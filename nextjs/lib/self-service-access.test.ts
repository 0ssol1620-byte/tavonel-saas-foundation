import { describe, expect, it } from "vitest";
import { foundationPilotAccess, foundationWorkspaceId, readAccessMode } from "./foundation-pilot";
import { FOUNDATION_INTAKE_MAX_BYTES } from "./r2-presign";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const PILOT_ENV = { FOUNDATION_PILOT_USER_IDS: USER_A };
const SELF_SERVICE_ENV = { ACCESS_MODE: "self_service" };

describe("access mode", () => {
  it("defaults to pilot when unset, so a misconfigured deployment fails closed", () => {
    expect(readAccessMode({})).toBe("pilot");
    expect(readAccessMode({ ACCESS_MODE: "" })).toBe("pilot");
  });

  it("only opens self-service on an exact opt-in value", () => {
    expect(readAccessMode({ ACCESS_MODE: "self_service" })).toBe("self_service");
    expect(readAccessMode({ ACCESS_MODE: "SELF_SERVICE" })).toBe("self_service");
    expect(readAccessMode({ ACCESS_MODE: " self_service " })).toBe("self_service");
    for (const value of ["true", "1", "yes", "selfservice", "self-service", "public", "open"]) {
      expect(readAccessMode({ ACCESS_MODE: value }), `${value} must not open self-service`).toBe("pilot");
    }
  });

  it("opens production but refuses Vercel previews that inherit the same project value", () => {
    expect(readAccessMode({ ACCESS_MODE: "self_service", VERCEL_ENV: "production" })).toBe("self_service");
    expect(readAccessMode({ ACCESS_MODE: "self_service", VERCEL_ENV: "preview" })).toBe("pilot");
    expect(readAccessMode({ ACCESS_MODE: "self_service", VERCEL_ENV: "development" })).toBe("pilot");
  });
});

describe("pilot mode is unchanged", () => {
  it("admits an allowlisted user", () => {
    const access = foundationPilotAccess(USER_A, PILOT_ENV);
    expect(access?.membership.role).toBe("owner");
    expect(access?.entitlement.status).toBe("active");
  });

  it("still refuses a signed-in user who is not on the allowlist", () => {
    expect(foundationPilotAccess(USER_B, PILOT_ENV)).toBeNull();
  });

  it("refuses everyone when no allowlist is configured", () => {
    expect(foundationPilotAccess(USER_A, {})).toBeNull();
  });
});

describe("self-service mode", () => {
  it("gives any authenticated user their own owned workspace", () => {
    const access = foundationPilotAccess(USER_B, SELF_SERVICE_ENV);
    expect(access).not.toBeNull();
    expect(access?.membership.userId).toBe(USER_B);
    expect(access?.membership.role).toBe("owner");
  });

  it("does not require the allowlist, which is what unblocks public signup", () => {
    expect(foundationPilotAccess(USER_B, PILOT_ENV)).toBeNull();
    expect(foundationPilotAccess(USER_B, SELF_SERVICE_ENV)).not.toBeNull();
  });

  it("starts a new workspace as trialing, never active", () => {
    const access = foundationPilotAccess(USER_B, SELF_SERVICE_ENV);
    expect(access?.entitlement.status).toBe("trialing");
  });

  it("advertises no more than the durable three-file evaluation before bootstrap completes", () => {
    const pilot = foundationPilotAccess(USER_A, PILOT_ENV);
    const fresh = foundationPilotAccess(USER_B, SELF_SERVICE_ENV);
    expect(fresh?.entitlement.documentLimit).toBe(3);
    expect(fresh?.entitlement.uploadBytesLimit).toBe(FOUNDATION_INTAKE_MAX_BYTES * 3);
    expect(fresh!.entitlement.documentLimit).toBeLessThanOrEqual(pilot!.entitlement.documentLimit);
    expect(fresh!.entitlement.uploadBytesLimit).toBeLessThanOrEqual(pilot!.entitlement.uploadBytesLimit);
  });
});

describe("tenant boundary under self-service", () => {
  it("gives two different users two different workspaces", () => {
    const a = foundationPilotAccess(USER_A, SELF_SERVICE_ENV);
    const b = foundationPilotAccess(USER_B, SELF_SERVICE_ENV);
    expect(a?.membership.workspaceId).not.toBe(b?.membership.workspaceId);
    expect(a?.entitlement.workspaceId).not.toBe(b?.entitlement.workspaceId);
  });

  it("derives the workspace from the user ID, so it cannot be chosen by the caller", () => {
    const access = foundationPilotAccess(USER_B, SELF_SERVICE_ENV);
    expect(access?.membership.workspaceId).toBe(foundationWorkspaceId(USER_B));
  });

  it("produces a workspace key the retrieval schema will accept", () => {
    for (const userId of [USER_A, USER_B, "abcdef01-2345-4678-8abc-def012345678"]) {
      const access = foundationPilotAccess(userId, SELF_SERVICE_ENV);
      expect(access?.membership.workspaceId).toMatch(/^pilot-[A-Za-z0-9]{1,16}$/);
    }
  });

  it("refuses a malformed user ID in every mode", () => {
    for (const bad of ["", "not-a-uuid", "../../etc", "11111111-1111-4111-8111", "'; drop table--"]) {
      expect(foundationPilotAccess(bad, SELF_SERVICE_ENV), `${bad} must be refused`).toBeNull();
      expect(foundationPilotAccess(bad, PILOT_ENV), `${bad} must be refused`).toBeNull();
    }
  });

  it("never grants a role above owner of one's own workspace", () => {
    const access = foundationPilotAccess(USER_B, SELF_SERVICE_ENV);
    expect(access?.membership.role).toBe("owner");
    expect(access?.membership.userId).toBe(USER_B);
    expect(access?.entitlement.workspaceId).toBe(access?.membership.workspaceId);
  });
});
