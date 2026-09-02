import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/0035_subscription_allowance_ledger.sql"), "utf8");

describe("subscription allowance ledger migration", () => {
  it("grants signed subscription transactions once and supports renewal transactions", () => {
    expect(migration).toContain("p_event_type <> 'transaction.completed'");
    expect(migration).toContain("foundation_allowance_transaction_idx");
    expect(migration).toContain("kind = 'allowance'");
    expect(migration).toContain("credit_balance = credit_balance + p_credit_delta");
  });

  it("reverses refunded allowance transactions and freezes further use", () => {
    expect(migration).toContain("where transaction_id = p_transaction_id and kind = 'allowance'");
    expect(migration).toContain("billing_hold = true");
    expect(migration).toContain("credit_balance = greatest(0, credit_balance - allowance.credit_delta)");
    expect(migration).toContain("select * into pending from public.foundation_pending_reversals");
    expect(migration).toContain("credit_balance = greatest(0, credit_balance - p_credit_delta)");
    expect(migration).toContain("delete from public.foundation_pending_reversals where event_id = pending.event_id");
  });

  it("keeps the RPC service-role only", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("revoke all on function public.apply_foundation_billing_event_v4");
    expect(migration).toContain("to service_role");
  });
});
