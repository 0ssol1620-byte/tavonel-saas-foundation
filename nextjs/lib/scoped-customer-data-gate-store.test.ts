import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateQualificationRelease, evaluateScopedRelease, QUALIFICATION_PENDING, requiredReleaseEvidence,
  workspaceGrantSha256,
  type WorkspaceGrant,
} from "../../shared/scopedCustomerDataGate";

const config = vi.fn();
const request = vi.fn();
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: (...args: unknown[]) => config(...args),
  supabaseAdminRequest: (...args: unknown[]) => request(...args),
}));
const { readVerifiedScopedCustomerDataGate } = await import("./scoped-customer-data-gate-store");
const { processingTermsReceiptSha256 } = await import("./processing-workspace-grant");

const TERMS = "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md";
const PROCESSING = "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md";
const hash = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const manifest = {
  version: "2026-09-30",
  terms: { path: TERMS, sha256: hash("terms fixture") },
  processing: { path: PROCESSING, sha256: hash("processing fixture") },
};
const WORKSPACE = "pilot-1111111111114111";
const OWNER = "11111111-1111-4111-8111-111111111111";
const scope = "direct_upload" as const;
const revision = "a".repeat(40);
const evaluatedAt = "2026-09-29T00:00:00.000Z";
const now = new Date("2026-09-29T01:00:00.000Z");
const evidence = requiredReleaseEvidence(scope).map((precondition) => ({
  precondition, satisfied: true, evidence: `test:${precondition}`, checkedAt: evaluatedAt,
}));
const release = evaluateScopedRelease({ scope, releaseRevision: revision, evidence, now: evaluatedAt });
if (!release.allowed || !release.receiptSha256) throw new Error("invalid release fixture");

const acceptance = (overrides: Record<string, unknown> = {}) => ({
  acceptanceId: "22222222-2222-4222-8222-222222222222", workspaceKey: WORKSPACE, userId: OWNER,
  actorRole: "owner", authorizationRevision: 3, scope, termsVersion: manifest.version,
  terms: manifest.terms, processing: manifest.processing, acceptedAt: "2026-09-28T12:00:00.000Z",
  idempotentReplay: false, ...overrides,
});
const receipt = (kind: "terms" | "processing") => processingTermsReceiptSha256(kind, {
  acceptanceId: acceptance().acceptanceId, workspaceKey: WORKSPACE, userId: OWNER, authorizationRevision: 3,
  scope, termsVersion: manifest.version, document: kind === "terms" ? manifest.terms : manifest.processing,
});
const unsignedGrant: Omit<WorkspaceGrant, "grantReceiptSha256"> = {
  tenantId: WORKSPACE, workspaceId: WORKSPACE, userId: OWNER,
  scope, stage: "production", releaseRevision: revision, releaseReceiptSha256: release.receiptSha256,
  termsVersion: manifest.version, termsReceiptSha256: receipt("terms"),
  processingTermsReceiptSha256: receipt("processing"),
  grantedAt: evaluatedAt, expiresAt: "2026-10-01T00:00:00.000Z", revokedAt: null,
};
const grant: WorkspaceGrant = { ...unsignedGrant, grantReceiptSha256: workspaceGrantSha256(unsignedGrant) };

function releaseRow(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: release.schemaVersion, stage: "production", scope, release_revision: revision, allowed: true,
    qualification_workspace_key: null, qualification_expires_at: null,
    receipt_sha256: release.receiptSha256, evidence, missing: [], evaluated_at: evaluatedAt,
    recorded_at: "2026-09-29T00:00:01.000Z", ...overrides,
  };
}
function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: release.schemaVersion, stage: "production", tenant_id: grant.tenantId, workspace_id: grant.workspaceId,
    scope, release_revision: revision, allowed: true, user_id: grant.userId,
    release_receipt_sha256: grant.releaseReceiptSha256, terms_version: grant.termsVersion,
    terms_receipt_sha256: grant.termsReceiptSha256,
    processing_terms_receipt_sha256: grant.processingTermsReceiptSha256,
    grant_receipt_sha256: grant.grantReceiptSha256,
    granted_at: grant.grantedAt, expires_at: grant.expiresAt,
    recorded_at: "2026-09-29T00:00:02.000Z", ...overrides,
  };
}

let root: string;
const read = (at = now, tenant = WORKSPACE) =>
  readVerifiedScopedCustomerDataGate(tenant, WORKSPACE, scope, revision, at, process.env, root);
const withAcceptance = (body: unknown) => request.mockReset()
  .mockResolvedValueOnce(Response.json([releaseRow()]))
  .mockResolvedValueOnce(Response.json([grantRow()]))
  .mockResolvedValueOnce(Response.json(body));
const publish = async (terms = "terms fixture", served = manifest) => {
  await writeFile(join(root, "policy/processing-terms-2026-09-30.json"), JSON.stringify(served));
  await writeFile(join(root, TERMS.slice(1)), terms);
  await writeFile(join(root, PROCESSING.slice(1)), "processing fixture");
};

beforeEach(async () => {
  vi.clearAllMocks();
  config.mockReturnValue({ url: "https://example.supabase.co", serviceRoleKey: "s".repeat(48) });
  root = await mkdtemp(join(tmpdir(), "gate-"));
  await mkdir(join(root, "policy"));
  await publish();
  withAcceptance(acceptance());
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("durable scoped customer-data gate", () => {
  it("requires exact release and workspace decisions and the grant's current acceptance", async () => {
    await expect(read()).resolves.toEqual({
      ok: true, scope, stage: "production", releaseReceiptSha256: release.receiptSha256,
      grantReceiptSha256: grant.grantReceiptSha256,
      authorization: { allowed: true, schemaVersion: release.schemaVersion, stage: "production",
        tenantId: grant.tenantId, workspaceId: grant.workspaceId,
        receiptSha256: grant.grantReceiptSha256, evaluatedAt, release, grant },
    });
    const releasePath = decodeURIComponent(request.mock.calls[0][1] as string);
    const grantPath = decodeURIComponent(request.mock.calls[1][1] as string);
    expect(releasePath).toContain(`scope=eq.${scope}`);
    expect(releasePath).toContain(`release_revision=eq.${revision}`);
    expect(releasePath).toContain("order=recorded_at.desc,allowed.asc,evaluated_at.desc");
    expect(grantPath).toContain(`tenant_id=eq.${WORKSPACE}`);
    expect(grantPath).toContain(`workspace_id=eq.${WORKSPACE}`);
    expect(grantPath).toContain("order=recorded_at.desc,allowed.asc");
    expect(request.mock.calls[2][1]).toBe("/rest/v1/rpc/current_foundation_processing_terms_acceptance");
    expect(JSON.parse(String(request.mock.calls[2][2].body))).toEqual({
      p_workspace_key: WORKSPACE, p_scope: scope, p_terms_version: manifest.version,
      p_terms_sha256: manifest.terms.sha256, p_processing_sha256: manifest.processing.sha256,
    });
  });

  it("does not let a tenant read another workspace's grant", async () => {
    await expect(read(now, "pilot-2222222222224222")).resolves.toEqual({ ok: false, code: "SCOPED_GATE_INPUT_INVALID" });
    expect(request).not.toHaveBeenCalled();
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

  it("stops admitting an unexpired grant once its accepting owner is revoked, replaced or re-authorized", async () => {
    // Revoked or demoted owner: the current-acceptance RPC no longer answers.
    withAcceptance(null);
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_TERMS_ACCEPTANCE_REQUIRED" });
    // A new owner accepted: their acceptance is current, but this grant was issued from someone else's.
    withAcceptance(acceptance({ acceptanceId: "33333333-3333-4333-8333-333333333333",
      userId: "44444444-4444-4444-8444-444444444444" }));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_TERMS_ACCEPTANCE_REQUIRED" });
    // The same owner re-accepted at a new membership revision: the old receipt no longer matches.
    withAcceptance(acceptance({ acceptanceId: "55555555-5555-4555-8555-555555555555", authorizationRevision: 4 }));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_TERMS_ACCEPTANCE_REQUIRED" });
    withAcceptance(acceptance({ workspaceKey: "pilot-2222222222224222" }));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_TERMS_ACCEPTANCE_REQUIRED" });
  });

  it("stops admitting a grant once the served terms change", async () => {
    const next = { ...manifest, terms: { path: TERMS, sha256: hash("terms v2") } };
    await publish("terms v2", next);
    withAcceptance(acceptance({ acceptanceId: "66666666-6666-4666-8666-666666666666", terms: next.terms }));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_TERMS_ACCEPTANCE_REQUIRED" });
    expect(JSON.parse(String(request.mock.calls[2][2].body))).toMatchObject({ p_terms_sha256: next.terms.sha256 });

    await publish("edited without a manifest update");
    withAcceptance(acceptance());
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_TERMS_UNAVAILABLE" });
  });

  it("closes on an acceptance store outage", async () => {
    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json([grantRow()]))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_GATE_STORE_FAILED" });
  });
});

describe("qualification stage at the gate reader", () => {
  const qExpires = "2026-09-29T01:30:00.000Z";
  const qEvaluated = "2026-09-29T00:40:00.000Z";
  const eleven = evidence.filter((row) => row.precondition !== QUALIFICATION_PENDING)
    .map((row) => ({ ...row, checkedAt: qEvaluated }));
  const qualification = evaluateQualificationRelease({
    releaseRevision: revision, workspaceId: WORKSPACE, expiresAt: qExpires, evidence: eleven, now: qEvaluated,
  });
  const qRow = {
    schema_version: qualification.schemaVersion, stage: "qualification", scope, release_revision: revision,
    allowed: true, receipt_sha256: qualification.receiptSha256, evidence: eleven, missing: qualification.missing,
    evaluated_at: qEvaluated, recorded_at: "2026-09-29T00:40:01.000Z",
    qualification_workspace_key: WORKSPACE, qualification_expires_at: qExpires,
  };
  const qUnsigned: Omit<WorkspaceGrant, "grantReceiptSha256"> = {
    ...unsignedGrant, stage: "qualification", releaseReceiptSha256: qualification.receiptSha256!,
    grantedAt: "2026-09-29T00:45:00.000Z", expiresAt: qExpires,
  };
  const qGrant: WorkspaceGrant = { ...qUnsigned, grantReceiptSha256: workspaceGrantSha256(qUnsigned) };
  const qGrantRow = (overrides: Record<string, unknown> = {}) => grantRow({
    schema_version: qualification.schemaVersion, stage: "qualification",
    release_receipt_sha256: qGrant.releaseReceiptSha256, grant_receipt_sha256: qGrant.grantReceiptSha256,
    granted_at: qGrant.grantedAt, expires_at: qGrant.expiresAt, recorded_at: "2026-09-29T00:45:01.000Z", ...overrides,
  });
  const answer = (release: unknown, grantRows: unknown) => request.mockReset()
    .mockResolvedValueOnce(Response.json([release]))
    .mockResolvedValueOnce(Response.json(grantRows))
    .mockResolvedValueOnce(Response.json(acceptance()));

  it("admits the recorded workspace with a typed qualification stage", async () => {
    answer(qRow, [qGrantRow()]);
    const result = await read();
    expect(result).toMatchObject({ ok: true, stage: "qualification",
      authorization: { stage: "qualification", release: { stage: "qualification", missing: [QUALIFICATION_PENDING] },
        grant: { stage: "qualification" } } });
    expect(decodeURIComponent(request.mock.calls[0][1] as string)).toContain("qualification_workspace_key");
  });

  it("denies a stage mismatch, a forged stage, expiry and a workspace the qualification does not name", async () => {
    answer(qRow, [grantRow()]);
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_INVALID" });
    answer(qRow, [qGrantRow({ stage: "production" })]);
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_INVALID" });
    answer(qRow, [qGrantRow({ stage: "beta" })]);
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_INVALID" });
    answer(qRow, [qGrantRow()]);
    await expect(read(new Date(qExpires))).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_STALE" });
    answer({ ...qRow, qualification_workspace_key: "pilot-2222222222224222" }, [qGrantRow()]);
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_INVALID" });
    answer(releaseRow(), [qGrantRow()]);
    await expect(read()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_INVALID" });
  });
});
