import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/20260920110000_workspace_membership_control_plane.sql"), "utf8");

describe("workspace membership migration", () => {
  it("stores tenant-scoped memberships, hashed invites, and append-only audit events", () => {
    expect(sql).toContain("create table public.foundation_workspace_members");
    expect(sql).toContain("primary key (workspace_key, user_id)");
    expect(sql).toContain("token_hash text not null unique");
    expect(sql).toContain("foundation_membership_events_append_only");
    expect(sql).toContain("'invite.created', 'invite.accepted', 'invite.revoked'");
    expect(sql).toContain("'member.role_changed', 'member.revoked'");
  });

  it("binds acceptance to auth.users email and rejects expiry and replay", () => {
    expect(sql).toContain("select lower(email) into v_email from auth.users where id = p_actor_user_id");
    expect(sql).toContain("workspace_invite_identity_mismatch");
    expect(sql).toContain("workspace_invite_expired");
    expect(sql).toContain("workspace_invite_consumed");
    expect(sql).toContain("v_invite.accepted_by = p_actor_user_id");
  });

  it("enforces role hierarchy and protects the active owner", () => {
    expect(sql).toContain("foundation_workspace_one_active_owner_idx");
    expect(sql).toContain("v_actor.role = 'admin' and p_role <> 'member'");
    expect(sql.match(/workspace_last_owner_protected/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("v_actor.role = 'admin' and v_subject.role <> 'member'");
  });

  it("keeps all tables and mutation RPCs away from browser roles", () => {
    expect(sql).toContain("alter table public.foundation_workspace_members enable row level security");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete).*\s+to\s+(anon|authenticated)/i);
  });
});
