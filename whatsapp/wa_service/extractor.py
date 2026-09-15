"""Detect events inside WhatsApp messages.

ONLY messages that contain an explicit numeric date/time format are
treated as events (e.g. "12/09/2026", "7 pm", "18:00-19:30",
"25th Sept", "on the 22nd at 5"). Vague keyword-only matches
("party tomorrow!") are ignored by design.
"""
import re
from datetime import timedelta, datetime

import dateparser

from .models import DetectedEvent

# A numeric date: 12/09/2026, 2026-09-18, 25th Sept, Sept 25
NUMERIC_DATE_RE = re.compile(
    r"""(?xi)\b(?:
        \d{4}-\d{1,2}-\d{1,2}                                  # 2026-09-18
      | \d{1,2}[/-]\d{1,2}[/-]\d{2,4}                          # 12/09/2026
      | (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?
      | \d{1,2}(?:st|nd|rd|th)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*\d{4})?
    )\b"""
)

# A clock time: "7 pm", "18:00", "10:30 am", "7.30 pm", "5 o'clock"
NUMERIC_TIME_RE = re.compile(
    r"(?xi)\b\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?|hrs?|o'?clock)\b"
    r"|\b(?:[01]?\d|2[0-3])[:][0-5]\d\b"
)

# Weekday/relative mentions, mirroring the DATE_PART alternatives.
RELATIVE_DATE_RE = re.compile(
    r"""(?xi)\b(?:
        day\s+after\s+tomorrow
      | tomorrow | tonight | today
      | (?:next|this)\s+(?:week|weekend|month|year)
      | (?:next\s+|this\s+|on\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day
    )\b"""
)

# Academic keywords that make a bare weekday/relative mention event-worthy.
ACADEMIC_RE = re.compile(
    r"(?xi)\b(?:submission|submit(?:ted|ting)?|exam|deadline|presentation|"
    r"class|test|quiz|assignment|viva|due)\b"
)

# Obvious non-event noise in groups
NOISE_RE = re.compile(
    r"^(ok|okay|k|done|thanks|thank you|yes|no|congrats|congratulations|"
    r"good morning|good night|gn|gm|haha+|lol|hii*|hey+|hello)\W*$",
    re.IGNORECASE,
)

DATE_PART = re.compile(
    r"""(?xi)\b(?P<date>
        \d{4}-\d{1,2}-\d{1,2}                                   # 2026-09-18
      | \d{1,2}[/-]\d{1,2}[/-]\d{2,4}                           # 12/09/2026
      | (?:day\s+after\s+)?tomorrow
      | tonight | today
      | (?:next|this)\s+(?:week|weekend|month|year)
      | (?:next\s+|this\s+|on\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day
      | (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?
      | \d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*\d{4})?
    )\b"""
)

# A clock time: "7 pm", "18:00", "10:30 am", "5 o'clock", "7.30 pm"
CLOCK_RE = re.compile(
    r"(?xi)\b(?P<h>\d{1,2})(?:[:.](?P<m>\d{2}))?\s*(?P<ap>[ap]\.?m\.?|hrs?|o'?clock)?\b"
)

# A time range: "5-7 pm", "18:00-19:30", "3 to 5 pm"
RANGE_RE = re.compile(
    r"(?xi)\b(?P<sh>\d{1,2})(?:[:.](?P<sm>\d{2}))?\s*(?:-|–|to)\s*"
    r"(?P<eh>\d{1,2})(?:[:.](?P<em>\d{2}))?\s*(?P<ap>[ap]\.?m\.?)?\b"
)


def _looks_like_event(text: str, *, relative_dates: bool = False) -> bool:
    """Only messages with an EXPLICIT numeric date/time qualify:
    "12/09/2026", "2026-09-18", "25th Sept", "7 pm", "18:00".
    With ``relative_dates`` a weekday/relative mention also qualifies, but
    ONLY when paired with a clock time or an academic keyword; keyword-only
    guesses ("party tomorrow") still do NOT."""
    if NOISE_RE.match(text.strip()):
        return False
    has_numeric_date = bool(NUMERIC_DATE_RE.search(text))
    has_numeric_time = bool(NUMERIC_TIME_RE.search(text))
    if has_numeric_date or has_numeric_time:
        return True
    if not relative_dates or not RELATIVE_DATE_RE.search(text):
        return False
    return bool(ACADEMIC_RE.search(text))


def _to_24h(hour: int, ampm: str or None) -> int:
    ampm = (ampm or "").lower().replace(".", "")
    if ampm.startswith("p") and hour < 12:
        return hour + 12
    if ampm.startswith("a") and hour == 12:
        return 0
    return hour


def _apply_clock(dt, m):
    """Apply a CLOCK_RE/RANGE_RE hour/minute/am-pm match onto a datetime."""
    h = _to_24h(int(m.group("h")), m.group("ap"))
    minute = int(m.group("m") or 0)
    return dt.replace(hour=min(h, 23), minute=minute, second=0, microsecond=0)


def _parse_time(message, *, now, date_order, envelope_date_order, default_duration_minutes):
    """Return (start, end, all_day, date_span) parsed from the message text,
    or (None, None, False, None). date_span = (idx_start, idx_end) of the
    date text within the original message, used for cleaner event titles."""
    text = message.text

    base = dateparser.parse(
        "{0.date_str} {0.time_str}".format(message),
        settings={"DATE_ORDER": envelope_date_order or date_order},
    ) or now or datetime.now()
    # Anchor relative parsing at the message day's midnight so a mention of
    # an earlier hour on that day is not read against the send timestamp.
    base = base.replace(hour=0, minute=0, second=0, microsecond=0)

    date_settings = {
        "RELATIVE_BASE": base,
        "PREFER_DATES_FROM": "future",
        "PREFER_DAY_OF_MONTH": "first",
        "DATE_ORDER": date_order,
    }

    # Find ALL date mentions first; prefer explicit ones (they contain digits)
    matches = list(DATE_PART.finditer(text))
    if not matches:
        return None, None, False, None
    # explicit numeric/ISO dates first, otherwise the earliest mention
    explicit = [m for m in matches if re.search(r"\d", m.group("date"))]
    chosen = explicit[0] if explicit else matches[0]
    date_span = (chosen.start(), chosen.end())

    date_frag = chosen.group("date")
    is_iso = re.match(r"^\d{4}-\d{1,2}-\d{1,2}$", date_frag)
    start = None
    # dateparser doesn't know "tonight" -> treat as today
    if date_frag.lower() == "tonight":
        start = base.replace(second=0, microsecond=0)
    # ISO dates break under DATE_ORDER; "next <day>" sometimes fails as-is
    attempt_settings = []
    if start is None:
        if is_iso:
            attempt_settings.append({k: v for k, v in date_settings.items() if k != "DATE_ORDER"})
        if date_frag.lower().startswith("next "):
            attempt_settings.append(date_settings)
            # fallback: "Friday" + future-preference usually equals "next Friday"
            stripped = {**date_settings}
            attempt_settings.append(stripped)
            date_frag = date_frag[5:]
        else:
            attempt_settings.append(date_settings)
        for st in attempt_settings:
            start = dateparser.parse(date_frag, settings=st)
            if start:
                break
    if not start:
        return None, None, False, None
    start = start.replace(second=0, microsecond=0)

    # dateparser's future preference adds a year when the candidate equals
    # RELATIVE_BASE, so with the base at the message day's midnight a mention
    # of that same day ("12th sept" sent 12 Sept) would roll to next year.
    # Keep the un-rolled year when the fragment resolves to the base day.
    current = dateparser.parse(
        date_frag,
        settings={**date_settings, "PREFER_DATES_FROM": "current_period"},
    )
    if (
        current
        and start.year == current.year + 1
        and (start.month, start.day) == (current.month, current.day)
        and current.date() == base.date()
    ):
        start = current.replace(second=0, microsecond=0)

    # text before/after the date fragment (look for times after mainly)
    before, after = text[:chosen.start()], text[chosen.end():]

    # 1) a range like "18:00-19:30" or "5-7 pm" -> start & end
    #    (search AFTER the date so "2026-09-18" isn't read as 09-18 range)
    rng = RANGE_RE.search(after)
    if rng:
        sh = _to_24h(int(rng.group("sh")), rng.group("ap"))
        sm = int(rng.group("sm") or 0)
        eh = _to_24h(int(rng.group("eh")), rng.group("ap"))
        em = int(rng.group("em") or 0)
        s = start.replace(hour=min(sh, 23), minute=sm)
        e = start.replace(hour=min(eh, 23), minute=em)
        if e > s:
            return s, e, False, date_span

    # 2) a single time mention
    clock = None
    for chunk in (after, before):
        clock = CLOCK_RE.search(chunk)
        if clock and (clock.group("ap") or clock.group("m")):
            break
        clock = None
    if clock:
        return _apply_clock(start, clock), None, False, date_span

    # 3) "tonight" implies evening but no exact time -> default duration at 19:00
    if re.search(r"\btonight\b", text, re.I):
        s = start.replace(hour=19, minute=0)
        return s, s + timedelta(minutes=default_duration_minutes), False, date_span

    # 4) no time at all -> all-day event
    midnight = start.replace(hour=0, minute=0)
    return midnight, None, True, date_span


def extract_events(messages, *, now=None, date_order="DMY", envelope_date_order=None,
                   relative_dates=False, default_duration_minutes=60, max_events=None) -> list:
    """Scan all messages and return a list of DetectedEvent objects.

    ``envelope_date_order`` parses the message timestamps (falls back to
    ``date_order``); message-TEXT dates always use ``date_order``.
    ``relative_dates`` opts into the conservative weekday/relative rules.
    """
    now = now or datetime.now()
    events = []
    for msg in messages:
        if not _looks_like_event(msg.text, relative_dates=relative_dates):
            continue
        start, end, all_day, date_span = _parse_time(
            msg,
            now=now,
            date_order=date_order,
            envelope_date_order=envelope_date_order,
            default_duration_minutes=default_duration_minutes,
        )
        if start is None:
            continue
        events.append(DetectedEvent(msg, start, end, all_day, date_span))

    # skip duplicates (same start + same text)
    seen = set()
    unique = []
    for e in events:
        key = (e.start, e.title.lower())
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique[:max_events] if max_events else unique
