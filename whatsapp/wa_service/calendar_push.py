"""Push a confirmed candidate to Google Calendar (spec §8, task P2.6).

The Google libraries are imported lazily so the rest of the service still runs
on a worker host that did not install ``requirements-google.txt``. Tests never
touch the network: ``refresh_credentials`` and ``build_service`` are
module-level seams that tests monkeypatch, and ``run_push`` only talks to the
Supabase client passed in.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .supabase_client import ServiceError
from .sync import _profile_timezone

_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_INVALID_GRANT_MESSAGE = (
    "Google authorization expired (invalid_grant); reconnect Google Calendar."
)


class GoogleLibsUnavailable(ServiceError):
    def __init__(self):
        super().__init__(
            "Google libraries are not installed on this worker host "
            "(pip install -r whatsapp/requirements-google.txt)",
            retryable=False,
        )


def refresh_credentials(settings, refresh_token):
    """Mint an in-memory access token from the stored refresh token."""
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError as error:
        raise GoogleLibsUnavailable() from error
    credentials = Credentials(
        None,
        refresh_token=refresh_token,
        token_uri=_TOKEN_URI,
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=[_CALENDAR_SCOPE],
    )
    credentials.refresh(Request())
    return credentials


def build_service(credentials):
    """Build the Google Calendar v3 service object."""
    try:
        from googleapiclient.discovery import build
    except ImportError as error:
        raise GoogleLibsUnavailable() from error
    return build("calendar", "v3", credentials=credentials)


def _parse_instant(value) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _local_date(instant, tz_name: str):
    return _parse_instant(instant).astimezone(ZoneInfo(tz_name)).date()


def build_event_body(candidate: dict, event: dict, *, timezone: str) -> dict:
    body = {
        "summary": candidate["title"],
        "description": event.get("description") or "",
        "extendedProperties": {
            "private": {"unipilot_source_ref": candidate["fingerprint"]}
        },
    }
    if event.get("all_day"):
        start_date = _local_date(event["start_at"], timezone)
        if event.get("end_at"):
            end_date = _local_date(event["end_at"], timezone)
        else:
            end_date = start_date + timedelta(days=1)
        body["start"] = {"date": start_date.isoformat()}
        body["end"] = {"date": end_date.isoformat()}
    else:
        # Stored instants are already UTC; Google gets them verbatim plus the
        # profile timezone for display.
        start_at = event["start_at"]
        end_at = event.get("end_at") or start_at
        body["start"] = {"dateTime": start_at, "timeZone": timezone}
        body["end"] = {"dateTime": end_at, "timeZone": timezone}
    return body


def _credentials_row(client, settings, candidate):
    rows = client.rpc(
        "get_google_credentials",
        {"p_user_id": candidate["user_id"], "p_key": settings.integrations_key},
    )
    if isinstance(rows, list):
        return rows[0] if rows else None
    return rows


def _mark_invalid_grant(client, candidate) -> None:
    client.patch(
        "integration_candidates",
        {"id": f"eq.{candidate['id']}"},
        {"push_error": _INVALID_GRANT_MESSAGE},
    )
    client.patch(
        "integration_connections",
        {"user_id": f"eq.{candidate['user_id']}", "provider": "eq.google"},
        {"status": "error"},
    )


def run_push(settings, client, candidate_id: str) -> dict:
    candidate = client.select_one(
        "integration_candidates", {"id": f"eq.{candidate_id}", "select": "*"}
    )
    if candidate is None:
        raise ServiceError("candidate not found", retryable=False)
    if candidate.get("pushed_at"):
        return {"pushed": False}

    credentials_row = _credentials_row(client, settings, candidate)
    if not credentials_row:
        return {"pushed": False}

    event = client.select_one(
        "events", {"id": f"eq.{candidate['event_id']}", "select": "*"}
    )
    if event is None:
        raise ServiceError("candidate event not found", retryable=False)
    timezone_name = _profile_timezone(
        client, candidate["user_id"], settings.default_timezone
    )
    calendar_id = (
        credentials_row.get("calendar_id") or settings.google_calendar_id or "primary"
    )

    try:
        credentials = refresh_credentials(settings, credentials_row["refresh_token"])
        service = build_service(credentials)
        body = build_event_body(candidate, event, timezone=timezone_name)
        found = service.events().list(
            calendarId=calendar_id,
            privateExtendedProperty=[f"unipilot_source_ref={candidate['fingerprint']}"],
        ).execute()
        items = found.get("items") or []
        if items:
            provider_event_id = items[0]["id"]
        else:
            provider_event_id = service.events().insert(
                calendarId=calendar_id, body=body
            ).execute()["id"]
    except ServiceError:
        raise
    except Exception as error:
        if "invalid_grant" in str(error):
            _mark_invalid_grant(client, candidate)
            raise ServiceError(_INVALID_GRANT_MESSAGE, retryable=False) from error
        # Never surface raw provider text (it can carry tokens) to stderr/logs.
        raise ServiceError("Google Calendar request failed", retryable=True) from error

    client.patch(
        "integration_candidates",
        {"id": f"eq.{candidate['id']}"},
        {
            "pushed_at": datetime.now(timezone.utc).isoformat(),
            "provider_event_id": provider_event_id,
            "push_error": None,
        },
    )
    return {"pushed": True, "provider_event_id": provider_event_id}
