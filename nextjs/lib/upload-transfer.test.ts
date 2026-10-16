/**
 * `putWithProgress` against a fake XMLHttpRequest: no network, no browser.
 *
 *   vitest run lib/upload-transfer.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { putWithProgress, UPLOAD_TIMEOUT_MS } from "./upload-transfer";

type Listener = () => void;

class FakeXhr {
  static last: FakeXhr | undefined;
  timeout = 0;
  timeoutAtSend: number | undefined;
  status = 0;
  withCredentials = false;
  readonly headers: Array<[string, string]> = [];
  readonly upload = { addEventListener: () => {} };
  private readonly listeners = new Map<string, Listener[]>();

  constructor() {
    FakeXhr.last = this;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open() {}

  setRequestHeader(name: string, value: string) {
    this.headers.push([name, value]);
  }

  send() {
    this.timeoutAtSend = this.timeout;
  }

  abort() {
    this.fire("abort");
  }

  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

/** The request `putWithProgress` just constructed; fails the test if it built none. */
function sentRequest(): FakeXhr {
  const request = FakeXhr.last;
  expect(request).toBeInstanceOf(FakeXhr);
  return request as FakeXhr;
}

describe("putWithProgress", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");

  beforeEach(() => {
    FakeXhr.last = undefined;
    Object.defineProperty(globalThis, "XMLHttpRequest", { value: FakeXhr, configurable: true, writable: true });
  });

  // Vitest runs afterEach whether the test passed or threw, so the real global always comes back.
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
    else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  });

  it("the PUT carries the 120-second timeout, set before it is sent, and nothing else new", () => {
    putWithProgress("https://storage.invalid/quarantine/object", new Blob(["%PDF-1.4"]), "application/pdf");
    const request = sentRequest();
    expect(UPLOAD_TIMEOUT_MS).toBe(120 * 1000);
    // The documented bound: a 5 MiB source in that window is about 43 KiB/s.
    expect(Math.round((5 * 1024) / (UPLOAD_TIMEOUT_MS / 1000))).toBe(43);
    expect(request.timeoutAtSend).toBe(120 * 1000);
    expect(request.headers).toStrictEqual([["content-type", "application/pdf"]]);
    expect(request.withCredentials).toBe(false);
  });

  it("a timed-out PUT settles as a network failure", async () => {
    const handle = putWithProgress("https://storage.invalid/quarantine/object", new Blob(["%PDF-1.4"]), "application/pdf");
    const request = sentRequest();
    request.fire("timeout");
    expect(await handle.done).toStrictEqual({ ok: false, status: 0, reason: "network" });
  });
});
