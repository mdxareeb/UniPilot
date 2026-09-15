import io
import json
import os
import subprocess
import sys
from pathlib import Path

from wa_service import __main__ as cli


def _boom():
    raise RuntimeError("boom")


def test_unknown_action_is_non_retryable(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO('{"action": "nope"}'))
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    code = cli.main([])
    assert code == 1
    payload = json.loads(out.getvalue().strip().splitlines()[-1])
    assert payload == {"ok": False, "error": "unknown action", "retryable": False}


def test_unknown_action_from_argv_wins_over_payload(monkeypatch):
    # argv names an action while the payload names a real one: the argv action
    # must win, so `sync` is never dispatched (load_settings would blow up).
    monkeypatch.setattr("sys.stdin", io.StringIO('{"action": "sync", "runId": "r1"}'))
    monkeypatch.setattr(cli, "load_settings", _boom)
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    code = cli.main(["nope"])
    assert code == 1
    payload = json.loads(out.getvalue().strip().splitlines()[-1])
    assert payload == {"ok": False, "error": "unknown action", "retryable": False}


def test_main_defaults_to_sys_argv(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO('{"action": "sync", "runId": "r1"}'))
    monkeypatch.setattr("sys.argv", ["wa_service", "nope"])
    monkeypatch.setattr(cli, "load_settings", _boom)
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    code = cli.main()
    assert code == 1
    payload = json.loads(out.getvalue().strip().splitlines()[-1])
    assert payload == {"ok": False, "error": "unknown action", "retryable": False}


def test_module_invocation_takes_action_from_argv():
    package_root = Path(__file__).resolve().parent.parent
    env = dict(os.environ)
    env.update({"SUPABASE_URL": "", "NEXT_PUBLIC_SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""})
    result = subprocess.run(
        [sys.executable, "-m", "wa_service", "nope"],
        input='{"action": "sync", "runId": "r1"}',
        capture_output=True,
        text=True,
        cwd=package_root,
        env=env,
        timeout=30,
    )
    assert result.returncode == 1
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    assert payload == {"ok": False, "error": "unknown action", "retryable": False}


def test_invalid_json_is_non_retryable(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    code = cli.main([])
    assert code == 1
    payload = json.loads(out.getvalue().strip().splitlines()[-1])
    assert payload == {"ok": False, "error": "invalid job payload", "retryable": False}


def test_unexpected_failure_logs_traceback_and_sanitizes_stdout(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO('{"action": "sync", "runId": "r1"}'))
    out = io.StringIO()
    err = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    monkeypatch.setattr("sys.stderr", err)

    def boom():
        raise RuntimeError("boom")

    monkeypatch.setattr(cli, "load_settings", boom)
    code = cli.main([])
    assert code == 1
    payload = json.loads(out.getvalue().strip().splitlines()[-1])
    assert payload == {"ok": False, "error": "whatsapp service failed", "retryable": True}
    assert "Traceback (most recent call last)" in err.getvalue()
    assert "RuntimeError" in err.getvalue()
