from datetime import datetime

from wa_service import config
from wa_service.timezones import to_utc_rfc3339


def test_settings_defaults_are_the_documented_ones(monkeypatch):
    for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "UNIPILOT_INTEGRATIONS_KEY",
                 "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "DEFAULT_TIMEZONE",
                 "DATE_ORDER", "IGNORE_SENDERS", "WHATSAPP_PROFILE_ROOT"):
        monkeypatch.delenv(name, raising=False)
    settings = config.load_settings()
    assert settings.default_timezone == "Asia/Kolkata"
    assert settings.date_order == "DMY"
    assert settings.message_cap == 5000
    assert settings.candidate_cap == 500
    assert settings.ignore_senders == ()


def test_profile_timezone_beats_default():
    assert to_utc_rfc3339(datetime(2026, 9, 12, 19, 0), "Asia/Kolkata") == "2026-09-12T13:30:00Z"
