import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/20260920130000_operational_sli_alert_evaluations.sql"),
  "utf8",
).toLowerCase();

describe("operational SLI alert persistence migration", () => {
  it("keeps evaluations append-only and private", () => {
    expect(sql).toContain("foundation_operational_sli_evaluations_append_only");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.foundation_operational_sli_evaluations from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select on public.foundation_operational_sli_evaluations to service_role");
  });

  it("derives a slot key, serializes identical retries, and rejects changed payloads", () => {
    expect(sql).toContain("v_payload_sha256");
    expect(sql).toContain("tavonel.operational_sli_alert_evaluation.v1");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("operational_sli_evaluation_idempotency_conflict");
    expect(sql).toContain("'status', 'replayed'");
    expect(sql).toContain("'status', 'recorded'");
  });

  it("validates the fixed slot and the bounded evaluator contract", () => {
    expect(sql).toContain("extract(epoch from p_window_started_at) % 300");
    expect(sql).toContain("tavonel.operational_sli.v1");
    expect(sql).toContain("p_evaluation->>'evaluatedat'");
    expect(sql).toContain("octet_length(p_evaluation::text) > 16384");
    expect(sql).toContain("not (p_evaluation ? 'alerts')");
    expect(sql).toContain("jsonb_typeof(p_evaluation->'alerts') <> 'array'");
  });
});
