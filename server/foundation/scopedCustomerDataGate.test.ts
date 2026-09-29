import { describe, expect, it } from "vitest";
import { customerDataPreconditions } from "../../shared/uskcEnums";
import {
  admitsWorkspace, evaluateScopedRelease, requiredReleaseEvidence, workspaceGrantSha256, type ReleaseEvidence,
  type WorkspaceGrant,
} from "../../shared/scopedCustomerDataGate";

const now = "2026-09-29T00:00:00.000Z";
const revision = "a".repeat(40);
const evidence = (scope: "direct_upload" | "connector"): ReleaseEvidence[] =>
  requiredReleaseEvidence(scope).map((precondition) => ({
    precondition, satisfied: true, evidence: `test:${precondition}`, checkedAt: now,
  }));

describe("scope-bound customer-data policy", () => {
  it("requires 12 release facts for direct upload and all 17 for connectors", () => {
    expect(requiredReleaseEvidence("direct_upload")).toHaveLength(12);
    expect(requiredReleaseEvidence("connector")).toEqual(customerDataPreconditions);
    expect(evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision, evidence: evidence("direct_upload"), now }).allowed).toBe(true);
    expect(evaluateScopedRelease({ scope: "connector", releaseRevision: revision, evidence: evidence("direct_upload"), now }).allowed).toBe(false);
    expect(evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision,
      evidence: evidence("direct_upload"), now: "2026-09-29T00:00:00+00:00" }).receiptSha256).toBe(
      evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision,
        evidence: evidence("direct_upload"), now }).receiptSha256,
    );
  });

  it("rejects duplicate, extra, false and stale release evidence", () => {
    const valid = evidence("direct_upload");
    for (const invalid of [
      [...valid.slice(1), valid[1]],
      [...valid, evidence("connector")[3]],
      valid.map((row, index) => index === 0 ? { ...row, satisfied: false } : row),
      valid.map((row, index) => index === 0 ? { ...row, checkedAt: "2026-08-01T00:00:00.000Z" } : row),
    ]) {
      expect(evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision, evidence: invalid, now }).allowed).toBe(false);
    }
  });

  it("binds a separate terms-accepted grant to exact workspace, scope and release", () => {
    const release = evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision, evidence: evidence("direct_upload"), now });
    const unsignedGrant: Omit<WorkspaceGrant, "grantReceiptSha256"> = {
      tenantId: "tenant-a", workspaceId: "workspace-a", userId: "user-a", scope: "direct_upload",
      releaseRevision: revision, releaseReceiptSha256: release.receiptSha256!,
      termsVersion: "live-2026-09-29", termsReceiptSha256: `sha256:${"1".repeat(64)}`,
      processingTermsReceiptSha256: `sha256:${"2".repeat(64)}`,
      grantedAt: now, expiresAt: "2026-10-01T00:00:00.000Z", revokedAt: null,
    };
    const grant: WorkspaceGrant = { ...unsignedGrant, grantReceiptSha256: workspaceGrantSha256(unsignedGrant) };
    expect(workspaceGrantSha256({ ...unsignedGrant, grantedAt: "2026-09-29T00:00:00+00:00" }))
      .toBe(grant.grantReceiptSha256);
    const subject = { tenantId: "tenant-a", workspaceId: "workspace-a", scope: "direct_upload" as const, releaseRevision: revision };
    expect(admitsWorkspace(release, grant, subject, now)).toBe(true);
    expect(admitsWorkspace(release, grant, { ...subject, workspaceId: "workspace-b" }, now)).toBe(false);
    expect(admitsWorkspace(release, grant, { ...subject, scope: "connector" }, now)).toBe(false);
    expect(admitsWorkspace(release, { ...grant, revokedAt: now }, subject, now)).toBe(false);
    expect(admitsWorkspace(release, { ...grant, termsVersion: "changed" }, subject, now)).toBe(false);
    expect(admitsWorkspace(release, { ...grant, processingTermsReceiptSha256: "" }, subject, now)).toBe(false);
    expect(admitsWorkspace(release, grant, subject, "2026-10-01T00:00:00.000Z")).toBe(false);
  });
});
