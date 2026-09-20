import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260920110200_workspace_membership_concurrency_hardening.sql",
), "utf8");

describe("workspace membership concurrency hardening migration", () => {
  it("keeps this repair forward-only", () => {
    expect(sql).toContain("20260920110000, 20260920110100, then this file");
    expect(sql).toContain("create or replace function public.create_foundation_workspace_invite");
    expect(sql).toContain("create or replace function public.assert_foundation_workspace_has_owner");
  });

  it("normalizes historical rows before enforcing one pending invite per workspace and email", () => {
    expect(sql).toMatch(/set state = 'expired'[\s\S]*expires_at <= clock_timestamp\(\)/i);
    expect(sql).toContain("partition by workspace_key, invitee_email");
    expect(sql).toContain("foundation_workspace_one_pending_invite_per_email_idx");
    expect(sql).toMatch(/\(workspace_key, invitee_email\)\s+where state = 'pending'/i);
  });

  it("serializes email and idempotency resources before replay lookup", () => {
    const emailLock = sql.indexOf("foundation_workspace_invite:email");
    const idempotencyLock = sql.indexOf("foundation_workspace_invite:idempotency");
    const replayLookup = sql.indexOf("select * into v_existing");
    expect(emailLock).toBeGreaterThan(0);
    expect(idempotencyLock).toBeGreaterThan(emailLock);
    expect(replayLookup).toBeGreaterThan(idempotencyLock);
    expect(sql).toContain("v_existing.token_hash <> p_token_hash");
    expect(sql).toContain("'idempotentReplay', true");
  });

  it("checks both tenants when a membership changes workspace", () => {
    expect(sql).toMatch(/tg_op in \('UPDATE', 'DELETE'\)[\s\S]*old\.workspace_key/i);
    expect(sql).toMatch(/tg_op in \('INSERT', 'UPDATE'\)[\s\S]*new\.workspace_key/i);
    expect(sql).toContain("v_new_workspace_key is distinct from v_old_workspace_key");
    expect(sql.match(/workspace_exactly_one_owner_required/g)).toHaveLength(2);
  });

  it("retains service-role-only execution", () => {
    expect(sql).toMatch(/revoke all on function public\.create_foundation_workspace_invite[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.create_foundation_workspace_invite[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant\s+execute[\s\S]*to\s+(anon|authenticated)/i);
  });
});
