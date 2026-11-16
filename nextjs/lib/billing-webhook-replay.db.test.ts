// WO-D28-3: Paddle-shaped, signed webhook bodies go through the REAL route handler
// (app/api/paddle/webhook/route.ts -> lib/billing-store.ts) into the local database, with a test-only
// PostgREST-RPC adapter over psql in place of Supabase. After every delivery the account, ledger and
// event rows are compared with WO-D27-1's oracle. Needs the disposable local cluster (loopback only):
//   TAVONEL_LOCAL_DSN=postgres://postgres@127.0.0.1:55439/tavonel_local PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" \
//     pnpm exec vitest run lib/billing-webhook-replay.db.test.ts
//
// Not covered here (see lib/testing/postgrest-rpc-psql.ts): PostgREST, RLS and role boundaries, Paddle's own
// delivery and retry behaviour, concurrency (one session, strictly sequential), now() (constant: one outer
// transaction per seed), scheduled cancellation (the replay always sends scheduled_change: null, so
// subscription_cancel_at is never exercised). billing-ledger-replay.db.test.ts inserts the same fixture user;
// the 600_000 timeouts let this suite wait on that row lock. A mismatch between the oracle
// and the database is a FINDING: record it, never edit the oracle to agree without the Opus reviewer.
import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/paddle/webhook/route";
import { BILLING_OFFERS, type BillingOfferCode } from "./billing-catalog";
import { getFoundationBillingAccount, issueFoundationCheckoutIntent } from "./billing-store";
import type { CheckoutBinding } from "./billing-binding";
import {
  assertEmptyLedgerDatabase, checkInvariants, diffOutcome, diffValues, LedgerOracle, mulberry32, openPsqlSession,
  REPLAY_CUSTOMER, REPLAY_USER, REPLAY_WORKSPACE, type ActualSnapshot, type EventOp, type IntentOp, type Outcome,
  type PsqlSession, type Snapshot,
} from "./billing-ledger-replay";
import { ADAPTER_UNSUPPORTED, createPostgrestRpcPsqlFetch, type RpcCall } from "./testing/postgrest-rpc-psql";

const dsn = process.env.TAVONEL_LOCAL_DSN;
if (!dsn) {
  console.info("billing-webhook-replay.db.test skipped: TAVONEL_LOCAL_DSN is not set (it needs the disposable local cluster, loopback only).");
}

const WEBHOOK_SECRET = "w".repeat(40);
const BINDING_KEY = "k".repeat(40);
const OFFERS = ["observer_access", "studio_access"] as const satisfies readonly BillingOfferCode[];
const CONFIGURED_PRICE = { observer_access: `pri_${"o".repeat(26)}`, studio_access: `pri_${"u".repeat(26)}` } as const;
const OTHER_PRICE = `pri_${"z".repeat(26)}`;
const CREDITS = [900, 600, 1500, 400, 700, 1000, 800, 1200, 500, 1100] as const;
const ISSUED = 8; // intents 0..7 exist; 8 and 9 are never issued (a delivery for them has no intent)
const POLICY = "checkout-v1";
const SEEDS = [11, 12];

const id26 = (prefix: string, tag: string, n: number) => `${prefix}_${`${tag}${n.toString(36)}`.padStart(26, "0")}`;
const nonce = (k: number) => `11110000-0000-4000-8000-${k.toString(16).padStart(12, "0")}`;
const subId = (k: number) => id26("sub", "s", k);
const intentPrice = (k: number) => (k % 3 === 0 ? CONFIGURED_PRICE[OFFERS[k % 2]] : id26("pri", "i", k));
const sha256 = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;

function signedBinding(baseIso: string, nonceValue: string, offer: BillingOfferCode): CheckoutBinding {
  const unsigned = {
    tavonel_binding_version: "v3" as const, tavonel_user_id: REPLAY_USER, tavonel_workspace_id: REPLAY_WORKSPACE,
    tavonel_offer_code: offer, tavonel_nonce: nonceValue, tavonel_issued_at: baseIso, tavonel_policy_version: POLICY,
  };
  const payload = [
    unsigned.tavonel_binding_version, unsigned.tavonel_user_id, unsigned.tavonel_workspace_id,
    unsigned.tavonel_offer_code, unsigned.tavonel_nonce, unsigned.tavonel_issued_at, unsigned.tavonel_policy_version,
  ].join("\0");
  return { ...unsigned, tavonel_binding: createHmac("sha256", BINDING_KEY).update(payload, "utf8").digest("hex") };
}

// The intent's credits are an arbitrary fixture value here, not a catalog offer's, so the literal type is widened.
const offerArg = (priceId: string, credits: number) => ({ priceId, credits }) as unknown as Parameters<typeof issueFoundationCheckoutIntent>[1];

const signatureHeader = (body: string, secret = WEBHOOK_SECRET) => {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${body}`, "utf8").digest("hex")}`;
};

const deliver = (body: string, signature = signatureHeader(body)) =>
  POST(new Request("https://tavonel.test/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": signature } }));

// ---------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------

type Flaw = "binding" | "no_sub";
interface Planned { op: EventOp; body: string; quarantine: boolean }

function buildScenario(seed: number, baseIso: string): { all: Planned[]; deliveries: Planned[] } {
  const baseMs = Date.parse(baseIso);
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const weighted = <T extends string>(table: ReadonlyArray<readonly [T, number]>): T => {
    let r = rnd() * table.reduce((n, [, w]) => n + w, 0);
    for (const [name, w] of table) if ((r -= w) < 0) return name;
    return table[table.length - 1][0];
  };
  let counter = 0;
  const next = () => ++counter;
  const tag = (s: string) => `${s}${seed}x`;

  const bodyFor = (op: Omit<EventOp, "sha">, flaw?: Flaw, note?: string) => {
    const occurred_at = new Date(baseMs + op.t * 1000).toISOString();
    let data: Record<string, unknown>;
    if (op.action === "reversal") {
      data = { id: op.adjustment, transaction_id: op.txn, action: "refund", status: "approved" };
    } else {
      const binding = signedBinding(baseIso, op.nonce, op.offer as BillingOfferCode);
      if (flaw === "binding") binding.tavonel_binding = "0".repeat(64);
      const common = { customer_id: REPLAY_CUSTOMER, items: [{ quantity: 1, price: { id: op.price } }], custom_data: binding };
      data = op.action === "allowance"
        ? { id: op.txn, ...common, ...(flaw === "no_sub" ? {} : { subscription_id: op.sub }) }
        : { id: op.sub, ...common, status: op.status, scheduled_change: null };
    }
    return JSON.stringify({ event_id: op.eventId, event_type: op.eventType, occurred_at, data, ...(note ? { note } : {}) });
  };
  const planned = (op: Omit<EventOp, "sha">, flaw?: Flaw, note?: string): Planned => {
    const body = bodyFor(op, flaw, note);
    return { op: { ...op, sha: sha256(body) }, body, quarantine: flaw !== undefined };
  };
  const base = (variant: string, e: Partial<EventOp> & Pick<EventOp, "action" | "eventType">): Omit<EventOp, "sha"> => ({
    k: "event", retry: false, tag: variant, eventId: id26("evt", tag("e"), next()), t: int(1, 2400), offer: OFFERS[0],
    txn: null, sub: null, status: null, adjustment: null, nonce: nonce(0), price: null, configured: null, ...e,
  });
  const configuredFor = (offer: string, price: string | null) =>
    price !== null && price === CONFIGURED_PRICE[offer as keyof typeof CONFIGURED_PRICE]
      ? BILLING_OFFERS[offer as BillingOfferCode].credits : null;

  const events: Planned[] = [];
  const allowanceTxns: string[] = [];
  const orphanTxns: string[] = [];
  const freshTxn = () => id26("txn", tag("t"), next());
  const bound = (variant: string, k: number, e: Partial<EventOp> & Pick<EventOp, "action" | "eventType">) => {
    const offer = e.offer ?? OFFERS[k % 2];
    const price = e.price === undefined ? intentPrice(k) : e.price;
    return base(variant, { nonce: nonce(k), offer, sub: subId(k), ...e, price, configured: configuredFor(offer, price) });
  };

  while (events.length < 200) {
    const variant = weighted([
      ["allowance", 70], ["allowance_renewal_price", 14], ["allowance_bad_price", 8], ["allowance_unknown_intent", 6],
      ["allowance_expired", 5], ["allowance_wrong_offer", 5], ["allowance_sub_conflict", 6], ["subscription", 70],
      ["reversal_known", 28], ["reversal_orphan", 14], ["quarantine_binding", 5], ["quarantine_no_sub", 4], ["allowance_dup_txn", 18],
    ] as const);
    const k = int(0, ISSUED - 1);
    const allowance = (v: string, e: Partial<EventOp> = {}, flaw?: Flaw) => {
      const txn = orphanTxns.length && rnd() < 0.4 ? orphanTxns.splice(int(0, orphanTxns.length - 1), 1)[0] : freshTxn();
      const p = planned(bound(v, k, { action: "allowance", eventType: "transaction.completed", txn, ...e }), flaw);
      if (!flaw) allowanceTxns.push(txn);
      events.push(p);
    };
    switch (variant) {
      case "allowance": allowance(variant); break;
      case "allowance_renewal_price": allowance(variant, { price: CONFIGURED_PRICE[OFFERS[k % 2]] }); break;
      case "allowance_dup_txn": if (allowanceTxns.length) allowance(variant, { txn: pick(allowanceTxns) }); break;
      case "allowance_bad_price": allowance(variant, { price: OTHER_PRICE }); break;
      case "allowance_unknown_intent": {
        const u = int(ISSUED, CREDITS.length - 1);
        events.push(planned(bound(variant, u, { action: "allowance", eventType: "transaction.completed", txn: freshTxn(), price: OTHER_PRICE })));
        break;
      }
      case "allowance_expired": allowance(variant, { t: 25 * 3600 }); break;
      case "allowance_wrong_offer": allowance(variant, { offer: OFFERS[(k + 1) % 2] }); break;
      case "allowance_sub_conflict": allowance(variant, { sub: subId((k + 1 + int(0, 2)) % ISSUED) }); break;
      case "subscription":
        events.push(planned(bound(variant, k, {
          action: "subscription", eventType: pick(["subscription.created", "subscription.activated", "subscription.updated"]),
          status: weighted([["active", 45], ["trialing", 8], ["past_due", 15], ["paused", 12], ["canceled", 10], ["inactive", 4]] as const),
          price: rnd() < 0.05 ? OTHER_PRICE : undefined,
        })));
        break;
      case "reversal_known": {
        const txn = allowanceTxns.length ? pick(allowanceTxns) : freshTxn();
        events.push(planned(base(variant, { action: "reversal", eventType: "adjustment.updated", txn, adjustment: id26("adj", tag("a"), next()) })));
        break;
      }
      case "reversal_orphan": {
        const txn = freshTxn();
        orphanTxns.push(txn);
        events.push(planned(base(variant, { action: "reversal", eventType: "adjustment.created", txn, adjustment: id26("adj", tag("a"), next()) })));
        break;
      }
      case "quarantine_binding": allowance(variant, {}, "binding"); break;
      case "quarantine_no_sub": allowance(variant, {}, "no_sub"); break;
    }
  }

  // Same event id, a different signed body: the id-conflict path.
  const conflicts = events.filter((p) => !p.quarantine && p.op.action !== "reversal").slice(0, 10)
    .map((p) => planned({ ...p.op, tag: "event_conflict", retry: true }, undefined, "different payload under the same event id"));
  const all = [...events, ...conflicts];

  // Each event is delivered 1-3 times; the whole stream is shuffled.
  const deliveries = all.flatMap((p) => Array.from({ length: int(1, 3) }, () => p));
  for (let i = deliveries.length - 1; i > 0; i--) {
    const j = int(0, i);
    [deliveries[i], deliveries[j]] = [deliveries[j], deliveries[i]];
  }
  return { all, deliveries };
}

// ---------------------------------------------------------------------------------------------
// Database side
// ---------------------------------------------------------------------------------------------

const W = `'${REPLAY_WORKSPACE}'`;
const SNAP_SQL = `
create function pg_temp.snap(p_txn text, p_evt text) returns jsonb language sql as $f$
select jsonb_build_object(
  'account', (select jsonb_build_object(
      'balance', credit_balance, 'hold', billing_hold, 'overageEnabled', overage_enabled,
      'overageUnits', overage_units, 'lifetimeOverage', lifetime_overage_units,
      'lifetimeAllowance', lifetime_allowance_units, 'lifetimeReversed', lifetime_credits_reversed,
      'accessPlan', access_plan, 'status', subscription_status, 'subscriptionId', paddle_subscription_id,
      'lastSubAt', case when last_subscription_event_at is null then null
        else round(extract(epoch from last_subscription_event_at - now()))::int end)
    from public.foundation_billing_accounts where workspace_key = ${W}),
  'ledger', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'offer', offer_code,
      'txn', transaction_id, 'reversalOf', reversal_of_transaction_id, 'delta', credit_delta, 'eventId', event_id)
      order by kind collate "C", event_id collate "C")
    from public.foundation_credit_ledger
    where p_txn is not null and (transaction_id = p_txn or reversal_of_transaction_id = p_txn)), '[]'::jsonb),
  'events', coalesce((select jsonb_agg(jsonb_build_object('eventId', event_id, 'result', processing_result) order by event_id collate "C")
    from public.foundation_billing_events
    where event_id = p_evt or (p_txn is not null and transaction_id = p_txn)), '[]'::jsonb),
  'reservation', null,
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
    'balance', (select credit_balance from public.foundation_billing_accounts where workspace_key = ${W}),
    'overageUnits', (select overage_units from public.foundation_billing_accounts where workspace_key = ${W}),
    'lifetimeReversed', (select lifetime_credits_reversed from public.foundation_billing_accounts where workspace_key = ${W}),
    'ledgerSum', (select coalesce(sum(credit_delta), 0) from public.foundation_credit_ledger),
    'liveHolds', 0, 'charged', 0, 'overageCharged', 0))
$f$;`;

const SETUP_SQL = `
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '${REPLAY_USER}', 'authenticated', 'authenticated',
  'webhook-replay@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
${SNAP_SQL}`;

const lit = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);

describe("Postgrest RPC psql adapter refuses what it does not know", () => {
  const session: PsqlSession = { query: async () => { throw new Error("the adapter must refuse before it reaches the database"); }, close: async () => {} };

  it.each([
    ["GET", "https://adapter.invalid/rest/v1/foundation_credit_ledger?select=*"],
    ["POST", "https://adapter.invalid/rest/v1/rpc/reserve_foundation_compute_v3"],
    ["POST", "https://adapter.invalid/rest/v1/rpc/drop_everything"],
    ["GET", "https://adapter.invalid/rest/v1/foundation_billing_accounts?select=credit_balance&or=(a.eq.1)"],
    ["GET", "https://adapter.invalid/rest/v1/foundation_billing_accounts?select=credit_balance;drop"],
  ])("%s %s throws ADAPTER_UNSUPPORTED and records it", async (method, url) => {
    const adapter = createPostgrestRpcPsqlFetch(session);
    await expect(adapter.fetch(url, { method, body: method === "POST" ? "{}" : undefined })).rejects.toThrow(ADAPTER_UNSUPPORTED);
    expect(adapter.unsupported).toHaveLength(1);
    expect(adapter.calls).toHaveLength(0);
  });
});

describe.skipIf(!dsn)("webhook replay through the real route into the local database", () => {
  let session: PsqlSession;
  let baseIso = "";
  let current: ReturnType<typeof createPostgrestRpcPsqlFetch>;
  const spies: Array<{ mockRestore(): void }> = [];

  const snap = async (txn: string | null, evt: string | null): Promise<ActualSnapshot> => {
    const lines = await session.query(`select pg_temp.snap(${lit(txn)}, ${lit(evt)})::text;`);
    return JSON.parse(lines[0]) as ActualSnapshot;
  };
  // One outer transaction per test: `now()` is constant inside it, which is what the oracle's `t` is relative to.
  const freshTransaction = async (first = false) => {
    await session.query(`${first ? "" : "rollback;"} ${SETUP_SQL}`);
    baseIso = (await session.query(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');`))[0];
  };

  beforeAll(async () => {
    session = openPsqlSession(dsn as string);
    await assertEmptyLedgerDatabase(session);
    await freshTransaction(true);
    current = createPostgrestRpcPsqlFetch(session);
    vi.stubGlobal("fetch", current.fetch);
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("FOUNDATION_BILLING_HMAC", BINDING_KEY);
    vi.stubEnv("FOUNDATION_BILLING_HMAC_PREVIOUS", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://postgrest-adapter.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "r".repeat(40));
    vi.stubEnv("PADDLE_PRICE_OBSERVER_ACCESS", CONFIGURED_PRICE.observer_access);
    vi.stubEnv("PADDLE_PRICE_STUDIO_ACCESS", CONFIGURED_PRICE.studio_access);
    for (const method of ["error", "warn", "info"] as const) spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }, 600_000);
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (session) {
      await session.query("rollback;");
      await session.close();
    }
  });

  const outcomeOf = (status: number, json: Record<string, unknown>, calls: RpcCall[]): { outcome: Outcome; problems: string[] } => {
    const problems: string[] = [];
    const want = (code: string, httpStatus: number) => {
      if (status !== httpStatus) problems.push(`http status ${status}, expected ${httpStatus} for ${code}`);
    };
    switch (json.code) {
      case "EVENT_APPLIED":
        want("EVENT_APPLIED", 200);
        return { outcome: { ok: json.result as Outcome["ok"] }, problems };
      case "EVENT_QUARANTINED":
        want("EVENT_QUARANTINED", 200);
        return { outcome: { ok: { status: "binding_rejected", reason: json.reason as string } }, problems };
      case "EVENT_DEPENDENCY_PENDING":
        want("EVENT_DEPENDENCY_PENDING", 503);
        return { outcome: { ok: { status: "binding_rejected", reason: "checkout_binding_bootstrap_event_invalid" } }, problems };
      case "BILLING_EVENT_APPLY_FAILED": {
        want("BILLING_EVENT_APPLY_FAILED", 503);
        const failed = calls.find((c) => !c.ok);
        if (!failed) problems.push("route answered 503 without a failed rpc");
        return { outcome: { error: failed ? (failed.state === "P0001" ? failed.error : `sqlstate:${failed.state}`) : "no failed rpc" }, problems };
      }
      default:
        problems.push(`unexpected route answer ${status} ${JSON.stringify(json)}`);
        return { outcome: { error: "unexpected" }, problems };
    }
  };

  it.each(SEEDS)("seed %i: events delivered 1-3 times in shuffled order agree with the oracle after every delivery", async (seed) => {
    await freshTransaction();
    const oracle = new LedgerOracle();
    const extraRejections = new Set<string>();

    // Intents go through the real billing-store function, over the adapter.
    for (let k = 0; k < ISSUED; k++) {
      const op: IntentOp = { k: "intent", retry: false, tag: "intent", nonce: nonce(k), offer: OFFERS[k % 2], price: intentPrice(k), credit: CREDITS[k] };
      expect(oracle.apply(op)).toEqual({ ok: { status: "issued" } });
      expect(await issueFoundationCheckoutIntent(signedBinding(baseIso, op.nonce, op.offer as BillingOfferCode), offerArg(op.price, op.credit))).toEqual({ ok: true });
    }
    const duplicate = await issueFoundationCheckoutIntent(signedBinding(baseIso, nonce(0), OFFERS[0]), offerArg(intentPrice(0), CREDITS[0]));
    expect(duplicate).toEqual({ ok: false, code: "BILLING_INTENT_UNAVAILABLE" });
    expect(current.calls.at(-1)?.state).toBe("23505"); // the oracle's `sqlstate:23505` for a reused nonce

    const { all, deliveries } = buildScenario(seed, baseIso);
    expect(all.length).toBeGreaterThanOrEqual(200);
    expect(deliveries.length).toBeGreaterThan(all.length);
    const seen = new Set<string>();
    const reversalsBeforePurchase = new Set<string>();
    let quarantined = 0;

    for (let index = 0; index < deliveries.length; index++) {
      const { op, body, quarantine } = deliveries[index];
      const calls0 = current.calls.length;
      const response = await deliver(body);
      const json = (await response.json()) as Record<string, unknown>;
      const calls = current.calls.slice(calls0);
      let problems: string[] = [];
      let expected: { outcome: Outcome; snapshot: Snapshot };

      if (quarantine) {
        // Signed but unbindable: the route must quarantine it durably and acknowledge with a 200.
        if (response.status !== 200 || json.code !== "EVENT_QUARANTINED") problems.push(`quarantine expected, got ${response.status} ${JSON.stringify(json)}`);
        if (calls.length !== 1 || calls[0].fn !== "quarantine_foundation_billing_envelope" || !calls[0].ok) problems.push(`quarantine rpc expected, got ${JSON.stringify(calls)}`);
        extraRejections.add(op.eventId);
        quarantined++;
        expected = { outcome: { ok: { status: "binding_rejected" } }, snapshot: oracle.snapshot(op) };
      } else {
        const outcome = outcomeOf(response.status, json, calls);
        problems = outcome.problems;
        const expectedOutcome = oracle.apply(op);
        expected = { outcome: expectedOutcome, snapshot: oracle.snapshot(op) };
        problems.push(...diffOutcome(expectedOutcome, outcome.outcome));
        const status = expectedOutcome.ok?.status;
        if (typeof status === "string") seen.add(`${op.action}:${status}`);
        if (expectedOutcome.error) seen.add(`error:${expectedOutcome.error}`);
        if (op.action === "reversal" && status === "pending_original_transaction") reversalsBeforePurchase.add(op.txn as string);
      }
      expected.snapshot.counts.rejections += extraRejections.size;
      const actual = await snap(op.txn, op.eventId);
      problems.push(...diffValues(expected.snapshot, actual), ...checkInvariants(actual.invariants).map((p) => `invariant: ${p}`));
      if (index % 50 === 0 || index === deliveries.length - 1) {
        const account = await getFoundationBillingAccount(REPLAY_WORKSPACE, REPLAY_USER);
        const want = expected.snapshot.account;
        if (!account.ok) problems.push(`account read failed: ${account.code}`);
        else if (want && (account.account.creditBalance !== want.balance || account.account.accessPlan !== want.accessPlan || account.account.subscriptionStatus !== want.status)) {
          problems.push(`account read through the adapter disagrees with the oracle: ${JSON.stringify(account.account)}`);
        }
      }
      if (problems.length) {
        throw new Error([
          `WEBHOOK REPLAY MISMATCH seed=${seed} delivery#${index} (${op.tag}) ${op.action} ${op.eventType} ${op.eventId}`,
          ...problems.map((p) => `  - ${p}`),
          `http: ${response.status} ${JSON.stringify(json)}`,
          `rpc calls: ${JSON.stringify(calls)}`,
          `expected: ${JSON.stringify(expected)}`,
          `actual:   ${JSON.stringify(actual)}`,
        ].join("\n"));
      }
    }

    // The run must actually have met the cases the work order names; a lucky seed is not coverage.
    expect(current.unsupported).toEqual([]);
    expect(quarantined).toBeGreaterThanOrEqual(3);
    expect(reversalsBeforePurchase.size).toBeGreaterThanOrEqual(1);
    for (const needed of ["allowance:allowance_granted", "allowance:duplicate_transaction", "allowance:duplicate", "reversal:reversal_applied", "subscription:processed", "allowance:binding_rejected", "error:foundation_billing_event_id_conflict"]) {
      expect(seen, `scenario never produced ${needed}`).toContain(needed);
    }
  }, 600_000);

  it("a tampered signature is answered 401 and changes nothing", async () => {
    await freshTransaction();
    const { all } = buildScenario(SEEDS[0], baseIso);
    const body = all.find((p) => !p.quarantine && p.op.action === "subscription")?.body as string;
    const before = await snap(null, null);
    const calls0 = current.calls.length;
    const good = signatureHeader(body);
    const tampered = good.replace(/h1=./, (m) => `h1=${m.endsWith("a") ? "b" : "a"}`);
    const response = await deliver(body, tampered);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "INVALID_SIGNATURE" });
    const wrongSecret = await deliver(body, signatureHeader(body, "x".repeat(40)));
    expect(wrongSecret.status).toBe(401);
    expect(current.calls.length).toBe(calls0);
    expect(await snap(null, null)).toEqual(before);
  }, 600_000);

  it("with the adapter installed as fetch, an unknown request still throws instead of answering", async () => {
    const before = current.unsupported.length;
    await expect(fetch("https://postgrest-adapter.invalid/rest/v1/foundation_credit_ledger?select=*")).rejects.toThrow(ADAPTER_UNSUPPORTED);
    expect(current.unsupported.length).toBe(before + 1);
    current.unsupported.length = before;
  });
});
