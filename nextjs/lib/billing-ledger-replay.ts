/*
  U14 ledger replay (WO-D27-1): a seeded stream of randomized quota / idempotency events, an
  independent in-memory oracle of one workspace account, and a runner that drives the real
  `apply_foundation_billing_event_v6`, `issue_foundation_checkout_intent`,
  `reserve_foundation_compute_v3` and `settle_foundation_compute_v3` through one psql session.

  The oracle is written from the function bodies at the integration head (migrations through
  20261110040000), not from the generated SQL: every branch below names the function it ports.
  A mismatch between oracle and database is a FINDING. Never edit the oracle to agree with the
  database without recording the finding first (WO-D27-1 step 3).

  Scope limits, stated here so nobody reads the result wider than it is:
  - One session, strictly sequential. Advisory-lock races are not exercised.
  - The cluster superuser runs the calls: RLS, grants and the PostgREST role path are not tested.
  - One workspace, one user, one customer. Trial and owner billing sources are not generated;
    the oracle models `billing_source = 'paid'` only.
  - "Settle after expiry" ages a reservation with a fixture UPDATE (the `expire` op). That UPDATE
    is test scaffolding, not product behaviour.
*/
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------------------------
// Fixed identities. Everything is rolled back, so reuse across seeds is safe.
// ---------------------------------------------------------------------------------------------

export const REPLAY_WORKSPACE = "pilot-replay01";
export const REPLAY_USER = "77777777-7777-7777-7777-777777777770";
export const REPLAY_CUSTOMER = `ctm_${"replay".padEnd(26, "0")}`;
const POLICY = "checkout-v1";
const INTENT_LIFETIME_SECONDS = 24 * 3600;
const STALE = "stale_or_mismatched_subscription";

// Intents 0..3 exist from the start; the rest are issued late, so a delivery rejected for a missing intent can be retried
// and some nonces stay unconsumed long enough to meet the first-use checks.
const CREDITS = [900, 600, 1500, 400, 700, 1000, 800, 1200, 500, 1100, 650, 950] as const;
const OTHER_PRICE = 99; // a price no intent carries
const OFFERS = ["observer_access", "studio_access"] as const;

// ---------------------------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------------------------

interface OpBase {
  /** A redelivery, replay, duplicate or conflicting reuse of something already sent. */
  retry: boolean;
  /** The variant that produced the op; printed on a mismatch. */
  tag: string;
}
export interface IntentOp extends OpBase {
  k: "intent";
  nonce: string;
  offer: string;
  price: string;
  credit: number;
}
export interface EventOp extends OpBase {
  k: "event";
  action: "allowance" | "subscription" | "purchase" | "reversal";
  eventId: string;
  eventType: string;
  /** Seconds after the transaction start (`now()` is constant inside the replay transaction). */
  t: number;
  sha: string;
  offer: string;
  txn: string | null;
  sub: string | null;
  status: string | null;
  adjustment: string | null;
  nonce: string;
  price: string | null;
  configured: number | null;
}
export interface ReserveOp extends OpBase {
  k: "reserve";
  doc: string;
  reserved: number;
  max: number;
}
export interface SettleOp extends OpBase {
  k: "settle";
  doc: string;
  outcome: string;
  actual: number;
  reason: string;
}
export interface ExpireOp extends OpBase {
  k: "expire";
  doc: string;
}
/** Fixture: an operator clearing `billing_hold`. No SQL function ever does, so it is test scaffolding. */
export interface ClearHoldOp extends OpBase {
  k: "clear_hold";
}
export type Op = IntentOp | EventOp | ReserveOp | SettleOp | ExpireOp | ClearHoldOp;

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sha = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
export const hashOps = (ops: readonly Op[]) => createHash("sha256").update(JSON.stringify(ops)).digest("hex");

const WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["allowance_new", 110], ["allowance_renewal_price", 12], ["allowance_bad_price", 8],
  ["allowance_unknown_nonce", 8], ["allowance_expired", 6], ["allowance_no_sub", 6],
  ["allowance_sub_conflict", 8], ["allowance_wrong_offer", 5], ["allowance_bad_type", 5],
  ["purchase", 12], ["subscription", 95], ["reversal_known", 32], ["reversal_orphan", 25],
  ["reversal_dup_event", 20], ["redeliver", 260], ["allowance_dup_txn", 50], ["event_conflict", 12],
  ["reserve_new", 140], ["reserve_retry", 70], ["reserve_conflict", 10], ["reserve_big", 20],
  ["reserve_invalid", 5], ["settle", 130], ["settle_redeliver", 60], ["settle_unknown", 5],
  ["settle_invalid", 8], ["expire_seq", 30], ["intent_dup", 8], ["intent_late", 40], ["clear_hold", 70],
];

const SUB_STATUS: ReadonlyArray<readonly [string, number]> = [
  ["active", 45], ["trialing", 8], ["past_due", 15], ["paused", 12], ["canceled", 10], ["inactive", 4],
];

export function generateOps(seed: number, count = 1000): Op[] {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const weighted = <T extends string>(table: ReadonlyArray<readonly [T, number]>): T => {
    let r = rnd() * table.reduce((n, [, w]) => n + w, 0);
    for (const [name, w] of table) if ((r -= w) < 0) return name;
    return table[table.length - 1][0];
  };
  const base36 = (prefix: string, n: number) => `${prefix}_${`x${seed}x${n.toString(36)}`.padStart(26, "0")}`;
  const uuid = (lead: string, n: number) => `${lead}0000-0000-4000-8000-${(seed * 1_000_000 + n).toString(16).padStart(12, "0")}`;
  let counter = 0;
  const next = () => ++counter;

  const nonce = (k: number) => uuid("1111", k);
  const price = (k: number) => base36("pri", 500 + k);
  const sub = (k: number) => base36("sub", 600 + k);
  const intentOp = (k: number): IntentOp => ({
    k: "intent", retry: false, tag: "intent", nonce: nonce(k), offer: OFFERS[k % 2], price: price(k), credit: CREDITS[k],
  });

  const ops: Op[] = [];
  const events: EventOp[] = [];
  const allowances: EventOp[] = [];
  const reversedTxns: string[] = [];
  const orphanTxns: string[] = [];
  const reserves: ReserveOp[] = [];
  const settles: SettleOp[] = [];
  const intents: IntentOp[] = [];
  let issued = 4;
  let clock = 0;

  // The stream follows the oracle (never the database), so it is still a pure function of the seed.
  const tracker = new LedgerOracle();
  const live: ReserveOp[] = [];
  const push = (op: Op) => {
    if (ops.length >= count) return;
    ops.push(op);
    const out = tracker.apply(op);
    if (op.k === "reserve" && out.ok?.idempotentReplay === false) live.push(op);
    if (op.k === "settle" && (out.ok?.status === "processed" || out.error === "foundation_compute_settlement_expired")) {
      live.splice(live.findIndex((r) => r.doc === op.doc), 1);
    }
    if (op.k === "event") events.push(op);
    if (op.k === "reserve" && !op.retry) reserves.push(op);
    if (op.k === "settle") settles.push(op);
    if (op.k === "intent" && !op.retry) intents.push(op);
  };
  const event = (tag: string, e: Partial<EventOp> & Pick<EventOp, "action" | "eventType">, retry = false): EventOp => {
    const body: Omit<EventOp, "sha"> = {
      k: "event", retry, tag, eventId: base36("evt", next()), t: clock, offer: OFFERS[0], txn: null,
      sub: null, status: null, adjustment: null, nonce: nonce(0), price: null, configured: null, ...e,
    };
    return { ...body, sha: sha(JSON.stringify({ ...body, eventId: undefined })) };
  };
  // The common shape: an event bound to intent `k` exactly as the runtime route would send it.
  const bound = (tag: string, k: number, e: Partial<EventOp> & Pick<EventOp, "action" | "eventType">): EventOp =>
    event(tag, { nonce: nonce(k), offer: OFFERS[k % 2], price: price(k), sub: sub(k), ...e });
  const issuedIntent = () => int(0, issued - 1);
  const freshTxn = () => base36("txn", next());

  const allowance = (tag: string, k: number, e: Partial<EventOp> = {}) => {
    const reuse = orphanTxns.length > 0 && rnd() < 0.5 ? orphanTxns.splice(int(0, orphanTxns.length - 1), 1)[0] : freshTxn();
    const op = bound(tag, k, { action: "allowance", eventType: "transaction.completed", txn: reuse, ...e });
    allowances.push(op);
    push(op);
  };
  const reserve = (tag: string, e: Partial<ReserveOp> = {}) => {
    const reserved = int(1, 60);
    const op: ReserveOp = { k: "reserve", retry: false, tag, doc: uuid("2222", next()), reserved, max: reserved + int(0, 40), ...e };
    push(op);
    return op;
  };
  const clone = <T extends Op>(op: T, tag: string): T => ({ ...op, retry: true, tag });

  for (let k = 0; k < 4; k++) push(intentOp(k));
  clock = 10;
  push(bound("bootstrap_subscription", 0, { action: "subscription", eventType: "subscription.created", status: "active" }));
  allowance("bootstrap_allowance", 0);

  while (ops.length < count) {
    clock += int(1, 20);
    const variant = weighted(WEIGHTS);
    const k = issuedIntent();
    switch (variant) {
      case "allowance_new": allowance(variant, k); break;
      case "allowance_renewal_price": allowance(variant, k, { price: price(OTHER_PRICE), configured: int(100, 500) }); break;
      case "allowance_bad_price": allowance(variant, k, { price: price(OTHER_PRICE) }); break;
      case "allowance_unknown_nonce": {
        const u = int(issued, CREDITS.length - 1);
        push(event(variant, { action: "allowance", eventType: "transaction.completed", nonce: nonce(u), offer: OFFERS[u % 2], price: price(u), sub: sub(u), txn: freshTxn() }));
        break;
      }
      case "allowance_expired": allowance(variant, issued > 4 ? int(4, issued - 1) : k, { t: INTENT_LIFETIME_SECONDS + 3600 }); break;
      case "allowance_no_sub": allowance(variant, issued > 4 && rnd() < 0.5 ? int(4, issued - 1) : k, { sub: null }); break;
      case "allowance_sub_conflict": {
        // A late intent (4, 5) is still unconsumed, so it meets the subscription already bound to another nonce.
        const target = issued > 4 && rnd() < 0.5 ? int(4, issued - 1) : k;
        allowance(variant, target, { sub: sub(target < 4 ? (target + 1 + int(0, 2)) % 4 : int(0, 3)) });
        break;
      }
      case "allowance_wrong_offer": allowance(variant, k, { offer: OFFERS[(k + 1) % 2] }); break;
      case "allowance_bad_type": allowance(variant, k, { eventType: "transaction.updated" }); break;
      case "purchase":
        push(bound(variant, k, { action: "purchase", eventType: "transaction.completed", txn: freshTxn() }));
        break;
      case "subscription": {
        const sk = rnd() < 0.65 ? 0 : k; // most subscription events belong to the account's own subscription
        push(bound(variant, sk, {
          action: "subscription", eventType: pick(["subscription.created", "subscription.activated", "subscription.updated", "subscription.updated"]),
          status: weighted(SUB_STATUS), t: Math.max(0, clock - (rnd() < 0.2 ? int(1, 150) : 0)), price: rnd() < 0.05 ? price(OTHER_PRICE) : price(sk),
        }));
        break;
      }
      case "reversal_known":
        if (allowances.length) {
          const a = pick(allowances);
          reversedTxns.push(a.txn as string);
          push(event(variant, { action: "reversal", eventType: "adjustment.updated", txn: a.txn, adjustment: base36("adj", next()) }));
        }
        break;
      case "reversal_orphan": {
        const txn = freshTxn();
        orphanTxns.push(txn);
        push(event(variant, { action: "reversal", eventType: "adjustment.updated", txn, adjustment: rnd() < 0.05 ? null : base36("adj", next()) }));
        break;
      }
      case "reversal_dup_event":
        if (reversedTxns.length) {
          push(event(variant, { action: "reversal", eventType: "adjustment.updated", txn: pick(reversedTxns), adjustment: base36("adj", next()) }, true));
        }
        break;
      case "redeliver":
        if (events.length) {
          const e = pick(events);
          push(clone(e, `redeliver:${e.tag}`));
        }
        break;
      case "allowance_dup_txn":
        if (allowances.length) {
          const a = pick(allowances);
          push(event(variant, { ...a, eventId: base36("evt", next()) }, true));
        }
        break;
      case "event_conflict":
        if (events.length) {
          const e = pick(events);
          push({ ...e, retry: true, tag: variant, sha: sha(`${e.sha}#different-payload`) });
        }
        break;
      case "reserve_new": reserve(variant); break;
      case "reserve_big": reserve(variant, { reserved: int(200, 900), max: 900 + int(0, 100) }); break;
      case "reserve_invalid": reserve(variant, rnd() < 0.5 ? { reserved: 0, max: 5 } : { reserved: 10, max: 5 }); break;
      case "reserve_retry":
        if (reserves.length) push(clone(pick(reserves), variant));
        break;
      case "reserve_conflict":
        if (reserves.length) {
          const r = pick(reserves);
          push({ ...r, retry: true, tag: variant, reserved: r.reserved + 1, max: r.max + 1 });
        }
        break;
      case "settle": {
        if (!reserves.length) break;
        const r = pick(live.length && rnd() < 0.85 ? live : reserves);
        const outcome = pick(["settled", "settled", "settled", "operator_review", "released", "released"]);
        const x = rnd();
        const actual = outcome === "released" ? 0 : x < 0.5 ? int(0, r.reserved) : x < 0.85 ? int(r.reserved, r.max) : r.max + int(1, 5);
        push({ k: "settle", retry: false, tag: variant, doc: r.doc, outcome, actual, reason: "OCR_COMPLETED" });
        break;
      }
      case "settle_redeliver":
        if (settles.length) push(clone(pick(settles), variant));
        break;
      case "settle_unknown":
        push({ k: "settle", retry: false, tag: variant, doc: uuid("3333", next()), outcome: "settled", actual: 1, reason: "OCR_COMPLETED" });
        break;
      case "settle_invalid":
        if (reserves.length) {
          const r = pick(reserves);
          push(rnd() < 0.5
            ? { k: "settle", retry: false, tag: variant, doc: r.doc, outcome: "released", actual: 3, reason: "OCR_COMPLETED" }
            : { k: "settle", retry: false, tag: variant, doc: r.doc, outcome: "settled", actual: 1, reason: "bad reason" });
        }
        break;
      case "expire_seq":
        if (live.length) {
          const r = pick(live);
          push({ k: "expire", retry: false, tag: variant, doc: r.doc });
          reserve("expire_sweep");
          push({ k: "settle", retry: false, tag: "settle_after_expiry", doc: r.doc, outcome: "settled", actual: r.reserved, reason: "OCR_COMPLETED" });
        }
        break;
      case "intent_dup":
        if (intents.length) push(clone(pick(intents), variant));
        break;
      case "clear_hold": push({ k: "clear_hold", retry: false, tag: variant }); break;
      case "intent_late":
        if (issued < CREDITS.length) push(intentOp(issued++));
        break;
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------------------------

type Scalar = string | number | boolean | null;
export type Rec = Record<string, Scalar>;
export interface Outcome {
  ok?: Rec;
  /** The function's exception name, or `sqlstate:<code>` for a database-raised error. */
  error?: string;
}

interface Ev { sha: string; action: string; txn: string | null; result: string }
interface Led { eventId: string; kind: "allowance" | "reversed" | "allowance_expired"; offer: string; txn: string | null; reversalOf: string | null; delta: number }
interface Acct {
  balance: number; hold: boolean; overageEnabled: boolean; overageUnits: number; lifetimeOverage: number;
  lifetimeAllowance: number; lifetimeReversed: number; accessPlan: string | null; status: string;
  subscriptionId: string | null; lastSubAt: number | null;
}
interface Res { state: string; reserved: number; max: number; settled: number | null; reason: string | null; aged: boolean }
interface State {
  acct: Acct | null;
  events: Map<string, Ev>;
  ledger: Led[];
  pending: Map<string, { eventId: string; adjustment: string | null }>;
  intents: Map<string, { offer: string; price: string; credit: number }>;
  consumptions: Map<string, { offer: string; sub: string | null; price: string; credit: number }>;
  rejections: Set<string>;
  reservations: Map<string, Res>;
}

class Refusal extends Error {}
const refuse = (name: string): never => {
  throw new Refusal(name);
};

export interface Snapshot {
  account: Record<string, Scalar> | null;
  ledger: Array<Record<string, Scalar>>;
  events: Array<{ eventId: string; result: string }>;
  reservation: Record<string, Scalar> | null;
  counts: Record<string, number>;
}
export type ActualSnapshot = Snapshot & { invariants: Record<string, number | null> };

export class LedgerOracle {
  private s: State = {
    acct: null, events: new Map(), ledger: [], pending: new Map(), intents: new Map(),
    consumptions: new Map(), rejections: new Set(), reservations: new Map(),
  };

  /** Applies one op. A refusal rolls the whole call back, exactly like a raised exception in SQL. */
  apply(op: Op): Outcome {
    const before = structuredClone(this.s);
    try {
      switch (op.k) {
        case "intent": return { ok: this.intent(op) };
        case "event": return { ok: this.event(op) };
        case "reserve": return { ok: this.reserve(op) };
        case "settle": return { ok: this.settle(op) };
        case "expire": return { ok: this.expire(op) };
        case "clear_hold": return { ok: this.clearHold() };
      }
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      this.s = before;
      return { error: e.message };
    }
  }

  // issue_foundation_checkout_intent: issued at `now()`, so the clock-skew guard never fires.
  private intent(op: IntentOp): Rec {
    if (this.s.intents.has(op.nonce)) refuse("sqlstate:23505");
    this.s.intents.set(op.nonce, { offer: op.offer, price: op.price, credit: op.credit });
    return { status: "issued" };
  }

  private account(): Acct {
    return (this.s.acct ??= {
      balance: 0, hold: false, overageEnabled: false, overageUnits: 0, lifetimeOverage: 0, lifetimeAllowance: 0,
      lifetimeReversed: 0, accessPlan: null, status: "inactive", subscriptionId: null, lastSubAt: null,
    });
  }

  // apply_foundation_billing_event_v6
  private event(op: EventOp): Rec {
    const s = this.s;
    if (op.action === "reversal") return this.reversal(op);
    const previous = s.events.get(op.eventId);
    let staleRetry = false;
    if (previous) {
      if (previous.result === STALE && op.action === "subscription") staleRetry = true;
      else {
        if (previous.sha !== op.sha || previous.action !== op.action) refuse("foundation_billing_event_id_conflict");
        return { status: "duplicate" };
      }
    }
    const entitling = op.action !== "subscription" || op.status === "active" || op.status === "trialing";
    let reason: string | null = null;
    let snapPrice: string | null = null;
    let snapCredit = 0;
    let credit = 0;
    const consumed = s.consumptions.get(op.nonce);
    if (consumed) {
      if (consumed.offer !== op.offer || consumed.sub !== op.sub) reason = "checkout_binding_reuse_conflict";
      snapPrice = consumed.price;
      snapCredit = consumed.credit;
    } else if (
      op.action === "subscription" &&
      !(["subscription.created", "subscription.activated"].includes(op.eventType) && entitling && op.sub !== null)
    ) {
      reason = "checkout_binding_bootstrap_event_invalid";
    } else {
      const intent = s.intents.get(op.nonce);
      if (!intent) reason = "checkout_intent_missing";
      else {
        snapPrice = intent.price;
        snapCredit = intent.credit;
        if (intent.offer !== op.offer) reason = "checkout_intent_mismatch";
        else if (op.t < -300 || op.t > INTENT_LIFETIME_SECONDS) reason = "checkout_intent_expired";
        else if (op.price !== intent.price) reason = "checkout_price_not_allowed";
        else if (op.action === "allowance" && op.sub === null) reason = "checkout_subscription_binding_required";
      }
    }
    if (reason === null && entitling) {
      if (snapPrice !== null && op.price === snapPrice) credit = snapCredit;
      else if (op.configured !== null) credit = op.configured;
      else reason = "checkout_price_not_allowed";
    }
    if (reason === null && !consumed) {
      if (op.sub !== null && [...s.consumptions.values()].some((c) => c.sub === op.sub)) reason = "checkout_subscription_reuse_conflict";
      else s.consumptions.set(op.nonce, { offer: op.offer, sub: op.sub, price: snapPrice as string, credit: snapCredit });
    }
    if (reason !== null) {
      s.rejections.add(op.eventId);
      return { status: "binding_rejected", reason };
    }
    if (op.action === "allowance") return this.allowance(op, credit);
    if (staleRetry) return { status: STALE };
    if (op.action === "purchase") {
      // v3 -> v2 -> base: the offers this gate admits are not purchase offers, so base refuses.
      return refuse("billing_purchase_contract_invalid");
    }
    return this.subscription(op);
  }

  // apply_foundation_billing_event_v4, allowance branch
  private allowance(op: EventOp, credit: number): Rec {
    const s = this.s;
    if (op.eventType !== "transaction.completed" || op.txn === null || credit <= 0) refuse("billing_allowance_contract_invalid");
    const txn = op.txn as string;
    s.events.set(op.eventId, { sha: op.sha, action: "allowance", txn, result: "received" });
    const a = this.account();
    const granted = !s.ledger.some((r) => r.kind === "allowance" && r.txn === txn);
    let expired = 0;
    if (granted) {
      s.ledger.push({ eventId: op.eventId, kind: "allowance", offer: op.offer, txn, reversalOf: null, delta: credit });
      a.overageEnabled = true; // foundation_subscription_overage_trigger
      // FD-03: this period's pages replace what is left of the last period's.
      const other = Math.max(0, s.ledger.filter((r) => r.offer !== op.offer).reduce((n, r) => n + r.delta, 0));
      expired = Math.max(0, a.balance - other);
      if (expired > 0) s.ledger.push({ eventId: op.eventId, kind: "allowance_expired", offer: op.offer, txn, reversalOf: null, delta: -expired });
      a.balance = a.balance - expired + credit;
      a.lifetimeAllowance += credit;
      const pending = s.pending.get(txn);
      if (pending) {
        s.ledger.push({ eventId: pending.eventId, kind: "reversed", offer: op.offer, txn: null, reversalOf: txn, delta: -credit });
        a.overageEnabled = false; // the same trigger, on a reversed row
        a.balance = Math.max(0, a.balance - credit);
        a.lifetimeReversed += credit;
        a.hold = true;
        const row = s.events.get(pending.eventId);
        if (row) row.result = "reversal_applied";
        s.pending.delete(txn);
      }
    }
    const status = granted ? "allowance_granted" : "duplicate_transaction";
    (s.events.get(op.eventId) as Ev).result = status;
    return { status, expiredIncludedUnits: expired };
  }

  // apply_foundation_billing_event_v4, reversal branch (v6 hands reversals straight to it)
  private reversal(op: EventOp): Rec {
    const s = this.s;
    const previous = s.events.get(op.eventId);
    if (previous) {
      if (previous.sha !== op.sha || previous.action !== op.action) refuse("foundation_billing_event_id_conflict");
      return { status: "duplicate", expiredIncludedUnits: 0 };
    }
    const grant = s.ledger.find((r) => r.kind === "allowance" && r.txn === op.txn);
    if (!grant) {
      // v3 -> v2 -> base: a reversal for a transaction not seen yet waits in the pending ledger.
      if (op.txn === null || op.adjustment === null) refuse("billing_reversal_contract_invalid");
      s.events.set(op.eventId, { sha: op.sha, action: "reversal", txn: op.txn, result: "pending_original_transaction" });
      const taken = s.pending.has(op.txn as string) || [...s.pending.values()].some((p) => p.adjustment === op.adjustment);
      if (!taken) s.pending.set(op.txn as string, { eventId: op.eventId, adjustment: op.adjustment });
      return { status: "pending_original_transaction" };
    }
    s.events.set(op.eventId, { sha: op.sha, action: "reversal", txn: op.txn, result: "reversal_applied" });
    if (!s.ledger.some((r) => r.kind === "reversed" && r.reversalOf === op.txn)) {
      s.ledger.push({ eventId: op.eventId, kind: "reversed", offer: grant.offer, txn: null, reversalOf: op.txn, delta: -grant.delta });
      const a = this.account();
      a.overageEnabled = false;
      a.balance = Math.max(0, a.balance - grant.delta);
      a.lifetimeReversed += grant.delta;
      a.hold = true;
    }
    return { status: "reversal_applied" };
  }

  // v3 -> v2 -> base, subscription branch
  private subscription(op: EventOp): Rec {
    const s = this.s;
    s.events.set(op.eventId, { sha: op.sha, action: "subscription", txn: null, result: "received" });
    const a = this.account();
    const accepted =
      (a.lastSubAt === null || op.t >= a.lastSubAt) && (a.subscriptionId === null || a.subscriptionId === op.sub);
    if (accepted) {
      a.accessPlan = op.offer;
      a.status = op.status as string;
      a.subscriptionId = op.sub;
      a.lastSubAt = op.t;
    }
    const status = accepted ? "processed" : STALE;
    (s.events.get(op.eventId) as Ev).result = status;
    return { status };
  }

  // reserve_foundation_compute_v3, billing_source = 'paid'
  private reserve(op: ReserveOp): Rec {
    const s = this.s;
    if (op.reserved < 1 || op.reserved > 60000 || op.max < op.reserved || op.max > 60000) refuse("foundation_compute_reservation_invalid");
    for (const r of s.reservations.values()) {
      if (r.state === "reserved" && r.aged) {
        if (s.acct) s.acct.balance += r.reserved;
        r.state = "expired";
        r.settled = 0;
        r.reason = "CAPABILITY_EXPIRED";
      }
    }
    const existing = s.reservations.get(op.doc);
    if (existing) {
      if (existing.reserved !== op.reserved || existing.max !== op.max) refuse("foundation_compute_idempotency_conflict");
      return { state: existing.state, reservedCredits: existing.reserved, maximumCredits: existing.max, billingSource: "paid", idempotentReplay: true };
    }
    const a = s.acct;
    if (a && a.accessPlan !== null && (a.status === "active" || a.status === "trialing") && !a.hold) {
      if (a.balance < op.reserved) refuse("foundation_credits_required");
      s.reservations.set(op.doc, { state: "reserved", reserved: op.reserved, max: op.max, settled: null, reason: null, aged: false });
      a.balance -= op.reserved;
      return { state: "reserved", reservedCredits: op.reserved, maximumCredits: op.max, billingSource: "paid", idempotentReplay: false };
    }
    if (a && a.hold) refuse("foundation_billing_hold");
    return refuse("foundation_subscription_required"); // no trial row exists in this replay
  }

  // settle_foundation_compute_v3, billing_source = 'paid'
  private settle(op: SettleOp): Rec {
    const s = this.s;
    if (
      !["settled", "operator_review", "released"].includes(op.outcome) || op.actual < 0 || op.actual > 60000 ||
      (op.outcome === "released" && op.actual !== 0) || !/^[A-Z0-9_]{3,80}$/.test(op.reason)
    ) refuse("foundation_compute_settlement_invalid");
    const r = s.reservations.get(op.doc);
    if (!r) return refuse("foundation_compute_reservation_not_found");
    if (["settled", "released", "operator_review", "expired"].includes(r.state)) {
      if (r.state === op.outcome && r.settled === op.actual) return { status: "duplicate", billingSource: "paid" };
      if (r.state === "expired") refuse("foundation_compute_settlement_expired");
      refuse("foundation_compute_settlement_conflict");
    }
    if (op.actual > r.max) refuse("foundation_compute_maximum_charge_exceeded");
    const a = s.acct ?? refuse("foundation_billing_account_required");
    const over = Math.max(0, op.actual - r.reserved);
    if (over > 0 && (!a.overageEnabled || a.hold)) refuse("foundation_compute_overage_not_enabled");
    const released = Math.max(0, r.reserved - op.actual);
    a.balance += released;
    a.overageUnits += over;
    a.lifetimeOverage += over;
    r.state = op.outcome;
    r.settled = op.actual;
    r.reason = op.reason;
    return { status: "processed", state: op.outcome, settledCredits: op.actual, releasedCredits: released, overageCredits: over, billingSource: "paid" };
  }

  // Fixture: age a held reservation past its lifetime (what the SQL tests do with an UPDATE).
  private expire(op: ExpireOp): Rec {
    const r = this.s.reservations.get(op.doc);
    if (r && r.state === "reserved") {
      r.aged = true;
      return { updated: 1 };
    }
    return { updated: 0 };
  }

  private clearHold(): Rec {
    if (!this.s.acct) return { updated: 0 };
    this.s.acct.hold = false;
    return { updated: 1 };
  }

  /** What the database should show for the rows an op touched, plus global counts. */
  snapshot(op: Op): Snapshot {
    const s = this.s;
    const txn = op.k === "event" ? op.txn : null;
    const evt = op.k === "event" ? op.eventId : null;
    const a = s.acct;
    const res = op.k === "reserve" || op.k === "settle" || op.k === "expire" ? s.reservations.get(op.doc) : undefined;
    // Code-unit order, to match `collate "C"` in the database snapshot.
    const byKey = (x: Record<string, Scalar>, y: Record<string, Scalar>) =>
      x.kind === y.kind ? ((x.eventId as string) < (y.eventId as string) ? -1 : 1) : (x.kind as string) < (y.kind as string) ? -1 : 1;
    return {
      account: a && {
        balance: a.balance, hold: a.hold, overageEnabled: a.overageEnabled, overageUnits: a.overageUnits,
        lifetimeOverage: a.lifetimeOverage, lifetimeAllowance: a.lifetimeAllowance, lifetimeReversed: a.lifetimeReversed,
        accessPlan: a.accessPlan, status: a.status, subscriptionId: a.subscriptionId, lastSubAt: a.lastSubAt,
      },
      ledger: s.ledger
        .filter((r) => txn !== null && (r.txn === txn || r.reversalOf === txn))
        .map((r) => ({ kind: r.kind, offer: r.offer, txn: r.txn, reversalOf: r.reversalOf, delta: r.delta, eventId: r.eventId }))
        .sort(byKey),
      events: [...s.events.entries()]
        .filter(([id, e]) => id === evt || (txn !== null && e.txn === txn))
        .map(([eventId, e]) => ({ eventId, result: e.result }))
        .sort((x, y) => (x.eventId < y.eventId ? -1 : 1)),
      reservation: res
        ? { state: res.state, reserved: res.reserved, maximum: res.max, settled: res.settled, reason: res.reason, source: "paid" }
        : null,
      counts: {
        events: s.events.size, ledger: s.ledger.length, ledgerSum: s.ledger.reduce((n, r) => n + r.delta, 0),
        reservations: s.reservations.size, consumptions: s.consumptions.size, rejections: s.rejections.size,
        intents: s.intents.size, pending: s.pending.size,
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

/** Every difference between what the oracle expects and what the database returned. */
export function diffValues(expected: unknown, actual: unknown, path = ""): string[] {
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return [`${path || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
    if (Array.isArray(expected)) {
      const got = actual as unknown[];
      if (expected.length !== got.length) return [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
      return expected.flatMap((v, i) => diffValues(v, got[i], `${path}[${i}]`));
    }
    return Object.entries(expected).flatMap(([key, v]) => diffValues(v, (actual as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return expected === actual ? [] : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

export function diffOutcome(expected: Outcome, actual: Outcome): string[] {
  if (expected.error !== undefined || actual.error !== undefined) {
    return expected.error === actual.error ? [] : [`outcome: expected error ${JSON.stringify(expected.error)}, got ${JSON.stringify(actual.error ?? actual.ok)}`];
  }
  return diffValues(expected.ok, actual.ok, "result");
}

/**
 * Properties that must hold after every op whatever the oracle says. The balance identity is
 * ledger sum - live holds - charged = balance, with one allowed departure: a reversal clamps the
 * balance at zero (`greatest(0, ...)`), which can leave the balance ABOVE the identity, never below.
 * That slack must be exactly zero until a reversal has been applied.
 */
export function checkInvariants(inv: Record<string, number | null>): string[] {
  const n = (key: string) => inv[key] ?? 0;
  const out: string[] = [];
  if (n("maxAllowancePerTxn") > 1) out.push(`a transaction carries ${n("maxAllowancePerTxn")} allowance rows`);
  if (n("maxReversalPerTxn") > 1) out.push(`a transaction carries ${n("maxReversalPerTxn")} reversal rows`);
  if (inv.balance === null) return out;
  if (n("balance") < 0) out.push(`credit_balance ${n("balance")} < 0`);
  if (n("overageUnits") < 0) out.push(`overage_units ${n("overageUnits")} < 0`);
  const slack = n("balance") - (n("ledgerSum") - n("liveHolds") - n("charged"));
  if (slack < 0) out.push(`balance identity: balance ${n("balance")} < ledger ${n("ledgerSum")} - holds ${n("liveHolds")} - charged ${n("charged")}`);
  if (slack > 0 && n("lifetimeReversed") === 0) out.push(`balance identity: slack ${slack} with no reversal applied`);
  if (n("overageUnits") !== n("overageCharged")) out.push(`overage_units ${n("overageUnits")} != sum of settled overage ${n("overageCharged")}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// psql session
// ---------------------------------------------------------------------------------------------

export function assertLoopbackDsn(dsn: string): void {
  let host = "";
  try {
    host = new URL(dsn).hostname;
  } catch {
    /* falls through to the refusal */
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
    throw new Error(`TAVONEL_LOCAL_DSN must name a loopback host (127.0.0.1, localhost or ::1); got "${host || "no host"}".`);
  }
}

export interface PsqlSession {
  /** Sends one or more statements and resolves with the stdout lines; rejects on any stderr output. */
  query(sql: string): Promise<string[]>;
  close(): Promise<void>;
}

const END = "@@TAVONEL_LEDGER_REPLAY_END@@";

export function openPsqlSession(dsn: string, psqlPath: string = process.env.PSQL ?? "psql"): PsqlSession {
  assertLoopbackDsn(dsn);
  const child = spawn(psqlPath, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=0", dsn], {
    env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c lc_messages=C" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  let waiting: { resolve: (lines: string[]) => void; reject: (e: Error) => void } | null = null;
  const settle = () => {
    if (!waiting || !out.includes(`${END}\n`) || !err.includes(`${END}\n`)) return;
    const lines = out.slice(0, out.indexOf(`${END}\n`)).split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
    const problem = err.slice(0, err.indexOf(`${END}\n`)).trim();
    const w = waiting;
    waiting = null;
    out = "";
    err = "";
    if (problem) w.reject(new Error(`psql: ${problem}`));
    else w.resolve(lines);
  };
  child.stdout.setEncoding("utf8").on("data", (d: string) => { out += d.replace(/\r\n/g, "\n"); settle(); });
  child.stderr.setEncoding("utf8").on("data", (d: string) => { err += d.replace(/\r\n/g, "\n"); settle(); });
  child.on("exit", (code) => waiting?.reject(new Error(`psql exited with code ${code}`)));
  child.on("error", (e) => waiting?.reject(e));
  return {
    query(sql) {
      if (waiting) return Promise.reject(new Error("psql session is busy"));
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        child.stdin.write(`${sql}\n\\echo ${END}\n\\warn ${END}\n`);
      });
    },
    close() {
      return new Promise((resolve) => {
        child.on("exit", () => resolve());
        child.stdin.end("\\q\n");
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Database side
// ---------------------------------------------------------------------------------------------

const lit = (v: Scalar | undefined) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const SETUP_SQL = `
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', ${lit(REPLAY_USER)}, 'authenticated', 'authenticated',
  'ledger-replay@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
create function pg_temp.try(q text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute q into r;
  return jsonb_build_object('ok', r);
exception when others then
  return jsonb_build_object('error', sqlerrm, 'state', sqlstate);
end $f$;
create function pg_temp.snap(p_txn text, p_evt text, p_doc uuid) returns jsonb language sql as $f$
select jsonb_build_object(
  'account', (select jsonb_build_object(
      'balance', credit_balance, 'hold', billing_hold, 'overageEnabled', overage_enabled,
      'overageUnits', overage_units, 'lifetimeOverage', lifetime_overage_units,
      'lifetimeAllowance', lifetime_allowance_units, 'lifetimeReversed', lifetime_credits_reversed,
      'accessPlan', access_plan, 'status', subscription_status, 'subscriptionId', paddle_subscription_id,
      'lastSubAt', case when last_subscription_event_at is null then null
        else round(extract(epoch from last_subscription_event_at - now()))::int end)
    from public.foundation_billing_accounts where workspace_key = ${lit(REPLAY_WORKSPACE)}),
  'ledger', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'offer', offer_code,
      'txn', transaction_id, 'reversalOf', reversal_of_transaction_id, 'delta', credit_delta, 'eventId', event_id)
      order by kind collate "C", event_id collate "C")
    from public.foundation_credit_ledger
    where p_txn is not null and (transaction_id = p_txn or reversal_of_transaction_id = p_txn)), '[]'::jsonb),
  'events', coalesce((select jsonb_agg(jsonb_build_object('eventId', event_id, 'result', processing_result) order by event_id collate "C")
    from public.foundation_billing_events
    where event_id = p_evt or (p_txn is not null and transaction_id = p_txn)), '[]'::jsonb),
  'reservation', (select jsonb_build_object('state', state::text, 'reserved', reserved_credits,
      'maximum', maximum_credits, 'settled', settled_credits, 'reason', reason_code, 'source', billing_source)
    from public.foundation_compute_reservations where document_id = p_doc),
  'counts', jsonb_build_object(
    'events', (select count(*) from public.foundation_billing_events),
    'ledger', (select count(*) from public.foundation_credit_ledger),
    'ledgerSum', (select coalesce(sum(credit_delta), 0) from public.foundation_credit_ledger),
    'reservations', (select count(*) from public.foundation_compute_reservations),
    'consumptions', (select count(*) from public.foundation_checkout_binding_consumptions),
    'rejections', (select count(*) from public.foundation_billing_event_rejections),
    'intents', (select count(*) from public.foundation_checkout_intents),
    'pending', (select count(*) from public.foundation_pending_reversals)),
  'invariants', jsonb_build_object(
    'maxAllowancePerTxn', coalesce((select max(c) from (select count(*) c from public.foundation_credit_ledger
      where kind = 'allowance' group by transaction_id) x), 0),
    'maxReversalPerTxn', coalesce((select max(c) from (select count(*) c from public.foundation_credit_ledger
      where kind = 'reversed' group by reversal_of_transaction_id) x), 0),
    'balance', (select credit_balance from public.foundation_billing_accounts where workspace_key = ${lit(REPLAY_WORKSPACE)}),
    'overageUnits', (select overage_units from public.foundation_billing_accounts where workspace_key = ${lit(REPLAY_WORKSPACE)}),
    'lifetimeReversed', (select lifetime_credits_reversed from public.foundation_billing_accounts where workspace_key = ${lit(REPLAY_WORKSPACE)}),
    'ledgerSum', (select coalesce(sum(credit_delta), 0) from public.foundation_credit_ledger),
    'liveHolds', (select coalesce(sum(reserved_credits), 0) from public.foundation_compute_reservations where state = 'reserved'),
    'charged', (select coalesce(sum(least(reserved_credits, settled_credits)), 0)
      from public.foundation_compute_reservations where state in ('settled', 'operator_review')),
    'overageCharged', (select coalesce(sum(greatest(0, settled_credits - reserved_credits)), 0)
      from public.foundation_compute_reservations where state in ('settled', 'operator_review'))))
$f$;
`;

/** The statement the real database gets for an op. Every call is one RPC, as the route sends it. */
export function opSql(op: Op): string {
  switch (op.k) {
    case "intent":
      return `select to_jsonb(public.issue_foundation_checkout_intent(${lit(op.nonce)}::uuid, ${lit(REPLAY_WORKSPACE)}, ${lit(REPLAY_USER)}::uuid, ${lit(op.offer)}, ${lit(POLICY)}, ${lit(op.price)}, ${op.credit}, now()))`;
    case "event": {
      const reversal = op.action === "reversal";
      const a = (name: string, v: Scalar | undefined) => `${name} => ${lit(v)}`;
      return `select to_jsonb(public.apply_foundation_billing_event_v6(${[
        a("p_event_id", op.eventId), a("p_event_type", op.eventType), `p_occurred_at => now() + make_interval(secs => ${op.t})`,
        a("p_payload_sha256", op.sha), a("p_action", op.action),
        a("p_workspace_key", reversal ? null : REPLAY_WORKSPACE), `p_user_id => ${reversal ? "null" : `${lit(REPLAY_USER)}::uuid`}`,
        a("p_offer_code", reversal ? null : op.offer), a("p_transaction_id", op.txn),
        a("p_customer_id", reversal ? null : REPLAY_CUSTOMER), a("p_subscription_id", reversal ? null : op.sub),
        a("p_subscription_status", op.status), a("p_adjustment_id", reversal ? op.adjustment : null),
        a("p_binding_nonce", reversal ? null : op.nonce), `p_binding_issued_at => ${reversal ? "null" : "now()"}`,
        a("p_binding_policy_version", reversal ? null : POLICY), a("p_price_id", reversal ? null : op.price),
        a("p_configured_credit_delta", reversal ? null : op.configured),
      ].join(", ")}))`;
    }
    case "reserve":
      return `select to_jsonb(public.reserve_foundation_compute_v3(${lit(REPLAY_WORKSPACE)}, ${lit(op.doc)}::uuid, ${lit(REPLAY_USER)}::uuid, ${op.reserved}, ${op.max}))`;
    case "settle":
      return `select to_jsonb(public.settle_foundation_compute_v3(${lit(REPLAY_WORKSPACE)}, ${lit(op.doc)}::uuid, ${lit(op.outcome)}, ${op.actual}, ${lit(op.reason)}))`;
    case "clear_hold":
      return `with u as (update public.foundation_billing_accounts set billing_hold = false where workspace_key = ${lit(REPLAY_WORKSPACE)} returning 1) select jsonb_build_object('updated', count(*)) from u`;
    case "expire":
      return `with u as (update public.foundation_compute_reservations set created_at = clock_timestamp() - interval '20 minutes', expires_at = clock_timestamp() - interval '10 minutes' where document_id = ${lit(op.doc)}::uuid and state = 'reserved' returning 1) select jsonb_build_object('updated', count(*)) from u`;
  }
}

function parseOutcome(line: string): Outcome {
  const raw = JSON.parse(line) as { ok?: Rec | null; error?: string; state?: string };
  if (raw.error !== undefined) return { error: raw.state === "P0001" ? raw.error : `sqlstate:${raw.state}` };
  return { ok: raw.ok ?? {} };
}

/** The tables a replay compares against must start empty, or the oracle's counts are meaningless. */
export async function assertEmptyLedgerDatabase(session: PsqlSession): Promise<void> {
  const tables = [
    "foundation_billing_accounts", "foundation_billing_events", "foundation_credit_ledger", "foundation_compute_reservations",
    "foundation_checkout_intents", "foundation_checkout_binding_consumptions", "foundation_billing_event_rejections",
    "foundation_pending_reversals",
  ];
  const lines = await session.query(
    `select to_jsonb(x) from (select ${tables.map((t) => `(select count(*) from public.${t}) as ${t}`).join(", ")}) x;`,
  );
  const counts = JSON.parse(lines[0]) as Record<string, number>;
  const dirty = Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`);
  if (dirty.length) throw new Error(`refusing to replay into a database that already holds billing rows (${dirty.join(", ")})`);
}

export interface Mismatch {
  seed: number;
  index: number;
  op: Op;
  problems: string[];
  expected: { outcome: Outcome; snapshot: Snapshot };
  actual: { outcome: Outcome; snapshot: ActualSnapshot };
}

/** One seed inside begin ... rollback. Returns the first mismatch, or null when oracle and database agree throughout. */
export async function replayOps(session: PsqlSession, seed: number, ops: readonly Op[]): Promise<Mismatch | null> {
  await session.query(SETUP_SQL);
  try {
    const oracle = new LedgerOracle();
    for (let index = 0; index < ops.length; index++) {
      const op = ops[index];
      const expectedOutcome = oracle.apply(op);
      const expectedSnapshot = oracle.snapshot(op);
      const txn = op.k === "event" ? op.txn : null;
      const evt = op.k === "event" ? op.eventId : null;
      const doc = op.k === "reserve" || op.k === "settle" || op.k === "expire" ? op.doc : null;
      const lines = await session.query(
        `select pg_temp.try($q$${opSql(op)}$q$)::text;\nselect pg_temp.snap(${lit(txn)}, ${lit(evt)}, ${doc ? `${lit(doc)}::uuid` : "null::uuid"})::text;`,
      );
      const actualOutcome = parseOutcome(lines[0]);
      const actualSnapshot = JSON.parse(lines[1]) as ActualSnapshot;
      const problems = [
        ...diffOutcome(expectedOutcome, actualOutcome),
        ...diffValues(expectedSnapshot, actualSnapshot),
        ...checkInvariants(actualSnapshot.invariants).map((p) => `invariant: ${p}`),
      ];
      if (problems.length) {
        return { seed, index, op, problems, expected: { outcome: expectedOutcome, snapshot: expectedSnapshot }, actual: { outcome: actualOutcome, snapshot: actualSnapshot } };
      }
    }
    return null;
  } finally {
    await session.query("rollback;");
  }
}

/**
 * Shortest failing prefix, then (for short prefixes) a single backward pass dropping every op the
 * failure does not need. Ops are self-contained, so any subsequence is a valid stream.
 */
export async function shrinkFailure(session: PsqlSession, seed: number, ops: readonly Op[], failure: Mismatch): Promise<Op[]> {
  let kept = ops.slice(0, failure.index + 1);
  if (kept.length > 150) return kept;
  for (let i = kept.length - 2; i >= 0; i--) {
    const candidate = kept.filter((_, j) => j !== i);
    if (await replayOps(session, seed, candidate)) kept = candidate;
  }
  return kept;
}

export function formatMismatch(m: Mismatch, shrunk: readonly Op[]): string {
  return [
    `LEDGER REPLAY MISMATCH seed=${m.seed} op#${m.index} (${m.op.tag})`,
    `op: ${JSON.stringify(m.op)}`,
    ...m.problems.map((p) => `  - ${p}`),
    `expected: ${JSON.stringify(m.expected)}`,
    `actual:   ${JSON.stringify(m.actual)}`,
    `shortest failing stream (${shrunk.length} ops):`,
    ...shrunk.map((o, i) => `  ${i}: ${JSON.stringify(o)}`),
  ].join("\n");
}
