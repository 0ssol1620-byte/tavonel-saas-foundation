import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/0008_foundation_intake_admission.sql"),
  "utf8",
).toLowerCase();

describe("Foundation intake admission migration contract", () => {
  it("serializes tenant reservations before evaluating both quota windows", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("interval '1 minute'");
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("minute_count >= 5");
    expect(migration).toContain("day_count >= 20");
    expect(migration).toContain("26214400");
    expect(migration).toContain("104857600");
  });

  it("binds one exact quarantine object and exposes the RPC only to service_role", () => {
    expect(migration).toContain("object_key = 'quarantine/' || workspace_key || '/' || document_id::text || '/source'");
    expect(migration).toContain("foundation_intake_idempotency_conflict");
    expect(migration).toContain("revoke all on public.foundation_intake_admissions from anon, authenticated");
    expect(migration).toContain("grant execute on function public.reserve_foundation_intake_admission");
    expect(migration).toContain("to service_role");
  });
});
