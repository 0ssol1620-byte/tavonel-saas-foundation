import { describe, expect, it } from "vitest";
import type { WorkspaceEntitlement, WorkspaceMembership } from "../../shared/tenantDomain";
import { evaluateUploadCapability } from "./uploadCapability";
import { canAccessWorkspace, entitlementAllowsUpload } from "./tenantAuthorization";

const member: WorkspaceMembership = {
  workspaceId: "workspace-a",
  userId: "user-a",
  role: "member",
};

const activeEntitlement: WorkspaceEntitlement = {
  workspaceId: "workspace-a",
  status: "active",
  uploadBytesLimit: 20_000_000,
  uploadBytesUsed: 100,
  documentLimit: 10,
  documentCount: 2,
  validUntil: new Date("2030-01-01T00:00:00.000Z"),
};

describe("tenant authorization", () => {
  it("denies cross-tenant and role-escalating access", () => {
    expect(canAccessWorkspace(member, "user-b", "workspace-a", "document.read")).toBe(false);
    expect(canAccessWorkspace(member, "user-a", "workspace-b", "document.read")).toBe(false);
    expect(canAccessWorkspace(member, "user-a", "workspace-a", "workspace.manageBilling")).toBe(false);
  });

  it("applies entitlement status, expiry, and quota checks server-side", () => {
    expect(entitlementAllowsUpload(activeEntitlement, 1_000)).toBe(true);
    expect(entitlementAllowsUpload({ ...activeEntitlement, status: "canceled" }, 1_000)).toBe(false);
    expect(entitlementAllowsUpload({ ...activeEntitlement, uploadBytesUsed: 19_999_900 }, 1_000)).toBe(false);
    expect(entitlementAllowsUpload({ ...activeEntitlement, validUntil: new Date("2020-01-01") }, 1_000)).toBe(false);
  });

  it("keeps browser-direct intake denied even for a valid active workspace", () => {
    expect(
      evaluateUploadCapability({
        actorId: "user-a",
        workspaceId: "workspace-a",
        requestedBytes: 1_000,
        membership: member,
        entitlement: activeEntitlement,
      }),
    ).toEqual({ permitted: false, code: "INTAKE_DISABLED" });
  });
});
