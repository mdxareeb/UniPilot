"""Data models shared across the WhatsApp service.

``Message`` is copied verbatim from ``Default Project/whatsapp_reader.py`` and
``DetectedEvent`` from ``Default Project/event_extractor.py``.
"""
import re


class Message:
    __slots__ = ("date_str", "time_str", "sender", "text")

    def __init__(self, date_str: str, time_str: str, sender: str, text: str):
        self.date_str = date_str
        self.time_str = time_str
        self.sender = sender
        self.text = text

    def __repr__(self):
        return f"<Message {self.date_str} {self.time_str} {self.sender}: {self.text[:40]!r}>"


class DetectedEvent:
    def __init__(self, message, start, end=None, all_day=False, date_span=None):
        self.message = message
        self.start = start
        self.end = end
        self.all_day = all_day
        self.date_span = date_span  # (start_idx, end_idx) of date text in message
        self.include = True  # user toggles this during review

    @property
    def title(self):
        first = self.message.text.splitlines()[0]
        # cut out the date portion, plus its dangling preposition/punctuation
        if self.date_span:
            before = first[:self.date_span[0]]
            after = first[self.date_span[1]:]
            before = re.sub(r"[\s,]*\b(on|at|by|from|since|until|during|of)\s*$",
                            "", before, flags=re.I)
            after = re.sub(r"^[\s,]*", "", after)
            if before and after:
                first = before + " " + after
            else:
                first = before or after
        t = re.sub(r"\s+", " ", first).strip(" ,!-–.:;\"'")
        # strip chat fillers repeatedly from the front
        prev = None
        while prev != t:
            prev = t
            t = re.sub(r"^(hey|hi|hello|yo|guys|team|everyone)[a-z! ,]*?[:,!]\s*",
                       "", t, flags=re.I)
            t = re.sub(r"^(also|and)[,! ]+", "", t, flags=re.I)
            t = re.sub(r"^(don'?t forget (the|to|about)\s*|reminder[:-]\s*)",
                       "", t, flags=re.I)
            t = t.strip(" ,!-–.:;\"'")
        if len(t) > 80:
            t = t[:77] + "..."
        # fall back to the raw first line if cleanup removed everything
        return t or re.sub(r"\s+", " ", self.message.text.splitlines()[0]).strip()

    @property
    def description(self):
        return "From WhatsApp ({}):\n\n{}".format(self.message.sender, self.message.text)

    def __repr__(self):
        when = self.start.strftime("%a %d %b %Y %H:%M") if self.start else "?"
        return "<Event {}: {!r}>".format(when, self.title[:50])
