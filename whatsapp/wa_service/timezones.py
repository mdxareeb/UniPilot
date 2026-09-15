"""Timezone conversion helpers."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def to_utc_rfc3339(naive: datetime, tz_name: str) -> str:
    aware = naive.replace(tzinfo=ZoneInfo(tz_name))
    return aware.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
