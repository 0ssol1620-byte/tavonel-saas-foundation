// WO-D27-1: 3 x 1,000 seeded events against the real v6 / reserve_v3 / settle_v3 functions.
// WO-D27-4: the same against the page meter (20261117120000): a metered stream settled through
// settle_v4 with the compile-job triggers, and the same metered stream settled through settle_v3
// (the compatibility contract: v3 stays callable and unchanged with the meter's triggers installed).
// WO-CAT-3: the same against the catalog v2 offer codes (20261117140000): a metered stream drawing the six named
// codes, codes nobody names, scheduled cancellations and plan changes, settled through settle_v4.
// Needs the disposable local cluster (loopback only), see the work order's shared setup:
//   TAVONEL_LOCAL_DSN=postgres://postgres@127.0.0.1:55439/tavonel_local PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" \
//     pnpm exec vitest run lib/billing-ledger-replay.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertEmptyLedgerDatabase, formatMismatch, generateOps, hashOps, LedgerOracle, openPsqlSession, replayOps, shrinkFailure,
  type Meter, type PsqlSession,
} from "./billing-ledger-replay";

const dsn = process.env.TAVONEL_LOCAL_DSN;
if (!dsn) {
  console.info("billing-ledger-replay.db.test skipped: TAVONEL_LOCAL_DSN is not set (it needs the disposable local cluster, loopback only).");
}

const seeds = [1, 2, 3];
const extra = Number(process.env.TAVONEL_LEDGER_REPLAY_SEED);
if (Number.isInteger(extra) && !seeds.includes(extra)) seeds.push(extra);

type Run = [label: string, seed: number, stream: Parameters<typeof generateOps>[2], settle: Meter];
const runs: Run[] = [
  ...seeds.map((seed): Run => ["pre-meter stream, settle_v3", seed, {}, "v3"]),
  ...seeds.map((seed): Run => ["metered stream, settle_v4 and the compile triggers", seed, { meter: true }, "v4"]),
  ...seeds.map((seed): Run => ["metered stream, settle_v3 beside the meter", seed, { meter: true }, "v3"]),
  ...seeds.map((seed): Run => ["catalog v2 stream (v2 codes, unknown codes, schedules, plan changes), settle_v4", seed, { meter: true, catalog: "v2" }, "v4"]),
];

describe.skipIf(!dsn)("ledger replay against the real billing functions", () => {
  let session: PsqlSession;
  beforeAll(async () => {
    session = openPsqlSession(dsn as string);
    await assertEmptyLedgerDatabase(session);
  });
  afterAll(async () => {
    await session?.close();
  });

  it.each(runs)("%s, seed %i: 1,000 ops agree with the oracle and keep every invariant", async (_label, seed, stream, settle) => {
    const ops = generateOps(seed, 1000, stream);
    // Every run, legacy streams included, compares plan_code and subscription_cancel_at as well (WO-CAT-3).
    const failure = await replayOps(session, seed, ops, settle, { planIdentity: true });
    if (failure) {
      throw new Error(formatMismatch(failure, await shrinkFailure(session, seed, ops, failure, settle, { planIdentity: true })));
    }
    expect(failure).toBeNull();
  }, 600_000);
});

// Runs without a database: what the catalog v2 streams above are worth depends on what they reach.
describe("the catalog v2 stream (WO-CAT-3)", () => {
  it("leaves the streams without `catalog` exactly as they were", () => {
    expect(hashOps(generateOps(1, 1000))).toBe(hashOps(generateOps(1, 1000, {})));
    expect(hashOps(generateOps(1, 1000, { catalog: "v2" }))).not.toBe(hashOps(generateOps(1, 1000)));
  });

  it.each(seeds)("seed %i reaches every plan identity, both refusals of an unknown code, schedules and plan changes", (seed) => {
    const oracle = new LedgerOracle("v4");
    const seen = new Set<string>();
    for (const op of generateOps(seed, 1000, { meter: true, catalog: "v2" })) {
      const out = oracle.apply(op);
      const account = oracle.snapshotWithPlan(op).account;
      if (account?.accessPlan) seen.add(`held:${account.planCode ?? account.accessPlan}`);
      if (op.k === "intent" && out.error === "sqlstate:22023") seen.add("intent:unknown_refused");
      if (op.k === "event" && out.ok?.reason === "checkout_binding_contract_invalid") seen.add("event:unknown_rejected");
      if (op.k === "event" && out.ok?.status === "processed_subscription_upgrade") seen.add("event:replaced");
      if (op.k === "event" && op.tag === "plan_change" && op.action === "subscription" && out.ok?.status === "stale_or_mismatched_subscription") seen.add("event:replacement_refused");
      if (op.k === "event" && op.action === "allowance" && out.ok?.status === "allowance_granted") seen.add(`granted:${op.offer}`);
      if (op.k === "schedule") seen.add(`schedule:${out.ok?.status ?? out.error}`);
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining([
      "held:business", "held:developer", "held:personal", "held:team",
      "event:replaced", "event:replacement_refused", "event:unknown_rejected", "intent:unknown_refused",
      "granted:business", "granted:developer", "granted:personal", "granted:team",
      "schedule:billing_subscription_event_binding_invalid", "schedule:processed", "schedule:stale_subscription_schedule",
    ]));
  });
});
