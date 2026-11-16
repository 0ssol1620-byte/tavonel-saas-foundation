// WO-D27-1: 3 x 1,000 seeded events against the real v6 / reserve_v3 / settle_v3 functions.
// Needs the disposable local cluster (loopback only), see the work order's shared setup:
//   TAVONEL_LOCAL_DSN=postgres://postgres@127.0.0.1:55439/tavonel_local PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" \
//     pnpm exec vitest run lib/billing-ledger-replay.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertEmptyLedgerDatabase, formatMismatch, generateOps, openPsqlSession, replayOps, shrinkFailure,
  type PsqlSession,
} from "./billing-ledger-replay";

const dsn = process.env.TAVONEL_LOCAL_DSN;
if (!dsn) {
  console.info("billing-ledger-replay.db.test skipped: TAVONEL_LOCAL_DSN is not set (it needs the disposable local cluster, loopback only).");
}

const seeds = [1, 2, 3];
const extra = Number(process.env.TAVONEL_LEDGER_REPLAY_SEED);
if (Number.isInteger(extra) && !seeds.includes(extra)) seeds.push(extra);

describe.skipIf(!dsn)("ledger replay against the real billing functions", () => {
  let session: PsqlSession;
  beforeAll(async () => {
    session = openPsqlSession(dsn as string);
    await assertEmptyLedgerDatabase(session);
  });
  afterAll(async () => {
    await session?.close();
  });

  it.each(seeds)("seed %i: 1,000 ops agree with the oracle and keep every invariant", async (seed) => {
    const ops = generateOps(seed, 1000);
    const failure = await replayOps(session, seed, ops);
    if (failure) {
      throw new Error(formatMismatch(failure, await shrinkFailure(session, seed, ops, failure)));
    }
    expect(failure).toBeNull();
  }, 600_000);
});
