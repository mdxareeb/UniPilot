from pathlib import Path

from wa_service.models import Message
from wa_service.reader import (
    filter_ignored,
    infer_date_order,
    parse_chat_file,
    parse_chat_text,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample_chat.txt"
MDY_FIXTURE = Path(__file__).parent / "fixtures" / "envelope_mdy_chat.txt"


def test_parses_the_sample_export():
    messages = parse_chat_file(FIXTURE)
    assert len(messages) == 10
    assert messages[0].sender == "Priya"
    assert messages[0].date_str == "06/09/2026"
    assert messages[0].time_str == "20:15:22"
    assert messages[0].text.startswith("Hey everyone!")


def test_parses_bracketed_and_comma_formats():
    text = (
        "[06/02/2026, 21:14:33] Alice: first\n"
        "2/6/26, 9:14 PM - Bob: second\n"
    )
    messages = parse_chat_text(text)
    assert [m.sender for m in messages] == ["Alice", "Bob"]
    assert messages[1].text == "second"


def test_multiline_messages_append_to_the_previous():
    text = "[06/02/2026, 21:14:33] Alice: line one\nline two\nline three\n"
    messages = parse_chat_text(text)
    assert len(messages) == 1
    assert messages[0].text == "line one\nline two\nline three"


def test_strips_unicode_direction_marks_and_drops_empty_lines():
    text = "\u200f[06/02/2026, 21:14:33] Alice: hi\u200e\n\u200f\n[06/02/2026, 21:14:34] Bob: tue\n"
    messages = parse_chat_text(text)
    assert [m.text for m in messages] == ["hi", "tue"]


def test_multi_word_sender_is_not_truncated():
    messages = parse_chat_text("[06/02/2026, 21:14:33] Alice Smith: hello\n")
    assert messages[0].sender == "Alice Smith"
    assert messages[0].text == "hello"


def test_sender_with_digits_and_symbols():
    messages = parse_chat_text("[06/02/2026, 21:14:33] +1 555-0100: hi\n")
    assert messages[0].sender == "+1 555-0100"
    assert messages[0].text == "hi"


def test_colon_inside_message_text_is_kept():
    messages = parse_chat_text("[06/02/2026, 21:14:33] Alice: FYI: bring snacks\n")
    assert messages[0].sender == "Alice"
    assert messages[0].text == "FYI: bring snacks"


def test_system_line_has_no_sender():
    line = "Messages and calls are end-to-end encrypted."
    messages = parse_chat_text(f"[06/02/2026, 21:14:33] {line}\n")
    assert messages[0].sender == ""
    assert messages[0].text == line


def test_remainder_never_leaks_into_text():
    messages = parse_chat_text("[06/02/2026, 21:14:33] Alice Smith: hello\n")
    assert "Smith" not in messages[0].text
    assert messages[0].text == "hello"


# Fifth authorized delta: sender parses up to the first colon; colon-less system lines carry no sender.
def test_filter_ignored_is_case_insensitive_substring():
    messages = parse_chat_text(
        "[06/02/2026, 21:14:33] Alice: a\n[06/02/2026, 21:14:34] Campus Bot: b\n"
    )
    kept = filter_ignored(messages, ("bot",))
    assert [m.sender for m in kept] == ["Alice"]


def test_infer_date_order_is_mdy_when_second_components_exceed_12():
    messages = parse_chat_file(MDY_FIXTURE)
    assert infer_date_order(messages) == "MDY"


def test_infer_date_order_is_dmy_when_first_components_exceed_12():
    messages = parse_chat_text(
        "[14/09/26, 1:40:35 PM] Priya: a\n[15/09/26, 1:45:18 PM] Priya: b\n"
    )
    assert infer_date_order(messages) == "DMY"


def test_infer_date_order_is_none_when_all_components_are_ambiguous():
    messages = parse_chat_text(
        "[06/02/2026, 21:14:33] Alice: a\n[01/02/2026, 21:14:34] Bob: b\n"
    )
    assert infer_date_order(messages) is None


def test_infer_date_order_ties_without_signals():
    messages = parse_chat_text(
        "[14/09/26, 21:14:33] Alice: a\n[9/13/26, 21:14:34] Bob: b\n"
    )
    assert infer_date_order(messages) is None


def test_infer_date_order_ignores_year_first_envelopes():
    messages = [
        Message("2026-09-13", "20:15:22", "A", "x"),
        Message("9/14/26", "20:15:22", "B", "y"),
    ]
    assert infer_date_order(messages) == "MDY"
