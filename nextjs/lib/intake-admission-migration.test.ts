import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0008_foundation_intake_admission.sql"),
  "utf8",
).toLowerCase();
const replayMigration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0026_foundation_intake_replay.sql"),
  "utf8",
).toLowerCase();
const pilotQuotaMigration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0030_foundation_intake_pilot_quota.sql"),
  "utf8",
).toLowerCase();
const qualificationQuotaMigration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0031_foundation_intake_qualification_quota.sql"),
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

  it("accepts byte-variant native export replays without weakening identity or MIME", () => {
    const replayGuard = replayMigration.slice(replayMigration.indexOf("if found then"), replayMigration.indexOf("return jsonb_build_object", replayMigration.indexOf("if found then")));
    expect(replayGuard).toContain("existing.user_id <> p_user_id");
    expect(replayGuard).toContain("existing.object_key <> p_object_key");
    expect(replayGuard).toContain("existing.declared_mime_type <> p_declared_mime_type");
    expect(replayGuard).not.toContain("existing.requested_bytes <> p_requested_bytes");
    expect(replayMigration).toContain("'idempotentreplay', true");
    expect(replayMigration).toContain("to service_role");
  });

  it("expands the private-pilot count without widening byte or minute limits", () => {
    expect(pilotQuotaMigration).toContain("day_count >= 25");
    expect(pilotQuotaMigration).toContain("day_bytes + p_requested_bytes > 104857600");
    expect(pilotQuotaMigration).toContain("minute_count >= 5");
    expect(pilotQuotaMigration).toContain("minute_bytes + p_requested_bytes > 26214400");
    expect(pilotQuotaMigration).toContain("p_requested_bytes > 5242880");
  });

  it("adds bounded qualification retries without widening byte or minute limits", () => {
    expect(qualificationQuotaMigration).toContain("day_count >= 30");
    expect(qualificationQuotaMigration).toContain("day_bytes + p_requested_bytes > 104857600");
    expect(qualificationQuotaMigration).toContain("minute_count >= 5");
    expect(qualificationQuotaMigration).toContain("minute_bytes + p_requested_bytes > 26214400");
    expect(qualificationQuotaMigration).toContain("p_requested_bytes > 5242880");
  });
});
