"""Live WhatsApp Web mode (Selenium, self-host only; spec §8).

The service drives a private, per-user Chrome profile keyed by the validated
user UUID (``WHATSAPP_PROFILE_ROOT/<user_id>``, created ``0700`` where the OS
supports it), collects messages and feeds the exact same persistence path as
the export flow (``sync.run_live``).

Selenium is imported lazily so export/push worker hosts do not need
``requirements-live.txt``. The QR data-URL travels only through the encrypted
``set_whatsapp_qr``/``clear_whatsapp_qr`` RPCs and is never logged; neither are
message bodies. Live mode is single-tenant: do not run it on a shared worker
host.
"""
import logging
import os
import re
import shutil
import time
from datetime import datetime
from pathlib import Path
from uuid import UUID

from .config import Settings
from .models import Message
from .supabase_client import ServiceError

logger = logging.getLogger(__name__)

WA_URL = "https://web.whatsapp.com/"
# WhatsApp rotates its QR on roughly this cadence; the connect job re-arms the
# encrypted row with the QR TTL so a stale scan never succeeds.
QR_REARM_SECONDS = 20
QR_TTL_SECONDS = 60

# WhatsApp updates its DOM occasionally, so every selector is a fallback list
LOGGED_IN_SELECTORS = [
    'div[aria-label="Chat list"]',
    'div[data-testid="chat-list"]',
    "#side",
]
QR_SELECTORS = [
    'div[data-testid="link-device-qr-code"]',
    "div[data-ref]",
    "canvas",
]
# 2025+ layout: a real <input>; older layout: contenteditable div
SEARCH_SELECTORS = [
    'input[aria-label="Search or start a new chat"]',
    'div[data-testid="chat-list-search-container"] input',
    'div[aria-label="Search or start a new chat"]',
    '#side div[contenteditable="true"][data-tab="3"]',
    '#side div[contenteditable="true"]',
]
# 2025+ layout: cell-frame rows; older: role="listitem"
CHAT_LIST_SELECTORS = [
    'div[data-testid="chat-list"] div[data-testid="cell-frame-container"]',
    'div[data-testid="chat-list"] [role="listitem"]',
    '[aria-label="Chat list"] [role="listitem"]',
    '#side [role="listitem"]',
]
CHAT_TITLE_SELECTORS = [
    'div[data-testid="cell-frame-title"]',
    'span[dir="auto"]',
]

# Every copyable message bubble carries: "[time, date] Sender: " in
# data-pre-plain-text. The clean message text lives ONLY inside
# span[data-testid="selectable-text"] - the bubble's other spans hold
# the trailing timestamp, forwarded-labels and icon svg titles.
HARVEST_JS = """
const out = [];
document.querySelectorAll('[data-pre-plain-text]').forEach(el => {
  let text = '';
  const sel = el.querySelector('span[data-testid="selectable-text"]');
  if (sel) {
    text = sel.innerText;
  } else {
    // fallback for older layouts: strip known junk from textContent
    const clone = el.cloneNode(true);
    clone.querySelectorAll('svg, [data-testid="forwarded-header"]').forEach(n => n.remove());
    text = clone.textContent;
  }
  out.push({pre: el.getAttribute('data-pre-plain-text'), text: text});
});
return out;
"""

# find the scrollable ancestor that holds the messages (class names are
# hashed and change often, so we detect "the scrollable parent" instead)
SCROLLER_JS = """
let node = document.querySelector('[data-pre-plain-text]');
while (node && node !== document.body) {
  if (node.scrollHeight > node.clientHeight + 10) return node;
  node = node.parentElement;
}
return null;
"""

PRE_RE = re.compile(
    r"^\[(?P<time>\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)\s*,\s*(?P<date>[\d/.-]+)\]\s*(?P<sender>.*)$"
)


class LiveLibsUnavailable(ServiceError):
    def __init__(self):
        super().__init__(
            "Selenium is not installed on this worker host "
            "(pip install -r whatsapp/requirements-live.txt)",
            retryable=False,
        )


def _validated_user_id(user_id) -> str:
    """Canonical UUID string; the profile path is never built from raw input."""
    try:
        return str(UUID(str(user_id)))
    except (AttributeError, TypeError, ValueError) as error:
        raise ServiceError("invalid user id", retryable=False) from error


def profile_dir(settings: Settings, user_id: str) -> Path:
    """Per-user browser profile dir; created ``0700`` where supported."""
    path = Path(settings.profile_root) / _validated_user_id(user_id)
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def purge_profile(settings: Settings, user_id: str) -> dict:
    """Remove the user's on-disk browser profile (no-op when never created)."""
    path = Path(settings.profile_root) / _validated_user_id(user_id)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    return {"purged": True}


def _find_all(driver, selectors):
    for sel in selectors:
        try:
            els = driver.find_elements("css selector", sel)
            if els:
                return els, sel
        except Exception:
            continue
    return [], None


def _wait_for(driver, selectors, timeout, poll=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        els, sel = _find_all(driver, selectors)
        if els:
            return els, sel
        time.sleep(poll)
    return None, None


def start_driver(settings, user_id: str):
    """Launch Chrome with the user's saved profile so login is one-time."""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError as error:
        raise LiveLibsUnavailable() from error

    profile = profile_dir(settings, user_id)
    opts = Options()
    opts.add_argument(f"--user-data-dir={profile}")
    opts.add_argument("--window-size=1300,900")
    opts.add_argument("--disable-notifications")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    try:
        driver = webdriver.Chrome(options=opts)
        driver.get(WA_URL)
    except ServiceError:
        raise
    except Exception as error:
        raise ServiceError(
            "Chrome is not available on this worker host "
            "(live mode needs Chrome + selenium, see whatsapp/README.md)",
            retryable=False,
        ) from error
    return driver


def _quit(driver) -> None:
    try:
        driver.quit()
    except Exception:
        pass


def _capture_qr(element):
    """Base64 data-URL of the QR element. A failed capture is a warning that
    is retried on the next poll - the payload itself is never logged."""
    try:
        encoded = element.screenshot_as_base64
    except Exception:
        logger.warning("QR screenshot capture failed; retrying on next poll")
        return None
    return f"data:image/png;base64,{encoded}" if encoded else None


def wait_for_login(driver, settings: Settings, on_qr=None):
    """True once WhatsApp Web shows the chat list; False on QR timeout.

    Each new QR data-URL (and every re-arm window while the code is unchanged)
    is handed to ``on_qr`` so the connect job can refresh the encrypted row.
    """
    timeout = settings.live_qr_timeout
    start = time.time()
    last_qr = None
    last_sent = start
    while time.time() - start < timeout:
        els, _ = _find_all(driver, LOGGED_IN_SELECTORS)
        if els:
            logger.info("Logged in to WhatsApp Web")
            return True
        qr, _ = _find_all(driver, QR_SELECTORS)
        if qr and on_qr:
            data_url = _capture_qr(qr[0])
            now = time.time()
            if data_url and (
                data_url != last_qr or now - last_sent >= QR_REARM_SECONDS
            ):
                last_qr = data_url
                last_sent = now
                on_qr(data_url)
        time.sleep(1)
    return False


def list_chats(driver, limit=30):
    """Best-effort list of recent chat names from the left panel."""
    items, _ = _find_all(driver, CHAT_LIST_SELECTORS)
    names = []
    for it in items[: limit * 2]:
        title = None
        try:
            # 2025+ layout: title div carries a title attribute
            for sel in CHAT_TITLE_SELECTORS:
                found = it.find_elements("css selector", sel)
                if found:
                    title = found[0].get_attribute("title") or found[0].text
                    if title:
                        break
        except Exception:
            title = None
        title = (title or it.get_attribute("title") or "").strip()
        # unread badges leak into .text as "N unread message" lines - drop them
        if "\n" in title:
            lines = [
                ln.strip()
                for ln in title.splitlines()
                if ln.strip() and "unread" not in ln.lower()
            ]
            title = lines[-1] if lines else ""
        if (
            title
            and "unread message" not in title.lower()
            and title not in names
        ):
            names.append(title)
        if len(names) >= limit:
            break
    return names


def open_chat(driver, name):
    """Open a chat by typing its name into the search box, then pressing
    Enter on the top result. Handles both the <input> and contenteditable
    layouts."""
    from selenium.webdriver.common.keys import Keys

    boxes, sel = _wait_for(driver, SEARCH_SELECTORS, 15)
    if not boxes:
        raise RuntimeError("Could not find the WhatsApp Web search box.")
    box = boxes[0]
    try:
        box.click()
        box.clear()  # works for <input>; harmless on contenteditable
    except Exception:
        pass
    try:
        box.send_keys(Keys.CONTROL, "a")
    except Exception:
        pass
    box.send_keys(name)
    time.sleep(2.0)  # let search results appear

    # clicking the first result is more reliable than Enter (Enter can
    # open the search filters instead of the chat on some layouts)
    clicked = False
    for sel in CHAT_LIST_SELECTORS:
        try:
            results = driver.find_elements("css selector", sel)
            fresh = [r for r in results if r.is_displayed()]
            if fresh:
                from selenium.webdriver.common.action_chains import ActionChains
                ActionChains(driver).move_to_element(fresh[0]).click().perform()
                clicked = True
                break
        except Exception:
            continue
    if not clicked:
        box.send_keys(Keys.ENTER)
    time.sleep(2.0)  # let the chat open and first messages render


_JUNK_SIZE_RE = re.compile(r"\b\d+(?:[.,]\d+)?\s*[kKmMgG][Bb]\b")
# size token possibly GLUED to a name (no word boundary: "Shreya148 kB")
_GLUED_SIZE_RE = re.compile(r"^(\d+(?:[.,]\d+)?\s*[kKmMgG][Bb]\b)(.*)$", re.I)
# first line is ONLY sender + size ("Shreya: 148 kB" / "Shreya 148 kB")
_NAME_SIZE_ONLY_RE = re.compile(r"^[\s,]*\d+(?:[.,]\d+)?\s*[kKmMgG][Bb]\b[\s,]*$", re.I)


def _clean_text(text: str, sender: str) -> str:
    """Strip junk that leaks into bubble text during re-renders:
    a leading line that repeats the sender name (forwarded-header /
    attachment leakage like "Shreya", "Shreya148 kB"), attachment
    sizes ("148 kB"), and "Forwarded" labels. Real sentences that
    happen to start with the sender's name are kept untouched."""
    t = text
    lines = t.splitlines()
    if sender and lines:
        first = lines[0].strip()
        sender_l = sender.strip().strip(":").lower()
        first_l = first.lower()
        if first_l == sender_l:
            # line is JUST the sender name -> drop it
            lines = lines[1:]
        elif first_l.startswith(sender_l):
            after = first[len(sender_l):]
            if _NAME_SIZE_ONLY_RE.match(after):
                # only a file size follows the name -> drop the line
                lines = lines[1:]
            else:
                m = _GLUED_SIZE_RE.match(after)
                if m and m.group(2).strip():
                    # glued size then real content ("Shreya148 kB HACKATHON...")
                    # -> keep the content without the name+size prefix
                    lines = [m.group(2).strip()] + lines[1:]
                # otherwise: real content follows the name -> keep line as-is
        t = "\n".join(lines)
    t = _JUNK_SIZE_RE.sub(" ", t)
    t = re.sub(r"^\s*Forwarded\b[:\s]*", "", t, flags=re.I)
    return re.sub(r"[ \t]+", " ", t).strip()


def _dedup_key(pre: str, text: str) -> str:
    """Normalized key so the same message harvested twice (WhatsApp
    re-renders bubbles mid-scroll with slightly different junk) and
    messages that differ only by whitespace collapse into one entry."""
    norm = re.sub(r"\s+", " ", text).strip().lower()
    return f"{pre.strip().lower()}\x00{norm}"


def _harvest(driver):
    raw = driver.execute_script(HARVEST_JS) or []
    msgs = {}
    for item in raw:
        pre, text = (item.get("pre") or ""), (item.get("text") or "").strip()
        m = PRE_RE.match(pre.strip())
        if not m or not text:
            continue
        sender = m.group("sender").rstrip(": ").strip()
        if not sender:
            continue
        text = _clean_text(text, sender)
        if not text:
            continue
        msg = Message(m.group("date"), m.group("time"), sender, text)
        msgs[_dedup_key(pre, text)] = msg
    return msgs


def collect_messages(driver, settings: Settings, max_messages=None, progress=True):
    """Scroll up through the chat history, harvesting messages on the way.

    WhatsApp Web only keeps a window of messages in the DOM, so we must
    collect as we scroll or older messages vanish. When the top is
    reached, WhatsApp still needs time to FETCH older messages from the
    phone/server, so we wait with increasing patience (backoff) before
    concluding that the history is exhausted.
    """
    from selenium.webdriver.common.by import By

    max_messages = max_messages or settings.live_max_messages
    collected = {}

    # wait until at least one message is rendered (empty chat is fine too)
    deadline = time.time() + 15
    while time.time() < deadline:
        collected = _harvest(driver)
        if collected or not _find_all(driver, LOGGED_IN_SELECTORS)[0]:
            break
        time.sleep(1)

    if not collected:
        return []

    scroller = driver.execute_script(SCROLLER_JS)
    if scroller is None:
        return list(collected.values())

    stale_rounds = 0
    round_no = 0
    wait = settings.live_scroll_wait
    while len(collected) < max_messages and stale_rounds < settings.live_stale_rounds:
        round_no += 1
        before = len(collected)
        driver.execute_script("arguments[0].scrollTop = 0;", scroller)
        time.sleep(wait)
        collected.update(_harvest(driver))
        grew = len(collected) - before
        if grew == 0:
            stale_rounds += 1
            # nothing new arrived: WhatsApp may still be fetching older
            # history from the server - wait longer each round (backoff),
            # e.g. 0.9s -> 1.8s -> 3.6s -> 7.2s ... capped at 15s
            wait = min(wait * 2, 15.0)
            if progress:
                print(
                    f"  ...waiting for older messages to load "
                    f"({stale_rounds}/{settings.live_stale_rounds}, {wait:.0f}s)"
                )
        else:
            stale_rounds = 0
            wait = settings.live_scroll_wait  # reset patience when data flows
            if progress and (round_no % 5 == 0 or grew > 20):
                print(f"  ...{len(collected)} messages collected so far")

    if progress:
        print(f"  Collected {len(collected)} message(s) from this chat.")
    return list(collected.values())


def _sort_key(message, date_order: str = "DMY"):
    try:
        import dateparser
        parsed = dateparser.parse(
            f"{message.date_str} {message.time_str}",
            settings={"DATE_ORDER": date_order},
        )
        return parsed or datetime.min
    except Exception:
        return datetime.min


def run_connect(settings: Settings, client, connection_id: str) -> dict:
    """Drive the QR login for an existing connection row.

    The QR is published exclusively through the encrypted RPCs; the payload
    is never printed, returned, or stored locally.
    """
    connection = client.select_one(
        "integration_connections", {"id": f"eq.{connection_id}", "select": "*"}
    )
    if connection is None:
        raise ServiceError("connection not found", retryable=False)
    user_id = str(connection["user_id"])

    def publish_qr(data_url):
        client.rpc(
            "set_whatsapp_qr",
            {
                "p_connection_id": connection_id,
                "p_qr": data_url,
                "p_key": settings.integrations_key,
                "p_ttl_seconds": QR_TTL_SECONDS,
            },
        )

    driver = start_driver(settings, user_id)
    try:
        connected = wait_for_login(driver, settings, publish_qr)
    finally:
        _quit(driver)

    if connected:
        client.patch(
            "integration_connections",
            {"id": f"eq.{connection_id}"},
            {"status": "connected", "last_error": None},
        )
        client.rpc("clear_whatsapp_qr", {"p_connection_id": connection_id})
        return {"connected": True}

    client.patch(
        "integration_connections",
        {"id": f"eq.{connection_id}"},
        {"status": "error", "last_error": "QR scan timed out"},
    )
    client.rpc("clear_whatsapp_qr", {"p_connection_id": connection_id})
    return {"connected": False}


def run_live_sync(settings: Settings, client, run: dict) -> dict:
    """Collect the run's chat from the per-user profile, then persist via
    the shared ``sync`` path."""
    from . import sync

    try:
        driver = start_driver(settings, run["user_id"])
        try:
            if not wait_for_login(driver, settings):
                raise ServiceError("WhatsApp Web login timed out", retryable=False)
            open_chat(driver, run["chat_name"])
            messages = collect_messages(driver, settings)
        finally:
            _quit(driver)
    except ServiceError as error:
        sync.mark_run_failed(client, run["id"], error.message, error.retryable)
        raise
    except Exception as error:
        # Never surface raw Selenium/page text (it can carry chat content).
        sync.mark_run_failed(client, run["id"], "WhatsApp Web scan failed", retryable=True)
        raise ServiceError("WhatsApp Web scan failed", retryable=True) from error

    messages.sort(key=lambda message: _sort_key(message, settings.date_order))
    return sync.run_live(settings, client, run, messages)
