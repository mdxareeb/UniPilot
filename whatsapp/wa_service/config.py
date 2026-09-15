"""Env-driven settings. No global file paths, no .env loading side effects."""
import os
from dataclasses import dataclass


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_key: str
    integrations_key: str
    google_client_id: str
    google_client_secret: str
    google_calendar_id: str
    default_timezone: str
    date_order: str
    ignore_senders: tuple[str, ...]
    default_event_duration_minutes: int
    message_cap: int
    candidate_cap: int
    live_qr_timeout: int
    live_max_messages: int
    live_scroll_wait: float
    live_stale_rounds: int
    profile_root: str


def load_settings() -> Settings:
    date_order = _env("DATE_ORDER", "DMY").upper()
    return Settings(
        supabase_url=_env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL"),
        service_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        integrations_key=_env("UNIPILOT_INTEGRATIONS_KEY"),
        google_client_id=_env("GOOGLE_OAUTH_CLIENT_ID"),
        google_client_secret=_env("GOOGLE_OAUTH_CLIENT_SECRET"),
        google_calendar_id=_env("GOOGLE_CALENDAR_ID", "primary"),
        default_timezone=_env("DEFAULT_TIMEZONE", "Asia/Kolkata"),
        date_order=date_order if date_order in ("DMY", "MDY") else "DMY",
        ignore_senders=tuple(s.strip() for s in _env("IGNORE_SENDERS").split(",") if s.strip()),
        default_event_duration_minutes=_int("DEFAULT_EVENT_DURATION_MINUTES", 60),
        message_cap=_int("WHATSAPP_MESSAGE_CAP", 5000),
        candidate_cap=_int("WHATSAPP_CANDIDATE_CAP", 500),
        live_qr_timeout=_int("LIVE_QR_TIMEOUT", 180),
        live_max_messages=_int("LIVE_MAX_MESSAGES", 2000),
        live_scroll_wait=_float("LIVE_SCROLL_WAIT", 0.9),
        live_stale_rounds=_int("LIVE_STALE_ROUNDS", 7),
        profile_root=_env("WHATSAPP_PROFILE_ROOT") or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".profiles"
        ),
    )
