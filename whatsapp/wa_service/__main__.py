"""CLI contract: action in argv (`python -m wa_service <action>`) or in the
JSON payload on stdin, one JSON result line on stdout."""
import json
import sys
import traceback

from .config import load_settings
from .supabase_client import ServiceError, SupabaseRest


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    try:
        raw = sys.stdin.read() or "{}"
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
    except (ValueError, json.JSONDecodeError):
        print(json.dumps({"ok": False, "error": "invalid job payload", "retryable": False}))
        return 1

    action = argv[0] if argv else payload.get("action")
    try:
        if action == "sync":
            from . import sync

            settings = load_settings()
            client = SupabaseRest(settings.supabase_url, settings.service_key)
            run = client.select_one("integration_runs", {"id": f"eq.{payload['runId']}", "select": "*"})
            if run is None:
                raise ServiceError("run not found", retryable=False)
            client.patch("integration_runs", {"id": f"eq.{run['id']}"},
                         {"status": "running", "started_at": _now_iso()})
            if run["mode"] == "export":
                result = sync.run_export(settings, client, run)
            else:
                from . import live

                result = live.run_live_sync(settings, client, run)
        elif action == "push":
            from . import calendar_push

            settings = load_settings()
            client = SupabaseRest(settings.supabase_url, settings.service_key)
            result = calendar_push.run_push(settings, client, payload["candidateId"])
        elif action == "connect":
            from . import live

            settings = load_settings()
            client = SupabaseRest(settings.supabase_url, settings.service_key)
            result = live.run_connect(settings, client, payload["connectionId"])
        elif action == "disconnect":
            from . import live

            settings = load_settings()
            client = SupabaseRest(settings.supabase_url, settings.service_key)
            result = live.purge_profile(settings, payload["userId"])
        else:
            raise ServiceError("unknown action", retryable=False)
    except ServiceError as error:
        print(json.dumps({"ok": False, "error": error.message, "retryable": error.retryable}))
        return 1
    except Exception:
        # Never leak internals: the worker logs stderr; the job gets sanitized copy.
        print(traceback.format_exc(limit=3), file=sys.stderr)
        print(json.dumps({"ok": False, "error": "whatsapp service failed", "retryable": True}))
        return 1

    print(json.dumps({"ok": True, **result}))
    return 0


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
