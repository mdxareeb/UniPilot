import { EventEmitter } from "node:events";
import type { RawSocketLike } from "../../src/socket/readOnly.ts";

/** A FAKE Baileys socket: records calls and lets a test emit events. */
export class FakeSocket implements RawSocketLike {
  readonly emitter = new EventEmitter();
  readonly calls: string[] = [];
  user = { id: "15550001111:1@s.whatsapp.net", name: "Test" };
  groups: Record<string, { id: string; subject?: string }> = {};

  readonly ev = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.emitter.on(event, listener);
      return this;
    },
    removeAllListeners: (event?: string) => {
      this.emitter.removeAllListeners(event);
      return this;
    },
  };

  async groupFetchAllParticipating() {
    this.calls.push("groupFetchAllParticipating");
    return this.groups;
  }

  async logout(): Promise<void> {
    this.calls.push("logout");
  }

  /** What `requestPairingCode` resolves to; set `pairingError` to make it throw. */
  pairingCode = "ABCD1234";
  pairingError: Error | null = null;
  readonly pairingRequests: string[] = [];

  async requestPairingCode(phoneNumber: string): Promise<string> {
    this.calls.push("requestPairingCode");
    this.pairingRequests.push(phoneNumber);
    if (this.pairingError) throw this.pairingError;
    return this.pairingCode;
  }

  end(): void {
    this.calls.push("end");
  }

  emit(event: string, data: unknown): void {
    this.emitter.emit(event, data);
  }

  close(statusCode: number): void {
    this.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode } } },
    });
  }
}

/** Lets queued promise chains and timers run. */
export async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
