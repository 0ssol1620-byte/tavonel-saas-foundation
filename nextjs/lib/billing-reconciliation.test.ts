/*
  O04 — the billing ledger reconciled across retry, duplicate webhook, cancel-before-completion,
  quota exhaustion and failure reprocessing.

  The audit's finding was not "the ledger is wrong". It was that nobody had reconciled it: job
  reuse and a blocker decision do not prove that no case charges twice. This file is that
  reconciliation for the TypeScript half, and `supabase/tests/billing_reconciliation.sql` is the
  same reconciliation run against the real functions in a disposable Postgres — the guarantees
  live in SQL (advisory locks, `on conflict do nothing`, the terminal-state guard), so a test
  that only mocked them would prove nothing about production.

  Split, deliberately:
    * here — what the application sends and what it does with each answer. A retry must send a
      byte-identical idempotency key, a `duplicate` answer must not be turned into a second
      charge, and a refusal must stop before any settlement call is made.
    * `supabase/tests/billing_reconciliation.sql` — whether the same event applied twice moves
      `credit_balance` twice.
    * the migration-contract assertions at the end of this file — the invariants that exist only
      as SQL text, asserted on the files rather than on a running database, so a CI run without
      Docker still fails when one of them is deleted.

  Nothing here changes billing behaviour. One real discrepancy was found while writing it --
  settling a reservation the expiry sweep has already refunded credited the held units a second
  time -- and it is **fixed**, by
  `supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql`. FINDING O04-1 is
  closed in that migration, in `billing_reconciliation.sql` and in the assertion at the end of
  this file, which now guards the fix rather than marking the gap.
*/
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckoutBinding } from "./billing-binding";
import { applyFoundationBillingAction } from "./billing-store";
import { reserveFoundationCompute, settleFoundationCompute } from "./compute-reservation";
import { parsePaddleBillingAction } from "./paddle-billing-event";

const SECRET = "billing-test-secret-that-is-at-least-32-characters";
const OBSERVER_PRICE = `pri_${"o".repeat(26)}`;
const paddleEnv = {
  FOUNDATION_BILLING_HMAC: SECRET,
  PADDLE_PRICE_OBSERVER_ACCESS: OBSERVER_PRICE,
};
const principal = {
  userId: "969dc192-daa2-4119-969d-c192daa24119",
  workspaceId: "pilot-969dc192daa24119",
} as const;
const source = {
  workspaceKey: principal.workspaceId,
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: principal.userId,
  estimatedPages: 3,
};

/** The same bytes Paddle would redeliver: one webhook body, reused verbatim. */
function allowanceWebhookBody() {
  return JSON.stringify({
    event_id: `evt_${"a".repeat(26)}`,
    event_type: "transaction.completed",
    occurred_at: "2026-09-11T07:00:00.000Z",
    data: {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      custom_data: createCheckoutBinding({ ...principal, offerCode: "observer_access" }, SECRET),
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    },
  });
}

function configureLedger() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
}

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function sentBodies(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.map(([, init]) => String((init as RequestInit).body));
}

describe("O04 duplicate webhook delivery", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("projects a redelivered event with a byte-identical key, so the ledger can refuse it", async () => {
    configureLedger();
    const raw = allowanceWebhookBody();
    const first = parsePaddleBillingAction(raw, paddleEnv);
    const second = parsePaddleBillingAction(raw, paddleEnv);
    expect(first).toMatchObject({ action: "allowance", creditDelta: 2_000 });
    // The dedupe key is the pair the SQL function compares. If either half varied per delivery,
    // the second delivery would look like a different event and grant a second allowance.
    expect(second).toEqual(first);

    const fetchMock = respond({ status: "allowance_granted", eventId: first!.eventId });
    vi.stubGlobal("fetch", fetchMock);
    await expect(applyFoundationBillingAction(first as never)).resolves.toMatchObject({ ok: true });

    const duplicateMock = respond({ status: "duplicate", eventId: first!.eventId });
    vi.stubGlobal("fetch", duplicateMock);
    const replay = await applyFoundationBillingAction(second as never);
    // A `duplicate` answer is a success with no credit movement. It must not be retried, and it
    // must not be reported as a failure the sender would redeliver again.
    expect(replay).toMatchObject({ ok: true, result: { status: "duplicate" } });
    expect(sentBodies(fetchMock)[0]).toBe(sentBodies(duplicateMock)[0]);
    expect(sentBodies(duplicateMock)[0]).toContain(`"p_event_id":"${first!.eventId}"`);
    expect(duplicateMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the ledger refuses the projection instead of reporting a grant", async () => {
    configureLedger();
    const action = parsePaddleBillingAction(allowanceWebhookBody(), paddleEnv);
    vi.stubGlobal("fetch", respond({ message: "foundation_billing_event_id_conflict" }, 400));
    // The webhook route turns this into a 503, so Paddle redelivers rather than the deployment
    // silently accepting an event whose payload disagrees with the one already recorded.
    await expect(applyFoundationBillingAction(action as never)).resolves.toEqual({
      ok: false,
      code: "BILLING_EVENT_APPLY_FAILED",
    });
  });
});

describe("O04 retry after a transient failure", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("re-reserves with the same document key and accepts the replay rather than holding twice", async () => {
    configureLedger();
    // Attempt one: the ledger is unreachable. Nothing was reserved, and the caller is told so.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    await expect(reserveFoundationCompute(source)).resolves.toEqual({ ok: false, code: "COMPUTE_LEDGER_FAILED" });

    const replay = respond({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: source.documentId,
      state: "reserved",
      expiresAt: "2026-09-11T07:10:00Z",
      reservedCredits: 12,
      maximumCredits: 18,
      billingSource: "paid",
      idempotentReplay: true,
    });
    vi.stubGlobal("fetch", replay);
    await expect(reserveFoundationCompute(source)).resolves.toMatchObject({
      ok: true,
      result: { idempotentReplay: true, reservedCredits: 12 },
    });
    // The quote is derived from the document, not from the attempt: a retry that asked for a
    // different hold would raise `foundation_compute_idempotency_conflict` instead of replaying.
    expect(sentBodies(replay)[0]).toContain('"p_reserved_credits":12,"p_maximum_credits":18');
    expect(sentBodies(replay)[0]).toContain(`"p_document_id":"${source.documentId}"`);
  });

  it("refuses a reservation receipt that does not describe the document it was asked for", async () => {
    configureLedger();
    vi.stubGlobal("fetch", respond({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      state: "reserved",
      expiresAt: "2026-09-11T07:10:00Z",
      reservedCredits: 12,
      maximumCredits: 18,
      billingSource: "paid",
      idempotentReplay: true,
    }));
    await expect(reserveFoundationCompute(source)).resolves.toEqual({
      ok: false,
      code: "COMPUTE_RESERVATION_RECEIPT_INVALID",
    });
  });
});

describe("O04 cancel after partial compute", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const release = {
    workspaceKey: source.workspaceKey,
    documentId: source.documentId,
    outcome: "released" as const,
    actualCredits: 0,
    reasonCode: "UPLOAD_TRANSFER_FAILED",
  };

  it("releases once and reads a redelivered release as a duplicate, not a second release", async () => {
    configureLedger();
    vi.stubGlobal("fetch", respond({
      status: "processed",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "released",
      settledCredits: 0,
      releasedCredits: 12,
      overageCredits: 0,
      billingSource: "paid",
    }));
    await expect(settleFoundationCompute(release)).resolves.toMatchObject({
      ok: true,
      result: { status: "processed", releasedCredits: 12 },
    });

    vi.stubGlobal("fetch", respond({
      status: "duplicate",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      billingSource: "paid",
    }));
    // At-least-once delivery: the CDR worker's settlement can arrive twice. The second one moves
    // nothing, and the caller treats it as applied rather than retrying it into a third.
    await expect(settleFoundationCompute(release)).resolves.toMatchObject({
      ok: true,
      result: { status: "duplicate" },
    });
  });

  it("surfaces a settlement that contradicts one already recorded", async () => {
    configureLedger();
    vi.stubGlobal("fetch", respond({ message: "foundation_compute_settlement_conflict" }, 400));
    await expect(settleFoundationCompute({ ...release, outcome: "settled", actualCredits: 12 })).resolves.toEqual({
      ok: false,
      code: "COMPUTE_SETTLEMENT_CONFLICT",
    });
  });

  it("refuses a settlement receipt with no status the ledger defines", async () => {
    configureLedger();
    vi.stubGlobal("fetch", respond({ status: "maybe", reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    await expect(settleFoundationCompute(release)).resolves.toEqual({
      ok: false,
      code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID",
    });
  });
});

describe("O04 quota exhausted mid-run", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each([
    ["foundation_credits_required", "GPU_CREDITS_REQUIRED"],
    ["foundation_trial_page_limit_exceeded", "TRIAL_PAGE_LIMIT_EXCEEDED"],
    ["foundation_trial_global_budget_exceeded", "TRIAL_CAPACITY_REACHED"],
  ])("refuses on %s without opening a reservation to settle", async (message, code) => {
    configureLedger();
    const fetchMock = respond({ message }, 400);
    vi.stubGlobal("fetch", fetchMock);
    await expect(reserveFoundationCompute(source)).resolves.toEqual({ ok: false, code });
    // Exactly one call: the refusal is terminal. A settlement here would be a settlement of a
    // reservation that does not exist, which the ledger answers with
    // `foundation_compute_reservation_not_found`.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("reserve_foundation_compute_v3"), expect.any(Object));
  });

  it("says the ledger is unconfigured rather than proceeding unbilled", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(reserveFoundationCompute(source)).resolves.toEqual({ ok: false, code: "COMPUTE_LEDGER_NOT_CONFIGURED" });
    await expect(settleFoundationCompute({
      workspaceKey: source.workspaceKey,
      documentId: source.documentId,
      outcome: "released",
      actualCredits: 0,
      reasonCode: "UPLOAD_TRANSFER_FAILED",
    })).resolves.toEqual({ ok: false, code: "COMPUTE_LEDGER_NOT_CONFIGURED" });
  });
});

/*
  The invariants that exist only as SQL text.

  `supabase/tests/billing_reconciliation.sql` executes them, and that suite needs Docker. These
  assertions read the migration files instead, so deleting a guard fails `pnpm test` on any
  machine — the same trick `compute-reservation-migration.test.ts` already uses.
*/
describe("O04 ledger guards that live only in SQL", () => {
  const allowance = readFileSync(
    resolve(import.meta.dirname, "../../supabase/migrations/0035_subscription_allowance_ledger.sql"),
    "utf8",
  ).toLowerCase();
  const compute = readFileSync(
    resolve(import.meta.dirname, "../../supabase/migrations/0045_self_service_trial_and_owner_access.sql"),
    "utf8",
  ).toLowerCase();
  const settlementFix = readFileSync(
    resolve(import.meta.dirname, "../../supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql"),
    "utf8",
  ).toLowerCase();

  it("serializes each billing event by id and answers a redelivery with `duplicate`", () => {
    expect(allowance).toContain("pg_advisory_xact_lock(hashtextextended('foundation-billing-event:' || p_event_id, 0))");
    expect(allowance).toContain("'status', 'duplicate'");
    expect(allowance).toContain("existing.payload_sha256 <> p_payload_sha256");
    expect(allowance).toContain("raise exception 'foundation_billing_event_id_conflict'");
  });

  it("moves the balance only when the credit-ledger row was the one this call inserted", () => {
    // `on conflict do nothing` plus the row-count guard is what makes a second delivery of the
    // same transaction a no-op instead of a second grant.
    expect(allowance).toContain("on conflict do nothing");
    expect(allowance).toContain("if inserted_count = 1 then");
    expect(allowance).toContain("'duplicate_transaction'");
  });

  it("holds one reservation per document and replays rather than re-deducting", () => {
    expect(compute).toContain("pg_advisory_xact_lock(hashtextextended('foundation-compute:' || p_workspace_key, 0))");
    expect(compute).toContain("'idempotentreplay', true");
    expect(compute).toContain("if account.credit_balance < p_reserved_credits then raise exception 'foundation_credits_required'");
  });

  it("treats a settled, released or reviewed reservation as terminal", () => {
    expect(compute).toContain("if reservation.state in ('settled', 'released', 'operator_review') then");
    expect(compute).toContain("raise exception 'foundation_compute_settlement_conflict'");
    expect(compute).toContain("released_units := greatest(0, reservation.reserved_credits - p_actual_credits)");
    /*
      FINDING O04-1, closed by `20260911120000_compute_settlement_expired_terminal.sql`.

      `expired` was missing from 0045's terminal list, and the expiry sweep at the top of
      `reserve_foundation_compute_v3` had already returned the held units to `credit_balance`, so
      a settlement arriving after the sweep ran the paid branch again and added
      `reserved - actual` a second time. The direction was over-credit, not double-charge.

      0045 above is left exactly as it was — history is not rewritten, and the assertions on it
      still describe what it says. The current definition lives in the later migration, and that
      is what is asserted here, inverted: the terminal list includes `expired` and the refusal
      has its own error name, so a revert cannot pass quietly. The marker that used to say the
      finding was open is gone because it was: as of this branch the assertion guards the fix.
    */
    expect(settlementFix).toContain("in ('settled', 'released', 'operator_review', 'expired')");
    expect(settlementFix).toContain("raise exception 'foundation_compute_settlement_expired'");
  });

  /*
    The pgTAP file needs Docker, so nothing on a developer machine tells you its `plan(n)` is
    wrong -- and a plan that disagrees with the assertion count fails the whole suite in CI with
    a message about the plan rather than about billing. Counting the two here is the cheapest
    thing that fails locally instead.
  */
  it("keeps the pgTAP reconciliation plan equal to the assertions it makes", () => {
    const suite = readFileSync(resolve(import.meta.dirname, "../../supabase/tests/billing_reconciliation.sql"), "utf8");
    const planned = Number(/^select plan\((\d+)\);$/m.exec(suite)?.[1]);
    const assertions = suite.match(/^select (?:is|isnt|ok|throws_ok|is_empty|isnt_empty)\(/gm)?.length ?? 0;
    expect(assertions).toBeGreaterThan(0);
    expect(planned).toBe(assertions);
  });
});
