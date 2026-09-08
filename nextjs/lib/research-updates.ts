import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/*
  M-05, the half that is not a founder decision.

  The blueprint's owned-audience gap asks for a Research Updates opt-in. Three things have to
  exist before an address may be collected: a table to put it in, privacy wording that discloses
  what the address is used for, and a double opt-in so that an address nobody typed cannot be
  subscribed by somebody who typed it for them. The first two are founder items -- a migration
  and legal copy. This module is the third, and the route beside it refuses every request until
  the first two land, because a form that accepts an address and drops it is worse than no form:
  the person believes they subscribed.

  The state machine is here rather than in the route so that it can be tested without a store,
  and so that the store, when it arrives, has one place to ask what a transition means.

  Two rules are the whole of why double opt-in exists, and both are here rather than in a
  comment on a table:

  - a subscribe request for an already-confirmed address issues nothing. Re-sending on demand
    turns the confirmation mail into a way for a stranger to mail somebody repeatedly.
  - a confirmation carries a token that must match a digest stored against that address and must
    still be inside its window. Confirming without one would make the "double" decorative.
*/

export const CONFIRMATION_WINDOW_MS = 48 * 60 * 60 * 1000;

export type OptInState = "absent" | "pending" | "confirmed" | "unsubscribed";

/** What the store holds for one address. `absent` is the shape used when there is no row. */
export type OptInRecord = {
  state: OptInState;
  tokenDigest: string | null;
  issuedAt: number | null;
};

export const NO_RECORD: OptInRecord = { state: "absent", tokenDigest: null, issuedAt: null };

export type OptInAction =
  | { kind: "subscribe" }
  | { kind: "confirm"; token: string }
  | { kind: "unsubscribe" };

export type OptInOutcome =
  /** Store a pending row with this digest, and send the confirmation mail. */
  | { effect: "issue"; state: "pending" }
  /** The address is confirmed; nothing is sent and nothing changes. */
  | { effect: "activate"; state: "confirmed" }
  | { effect: "deactivate"; state: "unsubscribed" }
  | { effect: "hold"; state: OptInState }
  | { effect: "refuse"; reason: "no_pending_confirmation" | "token_mismatch" | "confirmation_expired" };

export function issueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function digestsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  // Length is compared first because timingSafeEqual throws on a mismatch rather than returning
  // false, and a thrown error is a slower answer than a wrong one.
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function decideOptIn(record: OptInRecord, action: OptInAction, now: number): OptInOutcome {
  switch (action.kind) {
    case "subscribe":
      return record.state === "confirmed"
        ? { effect: "hold", state: "confirmed" }
        : { effect: "issue", state: "pending" };

    case "confirm":
      // A second click on the same link is the same person finishing the same action.
      if (record.state === "confirmed") return { effect: "hold", state: "confirmed" };
      if (record.state !== "pending" || !record.tokenDigest || record.issuedAt === null) {
        return { effect: "refuse", reason: "no_pending_confirmation" };
      }
      if (!digestsMatch(digestToken(action.token), record.tokenDigest)) {
        return { effect: "refuse", reason: "token_mismatch" };
      }
      if (now - record.issuedAt > CONFIRMATION_WINDOW_MS) {
        return { effect: "refuse", reason: "confirmation_expired" };
      }
      return { effect: "activate", state: "confirmed" };

    case "unsubscribe":
      // Idempotent from every state, including one that was never subscribed: an unsubscribe
      // that answers differently for a known and an unknown address is an address oracle.
      return { effect: "deactivate", state: "unsubscribed" };
  }
}

export type OptInRequest =
  | { action: "subscribe"; email: string }
  | { action: "confirm" | "unsubscribe"; token: string };

/*
  Closed-shape parsing, the same posture the contact route takes: a request carrying a field this
  form never offered is rejected outright rather than having the extra field ignored.
*/
export function parseOptInRequest(raw: unknown): OptInRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const action = typeof value.action === "string" ? value.action : "";

  if (action === "subscribe") {
    const email = (typeof value.email === "string" ? value.email : "").trim().toLowerCase();
    // The honeypot, matching the contact form: a real submitter leaves it empty.
    const website = typeof value.website === "string" ? value.website.trim() : "";
    if (website) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return null;
    return { action: "subscribe", email };
  }

  if (action === "confirm" || action === "unsubscribe") {
    const token = typeof value.token === "string" ? value.token.trim() : "";
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
    return { action, token };
  }

  return null;
}

/*
  The gate. `false` until `foundation_research_updates` exists, which is a founder item: the
  migration and the privacy wording are one decision, and a table without the second is an
  address collected under no stated purpose.

  Flipping this without those two is what the route test exists to make visible -- it asserts
  that a fully configured, fully valid request still gets a 503 while this is false, so the day
  somebody flips it, the test that fails names the two things that have to be true first.
*/
export const RESEARCH_UPDATES_TABLE = "foundation_research_updates";
export const RESEARCH_UPDATES_TABLE_MIGRATED: boolean = false;
