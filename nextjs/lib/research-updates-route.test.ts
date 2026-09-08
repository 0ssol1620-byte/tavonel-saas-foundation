import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/research-updates/route";
import {
  CONFIRMATION_WINDOW_MS,
  NO_RECORD,
  RESEARCH_UPDATES_TABLE,
  RESEARCH_UPDATES_TABLE_MIGRATED,
  decideOptIn,
  digestToken,
  issueToken,
  parseOptInRequest,
  type OptInRecord,
} from "@/lib/research-updates";

/*
  M-05. The opt-in exists as a closed route and a tested state machine, and as nothing else.

  These tests are written so that the day somebody builds the rest of it, the ones that fail are
  the ones naming what still has to be true: a table, a privacy disclosure and a durable limit.
  A test that merely asserted "returns 503" would pass forever and tell that person nothing.
*/

const environment = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AKC_CONTACT_ALLOWED_ORIGINS"] as const;

beforeEach(() => {
  // Vercel injects real Production/Preview values during prebuild; start from a known posture.
  vi.stubEnv("NODE_ENV", "test");
  for (const key of environment) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("https://tavonel.com/api/research-updates", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const subscribe = { action: "subscribe", email: "reader@example.com", website: "" };

describe("research updates route", () => {
  it("stores nothing while the table does not exist", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(40));
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await POST(request(subscribe));

    expect(response.status).toBe(503);
    expect(fetchMock, "a refused opt-in reaches no store").not.toHaveBeenCalled();
  });

  /*
    The gate is a constant rather than a probe on purpose: opening it is a deliberate edit, and
    this is the test that then fails and names the two founder items it has to be made with.
  */
  it("is gated on a migration and a privacy disclosure that do not exist yet", () => {
    expect(
      RESEARCH_UPDATES_TABLE_MIGRATED,
      `opening this gate needs ${RESEARCH_UPDATES_TABLE}, the privacy wording that says what the address is used for, and a durable rate limit`,
    ).toBe(false);
  });

  it("fails closed without an admin credential, before any table question", async () => {
    expect((await POST(request(subscribe))).status).toBe(503);
  });

  it("rejects a cross-origin submission", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AKC_CONTACT_ALLOWED_ORIGINS", "https://tavonel.com");
    expect((await POST(request(subscribe, "https://attacker.test"))).status).toBe(403);
  });

  it("accepts only JSON", async () => {
    const form = new Request("https://tavonel.com/api/research-updates", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost:3000" },
      body: "action=subscribe&email=reader@example.com",
    });
    expect((await POST(form)).status).toBe(415);
  });

  it("rejects an oversized request before parsing it", async () => {
    const oversized = request(subscribe);
    oversized.headers.set("content-length", "4097");
    expect((await POST(oversized)).status).toBe(413);
  });

  it.each([
    ["a body that is not an object", "reader@example.com"],
    ["an unknown action", { action: "resubscribe", email: "reader@example.com" }],
    ["an address that is not one", { action: "subscribe", email: "reader@", website: "" }],
    ["a filled honeypot", { action: "subscribe", email: "reader@example.com", website: "spam.test" }],
    ["a token that is not token-shaped", { action: "confirm", token: "short" }],
  ])("refuses %s", async (_case, body) => {
    expect((await POST(request(body))).status).toBe(400);
  });

  it("reads a confirm and an unsubscribe as separate closed shapes", () => {
    const token = issueToken();
    expect(parseOptInRequest({ action: "confirm", token })).toEqual({ action: "confirm", token });
    expect(parseOptInRequest({ action: "unsubscribe", token })).toEqual({ action: "unsubscribe", token });
    expect(parseOptInRequest({ action: "subscribe", email: "READER@Example.com ", website: "" }))
      .toEqual({ action: "subscribe", email: "reader@example.com" });
  });
});

/*
  The state machine, tested against the two rules that are the whole point of a double opt-in.
*/
describe("double opt-in state machine", () => {
  const pending = (issuedAt: number, token: string): OptInRecord =>
    ({ state: "pending", tokenDigest: digestToken(token), issuedAt });
  const now = 1_757_000_000_000;

  it("issues a confirmation for an address it has never seen", () => {
    expect(decideOptIn(NO_RECORD, { kind: "subscribe" }, now)).toEqual({ effect: "issue", state: "pending" });
  });

  it("re-issues for an address that unsubscribed, because that is a new decision", () => {
    const record: OptInRecord = { state: "unsubscribed", tokenDigest: null, issuedAt: null };
    expect(decideOptIn(record, { kind: "subscribe" }, now)).toEqual({ effect: "issue", state: "pending" });
  });

  it("sends nothing when a confirmed address is subscribed again", () => {
    // Otherwise the confirmation mail is a way to mail somebody repeatedly from the outside.
    const record: OptInRecord = { state: "confirmed", tokenDigest: null, issuedAt: null };
    expect(decideOptIn(record, { kind: "subscribe" }, now)).toEqual({ effect: "hold", state: "confirmed" });
  });

  it("confirms only with the token it issued", () => {
    const token = issueToken();
    expect(decideOptIn(pending(now, token), { kind: "confirm", token }, now))
      .toEqual({ effect: "activate", state: "confirmed" });
    expect(decideOptIn(pending(now, token), { kind: "confirm", token: issueToken() }, now))
      .toEqual({ effect: "refuse", reason: "token_mismatch" });
  });

  it("refuses a confirmation past its window", () => {
    const token = issueToken();
    expect(decideOptIn(pending(now, token), { kind: "confirm", token }, now + CONFIRMATION_WINDOW_MS + 1))
      .toEqual({ effect: "refuse", reason: "confirmation_expired" });
  });

  it("refuses a confirmation for an address with nothing pending", () => {
    expect(decideOptIn(NO_RECORD, { kind: "confirm", token: issueToken() }, now))
      .toEqual({ effect: "refuse", reason: "no_pending_confirmation" });
  });

  it("treats a second click on the same confirmation as the same act", () => {
    const record: OptInRecord = { state: "confirmed", tokenDigest: null, issuedAt: null };
    expect(decideOptIn(record, { kind: "confirm", token: issueToken() }, now))
      .toEqual({ effect: "hold", state: "confirmed" });
  });

  it.each(["absent", "pending", "confirmed", "unsubscribed"] as const)(
    "unsubscribes from %s without revealing which it was",
    (state) => {
      const record: OptInRecord = { state, tokenDigest: null, issuedAt: null };
      expect(decideOptIn(record, { kind: "unsubscribe" }, now)).toEqual({ effect: "deactivate", state: "unsubscribed" });
    },
  );
});
