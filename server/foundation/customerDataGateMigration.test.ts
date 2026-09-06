import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { customerDataEvidenceReceiptSha256 } from "../../shared/customerDataGate";
import { customerDataPreconditions } from "../../shared/uskcEnums";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0050_customer_data_gate_acl.sql"),
  "utf8",
);

describe("customer-data gate migration", () => {
  it("creates exactly the two tables this lane owns and no third audit table", () => {
    expect(migration).toContain("create table if not exists public.source_acl_snapshots");
    expect(migration).toContain("create table if not exists public.customer_data_gate_receipts");
    expect(migration).not.toMatch(/create table[^;]*audit_events/);
  });

  it("cannot record an allowed decision without all seventeen and a receipt digest", () => {
    expect(migration).toContain("allowed boolean not null default false");
    expect(migration).toContain("constraint customer_data_gate_allowed_is_complete check (");
    expect(migration).toContain(
      "or (satisfied_count = 17 and receipt_sha256 is not null and cardinality(missing) = 0)",
    );
    expect(migration).toContain("constraint customer_data_gate_refusal_names_a_reason check (");
  });

  it("constrains `missing` to the seventeen frozen precondition names", () => {
    for (const precondition of customerDataPreconditions) {
      expect(migration).toContain(`'${precondition}'`);
    }
  });

  it("closes both tables to client roles and keeps the record append-only", () => {
    expect(migration).toContain("alter table public.source_acl_snapshots enable row level security;");
    expect(migration).toContain(
      "alter table public.customer_data_gate_receipts enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on public.source_acl_snapshots, public.customer_data_gate_receipts\n  from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant select, insert on public.source_acl_snapshots, public.customer_data_gate_receipts to service_role;",
    );
    // No update, no delete: a recorded gate decision is history, and history is not rewritten.
    expect(migration).not.toMatch(/grant[^;]*update[^;]*customer_data_gate_receipts/);
    expect(migration).toContain(
      "create policy customer_data_gate_receipts_no_client_access on public.customer_data_gate_receipts",
    );
    expect(migration).toContain(
      "create policy source_acl_snapshots_no_client_access on public.source_acl_snapshots",
    );
    expect(migration).toContain("as restrictive for all to anon, authenticated using (false) with check (false);");
  });

  it("keeps credentials out of the stored principal and evidence bodies", () => {
    expect(migration).toContain(
      "principals::text !~* '\"(secret|password|token|credential|access[_-]?key|private[_-]?key)\"[[:space:]]*:'",
    );
    expect(migration).toContain(
      "evidence::text !~* '\"(secret|password|token|credential|access[_-]?key|private[_-]?key)\"[[:space:]]*:'",
    );
  });

  it("inserts nothing and enables nothing", () => {
    expect(migration).not.toMatch(/\binsert\s+into\b/i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    // The header comment names the policy it exists to gate; no SQL literal enables it.
    expect(migration).not.toMatch(/'approved_customer_data'/);
  });

  /**
   * `intersectAcl` drops a grant it cannot rank; the column refuses to store one, so the frozen
   * vocabulary is enforced at the storage boundary too and not in exactly one place.
   */
  it("constrains every stored principal to the frozen kind and permission vocabulary", () => {
    expect(migration).toContain(
      `not (principals @? '$[*] ? (!(@.kind == "user" || @.kind == "group" || @.kind == "domain" || @.kind == "anyone"))')`,
    );
    expect(migration).toContain(
      `not (principals @? '$[*] ? (!(@.permission == "read" || @.permission == "write" || @.permission == "owner"))')`,
    );
  });

  /**
   * The `evidence` column comment promises that "a later reader can re-derive receipt_sha256
   * instead of trusting it". `gateAdmitsCustomerData` checks the digest's shape only, so this is
   * where the promise has to be executable: evidence and digest sit side by side in the row, and
   * the exported derivation reproduces the digest from the evidence and detects a tampered row.
   */
  it("stores the evidence a reader re-derives receipt_sha256 from", () => {
    expect(migration).toContain("evidence jsonb not null");
    expect(migration).toContain("receipt_sha256 text check (receipt_sha256 ~ '^sha256:[a-f0-9]{64}$')");

    const evidence = customerDataPreconditions.map((precondition) => ({
      precondition,
      satisfied: true,
      evidence: `fixture://${precondition}`,
      checkedAt: "2026-09-06T00:00:00.000Z",
    }));
    const storedDigest = customerDataEvidenceReceiptSha256(evidence);
    expect(customerDataEvidenceReceiptSha256([...evidence].reverse())).toBe(storedDigest);
    const tampered = evidence.map((entry, index) =>
      index === 0 ? { ...entry, satisfied: false } : entry,
    );
    expect(customerDataEvidenceReceiptSha256(tampered)).not.toBe(storedDigest);
  });

  it("is one transaction, appended after 0049 and never altering an earlier table", () => {
    expect(migration.match(/^begin;$/gm)).toHaveLength(1);
    expect(migration.match(/^commit;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).not.toMatch(/alter table public\.(documents|enterprise_audit_events|foundation_developer_audit_events)/);
  });
});
