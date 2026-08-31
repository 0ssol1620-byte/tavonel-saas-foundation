import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSelfServiceOrganization } from "./self-service-provisioning";

// bootstrap_enterprise_for_user (0015_enterprise_pilot_bootstrap.sql) creates the
// organization, workspace, owner memberships and default governance policy for a user. It
// was complete and correct, and nothing in the application ever called it.
//
// That was survivable while the pilot allowlist was the only way in -- the operator
// provisioned by hand. It stops being survivable the moment ACCESS_MODE=self_service admits
// a stranger: foundationPilotAccess hands them a workspace key, getEnterpriseAccess finds no
// enterprise_workspaces row, and every enterprise surface answers ENTERPRISE_ACCESS_DENIED.
// The user signs up successfully and is then told they have no organization.
//
// The risk in fixing it is the opposite one: a request path that writes rows. These tests
// pin down exactly when provisioning may and may not happen.

const USER = "11111111-1111-4111-8111-111111111111";
const SUPABASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_".padEnd(48, "x"),
};
const SELF_SERVICE = { ...SUPABASE_ENV, ACCESS_MODE: "self_service" };
const PILOT = { ...SUPABASE_ENV, FOUNDATION_PILOT_USER_IDS: USER };

let calls: Array<{ url: string; body: unknown }>;
let respondOk: boolean;

beforeEach(() => {
  calls = [];
  respondOk = true;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push({ url: href, body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: respondOk, status: respondOk ? 200 : 500, json: async () => ({}) } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("self-service organization provisioning", () => {
  it("calls the existing bootstrap function rather than inserting rows itself", async () => {
    // The RPC enforces the invariants (derived workspace key, owner role, no caller-supplied
    // workspace). Re-implementing those inserts in the application would duplicate and
    // eventually contradict them.
    const result = await ensureSelfServiceOrganization(USER, SELF_SERVICE);
    expect(result).toEqual({ ok: true, provisioned: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/rpc/bootstrap_enterprise_for_user");
  });

  it("passes only the user id, so the caller cannot choose an organization or role", async () => {
    await ensureSelfServiceOrganization(USER, SELF_SERVICE);
    expect(calls[0].body).toEqual({ p_user_id: USER });
  });

  it("refuses to provision in pilot mode", async () => {
    // In pilot mode the operator provisions deliberately. Signing in must not create tenancy
    // for someone the allowlist has not admitted.
    const result = await ensureSelfServiceOrganization(USER, PILOT);
    expect(result).toEqual({ ok: false, code: "PROVISION_NOT_PERMITTED" });
    expect(calls).toHaveLength(0);
  });

  it("refuses to provision when no access mode is configured", async () => {
    // Default is pilot, so an unconfigured deployment must not silently self-provision.
    const result = await ensureSelfServiceOrganization(USER, SUPABASE_ENV);
    expect(result).toEqual({ ok: false, code: "PROVISION_NOT_PERMITTED" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a malformed user id before making any request", async () => {
    for (const bad of ["", "not-a-uuid", "../../etc", "'; drop table--"]) {
      const result = await ensureSelfServiceOrganization(bad, SELF_SERVICE);
      expect(result).toEqual({ ok: false, code: "PROVISION_NOT_PERMITTED" });
    }
    expect(calls).toHaveLength(0);
  });

  it("reports a configuration gap rather than pretending to provision", async () => {
    const result = await ensureSelfServiceOrganization(USER, { ACCESS_MODE: "self_service" });
    expect(result).toEqual({ ok: false, code: "PROVISION_NOT_CONFIGURED" });
    expect(calls).toHaveLength(0);
  });

  it("reports failure when the database rejects the call", async () => {
    respondOk = false;
    const result = await ensureSelfServiceOrganization(USER, SELF_SERVICE);
    expect(result).toEqual({ ok: false, code: "PROVISION_FAILED" });
  });

  it("is safe to call repeatedly, because the underlying function is idempotent", async () => {
    // bootstrap_enterprise_for_user is built entirely from `on conflict do update`, so a
    // second call updates timestamps rather than creating a second organization. This test
    // records that the caller relies on that property.
    await ensureSelfServiceOrganization(USER, SELF_SERVICE);
    await ensureSelfServiceOrganization(USER, SELF_SERVICE);
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toEqual(calls[1].body);
  });
});
