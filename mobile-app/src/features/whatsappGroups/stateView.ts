import type { GroupSyncSnapshot, GroupSyncState } from "./types";

/**
 * Link state → what the screen shows. One table, so a state can never render a
 * control that does not belong to it (e.g. a phone form while a code is live).
 * Copy mirrors the web card; nothing claims progress the database does not show.
 */
export type StateView = {
  /** Headline for the link card. */
  title: string;
  body: string;
  /** The phone-number form (start a link). */
  showPhoneForm: boolean;
  /** The pairing code card (state is `code_ready` and a live code exists). */
  showCode: boolean;
  /** A way to cancel or disconnect. */
  showDisconnect: boolean;
  disconnectLabel: string;
  /** Groups + suggestions only make sense for a linked account. */
  showGroups: boolean;
  /** Suggestions can be reviewed even with nothing linked. */
  showReview: boolean;
  /** Poll quickly while something is in flight. */
  fastPoll: boolean;
  badge: string;
};

const BASE: Omit<StateView, "title" | "body" | "badge"> = {
  showPhoneForm: false,
  showCode: false,
  showDisconnect: false,
  disconnectLabel: "Disconnect",
  showGroups: false,
  showReview: true,
  fastPoll: false,
};

const VIEWS: Record<GroupSyncState, StateView> = {
  not_enabled: {
    ...BASE,
    badge: "Not enabled",
    title: "WhatsApp groups aren't switched on",
    body: "This server isn't running WhatsApp group sync yet, so there is nothing to link.",
    showReview: false,
  },
  disconnected: {
    ...BASE,
    badge: "Not linked",
    title: "Link your WhatsApp",
    body: "UniPilot reads the college groups you choose and turns deadlines, exams and files into tasks. It never sends or replies.",
    showPhoneForm: true,
  },
  starting: {
    ...BASE,
    badge: "Starting",
    title: "Contacting WhatsApp…",
    body: "Your code appears here in a few seconds.",
    showDisconnect: true,
    disconnectLabel: "Cancel",
    fastPoll: true,
  },
  bridge_offline: {
    ...BASE,
    badge: "Service not running",
    title: "The WhatsApp service isn't running",
    body: "Your request is saved, but nothing is captured until the service is back. You can cancel and try again later.",
    showDisconnect: true,
    disconnectLabel: "Cancel",
  },
  qr_ready: {
    ...BASE,
    badge: "Waiting on the web",
    title: "A link started on the web is waiting",
    body: "It needs a QR scan on a computer. Finish it there, or cancel and link with a code here.",
    showDisconnect: true,
    disconnectLabel: "Cancel",
    fastPoll: true,
  },
  code_ready: {
    ...BASE,
    badge: "Enter the code",
    title: "Enter this code in WhatsApp",
    body: "Open WhatsApp, then Linked devices, then Link with phone number instead, and type the code.",
    showCode: true,
    showDisconnect: true,
    disconnectLabel: "Cancel",
    fastPoll: true,
  },
  connected: {
    ...BASE,
    badge: "Linked",
    title: "WhatsApp is linked",
    body: "Turn on the groups you want. Turning one on captures messages from that moment forward.",
    showGroups: true,
    showDisconnect: true,
  },
  disconnecting: {
    ...BASE,
    badge: "Disconnecting",
    title: "Disconnecting…",
    body: "Forgetting the link and removing captured message text.",
    fastPoll: true,
  },
  error: {
    ...BASE,
    badge: "Link failed",
    title: "The link didn't finish",
    body: "You can try again with a new code.",
    showPhoneForm: true,
  },
};

export function viewFor(state: GroupSyncState): StateView {
  return VIEWS[state];
}

/** A `code_ready` state whose code is gone is an expired code, not a live one. */
export function effectiveView(snapshot: GroupSyncSnapshot): StateView {
  const view = viewFor(snapshot.state);
  if (snapshot.state === "code_ready" && snapshot.pairing === null) {
    return {
      ...view,
      title: "That code has expired",
      body: "Codes last about two minutes. Cancel and get a new one.",
      showCode: false,
      showPhoneForm: false,
    };
  }
  return view;
}

/** Poll delay in ms: quick while a link is in flight, relaxed otherwise. */
export function pollDelayMs(state: GroupSyncState): number {
  return viewFor(state).fastPoll ? 3_000 : state === "connected" ? 15_000 : 10_000;
}
