import { describe, expect, it } from "vitest";
import { customerDataPreconditions } from "../../shared/uskcEnums";
import {
  admitsWorkspace, evaluateQualificationRelease, evaluateScopedRelease, QUALIFICATION_GATE_SCHEMA,
  QUALIFICATION_PENDING, requiredReleaseEvidence, verifyStoredRelease, workspaceGrantSha256,
  type ReleaseEvidence, type ScopedReleaseDecision, type WorkspaceGrant,
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
      stage: "production", releaseRevision: revision, releaseReceiptSha256: release.receiptSha256!,
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

  it("keeps the production release digest byte-identical to the pre-qualification form", () => {
    // Computed from shared/scopedCustomerDataGate.ts at 39ce55a with the same input.
    expect(evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision, evidence: evidence("direct_upload"), now })
      .receiptSha256).toBe("sha256:cf63d8092112ac4bb22350bcaaaa3b827c09b4ac818820691be9fc2e3fe677ed");
  });
});

describe("bounded qualification stage", () => {
  const WS = "pilot-qual0001";
  const expiresAt = "2026-09-29T01:00:00.000Z";
  const eleven = () => evidence("direct_upload").filter((row) => row.precondition !== QUALIFICATION_PENDING);
  const qualify = (overrides: Partial<Parameters<typeof evaluateQualificationRelease>[0]> = {}) =>
    evaluateQualificationRelease({ releaseRevision: revision, workspaceId: WS, expiresAt, evidence: eleven(), now,
      ...overrides });

  it("admits the 11 other facts, names the audited compile as pending and is never a release digest", () => {
    const q = qualify();
    expect(eleven()).toHaveLength(11);
    expect(q).toMatchObject({ allowed: true, stage: "qualification", schemaVersion: QUALIFICATION_GATE_SCHEMA,
      scope: "direct_upload", missing: [QUALIFICATION_PENDING], qualification: { workspaceId: WS, expiresAt } });
    const production = evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision, evidence: eleven(), now });
    expect(production.allowed).toBe(false);
    expect(production.missing).toContain(QUALIFICATION_PENDING);
    expect(q.receiptSha256).not.toBe(evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision,
      evidence: evidence("direct_upload"), now }).receiptSha256);
  });

  it("refuses a claimed audited compile, missing/stale evidence, bad workspace and any expiry beyond one hour", () => {
    for (const invalid of [
      qualify({ evidence: evidence("direct_upload") }),
      qualify({ evidence: eleven().slice(1) }),
      qualify({ evidence: eleven().map((row, i) => i === 0 ? { ...row, checkedAt: "2026-08-01T00:00:00.000Z" } : row) }),
      qualify({ workspaceId: "pilot-*" }),
      qualify({ workspaceId: "tenant-a" }),
      qualify({ expiresAt: "2026-09-29T01:00:00.001Z" }),
      qualify({ expiresAt: now }),
      qualify({ expiresAt: "not-a-date" }),
      qualify({ releaseRevision: "b".repeat(39) }),
    ]) {
      expect(invalid.allowed).toBe(false);
      expect(invalid.receiptSha256).toBeNull();
      expect(invalid.qualification).toBeNull();
      expect(invalid.missing).toContain(QUALIFICATION_PENDING);
    }
  });

  const row = (q: ScopedReleaseDecision, overrides: Record<string, unknown> = {}) => ({
    schema_version: q.schemaVersion, stage: q.stage, scope: q.scope, release_revision: revision, allowed: q.allowed,
    receipt_sha256: q.receiptSha256, evidence: q.stage === "qualification" ? eleven() : evidence("direct_upload"),
    missing: q.missing, evaluated_at: now, recorded_at: now,
    qualification_workspace_key: q.qualification?.workspaceId ?? null,
    qualification_expires_at: q.qualification?.expiresAt ?? null, ...overrides,
  });
  const at = Date.parse(now) + 60_000;
  const subject = { scope: "direct_upload" as const, releaseRevision: revision, workspaceId: WS };

  it("verifies stored rows by stage and fails closed on anything unknown, foreign or expired", () => {
    const q = qualify();
    expect(verifyStoredRelease(row(q), subject, at)).toEqual({ ok: true, release: q });
    const production = evaluateScopedRelease({ scope: "direct_upload", releaseRevision: revision,
      evidence: evidence("direct_upload"), now });
    expect(verifyStoredRelease(row(production), subject, at)).toMatchObject({ ok: true, release: { stage: "production" } });
    const invalid = { ok: false, code: "SCOPED_RELEASE_INVALID" };
    expect(verifyStoredRelease(row(q, { stage: "pilot" }), subject, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q, { stage: undefined }), subject, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q, { schema_version: "tavonel.customer_data_gate.v2" }), subject, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q, { missing: [] }), subject, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q, { qualification_expires_at: "2026-09-29T00:59:59.000Z" }), subject, at))
      .toEqual(invalid);
    expect(verifyStoredRelease(row(q, { qualification_workspace_key: "pilot-other" }), subject, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q, { evidence: eleven().map((e, i) => i ? e : { ...e, note: "x" }) }), subject, at))
      .toEqual(invalid);
    expect(verifyStoredRelease(row(q, { evidence: evidence("direct_upload") }), subject, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q), { ...subject, scope: "connector" }, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(production, { qualification_workspace_key: WS }), subject, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q), { ...subject, releaseRevision: "b".repeat(40) }, at)).toEqual(invalid);
    expect(verifyStoredRelease(row(q), { ...subject, workspaceId: "pilot-other" }, at))
      .toEqual({ ok: false, code: "SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE" });
    expect(verifyStoredRelease(row(q), subject, Date.parse(expiresAt))).toEqual({ ok: false, code: "SCOPED_RELEASE_STALE" });
    expect(verifyStoredRelease(row(q, { allowed: false }), subject, at)).toEqual({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
  });

  it("admits only the recorded workspace, direct upload, a same-stage grant and at most an hour", () => {
    const q = qualify();
    const unsigned: Omit<WorkspaceGrant, "grantReceiptSha256"> = {
      tenantId: WS, workspaceId: WS, userId: "user-a", scope: "direct_upload", stage: "qualification",
      releaseRevision: revision, releaseReceiptSha256: q.receiptSha256!, termsVersion: "2026-09-30",
      termsReceiptSha256: `sha256:${"1".repeat(64)}`, processingTermsReceiptSha256: `sha256:${"2".repeat(64)}`,
      grantedAt: now, expiresAt, revokedAt: null,
    };
    const sign = (g: Omit<WorkspaceGrant, "grantReceiptSha256">): WorkspaceGrant =>
      ({ ...g, grantReceiptSha256: workspaceGrantSha256(g) });
    const grant = sign(unsigned);
    const who = { tenantId: WS, workspaceId: WS, scope: "direct_upload" as const, releaseRevision: revision };
    const t = new Date(at).toISOString();
    expect(admitsWorkspace(q, grant, who, t)).toBe(true);
    expect(grant.grantReceiptSha256).not.toBe(workspaceGrantSha256({ ...unsigned, stage: "production" }));
    expect(admitsWorkspace(q, sign({ ...unsigned, stage: "production" }), who, t)).toBe(false);
    expect(admitsWorkspace(q, { ...grant, stage: "production" }, who, t)).toBe(false);
    expect(admitsWorkspace(q, sign({ ...unsigned, tenantId: "pilot-other", workspaceId: "pilot-other" }),
      { ...who, tenantId: "pilot-other", workspaceId: "pilot-other" }, t)).toBe(false);
    expect(admitsWorkspace(q, sign({ ...unsigned, scope: "connector" }), { ...who, scope: "connector" }, t)).toBe(false);
    expect(admitsWorkspace(q, sign({ ...unsigned, expiresAt: "2026-09-29T01:00:00.001Z" }), who, t)).toBe(false);
    expect(admitsWorkspace(q, grant, who, expiresAt)).toBe(false);
    expect(admitsWorkspace({ ...q, stage: "production" }, grant, who, t)).toBe(false);
    expect(admitsWorkspace({ ...q, qualification: null }, grant, who, t)).toBe(false);
  });
});
