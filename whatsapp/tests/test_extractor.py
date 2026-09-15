from datetime import datetime
from pathlib import Path

from wa_service.extractor import extract_events
from wa_service.reader import infer_date_order, parse_chat_file

FIXTURE = Path(__file__).parent / "fixtures" / "sample_chat.txt"
MDY_FIXTURE = Path(__file__).parent / "fixtures" / "envelope_mdy_chat.txt"
NOW = datetime(2026, 9, 6, 20, 15, 0)
MDY_NOW = datetime(2026, 9, 13, 10, 0, 0)

REJECTED_WEEKDAY_TEXTS = {
    "friday is a holiday",
    "ask Dana to print the handouts on monday",
    "monday does not work",
    "no, I am around on Tuesday, we will decide then",
}


def extract(**overrides):
    messages = parse_chat_file(FIXTURE)
    return extract_events(messages, now=NOW, **overrides)


def extract_mdy(**overrides):
    messages = parse_chat_file(MDY_FIXTURE)
    return extract_events(
        messages, now=MDY_NOW, envelope_date_order="MDY", **overrides
    )


def test_sample_chat_yields_five_detections():
    events = extract()
    titles = [e.title for e in events]
    assert len(events) == 5, titles
    assert any("Birthday party" in t for t in titles)
    assert any("Team meeting" in t for t in titles)
    assert any("Football match" in t for t in titles)
    assert any("Webinar" in t for t in titles)
    assert any("picnic" in t for t in titles)


def test_birthday_is_september_12_at_19_00():
    events = [e for e in extract() if "Birthday" in e.title]
    assert len(events) == 1
    assert events[0].start == datetime(2026, 9, 12, 19, 0)
    assert events[0].all_day is False


def test_webinar_has_the_explicit_range():
    webinar = next(e for e in extract() if "Webinar" in e.title)
    assert webinar.start == datetime(2026, 9, 18, 18, 0)
    assert webinar.end == datetime(2026, 9, 18, 19, 30)
    assert webinar.all_day is False


def test_picnic_october_2_is_all_day():
    picnic = next(e for e in extract() if "picnic" in e.title)
    assert picnic.all_day is True
    assert (picnic.start.year, picnic.start.month, picnic.start.day) == (2026, 10, 2)
    assert picnic.end is None


def test_relative_dates_are_deterministic_with_injected_now():
    meeting = next(e for e in extract() if "Team meeting" in e.title)
    assert (meeting.start.month, meeting.start.day) == (9, 7)
    assert (meeting.start.hour, meeting.start.minute) == (10, 30)
    football = next(e for e in extract() if "Football" in e.title)
    assert football.start.hour == 17
    assert datetime(2026, 9, 6) <= football.start < datetime(2026, 9, 14)


def test_noise_and_keyword_only_messages_are_ignored():
    assert extract()  # sanity
    events = extract()
    assert not any(e.title.strip().lower() in {"ok", "congrats", "nice", "good night all"} for e in events)


def test_candidate_cap_stops_at_the_limit():
    events = extract(max_events=2)
    assert len(events) == 2


def test_duplicate_messages_dedupe_by_start_and_title():
    from wa_service.models import Message
    chunk = "Hey team, webinar on 18/09/2026 at 18:00"
    messages = [Message("06/09/2026", "20:00:00", "A", chunk), Message("06/09/2026", "20:01:00", "A", chunk)]
    events = extract_events(messages, now=NOW)
    assert len(events) == 1


def test_mdy_envelope_relative_off_keeps_only_explicit_dates():
    events = extract_mdy()
    assert [(e.start.year, e.start.month, e.start.day) for e in events] == [
        (2026, 9, 12),
        (2026, 9, 20),
    ]
    assert all(e.all_day for e in events)
    assert not any(e.message.text in REJECTED_WEEKDAY_TEXTS for e in events)


def test_relative_on_adds_only_academic_or_timed_weekday_mentions():
    events = extract_mdy(relative_dates=True)
    assert len(events) == 5
    by_text = {e.message.text: e for e in events}
    assert (by_text["12th sept is our final exam"].start.year,
            by_text["12th sept is our final exam"].start.month,
            by_text["12th sept is our final exam"].start.day) == (2026, 9, 12)
    friday = by_text["friday submission check"]
    assert (friday.start.year, friday.start.month, friday.start.day) == (2026, 9, 18)
    assert friday.all_day is True
    monday = by_text["Monday submit the draft"]
    assert (monday.start.year, monday.start.month, monday.start.day) == (2026, 9, 14)
    assert monday.all_day is True
    tuesday = next(e for e in events if e.message.text.startswith("tuesday is the CS101"))
    assert (tuesday.start.year, tuesday.start.month, tuesday.start.day) == (2026, 9, 15)
    assert tuesday.all_day is True
    assert not any(e.message.text in REJECTED_WEEKDAY_TEXTS for e in events)


def test_time_only_message_is_rejected_in_both_modes():
    from wa_service.models import Message
    message = Message("9/12/26", "10:00:00 AM", "Aisha", "10 AM")
    assert extract_events([message], now=MDY_NOW) == []
    assert extract_events([message], now=MDY_NOW, relative_dates=True) == []


def test_envelope_order_override_pins_the_same_day_year():
    messages = parse_chat_file(MDY_FIXTURE)
    assert infer_date_order(messages) == "MDY"
    mdy = extract_events(messages, now=MDY_NOW, envelope_date_order="MDY")
    dmy = extract_events(messages, now=MDY_NOW, envelope_date_order="DMY")
    assert (mdy[0].start.year, mdy[0].start.month, mdy[0].start.day) == (2026, 9, 12)
    assert (dmy[0].start.year, dmy[0].start.month, dmy[0].start.day) == (2027, 9, 12)
