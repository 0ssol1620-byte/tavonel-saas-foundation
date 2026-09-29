import { describe, expect, it, vi } from "vitest";
import { authorizationAdmitsCustomerData, type ScopedCustomerDataAuthorization } from "../../shared/customerDataAuthorization";
import { evaluateScopedRelease, requiredReleaseEvidence, workspaceGrantSha256, type WorkspaceGrant } from "../../shared/scopedCustomerDataGate";
import { buildProductCoreV2Request, dispatchProductCoreV2 } from "./core-runtime-v2";

const at = "2026-09-30T00:00:00.000Z";
const now = new Date(at);
const revision = "a".repeat(40);
function authorization(): ScopedCustomerDataAuthorization {
  const release = evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision, now: at,
    evidence: requiredReleaseEvidence("direct_upload").map(precondition => ({ precondition, satisfied: true, evidence: "test-only", checkedAt: at })) });
  const unsigned: Omit<WorkspaceGrant, "grantReceiptSha256"> = {
    tenantId: "pilot-test", workspaceId: "pilot-test", userId: "user-a", scope: "direct_upload",
    releaseRevision: revision, releaseReceiptSha256: release.receiptSha256!, termsVersion: "test",
    termsReceiptSha256: `sha256:${"b".repeat(64)}`, processingTermsReceiptSha256: `sha256:${"c".repeat(64)}`,
    grantedAt: at, expiresAt: "2026-10-01T00:00:00.000Z", revokedAt: null,
  };
  const grant = { ...unsigned, grantReceiptSha256: workspaceGrantSha256(unsigned) };
  return { allowed: true, schemaVersion: release.schemaVersion, tenantId: grant.tenantId,
    workspaceId: grant.workspaceId, receiptSha256: grant.grantReceiptSha256, evaluatedAt: at, release, grant };
}

describe("scoped authorization at the Core boundary", () => {
  it("uses the verified v2 authorization without inventing a v1 receipt", () => {
    const gate = authorization();
    expect(authorizationAdmitsCustomerData(gate, "pilot-test", "pilot-test", now, "direct_upload")).toBe(true);
    expect(buildProductCoreV2Request("pilot-test", [], now, "test", null, gate, "direct_upload").route.privacyPolicy).toBe("approved_customer_data");
  });

  it("requires a caller-selected scope and refuses a valid upload grant for connector work", () => {
    const gate = authorization();
    expect(authorizationAdmitsCustomerData(gate, "pilot-test", "pilot-test", now)).toBe(false);
    expect(authorizationAdmitsCustomerData(gate, "pilot-test", "pilot-test", now, "connector")).toBe(false);
  });

  it.each(["tenant", "workspace", "scope", "digest", "expiry", "revocation", "revision"])("refuses changed %s before provider dispatch", async field => {
    const gate = authorization();
    if (field === "tenant") gate.tenantId = "other";
    if (field === "workspace") gate.workspaceId = "other";
    if (field === "scope") gate.grant.scope = "connector";
    if (field === "digest") gate.receiptSha256 = `sha256:${"d".repeat(64)}`;
    if (field === "expiry") gate.grant.expiresAt = at;
    if (field === "revocation") gate.grant.revokedAt = at;
    if (field === "revision") gate.grant.releaseRevision = "f".repeat(40);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(authorizationAdmitsCustomerData(gate, "pilot-test", "pilot-test", now, "direct_upload")).toBe(false);
      expect(await dispatchProductCoreV2({ url: "https://core.test", hmac: "h".repeat(48) }, "pilot-test", [], now, null, gate, "direct_upload"))
        .toEqual({ ok: false, code: "CUSTOMER_DATA_GATE_DECISION_INVALID" });
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
