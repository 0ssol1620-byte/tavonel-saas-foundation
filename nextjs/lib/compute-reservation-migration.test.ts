import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0009_foundation_billing_compute_reservations.sql"),
  "utf8",
).toLowerCase();

describe("Foundation compute reservation migration contract", () => {
  it("requires Studio access, credits, and one exact serialized reservation", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("account.access_plan <> 'studio_access'");
    expect(migration).toContain("account.billing_hold");
    expect(migration).toContain("account.credit_balance < p_reserved_credits");
    expect(migration).toContain("document_id uuid not null unique");
  });

  it("releases expired capacity and restricts both RPCs to service_role", () => {
    expect(migration).toContain("state = 'expired'");
    expect(migration).toContain("credit_balance = credit_balance + expired.reserved_credits");
    expect(migration).toContain("grant execute on function public.reserve_foundation_compute");
    expect(migration).toContain("grant execute on function public.settle_foundation_compute");
    expect(migration).toContain("to service_role");
  });

  it("detects conflicting Paddle event-id reuse before calling the v1 projection", () => {
    expect(migration).toContain("foundation_billing_event_id_conflict");
    expect(migration).toContain("payload_sha256 <> p_payload_sha256");
    expect(migration).toContain("revoke execute on function public.apply_foundation_billing_event");
  });
});
