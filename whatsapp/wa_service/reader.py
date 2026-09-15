"""Read and parse exported WhatsApp chat files (.txt).

Supports both 12-hour and 24-hour export formats, e.g.:
    [06/02/2026, 21:14:33] Alice: message text
    2/6/26, 9:14 PM - Alice: message text
"""
import re
from pathlib import Path

from .models import Message

# [dd/mm/yyyy, hh:mm(:ss)] or m/d/yy, h:mm AM/PM
# Fifth authorized delta: the sender runs up to the first colon; colon-less
# system lines carry no sender and their full remainder becomes the text.
LINE_RE = re.compile(
    r"^\[?(?P<date>\d{1,2}[/.]\d{1,2}[/.]\d{2,4})[, ]+"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)\]?\s*[-–]?\s*"
    r"(?:(?P<sender>[^:]+):\s?(?P<text>.*)|(?P<system_text>.*))$"
)


def parse_chat_text(text: str) -> list[Message]:
    """Parse exported chat text into a list of Message objects."""
    messages = []
    current = None
    for raw in text.splitlines():
        line = raw.strip("\u200f\u200e")
        m = LINE_RE.match(line.strip())
        if m:
            sender = m.group("sender")
            if sender is None:
                sender, text = "", m.group("system_text")
            else:
                text = m.group("text")
            current = Message(
                m.group("date"), m.group("time"),
                sender.strip(), text.strip()
            )
            messages.append(current)
        elif current and line.strip():
            # multi-line message: append to previous
            current.text += "\n" + line.strip()
    return messages


def parse_chat_file(path: Path | str) -> list[Message]:
    """Parse one exported chat file into a list of Message objects."""
    path = Path(path)
    # WhatsApp exports are usually UTF-8; fall back to latin-1
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="utf-16")
    return parse_chat_text(text)


def infer_date_order(messages: list[Message]) -> str | None:
    """Infer the export envelope's date order from unambiguous lines.

    A first component above 12 can only be a day (day-first signal); a second
    component above 12 can only be a month (month-first signal). Returns
    "MDY" when month-first signals win, "DMY" when day-first signals win,
    and None when tied (including no signals at all).

    Only 1-2 digit components count; year-first/ISO envelopes (e.g.
    "2026-09-12") and any other component longer than two digits carry no
    day/month-order signal and are skipped. Live WhatsApp Web DOM envelopes
    are numeric day/month pairs, so this is a documented gap only for
    year-first exports.
    """
    day_first = month_first = 0
    for message in messages:
        parts = re.split(r"[/.\-]", message.date_str)
        if len(parts) < 2:
            continue
        first, second = parts[0].strip(), parts[1].strip()
        if not (first.isdigit() and second.isdigit()):
            continue
        if len(first) > 2 or len(second) > 2:
            continue
        if int(first) > 12:
            day_first += 1
        if int(second) > 12:
            month_first += 1
    if month_first > day_first:
        return "MDY"
    if day_first > month_first:
        return "DMY"
    return None


def filter_ignored(messages: list[Message], ignore_senders: tuple[str, ...]) -> list[Message]:
    """Drop messages whose sender contains any ignored name (case-insensitive)."""
    if ignore_senders:
        messages = [m for m in messages
                    if not any(ign.lower() in m.sender.lower()
                               for ign in ignore_senders)]
    return messages
