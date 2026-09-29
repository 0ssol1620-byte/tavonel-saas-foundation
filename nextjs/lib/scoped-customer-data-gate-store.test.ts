import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateScopedRelease, requiredReleaseEvidence, workspaceGrantSha256,
  type WorkspaceGrant,
} from "../../shared/scopedCustomerDataGate";

const config = vi.fn();
const request = vi.fn();
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: (...args: unknown[]) => config(...args),
  supabaseAdminRequest: (...args: unknown[]) => request(...args),
}));
const { readVerifiedScopedCustomerDataGate } = await import("./scoped-customer-data-gate-store");

const scope = "direct_upload" as const;
const revision = "a".repeat(40);
const evaluatedAt = "2026-09-29T00:00:00.000Z";
const now = new Date("2026-09-29T01:00:00.000Z");
const evidence = requiredReleaseEvidence(scope).map((precondition) => ({
  precondition, satisfied: true, evidence: `test:${precondition}`, checkedAt: evaluatedAt,
}));
const release = evaluateScopedRelease({ scope, releaseRevision: revision, evidence, now: evaluatedAt });
if (!release.allowed || !release.receiptSha256) throw new Error("invalid release fixture");
const unsignedGrant: Omit<WorkspaceGrant, "grantReceiptSha256"> = {
  tenantId: "tenant-a", workspaceId: "workspace-a", userId: "11111111-1111-4111-8111-111111111111",
  scope, releaseRevision: revision, releaseReceiptSha256: release.receiptSha256,
  termsVersion: "live-2026-09-29", termsReceiptSha256: `sha256:${"1".repeat(64)}`,
  processingTermsReceiptSha256: `sha256:${"2".repeat(64)}`,
  grantedAt: evaluatedAt, expiresAt: "2026-10-01T00:00:00.000Z", revokedAt: null,
};
const grant: WorkspaceGrant = { ...unsignedGrant, grantReceiptSha256: workspaceGrantSha256(unsignedGrant) };

function releaseRow(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: release.schemaVersion, scope, release_revision: revision, allowed: true,
    receipt_sha256: release.receiptSha256, evidence, missing: [], evaluated_at: evaluatedAt,
    recorded_at: "2026-09-29T00:00:01.000Z", ...overrides,
  };
}
function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: release.schemaVersion, tenant_id: grant.tenantId, workspace_id: grant.workspaceId,
    scope, release_revision: revision, allowed: true, user_id: grant.userId,
    release_receipt_sha256: grant.releaseReceiptSha256, terms_version: grant.termsVersion,
    terms_receipt_sha256: grant.termsReceiptSha256,
    processing_terms_receipt_sha256: grant.processingTermsReceiptSha256,
    grant_receipt_sha256: grant.grantReceiptSha256,
    granted_at: grant.grantedAt, expires_at: grant.expiresAt,
    recorded_at: "2026-09-29T00:00:02.000Z", ...overrides,
  };
}
const read = (at = now) => readVerifiedScopedCustomerDataGate("tenant-a", "workspace-a", scope, revision, at);

beforeEach(() => {
  vi.clearAllMocks();
  config.mockReturnValue({ url: "https://example.supabase.co", serviceRoleKey: "s".repeat(48) });
  request.mockResolvedValueOnce(Response.json([releaseRow()])).mockResolvedValueOnce(Response.json([grantRow()]));
});

describe("durable scoped customer-data gate", () => {
  it("requires both exact release and workspace decisions", async () => {
    await expect(read()).resolves.toEqual({
      ok: true, scope, releaseReceiptSha256: release.receiptSha256,
      grantReceiptSha256: grant.grantReceiptSha256,
    });
    const releasePath = decodeURIComponent(request.mock.calls[0][1] as string);
    const grantPath = decodeURIComponent(request.mock.calls[1][1] as string);
    expect(releasePath).toContain(`scope=eq.${scope}`);
    expect(releasePath).toContain(`release_revision=eq.${revision}`);
    expect(releasePath).toContain("order=recorded_at.desc,allowed.asc,evaluated_at.desc");
    expect(grantPath).toContain("tenant_id=eq.tenant-a");
    expect(grantPath).toContain("workspace_id=eq.workspace-a");
    expect(grantPath).toContain("order=recorded_at.desc,allowed.asc");
  });

  it("treats latest release and workspace refusals as revocations", async () => {
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow({ allowed: false })]));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json([grantRow({ allowed: false })]));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
  });

  it("refuses altered digests, scopes, stale release and expired grants", async () => {
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow({ receipt_sha256: `sha256:${"0".repeat(64)}` })]));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_INVALID" });
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json([grantRow({ terms_version: "changed" })]));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_INVALID" });
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json([grantRow({ scope: "connector" })]));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_INVALID" });
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow()]));
    await expect(read(new Date("2026-10-30T00:00:00.001Z"))).resolves.toEqual({
      ok: false, code: "SCOPED_RELEASE_STALE",
    });
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json([grantRow()]));
    await expect(read(new Date("2026-10-01T00:00:00.000Z"))).resolves.toEqual({
      ok: false, code: "SCOPED_WORKSPACE_INVALID",
    });
  });
});
