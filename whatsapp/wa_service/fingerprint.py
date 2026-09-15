"""Stable identity for a detected event (moved from calendar_sync.py:103-112)."""
import hashlib
from datetime import datetime


def event_fingerprint(start: datetime, end: datetime | None, sender: str, text: str) -> str:
    raw = "|".join([
        start.strftime("%Y%m%d%H%M"),
        end.strftime("%Y%m%d%H%M") if end else "",
        sender,
        text.strip().lower()[:200],
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
