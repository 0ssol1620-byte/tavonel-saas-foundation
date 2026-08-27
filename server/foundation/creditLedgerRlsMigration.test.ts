import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0004_harden_credit_ledger_rls.sql"),
  "utf8",
);

describe("credit ledger RLS hardening migration", () => {
  it("keeps command and ledger state explicitly invisible and unwritable to client roles", () => {
    expect(migration).toContain("create policy credit_ledger_entries_no_client_access on public.credit_ledger_entries");
    expect(migration).toContain("create policy gpu_job_reservations_no_client_access on public.gpu_job_reservations");
    expect(migration.match(/as restrictive for all to anon, authenticated using \(false\) with check \(false\);/g)).toHaveLength(2);
  });
});
