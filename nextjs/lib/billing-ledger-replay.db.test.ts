// WO-D27-1: 3 x 1,000 seeded events against the real v6 / reserve_v3 / settle_v3 functions.
// WO-D27-4: the same against the page meter (20261117120000): a metered stream settled through
// settle_v4 with the compile-job triggers, and the same metered stream settled through settle_v3
// (the compatibility contract: v3 stays callable and unchanged with the meter's triggers installed).
// Needs the disposable local cluster (loopback only), see the work order's shared setup:
//   TAVONEL_LOCAL_DSN=postgres://postgres@127.0.0.1:55439/tavonel_local PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" \
//     pnpm exec vitest run lib/billing-ledger-replay.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertEmptyLedgerDatabase, formatMismatch, generateOps, openPsqlSession, replayOps, shrinkFailure,
  type Meter, type PsqlSession,
} from "./billing-ledger-replay";

const dsn = process.env.TAVONEL_LOCAL_DSN;
if (!dsn) {
  console.info("billing-ledger-replay.db.test skipped: TAVONEL_LOCAL_DSN is not set (it needs the disposable local cluster, loopback only).");
}

const seeds = [1, 2, 3];
const extra = Number(process.env.TAVONEL_LEDGER_REPLAY_SEED);
if (Number.isInteger(extra) && !seeds.includes(extra)) seeds.push(extra);

type Run = [label: string, seed: number, metered: boolean, settle: Meter];
const runs: Run[] = [
  ...seeds.map((seed): Run => ["pre-meter stream, settle_v3", seed, false, "v3"]),
  ...seeds.map((seed): Run => ["metered stream, settle_v4 and the compile triggers", seed, true, "v4"]),
  ...seeds.map((seed): Run => ["metered stream, settle_v3 beside the meter", seed, true, "v3"]),
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

  it.each(runs)("%s, seed %i: 1,000 ops agree with the oracle and keep every invariant", async (_label, seed, metered, settle) => {
    const ops = generateOps(seed, 1000, { meter: metered });
    const failure = await replayOps(session, seed, ops, settle);
    if (failure) {
      throw new Error(formatMismatch(failure, await shrinkFailure(session, seed, ops, failure, settle)));
    }
    expect(failure).toBeNull();
  }, 600_000);
});
