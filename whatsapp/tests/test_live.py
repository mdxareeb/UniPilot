import sys
import types
from uuid import uuid4

import pytest

from wa_service import live
from wa_service.config import Settings
from wa_service.supabase_client import ServiceError


def settings_for(tmp_path):
    return Settings(
        supabase_url="http://local", service_key="s", integrations_key="k",
        google_client_id="", google_client_secret="", google_calendar_id="primary",
        default_timezone="Asia/Kolkata", date_order="DMY", ignore_senders=(),
        default_event_duration_minutes=60, message_cap=5000, candidate_cap=500,
        live_qr_timeout=5, live_max_messages=10, live_scroll_wait=0.1,
        live_stale_rounds=1, profile_root=str(tmp_path),
    )


def test_missing_chrome_is_non_retryable(monkeypatch, tmp_path):
    chrome_options = types.SimpleNamespace(
        Options=lambda: types.SimpleNamespace(
            add_argument=lambda *a, **k: None,
            add_experimental_option=lambda *a, **k: None,
        )
    )

    def raising_chrome(**kwargs):
        raise RuntimeError("chrome binary not found")

    fake_selenium = types.SimpleNamespace(webdriver=types.SimpleNamespace(Chrome=raising_chrome))
    monkeypatch.setitem(sys.modules, "selenium", fake_selenium)
    monkeypatch.setitem(sys.modules, "selenium.webdriver", types.SimpleNamespace(chrome=chrome_options))
    monkeypatch.setitem(sys.modules, "selenium.webdriver.chrome", chrome_options)
    monkeypatch.setitem(sys.modules, "selenium.webdriver.chrome.options", chrome_options)

    with pytest.raises(ServiceError) as excinfo:
        live.start_driver(settings_for(tmp_path), str(uuid4()))
    assert excinfo.value.retryable is False
    assert "Chrome" in excinfo.value.message
