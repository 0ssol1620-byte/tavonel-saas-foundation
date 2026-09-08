import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireWorkspaceSlot,
  checkIdempotency,
  rememberIdempotent,
  resetWorkspaceCostGuard,
} from "./workspace-cost-guard";

/*
  The parts of the guard the route tests cannot reach (blueprint §32, S-21/S-22).

  A concurrency slot with no deadline is a workspace that can be locked out forever by one
  request that died between taking the slot and releasing it -- a pod that was killed, a
  serverless invocation that timed out. The routes release in a `finally`, which covers the
  throw; nothing covers the process that stopped existing. That is what the deadline is for, and
  a clock is the only way to test it, so `now` is a parameter rather than a global.
*/

const WORKSPACE = "pilot-guardtest";
const OTHER = "pilot-elsewhere";

beforeEach(() => resetWorkspaceCostGuard());
afterEach(() => resetWorkspaceCostGuard());

describe("concurrency slots", () => {
  it("admits up to the limit and refuses the next one", () => {
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 2).ok).toBe(true);
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 2).ok).toBe(true);
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 2))
      .toEqual({ ok: false, code: "WORKSPACE_CONCURRENCY_LIMIT" });
  });

  it("keeps scopes apart, so an export never starves a question", () => {
    acquireWorkspaceSlot("export", WORKSPACE, 1);
    expect(acquireWorkspaceSlot("export", WORKSPACE, 1).ok).toBe(false);
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 1).ok).toBe(true);
  });

  it("keeps workspaces apart", () => {
    acquireWorkspaceSlot("ask", WORKSPACE, 1);
    expect(acquireWorkspaceSlot("ask", OTHER, 1).ok).toBe(true);
  });

  it("reclaims a slot whose holder never released it", () => {
    const lease = acquireWorkspaceSlot("ask", WORKSPACE, 1, 1_000);
    expect(lease.ok).toBe(true);
    // The process holding it is gone. Nothing will ever call release.
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 1, 30_000).ok).toBe(false);
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 1, 120_000).ok).toBe(true);
  });

  it("releases once, however many times release is called", () => {
    const first = acquireWorkspaceSlot("ask", WORKSPACE, 2);
    const second = acquireWorkspaceSlot("ask", WORKSPACE, 2);
    if (!first.ok || !second.ok) throw new Error("expected both slots");
    first.release();
    first.release();
    first.release();
    // A double release must not free the OTHER holder's slot: one is still held.
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 2).ok).toBe(true);
    expect(acquireWorkspaceSlot("ask", WORKSPACE, 2).ok).toBe(false);
    second.release();
  });
});

describe("idempotency", () => {
  const body = "collection-x\nwhat changed?";

  it("passes a request that carries no key at all", () => {
    expect(checkIdempotency("ask", WORKSPACE, null, body)).toEqual({ ok: true, replay: false });
  });

  it("refuses a key that is too short, too long, or not opaque", () => {
    for (const key of ["short", "a".repeat(129), "has spaces here", "slash/es"]) {
      expect(checkIdempotency("ask", WORKSPACE, key, body), key)
        .toEqual({ ok: false, code: "IDEMPOTENCY_KEY_INVALID" });
    }
  });

  it("replays a remembered result for the same key and the same body", () => {
    rememberIdempotent("ask", WORKSPACE, "key-00000001", body, { status: 200 });
    expect(checkIdempotency("ask", WORKSPACE, "key-00000001", body))
      .toEqual({ ok: true, replay: true, value: { status: 200 } });
  });

  it("refuses the same key with a different body rather than answering the wrong question", () => {
    rememberIdempotent("ask", WORKSPACE, "key-00000002", body, { status: 200 });
    expect(checkIdempotency("ask", WORKSPACE, "key-00000002", "a different question"))
      .toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("forgets a result once its window has passed", () => {
    rememberIdempotent("ask", WORKSPACE, "key-00000003", body, { status: 200 }, 0);
    expect(checkIdempotency("ask", WORKSPACE, "key-00000003", body, 60_000))
      .toEqual({ ok: true, replay: true, value: { status: 200 } });
    expect(checkIdempotency("ask", WORKSPACE, "key-00000003", body, 11 * 60_000))
      .toEqual({ ok: true, replay: false });
  });

  it("scopes a key to its workspace and its scope", () => {
    rememberIdempotent("ask", WORKSPACE, "key-00000004", body, { status: 200 });
    expect(checkIdempotency("ask", OTHER, "key-00000004", "someone else's body"))
      .toEqual({ ok: true, replay: false });
    expect(checkIdempotency("export", WORKSPACE, "key-00000004", "a different body"))
      .toEqual({ ok: true, replay: false });
  });

  it("remembers nothing for a key it would have refused", () => {
    rememberIdempotent("ask", WORKSPACE, "short", body, { status: 200 });
    expect(checkIdempotency("ask", WORKSPACE, "short", body))
      .toEqual({ ok: false, code: "IDEMPOTENCY_KEY_INVALID" });
  });
});
