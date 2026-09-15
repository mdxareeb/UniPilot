import sys

import pytest

from wa_service import calendar_push
from wa_service.calendar_push import build_event_body
from wa_service.config import Settings
from wa_service.supabase_client import ServiceError

SETTINGS = Settings(
    supabase_url="http://local", service_key="service", integrations_key="integrations-key",
    google_client_id="client-id", google_client_secret="client-secret",
    google_calendar_id="primary", default_timezone="Asia/Kolkata", date_order="DMY",
    ignore_senders=(), default_event_duration_minutes=60, message_cap=5000,
    candidate_cap=500, live_qr_timeout=180, live_max_messages=2000,
    live_scroll_wait=0.9, live_stale_rounds=7, profile_root="/tmp/profiles",
)

FP = "f" * 32


def candidate(**overrides):
    base = {
        "id": "c1", "user_id": "user-1", "event_id": "e1", "fingerprint": FP,
        "title": "Birthday party", "start_at": "2026-09-12T13:30:00Z",
        "end_at": None, "all_day": False, "pushed_at": None,
        "message_sender": "Priya", "message_text": "party at 7 pm",
    }
    base.update(overrides)
    return base


def event(**overrides):
    base = {
        "id": "e1", "description": "From WhatsApp (Priya):\n\nparty at 7 pm",
        "start_at": "2026-09-12T13:30:00Z", "end_at": None, "all_day": False,
    }
    base.update(overrides)
    return base


class FakeRequest:
    def __init__(self, payload):
        self.payload = payload

    def execute(self):
        return self.payload


class FakeEventsResource:
    def __init__(self, listed=None, inserted_id="google-1"):
        self.calls = []
        self.listed = listed if listed is not None else {"items": []}
        self.inserted_id = inserted_id

    def list(self, **kwargs):
        self.calls.append(("list", kwargs))
        return FakeRequest(self.listed)

    def insert(self, **kwargs):
        self.calls.append(("insert", kwargs))
        return FakeRequest({"id": self.inserted_id})


class FakeService:
    def __init__(self, listed=None, inserted_id="google-1"):
        self.events_resource = FakeEventsResource(listed, inserted_id)

    def events(self):
        return self.events_resource


class FakeClient:
    def __init__(self, candidate_row=None, event_row=None, credentials=None,
                 profile_timezone="Asia/Kolkata"):
        self.candidate_row = candidate_row
        self.event_row = event_row
        self.credentials = credentials
        self.profile_timezone = profile_timezone
        self.patches = []
        self.rpc_calls = []

    def select_one(self, table, params):
        if table == "integration_candidates":
            return self.candidate_row
        if table == "events":
            return self.event_row
        if table == "profiles":
            return {"timezone": self.profile_timezone}
        return None

    def rpc(self, name, body):
        self.rpc_calls.append((name, body))
        if name == "get_google_credentials":
            return self.credentials
        return None

    def patch(self, table, params, body):
        self.patches.append((table, params, body))


class FakeAuthError(Exception):
    pass


def test_timed_body_carries_summary_times_and_provenance():
    body = build_event_body(candidate(), event(), timezone="Asia/Kolkata")
    assert body["summary"] == "Birthday party"
    assert body["start"] == {"dateTime": "2026-09-12T13:30:00Z", "timeZone": "Asia/Kolkata"}
    assert body["end"] == {"dateTime": "2026-09-12T13:30:00Z", "timeZone": "Asia/Kolkata"}
    assert body["extendedProperties"]["private"]["unipilot_source_ref"] == "f" * 32


def test_all_day_body_uses_dates_and_next_day_end():
    body = build_event_body(
        candidate(all_day=True, start_at="2026-10-01T18:30:00Z", end_at="2026-10-02T18:30:00Z"),
        event(all_day=True, start_at="2026-10-01T18:30:00Z", end_at="2026-10-02T18:30:00Z"),
        timezone="Asia/Kolkata",
    )
    assert body["start"] == {"date": "2026-10-02"}
    assert body["end"] == {"date": "2026-10-03"}


def test_all_day_body_without_stored_end_adds_one_day():
    body = build_event_body(
        candidate(all_day=True, start_at="2026-10-01T18:30:00Z", end_at=None),
        event(all_day=True, start_at="2026-10-01T18:30:00Z", end_at=None),
        timezone="Asia/Kolkata",
    )
    assert body["start"] == {"date": "2026-10-02"}
    assert body["end"] == {"date": "2026-10-03"}


def test_body_description_comes_from_the_event():
    body = build_event_body(candidate(), event(description="From WhatsApp (Priya):\n\nparty at 7 pm"),
                            timezone="Asia/Kolkata")
    assert body["description"] == "From WhatsApp (Priya):\n\nparty at 7 pm"


def test_run_push_inserts_event_and_marks_candidate(monkeypatch):
    client = FakeClient(
        candidate_row=candidate(), event_row=event(),
        credentials=[{"refresh_token": "refresh-token", "calendar_id": "primary"}],
    )
    service = FakeService()
    monkeypatch.setattr(calendar_push, "refresh_credentials", lambda settings, token: "creds")
    monkeypatch.setattr(calendar_push, "build_service", lambda credentials: service)

    result = calendar_push.run_push(SETTINGS, client, "c1")

    assert result == {"pushed": True, "provider_event_id": "google-1"}
    rpc_name, rpc_body = client.rpc_calls[0]
    assert rpc_name == "get_google_credentials"
    assert rpc_body == {"p_user_id": "user-1", "p_key": "integrations-key"}
    assert [name for name, _ in service.events_resource.calls] == ["list", "insert"]
    list_kwargs = service.events_resource.calls[0][1]
    assert list_kwargs["calendarId"] == "primary"
    assert list_kwargs["privateExtendedProperty"] == [f"unipilot_source_ref={FP}"]
    insert_kwargs = service.events_resource.calls[1][1]
    assert insert_kwargs["calendarId"] == "primary"
    assert insert_kwargs["body"]["summary"] == "Birthday party"
    candidate_patch = next(
        body for table, params, body in client.patches if table == "integration_candidates"
    )
    assert candidate_patch["provider_event_id"] == "google-1"
    assert candidate_patch["pushed_at"]
    assert candidate_patch["push_error"] is None
    assert "refresh-token" not in str(client.patches) + str(result)


def test_run_push_reuses_event_found_by_source_ref(monkeypatch):
    client = FakeClient(
        candidate_row=candidate(), event_row=event(),
        credentials=[{"refresh_token": "refresh-token", "calendar_id": "primary"}],
    )
    service = FakeService(listed={"items": [{"id": "already-there"}]})
    monkeypatch.setattr(calendar_push, "refresh_credentials", lambda settings, token: "creds")
    monkeypatch.setattr(calendar_push, "build_service", lambda credentials: service)

    result = calendar_push.run_push(SETTINGS, client, "c1")

    assert result == {"pushed": True, "provider_event_id": "already-there"}
    assert [name for name, _ in service.events_resource.calls] == ["list"]
    candidate_patch = next(
        body for table, params, body in client.patches if table == "integration_candidates"
    )
    assert candidate_patch["provider_event_id"] == "already-there"


def test_already_pushed_candidate_is_a_noop(monkeypatch):
    client = FakeClient(candidate_row=candidate(pushed_at="2026-09-12T10:00:00Z"))
    called = []
    monkeypatch.setattr(calendar_push, "refresh_credentials",
                        lambda settings, token: called.append("refresh"))

    result = calendar_push.run_push(SETTINGS, client, "c1")

    assert result == {"pushed": False}
    assert called == []
    assert client.rpc_calls == []
    assert client.patches == []


def test_missing_credentials_is_a_noop():
    client = FakeClient(candidate_row=candidate(), credentials=[])
    assert calendar_push.run_push(SETTINGS, client, "c1") == {"pushed": False}
    assert client.patches == []


def test_missing_candidate_is_non_retryable():
    client = FakeClient(candidate_row=None)
    with pytest.raises(ServiceError) as excinfo:
        calendar_push.run_push(SETTINGS, client, "nope")
    assert excinfo.value.retryable is False


def test_invalid_grant_is_non_retryable(monkeypatch):
    client = FakeClient(
        candidate_row=candidate(), event_row=event(),
        credentials=[{"refresh_token": "refresh-token", "calendar_id": "primary"}],
    )

    def fail_refresh(settings, refresh_token):
        raise FakeAuthError("invalid_grant: Token has been expired or revoked.")

    monkeypatch.setattr(calendar_push, "refresh_credentials", fail_refresh)

    with pytest.raises(ServiceError) as excinfo:
        calendar_push.run_push(SETTINGS, client, "c1")

    assert excinfo.value.retryable is False
    candidate_patch = next(
        body for table, params, body in client.patches
        if table == "integration_candidates" and "push_error" in body
    )
    assert "invalid_grant" in candidate_patch["push_error"]
    assert "expired or revoked" not in candidate_patch["push_error"]
    connection = next(
        (params, body) for table, params, body in client.patches
        if table == "integration_connections"
    )
    assert connection[0] == {"user_id": "eq.user-1", "provider": "eq.google"}
    assert connection[1]["status"] == "error"


def test_provider_error_is_wrapped_as_retryable_and_sanitized(monkeypatch):
    client = FakeClient(
        candidate_row=candidate(), event_row=event(),
        credentials=[{"refresh_token": "refresh-token", "calendar_id": "primary"}],
    )

    def fail_refresh(settings, refresh_token):
        raise RuntimeError(f"provider exploded, token={refresh_token}")

    monkeypatch.setattr(calendar_push, "refresh_credentials", fail_refresh)

    with pytest.raises(ServiceError) as excinfo:
        calendar_push.run_push(SETTINGS, client, "c1")

    assert excinfo.value.retryable is True
    assert excinfo.value.message == "Google Calendar request failed"
    assert "refresh-token" not in str(excinfo.value)


def test_missing_google_libraries_are_non_retryable(monkeypatch):
    monkeypatch.setitem(sys.modules, "google.auth.transport.requests", None)
    with pytest.raises(ServiceError) as excinfo:
        calendar_push.refresh_credentials(SETTINGS, "refresh-token")
    assert isinstance(excinfo.value, calendar_push.GoogleLibsUnavailable)
    assert excinfo.value.retryable is False
    assert "whatsapp/requirements-google.txt" in excinfo.value.message


def test_missing_googleapiclient_is_non_retryable(monkeypatch):
    monkeypatch.setitem(sys.modules, "googleapiclient.discovery", None)
    with pytest.raises(ServiceError) as excinfo:
        calendar_push.build_service(object())
    assert isinstance(excinfo.value, calendar_push.GoogleLibsUnavailable)
    assert excinfo.value.retryable is False
    assert "whatsapp/requirements-google.txt" in excinfo.value.message
