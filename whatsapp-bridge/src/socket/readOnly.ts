/**
 * The strictly read-only socket.
 *
 * UniPilot only LISTENS to WhatsApp. The application code never holds the raw
 * Baileys socket: it gets this wrapper, which exposes an explicit ALLOWLIST and
 * throws on anything else. There is no way to call `sendMessage`, to mark a
 * chat read, to send a presence/typing update, or to touch a group, because
 * those names simply are not reachable.
 *
 * What the wrapper does NOT (and cannot) suppress is the protocol traffic that
 * Baileys itself performs to stay a valid linked device: keep-alives, pre-key
 * uploads, retry requests for messages it fails to decrypt, and app-state sync.
 * That traffic is part of being linked at all. `markOnlineOnConnect: false`
 * (see `factory.ts`) stops the "online" presence announcement, and Baileys 7.x
 * no longer sends delivery acknowledgements.
 *
 * `logout` is allowed because it is the user's own "disconnect" action: it
 * unlinks this device.
 */

export class ReadOnlyViolationError extends Error {
  override readonly name = "ReadOnlyViolationError";
  constructor(member: string) {
    super(`The WhatsApp bridge is read-only: "${member}" is not available.`);
  }
}

/** The only members the rest of the bridge may use. */
export const READ_ONLY_ALLOWLIST = [
  "ev",
  "user",
  "groupFetchAllParticipating",
  "logout",
  "end",
  // The "Link with phone number" handshake: it asks WhatsApp for the 8-character
  // code the user types under Linked devices. It is the pairing step itself (the
  // mobile twin of scanning a QR), not a message, receipt or presence update.
  "requestPairingCode",
] as const;

type Allowed = (typeof READ_ONLY_ALLOWLIST)[number];

/** What the bridge needs from a socket, structurally (so tests can fake it). */
export interface RawSocketLike {
  ev: {
    on(event: string, listener: (...args: any[]) => void): unknown;
    removeAllListeners?(event?: string): unknown;
  };
  user?: { id: string; name?: string } | undefined;
  groupFetchAllParticipating(): Promise<Record<string, GroupInfo>>;
  logout(message?: string): Promise<void>;
  end(error: Error | undefined): void;
  /** `phoneNumber`: digits-only E.164 (no `+`). Resolves to the 8-character code. */
  requestPairingCode(phoneNumber: string): Promise<string>;
}

export interface GroupInfo {
  id: string;
  subject?: string;
}

export type ReadOnlySocket = Pick<RawSocketLike, Allowed>;

const ALLOWED = new Set<string>(READ_ONLY_ALLOWLIST);

export function makeReadOnlySocket(raw: RawSocketLike): ReadOnlySocket {
  return new Proxy(raw, {
    get(target, prop) {
      if (typeof prop === "symbol") return Reflect.get(target, prop);
      // Promise/JSON/inspect probes must not look like violations.
      if (prop === "then" || prop === "toJSON") return undefined;
      if (!ALLOWED.has(prop)) throw new ReadOnlyViolationError(prop);
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, prop) {
      throw new ReadOnlyViolationError(String(prop));
    },
    defineProperty(_target, prop) {
      throw new ReadOnlyViolationError(String(prop));
    },
    deleteProperty(_target, prop) {
      throw new ReadOnlyViolationError(String(prop));
    },
  }) as ReadOnlySocket;
}
