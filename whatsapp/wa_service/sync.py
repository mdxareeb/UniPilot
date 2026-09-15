"""Run orchestration: read → parse → extract → persist (spec §8).

Automatic review mode (`integration_runs.review_mode = 'automatic'`) settles
every pending candidate whose fingerprint the run detects: rows this run
created and earlier pending rows from previous runs that the scan re-detects.
Only that pending set gets event rows, so a re-detected fingerprint whose
candidate already reached a terminal status (confirmed or rejected) is never
re-inserted or re-queued. Pending candidates whose fingerprints are not in the
run's detected set (e.g. another chat) stay pending. Manual/no-mode runs keep
every candidate pending.

M1 accepted mixed state (review round 1): the event insert deliberately
precedes the guarded candidate settle, so a candidate rejected mid-run can
leave an orphan event behind; a later insert with the same fingerprint reuses
it through `source_ref`. The settle filters on `status = pending`, so a
terminal rejection is never overwritten and never enqueues a `whatsapp.push`.
"""
from datetime import datetime, timedelta

import dateparser

from . import extractor, fingerprint
from .config import Settings
from .reader import filter_ignored, infer_date_order, parse_chat_text
from .supabase_client import ServiceError
from .timezones import to_utc_rfc3339


def download_export(settings: Settings, client, run: dict) -> str:
    data = client.download_object("whatsapp-exports", run["storage_path"])
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("utf-16")


def _profile_timezone(client, user_id: str, fallback: str) -> str:
    profile = client.select_one("profiles", {"id": f"eq.{user_id}", "select": "timezone"})
    tz = (profile or {}).get("timezone") or fallback
    return tz if isinstance(tz, str) and tz else fallback


def _message_time(message, now: datetime, date_order: str = "DMY") -> datetime:
    parsed = dateparser.parse(
        f"{message.date_str} {message.time_str}",
        settings={"DATE_ORDER": date_order},
    )
    return parsed or now


def mark_run_failed(client, run_id: str, message: str, retryable: bool) -> None:
    client.patch("integration_runs", {"id": f"eq.{run_id}"}, {
        "status": "failed",
        "error": message,
        "completed_at": datetime.now().isoformat(),
    })


def run_export(settings: Settings, client, run: dict) -> dict:
    try:
        chat = download_export(settings, client, run)
        return _run(settings, client, run, chat)
    except ServiceError as error:
        mark_run_failed(client, run["id"], error.message, error.retryable)
        raise


def run_live(settings: Settings, client, run: dict, messages) -> dict:
    # live.py collects Message objects, then shares the exact persistence path.
    try:
        return _run(settings, client, run, None, messages=messages)
    except ServiceError as error:
        mark_run_failed(client, run["id"], error.message, error.retryable)
        raise


_SELECT_BATCH = 100


def _auto_confirm(settings, client, run, candidate_rows):
    """Automatic review mode: settle every pending candidate the run detects.

    Mirrors the TS confirm mapping (`confirmCandidate` in
    frontend/lib/data/integrations.ts): the event upsert is deduped on
    `(user_id, source, source_ref)`, falls back to the existing row when the
    insert is ignored, and the candidate then settles `confirmed` with that id.

    Scope: every pending candidate for the user whose fingerprint is in this
    run's detected set, whether this run created it or an earlier run left it
    pending. A re-scan whose candidates insert is ignored end to end still
    confirms the earlier pending rows it re-detects; the events insert covers
    exactly that pending set, so a fingerprint whose candidate already reached
    a terminal status (confirmed or rejected) is neither re-inserted nor
    re-queued. Pending candidates from other chats (fingerprints outside the
    detected set) stay pending.

    The settle is guarded on `status = pending`, so a candidate rejected while
    the run was in flight stays rejected and is not queued for Google push (the
    event insert itself is not undone: see the module docstring's M1 note).
    """
    detected_refs = list(dict.fromkeys(row["fingerprint"] for row in candidate_rows))
    if not detected_refs:
        return

    # PostgREST caps `in.()` lists; read the pending candidates in batches.
    pending = []
    for start in range(0, len(detected_refs), _SELECT_BATCH):
        batch = detected_refs[start:start + _SELECT_BATCH]
        pending.extend(client.select("integration_candidates", {
            "user_id": f"eq.{run['user_id']}",
            "status": "eq.pending",
            "fingerprint": f"in.({','.join(batch)})",
            "select": "id,fingerprint",
        }))
    if not pending:
        return

    pending_refs = {row["fingerprint"] for row in pending}
    sources_by_ref = {}
    for source in candidate_rows:
        if source["fingerprint"] in pending_refs:
            sources_by_ref.setdefault(source["fingerprint"], source)
    event_rows = [
        {
            "user_id": run["user_id"],
            "title": source["title"],
            "description": (
                f"From WhatsApp ({source['message_sender']}):\n\n{source['message_text']}"
            ),
            "start_at": source["start_at"],
            "end_at": source["end_at"],
            "all_day": source["all_day"],
            "source": "whatsapp",
            "source_ref": source["fingerprint"],
        }
        for source in sources_by_ref.values()
    ]
    inserted_events = client.insert(
        "events", event_rows,
        prefer="resolution=ignore-duplicates,return=representation",
        params={"on_conflict": "user_id,source,source_ref"},
    )
    event_id_by_ref = {
        row["source_ref"]: row["id"]
        for row in inserted_events
        if row.get("source_ref") and row.get("id")
    }
    ignored_refs = [
        row["source_ref"] for row in event_rows
        if row["source_ref"] not in event_id_by_ref
    ]
    # PostgREST caps `in.()` lists; fetch the pre-existing ids in batches.
    for start in range(0, len(ignored_refs), _SELECT_BATCH):
        batch = ignored_refs[start:start + _SELECT_BATCH]
        existing = client.select("events", {
            "user_id": f"eq.{run['user_id']}",
            "source": "eq.whatsapp",
            "source_ref": f"in.({','.join(batch)})",
            "select": "id,source_ref",
        })
        for row in existing:
            event_id_by_ref.setdefault(row["source_ref"], row["id"])

    confirmed_ids = []
    for pending_row in pending:
        event_id = event_id_by_ref.get(pending_row["fingerprint"])
        if not event_id:
            continue
        settled = client.patch(
            "integration_candidates",
            {
                "id": f"eq.{pending_row['id']}",
                "user_id": f"eq.{run['user_id']}",
                "status": "eq.pending",
            },
            {"status": "confirmed", "event_id": event_id},
            prefer="return=representation",
        )
        if settled:
            confirmed_ids.append(pending_row["id"])
    if not confirmed_ids:
        return

    connection = client.select_one("integration_connections", {
        "user_id": f"eq.{run['user_id']}",
        "provider": "eq.google",
        "select": "status",
    })
    if (connection or {}).get("status") != "connected":
        return
    if not (settings.google_client_id and settings.google_client_secret):
        return
    for candidate_id in confirmed_ids:
        client.insert(
            "jobs",
            [{
                "kind": "whatsapp.push",
                "payload": {"candidateId": candidate_id},
                "user_id": run["user_id"],
            }],
            prefer="return=minimal",
        )


def _run(settings, client, run, chat, messages=None):
    review_mode = run.get("review_mode") or "manual"
    if messages is None:
        messages = filter_ignored(parse_chat_text(chat), settings.ignore_senders)
    capped = len(messages) > settings.message_cap
    messages = messages[: settings.message_cap]

    tz = _profile_timezone(client, run["user_id"], settings.default_timezone)
    now = datetime.now()
    connection = client.select_one("integration_connections", {
        "user_id": f"eq.{run['user_id']}",
        "provider": "eq.whatsapp",
        "select": "date_order,detect_relative_dates",
    }) or {}
    date_order = connection.get("date_order")
    if date_order not in ("DMY", "MDY"):
        date_order = "DMY"
    envelope_order = infer_date_order(messages) or date_order
    events = extractor.extract_events(
        messages,
        now=now,
        date_order=date_order,
        envelope_date_order=envelope_order,
        relative_dates=bool(connection.get("detect_relative_dates")),
        default_duration_minutes=settings.default_event_duration_minutes,
        max_events=settings.candidate_cap,
    )

    message_rows = [
        {
            "run_id": run["id"],
            "user_id": run["user_id"],
            "position": index,
            "sender": message.sender,
            "sent_at": to_utc_rfc3339(_message_time(message, now, envelope_order), tz),
            "body": message.text,
        }
        for index, message in enumerate(messages)
    ]
    client.insert("integration_messages", message_rows, prefer="return=minimal")
    # Ids are read back by position instead of trusting a heavy insert response.
    inserted_messages = client.select(
        "integration_messages",
        {"run_id": f"eq.{run['id']}", "select": "id,position"},
    )
    message_id_by_position = {row["position"]: row["id"] for row in inserted_messages}

    candidate_rows = []
    for event in events:
        position = next(
            (i for i, message in enumerate(messages) if message is event.message),
            None,
        )
        end = event.end
        if event.all_day and end is None:
            # Spec §8: all-day instants are the half-open local-midnight pair.
            end = event.start + timedelta(days=1)
        candidate_rows.append({
            "user_id": run["user_id"],
            "run_id": run["id"],
            "fingerprint": fingerprint.event_fingerprint(
                event.start, event.end, event.message.sender, event.message.text
            ),
            "title": event.title,
            "start_at": to_utc_rfc3339(event.start, tz),
            "end_at": to_utc_rfc3339(end, tz) if end else None,
            "all_day": event.all_day,
            "message_id": message_id_by_position.get(position),
            "message_sender": event.message.sender,
            "message_text": event.message.text,
        })
    created = client.insert(
        "integration_candidates", candidate_rows,
        prefer="resolution=ignore-duplicates,return=representation",
        # PostgREST's ignore-duplicates defaults its conflict target to the
        # primary key; a re-scan conflicts on the fingerprint unique index, so
        # the target must be named or the second upload fails with a 409.
        params={"on_conflict": "user_id,fingerprint"},
    )
    if review_mode == "automatic":
        _auto_confirm(settings, client, run, candidate_rows)

    client.patch("integration_runs", {"id": f"eq.{run['id']}"}, {
        "status": "succeeded",
        "message_count": len(messages),
        "candidate_count": len(created),
        "error": "Input capped at the per-run limit; later messages were not scanned."
            if capped else None,
        "completed_at": datetime.now().isoformat(),
    })
    return {"messages": len(messages), "candidates": len(created), "capped": capped}
