from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pytest

from wa_service import sync
from wa_service.config import Settings
from wa_service.models import Message
from wa_service.supabase_client import ServiceError

SETTINGS = Settings(
    supabase_url="http://local", service_key="service", integrations_key="k",
    google_client_id="", google_client_secret="", google_calendar_id="primary",
    default_timezone="Asia/Kolkata", date_order="DMY", ignore_senders=(),
    default_event_duration_minutes=60, message_cap=50, candidate_cap=10,
    live_qr_timeout=180, live_max_messages=2000, live_scroll_wait=0.9,
    live_stale_rounds=7, profile_root="/tmp/profiles",
)

GOOGLE_SETTINGS = replace(
    SETTINGS, google_client_id="google-client-id",
    google_client_secret="google-client-secret",
)

CHAT = (
    "[06/09/2026, 20:15:22] Priya: Birthday party on 12/09/2026 at 7 pm\n"
    "[06/09/2026, 20:16:05] Rahul: congrats\n"
)[:]

# Another explicit-date event on top of CHAT, so automatic-mode tests exercise
# two created candidates (CHAT alone yields one) without touching CHAT itself.
AUTO_CHAT = CHAT + "[06/09/2026, 20:30:00] Meera: Webinar on 2026-09-18 18:00-19:30\n"

# A third event (all-day) for the partial-insert coverage.
TRIPLE_CHAT = AUTO_CHAT + "[06/09/2026, 21:00:00] Priya: Picnic on 02/10/2026, all day at the park\n"

# Chat with no dated event, so the extractor detects nothing.
NO_EVENT_CHAT = "[06/09/2026, 20:16:05] Rahul: congrats\n"

FIXTURE = Path(__file__).parent / "fixtures" / "sample_chat.txt"


class FakeClient:
    def __init__(self, profile_timezone="Asia/Kolkata", google_status=None,
                 whatsapp_settings=None):
        self.patches = []
        self.patch_calls = []
        self.patch_responses = {}
        self.inserted = []
        self.insert_calls = []
        self.select_calls = []
        self.select_one_calls = []
        self.profile_timezone = profile_timezone
        self.google_status = google_status
        self.whatsapp_settings = whatsapp_settings
        self.message_rows = []
        self.insert_responses = {}
        self.select_responses = {}

    def select_one(self, table, params):
        self.select_one_calls.append((table, params))
        if table == "profiles":
            return {"timezone": self.profile_timezone}
        if table == "integration_connections":
            if params.get("provider") == "eq.whatsapp":
                return self.whatsapp_settings
            return None if self.google_status is None else {"status": self.google_status}
        return None

    def select(self, table, params):
        self.select_calls.append((table, params))
        if table == "integration_messages":
            return [
                {"id": f"m-{row['position']}", "position": row["position"]}
                for row in self.message_rows
            ]
        response = self.select_responses.get(table)
        if response is not None:
            return response(params) if callable(response) else list(response)
        return []

    def patch(self, table, params, body, prefer="return=minimal"):
        self.patches.append((table, params, body))
        self.patch_calls.append((table, params, body, prefer))
        response = self.patch_responses.get(table)
        if response is not None:
            return response(params, body) if callable(response) else list(response)
        if prefer == "return=representation":
            return [dict(body, id=str(params.get("id", "eq."))[len("eq."):])]
        return []

    def insert(self, table, body, prefer=None, params=None):
        rows = body if isinstance(body, list) else [body]
        self.inserted.append((table, rows, prefer))
        self.insert_calls.append((table, prefer, params))
        if table == "integration_messages":
            self.message_rows.extend(rows)
        response = self.insert_responses.get(table)
        if response is not None:
            return response(rows) if callable(response) else list(response)
        return [{"id": f"{table}-{i}"} for i, _ in enumerate(rows)]


def run_row():
    return {"id": "run-1", "user_id": "user-1", "mode": "export",
            "storage_path": "user-1/run-1/export.txt", "chat_name": None}


def automatic_client(google_status=None, event_insert=None, event_select=None,
                     pending_candidates=None, whatsapp_settings=None):
    client = FakeClient(google_status=google_status, whatsapp_settings=whatsapp_settings)
    client.insert_responses["integration_candidates"] = lambda rows: [
        {"id": f"cand-{i}", "fingerprint": row["fingerprint"]}
        for i, row in enumerate(rows)
    ]
    if event_insert is None:
        event_insert = lambda rows: [
            {"id": f"evt-{i}", "source_ref": row["source_ref"]}
            for i, row in enumerate(rows)
        ]
    client.insert_responses["events"] = event_insert
    if event_select is not None:
        client.select_responses["events"] = event_select

    def select_pending(params):
        requested = set(params["fingerprint"][len("in.("):-1].split(","))
        if pending_candidates is None:
            candidate_rows = next(
                (body for table, body, _ in client.inserted
                 if table == "integration_candidates"),
                [],
            )
            rows = [
                {"id": f"cand-{i}", "fingerprint": row["fingerprint"]}
                for i, row in enumerate(candidate_rows)
            ]
        else:
            rows = (
                pending_candidates(params)
                if callable(pending_candidates) else list(pending_candidates)
            )
        return [row for row in rows if row["fingerprint"] in requested]

    client.select_responses["integration_candidates"] = select_pending
    return client


def automatic_run():
    run = run_row()
    run["review_mode"] = "automatic"
    return run


def test_run_export_writes_messages_and_candidates_and_settles(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    result = sync.run_export(SETTINGS, client, run_row())
    assert result == {"messages": 2, "candidates": 1, "capped": False}
    tables = [row[0] for row in client.inserted]
    assert "integration_messages" in tables
    assert "integration_candidates" in tables
    message_rows = next(rows for table, rows, _ in client.inserted if table == "integration_messages")
    assert [row["position"] for row in message_rows] == [0, 1]
    candidate = next(rows[0] for table, rows, _ in client.inserted if table == "integration_candidates")
    assert candidate["user_id"] == "user-1"
    assert candidate["all_day"] is False
    assert candidate["message_id"] == "m-0"
    run_patch = next(body for table, params, body in client.patches if table == "integration_runs")
    assert run_patch["status"] == "succeeded"
    assert run_patch["message_count"] == 2
    assert run_patch["candidate_count"] == 1
    assert run_patch["completed_at"]


def test_early_dedupe_does_not_count_existing_candidates(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    real_insert = client.insert

    def insert(table, body, prefer=None, params=None):
        rows = real_insert(table, body, prefer, params)
        if table == "integration_candidates":
            return []  # Prefer: ignore-duplicates returned none
        return rows

    client.insert = insert
    result = sync.run_export(SETTINGS, client, run_row())
    assert result["candidates"] == 0


def test_candidate_insert_names_the_fingerprint_conflict_target(monkeypatch):
    # PostgREST's ignore-duplicates defaults to the primary key; without the
    # fingerprint target a re-scan's insert violates the unique index and the
    # run fails with a 409 (P5.2's re-sync proof).
    client = FakeClient()
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    sync.run_export(SETTINGS, client, run_row())
    candidate_calls = [
        call for call in client.insert_calls if call[0] == "integration_candidates"
    ]
    assert candidate_calls
    assert candidate_calls[0][1] == "resolution=ignore-duplicates,return=representation"
    assert candidate_calls[0][2] == {"on_conflict": "user_id,fingerprint"}


def test_message_cap_reports_capped(monkeypatch):
    client = FakeClient()
    many = "\n".join(f"[06/09/2026, 20:00:{i:02d}] A: event 12/09/2026 at {i % 24}:00" for i in range(60))
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: many)
    result = sync.run_export(SETTINGS, client, run_row())
    assert result["messages"] == 50
    assert result["capped"] is True
    message_rows = next(rows for table, rows, _ in client.inserted if table == "integration_messages")
    assert len(message_rows) == SETTINGS.message_cap
    candidate_rows = next(rows for table, rows, _ in client.inserted if table == "integration_candidates")
    assert len(candidate_rows) == SETTINGS.candidate_cap
    assert len(candidate_rows) <= SETTINGS.candidate_cap


def test_all_day_candidate_stores_exclusive_end(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(
        sync, "download_export",
        lambda settings, client, run: FIXTURE.read_text(encoding="utf-8"),
    )
    sync.run_export(SETTINGS, client, run_row())
    candidates = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    candidate = next(row for row in candidates if "picnic" in row["title"])
    assert candidate["all_day"] is True
    # 2026-10-02 00:00 Asia/Kolkata == 2026-10-01T18:30:00Z.
    assert candidate["start_at"] == "2026-10-01T18:30:00Z"
    # Exclusive next-day local midnight == 2026-10-03 00:00 IST.
    assert candidate["end_at"] == "2026-10-02T18:30:00Z"


def test_profile_timezone_wins(monkeypatch):
    client = FakeClient(profile_timezone="Europe/London")
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    sync.run_export(SETTINGS, client, run_row())
    candidate = next(rows[0] for table, rows, _ in client.inserted if table == "integration_candidates")
    # 19:00 Asia/Kolkata == 13:30 UTC; 19:00 Europe/London (BST) == 18:00 UTC.
    assert candidate["start_at"].startswith("2026-09-12T18:00")


def test_sync_failure_marks_run_failed(monkeypatch):
    client = FakeClient()

    def fail(settings, client, run):
        raise ServiceError("export object missing", retryable=False)

    monkeypatch.setattr(sync, "download_export", fail)
    with pytest.raises(ServiceError):
        sync.run_export(SETTINGS, client, run_row())
    run_patch = next(body for table, params, body in client.patches if table == "integration_runs")
    assert run_patch["status"] == "failed"
    assert run_patch["error"] == "export object missing"
    assert run_patch["completed_at"]


def test_message_time_parses_chat_timestamp_with_date_order():
    fallback = datetime(2020, 1, 1, 0, 0)
    message = Message("06/09/2026", "20:15:22", "Priya", "x")
    assert sync._message_time(message, fallback, "DMY") == datetime(2026, 9, 6, 20, 15, 22)
    assert sync._message_time(message, fallback, "MDY") == datetime(2026, 6, 9, 20, 15, 22)


def test_message_time_falls_back_when_unparseable():
    fallback = datetime(2020, 1, 1, 0, 0)
    message = Message("nonsense", "nonsense", "A", "x")
    assert sync._message_time(message, fallback, "DMY") == fallback


def test_automatic_run_confirms_created_candidates_into_events(monkeypatch):
    client = automatic_client()
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(SETTINGS, client, automatic_run())

    candidates = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    assert [row["message_sender"] for row in candidates] == ["Priya", "Meera"]

    pending_selects = [
        params for table, params in client.select_calls
        if table == "integration_candidates"
    ]
    assert pending_selects == [{
        "user_id": "eq.user-1",
        "status": "eq.pending",
        "fingerprint": (
            f"in.({candidates[0]['fingerprint']},{candidates[1]['fingerprint']})"
        ),
        "select": "id,fingerprint",
    }]

    event_inserts = [call for call in client.insert_calls if call[0] == "events"]
    assert len(event_inserts) == 1
    assert event_inserts[0][1] == "resolution=ignore-duplicates,return=representation"
    assert event_inserts[0][2] == {"on_conflict": "user_id,source,source_ref"}
    event_rows = next(rows for table, rows, _ in client.inserted if table == "events")
    assert event_rows == [
        {
            "user_id": "user-1",
            "title": candidates[0]["title"],
            "description": "From WhatsApp (Priya):\n\nBirthday party on 12/09/2026 at 7 pm",
            "start_at": "2026-09-12T13:30:00Z",
            "end_at": None,
            "all_day": False,
            "source": "whatsapp",
            "source_ref": candidates[0]["fingerprint"],
        },
        {
            "user_id": "user-1",
            "title": candidates[1]["title"],
            "description": "From WhatsApp (Meera):\n\nWebinar on 2026-09-18 18:00-19:30",
            "start_at": "2026-09-18T12:30:00Z",
            "end_at": "2026-09-18T14:00:00Z",
            "all_day": False,
            "source": "whatsapp",
            "source_ref": candidates[1]["fingerprint"],
        },
    ]

    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [(p[1], p[2]) for p in candidate_patches] == [
        (
            {"id": "eq.cand-0", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-0"},
        ),
        (
            {"id": "eq.cand-1", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-1"},
        ),
    ]
    assert not [call for call in client.insert_calls if call[0] == "jobs"]


def test_automatic_run_enqueues_push_jobs_when_google_connected(monkeypatch):
    client = automatic_client(google_status="connected")
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    connection_calls = [
        params for table, params in client.select_one_calls if table == "integration_connections"
    ]
    assert connection_calls == [
        {"user_id": "eq.user-1", "provider": "eq.whatsapp",
         "select": "date_order,detect_relative_dates"},
        {"user_id": "eq.user-1", "provider": "eq.google", "select": "status"},
    ]
    job_calls = [call for call in client.inserted if call[0] == "jobs"]
    assert [(rows, prefer) for _, rows, prefer in job_calls] == [
        (
            [{"kind": "whatsapp.push", "payload": {"candidateId": "cand-0"}, "user_id": "user-1"}],
            "return=minimal",
        ),
        (
            [{"kind": "whatsapp.push", "payload": {"candidateId": "cand-1"}, "user_id": "user-1"}],
            "return=minimal",
        ),
    ]


def test_automatic_run_reuses_existing_events_for_ignored_inserts(monkeypatch):
    def existing_events(params):
        refs = params["source_ref"][len("in.("):-1].split(",")
        return [
            {"id": f"evt-existing-{i}", "source_ref": ref}
            for i, ref in enumerate(refs)
        ]

    client = automatic_client(event_insert=[], event_select=existing_events)
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(SETTINGS, client, automatic_run())

    # The ignored insert must not be retried; its rows are already in `events`.
    event_inserts = [call for call in client.insert_calls if call[0] == "events"]
    assert len(event_inserts) == 1
    assert len(next(rows for table, rows, _ in client.inserted if table == "events")) == 2

    event_selects = [params for table, params in client.select_calls if table == "events"]
    assert len(event_selects) == 1
    assert event_selects[0]["user_id"] == "eq.user-1"
    assert event_selects[0]["source"] == "eq.whatsapp"
    assert event_selects[0]["source_ref"].startswith("in.(")
    assert event_selects[0]["select"] == "id,source_ref"

    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [(p[1], p[2]) for p in candidate_patches] == [
        (
            {"id": "eq.cand-0", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-existing-0"},
        ),
        (
            {"id": "eq.cand-1", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-existing-1"},
        ),
    ]
    assert not [call for call in client.insert_calls if call[0] == "jobs"]


@pytest.mark.parametrize("mode", [None, "manual"])
def test_manual_run_leaves_candidates_pending(monkeypatch, mode):
    client = FakeClient(google_status="connected")
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    run = run_row()
    if mode is not None:
        run["review_mode"] = mode
    result = sync.run_export(SETTINGS, client, run)

    assert result["candidates"] == 2
    assert [call[0] for call in client.insert_calls] == [
        "integration_messages", "integration_candidates",
    ]
    assert [p for p in client.patches if p[0] == "integration_candidates"] == []
    assert not [
        entry for entry in client.select_one_calls
        if entry[0] == "integration_connections" and entry[1].get("provider") == "eq.google"
    ]


def test_automatic_rescan_confirms_earlier_pending_candidates(monkeypatch):
    def earlier_pending(params):
        refs = params["fingerprint"][len("in.("):-1].split(",")
        return [
            {"id": f"pending-{i}", "fingerprint": ref}
            for i, ref in enumerate(refs)
        ]

    client = automatic_client(
        google_status="connected", pending_candidates=earlier_pending,
    )
    client.insert_responses["integration_candidates"] = []
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    result = sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    assert result["candidates"] == 0
    candidate_rows = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    event_inserts = [call for call in client.insert_calls if call[0] == "events"]
    assert len(event_inserts) == 1
    assert event_inserts[0][1] == "resolution=ignore-duplicates,return=representation"
    assert event_inserts[0][2] == {"on_conflict": "user_id,source,source_ref"}
    event_rows = next(rows for table, rows, _ in client.inserted if table == "events")
    assert [row["source_ref"] for row in event_rows] == [
        row["fingerprint"] for row in candidate_rows
    ]

    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [(p[1], p[2]) for p in candidate_patches] == [
        (
            {"id": "eq.pending-0", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-0"},
        ),
        (
            {"id": "eq.pending-1", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-1"},
        ),
    ]
    job_ids = [
        rows[0]["payload"]["candidateId"]
        for table, rows, _ in client.inserted if table == "jobs"
    ]
    assert job_ids == ["pending-0", "pending-1"]


def test_automatic_rescan_without_pending_candidates_writes_nothing(monkeypatch):
    client = automatic_client(google_status="connected", pending_candidates=[])
    client.insert_responses["integration_candidates"] = []
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    result = sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    assert result["candidates"] == 0
    assert [call[0] for call in client.insert_calls] == [
        "integration_messages", "integration_candidates",
    ]
    assert [p for p in client.patches if p[0] == "integration_candidates"] == []
    assert not [call for call in client.insert_calls if call[0] == "jobs"]


def test_pending_candidates_outside_detected_set_stay_pending(monkeypatch):
    foreign = {"id": "foreign-cand", "fingerprint": "fp-other-chat"}

    def pending_candidates(params):
        refs = params["fingerprint"][len("in.("):-1].split(",")
        return [
            {"id": f"in-set-{i}", "fingerprint": ref}
            for i, ref in enumerate(refs)
        ] + [foreign]

    client = automatic_client(
        google_status="connected", pending_candidates=pending_candidates,
    )
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    candidate_rows = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    pending_selects = [
        params for table, params in client.select_calls
        if table == "integration_candidates"
    ]
    assert len(pending_selects) == 1
    assert pending_selects[0]["fingerprint"] == (
        f"in.({candidate_rows[0]['fingerprint']},{candidate_rows[1]['fingerprint']})"
    )
    assert "fp-other-chat" not in pending_selects[0]["fingerprint"]

    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [p[1]["id"] for p in candidate_patches] == ["eq.in-set-0", "eq.in-set-1"]
    event_rows = next(rows for table, rows, _ in client.inserted if table == "events")
    assert [row["source_ref"] for row in event_rows] == [
        candidate_rows[0]["fingerprint"],
        candidate_rows[1]["fingerprint"],
    ]
    job_ids = [
        rows[0]["payload"]["candidateId"]
        for table, rows, _ in client.inserted if table == "jobs"
    ]
    assert job_ids == ["in-set-0", "in-set-1"]


def test_automatic_rescan_does_not_resurrect_rejected_fingerprint(monkeypatch):
    def pending_from_first(params):
        refs = params["fingerprint"][len("in.("):-1].split(",")
        return [{"id": "cand-0", "fingerprint": refs[0]}]

    client = automatic_client(
        google_status="connected", pending_candidates=pending_from_first,
    )
    client.insert_responses["integration_candidates"] = []
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    candidate_rows = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    pending_selects = [
        params for table, params in client.select_calls
        if table == "integration_candidates"
    ]
    assert pending_selects == [{
        "user_id": "eq.user-1",
        "status": "eq.pending",
        "fingerprint": (
            f"in.({candidate_rows[0]['fingerprint']},{candidate_rows[1]['fingerprint']})"
        ),
        "select": "id,fingerprint",
    }]
    event_rows = next(rows for table, rows, _ in client.inserted if table == "events")
    assert [row["source_ref"] for row in event_rows] == [
        candidate_rows[0]["fingerprint"],
    ]
    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [(p[1], p[2]) for p in candidate_patches] == [
        (
            {"id": "eq.cand-0", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-0"},
        ),
    ]
    job_ids = [
        rows[0]["payload"]["candidateId"]
        for table, rows, _ in client.inserted if table == "jobs"
    ]
    assert job_ids == ["cand-0"]


def test_automatic_rescan_does_not_restate_already_confirmed_fingerprint(monkeypatch):
    def pending_from_second(params):
        refs = params["fingerprint"][len("in.("):-1].split(",")
        return [{"id": "earlier-1", "fingerprint": refs[1]}]

    client = automatic_client(
        google_status="connected", pending_candidates=pending_from_second,
    )
    client.insert_responses["integration_candidates"] = []
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    candidate_rows = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    event_rows = next(rows for table, rows, _ in client.inserted if table == "events")
    assert [row["source_ref"] for row in event_rows] == [
        candidate_rows[1]["fingerprint"],
    ]
    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [(p[1], p[2]) for p in candidate_patches] == [
        (
            {"id": "eq.earlier-1", "user_id": "eq.user-1", "status": "eq.pending"},
            {"status": "confirmed", "event_id": "evt-0"},
        ),
    ]
    job_ids = [
        rows[0]["payload"]["candidateId"]
        for table, rows, _ in client.inserted if table == "jobs"
    ]
    assert job_ids == ["earlier-1"]


def test_automatic_run_with_no_detected_events_is_a_noop(monkeypatch):
    client = automatic_client(google_status="connected")
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: NO_EVENT_CHAT)
    result = sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    assert result == {"messages": 1, "candidates": 0, "capped": False}
    assert [call[0] for call in client.insert_calls] == [
        "integration_messages", "integration_candidates",
    ]
    assert not [
        params for table, params in client.select_calls
        if table == "integration_candidates"
    ]
    assert [p for p in client.patches if p[0] == "integration_candidates"] == []
    assert not [
        entry for entry in client.select_one_calls
        if entry[0] == "integration_connections" and entry[1].get("provider") == "eq.google"
    ]


def test_automatic_run_handles_partial_inserts(monkeypatch):
    def mixed_candidates(rows):
        # PostgREST returns only inserted rows: row 1 was a duplicate.
        return [
            {"id": "cand-0", "fingerprint": rows[0]["fingerprint"]},
            {"id": "cand-2", "fingerprint": rows[2]["fingerprint"]},
        ]

    def mixed_events(rows):
        # Only the first event is new; the second already exists.
        return [{"id": "evt-new", "source_ref": rows[0]["source_ref"]}]

    def existing_events(params):
        refs = params["source_ref"][len("in.("):-1].split(",")
        return [
            {"id": f"evt-existing-{i}", "source_ref": ref}
            for i, ref in enumerate(refs)
        ]

    def mixed_pending(params):
        refs = params["fingerprint"][len("in.("):-1].split(",")
        return [
            {"id": "cand-0", "fingerprint": refs[0]},
            {"id": "earlier-1", "fingerprint": refs[1]},
            {"id": "cand-2", "fingerprint": refs[2]},
        ]

    client = automatic_client(
        google_status="connected", event_insert=mixed_events,
        event_select=existing_events, pending_candidates=mixed_pending,
    )
    client.insert_responses["integration_candidates"] = mixed_candidates
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: TRIPLE_CHAT)
    sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    candidate_rows = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    assert len(candidate_rows) == 3
    event_rows = next(rows for table, rows, _ in client.inserted if table == "events")
    assert [row["source_ref"] for row in event_rows] == [
        candidate_rows[0]["fingerprint"],
        candidate_rows[1]["fingerprint"],
        candidate_rows[2]["fingerprint"],
    ]

    event_selects = [params for table, params in client.select_calls if table == "events"]
    assert len(event_selects) == 1
    assert event_selects[0]["source_ref"] == (
        f"in.({candidate_rows[1]['fingerprint']},{candidate_rows[2]['fingerprint']})"
    )

    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [(p[1]["id"], p[2]["event_id"]) for p in candidate_patches] == [
        ("eq.cand-0", "evt-new"),
        ("eq.earlier-1", "evt-existing-0"),
        ("eq.cand-2", "evt-existing-1"),
    ]
    job_ids = [
        rows[0]["payload"]["candidateId"]
        for table, rows, _ in client.inserted if table == "jobs"
    ]
    assert job_ids == ["cand-0", "earlier-1", "cand-2"]


def test_automatic_run_never_pushes_a_candidate_that_lost_the_pending_race(monkeypatch):
    client = automatic_client(google_status="connected")

    def settle(params, body):
        if params["id"] == "eq.cand-1":
            return []  # rejected between the run's read and this guarded settle
        return [dict(body, id=params["id"][len("eq."):])]

    client.patch_responses["integration_candidates"] = settle
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(GOOGLE_SETTINGS, client, automatic_run())

    settle_calls = [call for call in client.patch_calls if call[0] == "integration_candidates"]
    assert [(call[1], call[3]) for call in settle_calls] == [
        (
            {"id": "eq.cand-0", "user_id": "eq.user-1", "status": "eq.pending"},
            "return=representation",
        ),
        (
            {"id": "eq.cand-1", "user_id": "eq.user-1", "status": "eq.pending"},
            "return=representation",
        ),
    ]
    job_ids = [
        rows[0]["payload"]["candidateId"]
        for table, rows, _ in client.inserted if table == "jobs"
    ]
    assert job_ids == ["cand-0"]


def test_automatic_run_without_google_client_env_does_not_enqueue_jobs(monkeypatch):
    client = automatic_client(google_status="connected")
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(SETTINGS, client, automatic_run())

    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert len(candidate_patches) == 2
    assert not [call for call in client.insert_calls if call[0] == "jobs"]


def test_automatic_run_settles_by_pending_select_when_representation_lacks_fingerprint(monkeypatch):
    client = automatic_client()
    client.insert_responses["integration_candidates"] = lambda rows: [
        {"id": f"cand-{i}"} for i, _ in enumerate(rows)
    ]
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: AUTO_CHAT)
    sync.run_export(SETTINGS, client, automatic_run())

    candidate_rows = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    pending_selects = [
        params for table, params in client.select_calls
        if table == "integration_candidates"
    ]
    assert len(pending_selects) == 1
    assert pending_selects[0]["fingerprint"] == (
        f"in.({candidate_rows[0]['fingerprint']},{candidate_rows[1]['fingerprint']})"
    )
    event_rows = next(rows for table, rows, _ in client.inserted if table == "events")
    assert [row["source_ref"] for row in event_rows] == [
        candidate_rows[0]["fingerprint"],
        candidate_rows[1]["fingerprint"],
    ]
    candidate_patches = [p for p in client.patches if p[0] == "integration_candidates"]
    assert [(p[1]["id"], p[2]["event_id"]) for p in candidate_patches] == [
        ("eq.cand-0", "evt-0"),
        ("eq.cand-1", "evt-1"),
    ]


def test_auto_confirm_chunks_the_ignored_events_lookup():
    requested = []

    def pending_candidates(params):
        refs = params["fingerprint"][len("in.("):-1].split(",")
        return [{"id": f"cand-{ref}", "fingerprint": ref} for ref in refs]

    def existing_events(params):
        requested.append(params["source_ref"])
        return []

    client = automatic_client(
        event_insert=[], event_select=existing_events,
        pending_candidates=pending_candidates,
    )
    candidate_rows = [
        {
            "fingerprint": f"fp-{i}",
            "title": f"event {i}",
            "start_at": "2026-09-12T13:30:00Z",
            "end_at": None,
            "all_day": False,
            "message_sender": "Priya",
            "message_text": "event",
        }
        for i in range(150)
    ]

    sync._auto_confirm(GOOGLE_SETTINGS, client, run_row(), candidate_rows)

    assert [len(batch[len("in.("):-1].split(",")) for batch in requested] == [100, 50]


def test_auto_confirm_chunks_the_pending_candidates_lookup():
    requested = []

    def pending_candidates(params):
        refs = params["fingerprint"][len("in.("):-1].split(",")
        requested.append(refs)
        return [{"id": f"cand-{ref}", "fingerprint": ref} for ref in refs]

    client = automatic_client(pending_candidates=pending_candidates)
    candidate_rows = [
        {
            "fingerprint": f"fp-{i}",
            "title": f"event {i}",
            "start_at": "2026-09-12T13:30:00Z",
            "end_at": None,
            "all_day": False,
            "message_sender": "Priya",
            "message_text": "event",
        }
        for i in range(150)
    ]

    sync._auto_confirm(GOOGLE_SETTINGS, client, run_row(), candidate_rows)

    assert [len(batch) for batch in requested] == [100, 50]
    assert requested[0][0] == "fp-0"
    assert requested[1][-1] == "fp-149"


MDY_CHAT = (
    "[9/12/26, 1:40:35 PM] Aisha: 12th sept is our final exam\n"
    "[9/13/26, 9:02:00 AM] Ben: friday submission check\n"
)


def test_run_reads_whatsapp_detection_settings_once(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    sync.run_export(SETTINGS, client, run_row())
    whatsapp_calls = [
        params for table, params in client.select_one_calls
        if table == "integration_connections" and params.get("provider") == "eq.whatsapp"
    ]
    assert whatsapp_calls == [{
        "user_id": "eq.user-1",
        "provider": "eq.whatsapp",
        "select": "date_order,detect_relative_dates",
    }]


def test_inferred_mdy_envelope_fixes_message_sent_at(monkeypatch):
    client = FakeClient(
        whatsapp_settings={"date_order": "DMY", "detect_relative_dates": False}
    )
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: MDY_CHAT)
    sync.run_export(SETTINGS, client, run_row())
    message_rows = next(
        rows for table, rows, _ in client.inserted if table == "integration_messages"
    )
    # 1:40:35 PM on 2026-09-12 Asia/Kolkata == 08:10:35Z (DMY would say Dec 9).
    assert message_rows[0]["sent_at"] == "2026-09-12T08:10:35Z"


def test_envelope_inference_beats_connection_order_for_events(monkeypatch):
    client = FakeClient(
        whatsapp_settings={"date_order": "DMY", "detect_relative_dates": False}
    )
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: MDY_CHAT)
    sync.run_export(SETTINGS, client, run_row())
    candidates = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    # "12th sept" sent under an inferred-MDY envelope resolves to 2026-09-12 IST.
    assert len(candidates) == 1
    assert candidates[0]["all_day"] is True
    assert candidates[0]["start_at"] == "2026-09-11T18:30:00Z"


def test_connection_relative_dates_flag_enables_weekday_detection(monkeypatch):
    client = FakeClient(
        whatsapp_settings={"date_order": "DMY", "detect_relative_dates": True}
    )
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: MDY_CHAT)
    sync.run_export(SETTINGS, client, run_row())
    candidates = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    assert len(candidates) == 2
    assert [row["all_day"] for row in candidates] == [True, True]
    # Friday after the 2026-09-13 message == 2026-09-18 IST.
    assert candidates[1]["start_at"] == "2026-09-17T18:30:00Z"


@pytest.mark.parametrize(
    ("order", "expected"),
    [("MDY", "2026-10-12T13:30:00Z"), ("DMY", "2026-12-10T13:30:00Z")],
)
def test_connection_date_order_governs_message_text_dates(monkeypatch, order, expected):
    chat = "[9/12/26, 1:40:35 PM] Aisha: dinner on 10/12/2026 at 7 pm\n"
    client = FakeClient(
        whatsapp_settings={"date_order": order, "detect_relative_dates": False}
    )
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: chat)
    sync.run_export(SETTINGS, client, run_row())
    candidates = next(
        rows for table, rows, _ in client.inserted if table == "integration_candidates"
    )
    assert candidates[0]["start_at"] == expected
