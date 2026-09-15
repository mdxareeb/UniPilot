from datetime import datetime

from wa_service.fingerprint import event_fingerprint

START = datetime(2026, 9, 12, 19, 0)


def test_is_stable_for_identical_inputs():
    assert event_fingerprint(START, None, "Priya", "party at 7 pm") == event_fingerprint(START, None, "Priya", "party at 7 pm")


def test_changes_with_sender_time_or_text():
    base = event_fingerprint(START, None, "Priya", "party at 7 pm")
    assert base != event_fingerprint(START, None, "Rahul", "party at 7 pm")
    assert base != event_fingerprint(datetime(2026, 9, 12, 20, 0), None, "Priya", "party at 7 pm")
    assert base != event_fingerprint(START, None, "Priya", "party at 8 pm")


def test_is_32_lowercase_hex_chars():
    value = event_fingerprint(START, None, "Priya", "party at 7 pm")
    assert len(value) == 32
    assert value == value.lower()
    int(value, 16)
