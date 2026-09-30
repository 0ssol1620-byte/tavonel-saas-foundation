import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admitsWorkspace, evaluateQualificationRelease, evaluateScopedRelease, QUALIFICATION_PENDING, QUALIFICATION_PENDING_BY_SCOPE, requiredReleaseEvidence,
  workspaceGrantSha256, type ReleaseStage,
} from "../../shared/scopedCustomerDataGate";

const config = vi.fn();
const request = vi.fn();
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: (...args: unknown[]) => config(...args),
  supabaseAdminRequest: (...args: unknown[]) => request(...args),
}));
const { issueProcessingWorkspaceGrant, processingTermsReceiptSha256 } = await import("./processing-workspace-grant");

const TERMS = "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md";
const PROCESSING = "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md";
const hash = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const manifest = {
  version: "2026-09-30",
  terms: { path: TERMS, sha256: hash("terms fixture") },
  processing: { path: PROCESSING, sha256: hash("processing fixture") },
};
const scope = "direct_upload" as const;
const revision = "a".repeat(40);
const WORKSPACE = "pilot-1111111111114111";
const OTHER = "pilot-2222222222224222";
const OWNER = "11111111-1111-4111-8111-111111111111";
const evaluatedAt = "2026-09-29T00:00:00.000Z";
const now = new Date("2026-09-30T00:00:00.000Z");
const evidence = requiredReleaseEvidence(scope).map((precondition) => ({
  precondition, satisfied: true, evidence: `test:${precondition}`, checkedAt: evaluatedAt,
}));
const release = evaluateScopedRelease({ scope, releaseRevision: revision, evidence, now: evaluatedAt });

const releaseRow = (overrides: Record<string, unknown> = {}) => ({
  schema_version: release.schemaVersion, stage: "production", scope, release_revision: revision, allowed: true,
  qualification_workspace_key: null, qualification_expires_at: null,
  receipt_sha256: release.receiptSha256, evidence, missing: [], evaluated_at: evaluatedAt,
  recorded_at: "2026-09-29T00:00:01.000Z", ...overrides,
});
const acceptance = (overrides: Record<string, unknown> = {}) => ({
  acceptanceId: "22222222-2222-4222-8222-222222222222", workspaceKey: WORKSPACE, userId: OWNER,
  actorRole: "owner", authorizationRevision: 3, scope, termsVersion: manifest.version,
  terms: manifest.terms, processing: manifest.processing, acceptedAt: "2026-09-29T12:00:00.000Z",
  idempotentReplay: false, ...overrides,
});
type Rpc = (config: unknown, path: string, init: RequestInit) => Promise<Response>;
/** Plays the RPC: echoes the submitted grant back, as a fresh insert or a stored replay. */
function grantRpc(replay?: { grantedAt: string; expiresAt: string }, rpcStage: ReleaseStage = "production"): Rpc {
  return (_config, _path, init) => {
    const p = JSON.parse(String(init.body)) as Record<string, string>;
    const stored = {
      tenantId: p.p_workspace_key, workspaceId: p.p_workspace_key, userId: OWNER, scope, stage: rpcStage,
      releaseRevision: p.p_release_revision, releaseReceiptSha256: p.p_release_receipt_sha256,
      termsVersion: p.p_terms_version, termsReceiptSha256: p.p_terms_receipt_sha256,
      processingTermsReceiptSha256: p.p_processing_terms_receipt_sha256,
      grantedAt: replay?.grantedAt ?? p.p_granted_at, expiresAt: replay?.expiresAt ?? p.p_expires_at, revokedAt: null,
    };
    return Promise.resolve(Response.json({ ...stored, idempotentReplay: Boolean(replay),
      grantReceiptSha256: replay ? workspaceGrantSha256(stored) : p.p_grant_receipt_sha256 }));
  };
}
const rpcError = (message: string) => Promise.resolve(Response.json({ message }, { status: 400 }));

const GRANT_RPC = "/rest/v1/rpc/issue_customer_data_workspace_grant";
/** Durable facts the fake store answers with, routed by path rather than by call order. */
let store: { latest: unknown; acceptance: unknown; release: unknown; rpc: Rpc };
const paths = () => request.mock.calls.map((call) => String(call[1]));
const wroteGrant = () => paths().includes(GRANT_RPC);
const readRelease = () => paths().some((path) => path.startsWith("/rest/v1/customer_data_release_decisions"));

let root: string;
const issue = (at = now, env: Record<string, string | undefined> = { VERCEL_GIT_COMMIT_SHA: revision }) =>
  issueProcessingWorkspaceGrant({ workspaceKey: WORKSPACE, scope, now: at, env, publicDir: root });
const rpcBody = () => JSON.parse(String(request.mock.calls.filter((call) => call[1] === GRANT_RPC).at(-1)![2].body)) as
  Record<string, string>;

beforeEach(async () => {
  vi.clearAllMocks();
  config.mockReturnValue({ url: "https://example.supabase.co", serviceRoleKey: "s".repeat(48) });
  root = await mkdtemp(join(tmpdir(), "grant-"));
  await mkdir(join(root, "policy"));
  await writeFile(join(root, "policy/processing-terms-2026-09-30.json"), JSON.stringify(manifest));
  await writeFile(join(root, TERMS.slice(1)), "terms fixture");
  await writeFile(join(root, PROCESSING.slice(1)), "processing fixture");
  store = { latest: [], acceptance: acceptance(), release: [releaseRow()], rpc: grantRpc() };
  request.mockImplementation((c: unknown, path: string, init: RequestInit) => {
    if (path.startsWith("/rest/v1/customer_data_workspace_decisions?")) return Promise.resolve(Response.json(store.latest));
    if (path === "/rest/v1/rpc/current_foundation_processing_terms_acceptance") {
      return Promise.resolve(Response.json(store.acceptance));
    }
    if (path.startsWith("/rest/v1/customer_data_release_decisions?")) return Promise.resolve(Response.json(store.release));
    if (path === GRANT_RPC) return store.rpc(c, path, init);
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("processing workspace grant", () => {
  it("issues a gate-admissible grant bound to the deployed release and the owner's acceptance", async () => {
    const result = await issue();
    expect(result).toMatchObject({ ok: true, idempotentReplay: false });
    if (!result.ok) throw new Error("unreachable");
    expect(paths().find((path) => path.includes("customer_data_release_decisions"))).toContain(`release_revision=eq.${revision}`);
    const body = rpcBody();
    expect(body.p_workspace_key).toBe(WORKSPACE);
    expect(body.p_grant_receipt_sha256).toBe(workspaceGrantSha256(result.grant));
    expect(result.grant).toMatchObject({ tenantId: WORKSPACE, workspaceId: WORKSPACE, userId: OWNER,
      releaseReceiptSha256: release.receiptSha256, termsVersion: "2026-09-30",
      grantedAt: now.toISOString(), expiresAt: "2026-10-29T00:00:00.000Z" }); // release evaluatedAt + 30 days
    expect(admitsWorkspace(release, result.grant,
      { tenantId: WORKSPACE, workspaceId: WORKSPACE, scope, releaseRevision: revision }, now.toISOString())).toBe(true);
  });

  it("repeated issuance is an idempotent replay of the stored grant", async () => {
    const first = await issue();
    if (!first.ok) throw new Error("first grant failed");
    store.rpc = grantRpc(first.grant);
    const later = new Date(now.getTime() + 60_000);
    const second = await issue(later);
    expect(second).toEqual({ ok: true, grant: first.grant, idempotentReplay: true });
    expect(rpcBody().p_terms_receipt_sha256).toBe(first.grant.termsReceiptSha256);
  });

  it("binds terms receipts to the acceptance, owner and exact documents", () => {
    const base = { acceptanceId: "22222222-2222-4222-8222-222222222222", workspaceKey: WORKSPACE, userId: OWNER,
      authorizationRevision: 3, scope, termsVersion: "2026-09-30", document: manifest.terms };
    const receipt = processingTermsReceiptSha256("terms", base);
    // Pinned for supabase/tests/processing_workspace_grant.sql, which asserts the SQL mirror.
    expect(processingTermsReceiptSha256("terms", { ...base,
      acceptanceId: "c0a1a1a1-0000-4000-8000-00000000a001", workspaceKey: "pilot-c0a1a1a100004000",
      userId: "c0a1a1a1-0000-4000-8000-000000000001", authorizationRevision: 1,
      document: { path: TERMS, sha256: `sha256:${"a".repeat(64)}` } }))
      .toBe("sha256:aa98c2784eca086344961c2f34f00fc88c9765aadd84c42fee86340d773da81b");
    expect(workspaceGrantSha256({ tenantId: "pilot-c0a1a1a100004000", workspaceId: "pilot-c0a1a1a100004000",
      userId: "c0a1a1a1-0000-4000-8000-000000000001", scope, stage: "production", releaseRevision: revision,
      releaseReceiptSha256: `sha256:${"d".repeat(64)}`, termsVersion: "2026-09-30",
      termsReceiptSha256: `sha256:${"1".repeat(64)}`, processingTermsReceiptSha256: `sha256:${"2".repeat(64)}`,
      grantedAt: "2026-09-30T00:00:00.123Z", expiresAt: "2026-10-29T00:00:00.000Z", revokedAt: null }))
      .toBe("sha256:6ce4b1d04eecc27e2e6c51febe879df2778f4e547fb0cf73f23805b63666c4c6");
    for (const changed of [{ userId: "33333333-3333-4333-8333-333333333333" }, { authorizationRevision: 4 },
      { workspaceKey: "pilot-other" }, { document: manifest.processing }, { termsVersion: "2026-10-01" }]) {
      expect(processingTermsReceiptSha256("terms", { ...base, ...changed })).not.toBe(receipt);
    }
    expect(processingTermsReceiptSha256("processing", base)).not.toBe(receipt);
  });

  it("refuses cross-workspace acceptances and grants", async () => {
    store.acceptance = acceptance({ workspaceKey: OTHER });
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
    expect(wroteGrant()).toBe(false);

    store.acceptance = acceptance();
    store.rpc = (c, p, init) => grantRpc()(c, p, {
      ...init, body: JSON.stringify({ ...JSON.parse(String(init.body)), p_workspace_key: OTHER }),
    });
    await expect(issue()).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_STORE_FAILED" });
  });

  it("closes when the published manifest changed or the owner no longer holds a current acceptance", async () => {
    await writeFile(join(root, TERMS.slice(1)), "edited terms");
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_UNAVAILABLE" });
    expect(paths().some((path) => path.includes("processing_terms_acceptance"))).toBe(false);
    expect(wroteGrant()).toBe(false);
    await writeFile(join(root, TERMS.slice(1)), "terms fixture");

    store.acceptance = acceptance({ terms: { path: TERMS, sha256: hash("old terms") } });
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });

    // current_foundation_processing_terms_acceptance answers null once the owner changes or is revoked.
    store.acceptance = null;
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });

    // An owner change that races between the read and the locked RPC.
    store.acceptance = acceptance();
    store.rpc = () => rpcError("workspace_grant_acceptance_required");
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
  });

  it("never renews over a refused release or an explicit workspace refusal", async () => {
    store.release = [releaseRow({ allowed: false, missing: ["x"] })];
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    expect(wroteGrant()).toBe(false);

    store.release = [releaseRow()];
    store.rpc = () => rpcError("workspace_grant_release_changed");
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_CHANGED" });

    store.rpc = () => rpcError("workspace_grant_refused");
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
  });

  // The onboarding bug: with neither a release nor an acceptance the owner was told "release pending",
  // which the workspace renders as "terms accepted".
  it("reports missing consent before a missing release, and an explicit refusal before both", async () => {
    store.release = [];
    store.acceptance = null;
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });

    store.acceptance = acceptance();
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_NOT_FOUND" });

    store.acceptance = null;
    store.latest = [{ allowed: false }];
    request.mockClear();
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
    expect(wroteGrant()).toBe(false);

    // A later grant supersedes an older refusal; only the latest decision counts.
    store.latest = [{ allowed: true }];
    store.acceptance = acceptance();
    store.release = [releaseRow()];
    await expect(issue()).resolves.toMatchObject({ ok: true });

    store.latest = { message: "not a row list" };
    await expect(issue()).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_STORE_FAILED" });
  });

  it("issues only inside a configured rollout cohort, without hiding consent or refusal", async () => {
    const env = (cohort: string) => ({ VERCEL_GIT_COMMIT_SHA: revision, TAVONEL_PROCESSING_WORKSPACE_COHORT: cohort });
    await expect(issue(now, env(`${OTHER}, ${WORKSPACE}`))).resolves.toMatchObject({ ok: true });

    request.mockClear();
    await expect(issue(now, env(OTHER))).resolves.toEqual({ ok: false, code: "PROCESSING_COHORT_EXCLUDED" });
    expect(wroteGrant()).toBe(false);
    expect(readRelease()).toBe(false);

    // Exact keys only: a prefix of the workspace key is a different workspace.
    await expect(issue(now, env(WORKSPACE.slice(0, -1)))).resolves.toEqual({ ok: false, code: "PROCESSING_COHORT_EXCLUDED" });

    for (const malformed of ["", " ", ",", `${WORKSPACE},`, "*", "pilot-*", `${WORKSPACE.slice(0, 10)}*`, `${WORKSPACE};${OTHER}`]) {
      request.mockClear();
      await expect(issue(now, env(malformed)), malformed).resolves.toEqual({ ok: false, code: "PROCESSING_COHORT_CONFIG_INVALID" });
      expect(wroteGrant()).toBe(false);
    }

    // Outside the cohort the owner still learns the true consent state, and any refusal.
    store.acceptance = null;
    await expect(issue(now, env(OTHER))).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
    store.latest = [{ allowed: false }];
    await expect(issue(now, env(OTHER))).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
  });

  it("caps expiry at release evaluation + 30 days and refuses an expired release", async () => {
    const lateNow = new Date("2026-10-28T00:00:00.000Z");
    const result = await issue(lateNow);
    expect(result).toMatchObject({ ok: true, grant: { expiresAt: "2026-10-29T00:00:00.000Z" } });

    request.mockClear();
    await expect(issue(new Date("2026-10-29T00:00:00.001Z"))).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_STALE" });
    expect(wroteGrant()).toBe(false);
  });

  it("fails closed on missing SHA, tampered, duplicate or future evidence", async () => {
    await expect(issue(now, {})).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_INPUT_INVALID" });
    await expect(issue(now, { VERCEL_GIT_COMMIT_SHA: "main" })).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_INPUT_INVALID" });
    const cases = [
      releaseRow({ receipt_sha256: `sha256:${"f".repeat(64)}` }),
      releaseRow({ evidence: [...evidence.slice(1), evidence[1]] }),
      releaseRow({ evidence: evidence.map((row, i) => i ? row : { ...row, checkedAt: "2026-09-29T00:00:01.000Z" }) }),
      releaseRow({ recorded_at: "2026-10-01T00:00:00.000Z" }),
      releaseRow({ release_revision: "b".repeat(40) }),
    ];
    for (const row of cases) {
      store.release = [row];
      await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_INVALID" });
    }
    expect(wroteGrant()).toBe(false);
    store.release = [];
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_NOT_FOUND" });
    config.mockReturnValue(null);
    await expect(issue()).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_STORE_NOT_CONFIGURED" });
  });
});

describe("qualification-stage grant", () => {
  const qExpires = "2026-09-30T00:30:00.000Z";
  const qEvaluated = "2026-09-29T23:40:00.000Z";
  const eleven = evidence.filter((row) => row.precondition !== QUALIFICATION_PENDING)
    .map((row) => ({ ...row, checkedAt: qEvaluated }));
  const qualification = evaluateQualificationRelease({
    releaseRevision: revision, workspaceId: WORKSPACE, expiresAt: qExpires, evidence: eleven, now: qEvaluated,
  });
  const qualificationRow = (overrides: Record<string, unknown> = {}) => ({
    schema_version: qualification.schemaVersion, stage: "qualification", scope, release_revision: revision,
    allowed: true, receipt_sha256: qualification.receiptSha256, evidence: eleven, missing: qualification.missing,
    evaluated_at: qEvaluated, recorded_at: "2026-09-29T23:40:01.000Z",
    qualification_workspace_key: WORKSPACE, qualification_expires_at: qExpires, ...overrides,
  });
  const issueQ = (at = now, workspaceKey = WORKSPACE, env: Record<string, string | undefined> = { VERCEL_GIT_COMMIT_SHA: revision }) =>
    issueProcessingWorkspaceGrant({ workspaceKey, scope, now: at, env, publicDir: root, allowQualification: true });

  beforeEach(() => {
    store.release = [qualificationRow()];
    store.rpc = grantRpc(undefined, "qualification");
  });

  it("hashes a qualification grant like production except for its schema version", () => {
    const pinned = { tenantId: "pilot-c0a1a1a100004000", workspaceId: "pilot-c0a1a1a100004000",
      userId: "c0a1a1a1-0000-4000-8000-000000000001", scope, releaseRevision: revision,
      releaseReceiptSha256: `sha256:${"d".repeat(64)}`, termsVersion: "2026-09-30",
      termsReceiptSha256: `sha256:${"1".repeat(64)}`, processingTermsReceiptSha256: `sha256:${"2".repeat(64)}`,
      grantedAt: "2026-09-30T00:00:00.123Z", expiresAt: "2026-09-30T01:00:00.000Z", revokedAt: null };
    // Pinned for supabase/tests/processing_qualification_stage.sql.
    expect(workspaceGrantSha256({ ...pinned, stage: "qualification" }))
      .toBe("sha256:e9b93be98f017dae135364ec48620a6ba063651c0c6ef054f3dbc6651794a7d3");
  });

  it("issues an hour-bounded qualification grant only to the owner's authenticated bootstrap", async () => {
    const result = await issueQ();
    expect(result).toMatchObject({ ok: true, grant: { stage: "qualification", expiresAt: qExpires,
      releaseReceiptSha256: qualification.receiptSha256 } });
    if (!result.ok) throw new Error("unreachable");
    expect(rpcBody().p_grant_receipt_sha256).toBe(workspaceGrantSha256(result.grant));
    expect(admitsWorkspace(qualification, result.grant,
      { tenantId: WORKSPACE, workspaceId: WORKSPACE, scope, releaseRevision: revision }, now.toISOString())).toBe(true);

    // Billing renewal (no opt-in) never takes one.
    request.mockClear();
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_QUALIFICATION_ONLY" });
    expect(wroteGrant()).toBe(false);
  });

  it("ends the grant with the qualification, and refuses one recorded in the future", async () => {
    const early = new Date("2026-09-29T23:45:00.000Z");
    const long = evaluateQualificationRelease({ releaseRevision: revision, workspaceId: WORKSPACE,
      expiresAt: "2026-09-30T00:40:00.000Z", evidence: eleven, now: qEvaluated });
    store.release = [qualificationRow({ receipt_sha256: long.receiptSha256, qualification_expires_at: "2026-09-30T00:40:00.000Z" })];
    await expect(issueQ(early)).resolves.toMatchObject({ ok: true, grant: { expiresAt: "2026-09-30T00:40:00.000Z" } });
    await expect(issueQ(new Date("2026-09-29T23:39:59.000Z"))).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_INVALID" });
  });

  it("denies another workspace, an expired qualification and the wrong deployed SHA", async () => {
    store.acceptance = acceptance({ workspaceKey: OTHER });
    await expect(issueQ(now, OTHER)).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE" });
    store.acceptance = acceptance();
    await expect(issueQ(new Date(qExpires))).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_STALE" });
    await expect(issueQ(now, WORKSPACE, { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }))
      .resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_INVALID" });
    expect(wroteGrant()).toBe(false);
  });

  it("never falls back to qualification after a later refusal, and never without the owner's terms", async () => {
    store.release = [releaseRow({ allowed: false, missing: ["compile_receipts_signed_and_audited"],
      receipt_sha256: null, evidence: [] })];
    await expect(issueQ()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    store.release = [qualificationRow({ allowed: false })];
    await expect(issueQ()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    store.release = [qualificationRow()];
    store.latest = [{ allowed: false }];
    await expect(issueQ()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
    store.latest = [];
    store.acceptance = null;
    await expect(issueQ()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
    expect(wroteGrant()).toBe(false);
  });

  it("refuses scope escalation, a production-shaped echo and the database's own qualification refusal", async () => {
    await expect(issueProcessingWorkspaceGrant({ workspaceKey: WORKSPACE, scope: "connector", now,
      env: { VERCEL_GIT_COMMIT_SHA: revision }, publicDir: root, allowQualification: true }))
      .resolves.toMatchObject({ ok: false });
    expect(wroteGrant()).toBe(false);

    store.rpc = grantRpc(undefined, "production");
    await expect(issueQ()).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_STORE_FAILED" });

    store.rpc = () => rpcError("workspace_grant_qualification_refused");
    await expect(issueQ()).resolves.toEqual({ ok: false, code: "SCOPED_QUALIFICATION_REFUSED" });
  });
});

describe("connector qualification grant", () => {
  const connector = "connector" as const;
  const qExpires = "2026-09-30T00:30:00.000Z";
  const qEvaluated = "2026-09-29T23:40:00.000Z";
  const pending: readonly string[] = QUALIFICATION_PENDING_BY_SCOPE.connector;
  const fourteen = requiredReleaseEvidence(connector).filter((precondition) => !pending.includes(precondition))
    .map((precondition) => ({ precondition, satisfied: true, evidence: `test:${precondition}`, checkedAt: qEvaluated }));
  const qualification = evaluateQualificationRelease({ scope: connector, releaseRevision: revision,
    workspaceId: WORKSPACE, expiresAt: qExpires, evidence: fourteen, now: qEvaluated });
  const connectorRow = {
    schema_version: qualification.schemaVersion, stage: "qualification", scope: connector, release_revision: revision,
    allowed: true, receipt_sha256: qualification.receiptSha256, evidence: fourteen, missing: qualification.missing,
    evaluated_at: qEvaluated, recorded_at: "2026-09-29T23:40:01.000Z",
    qualification_workspace_key: WORKSPACE, qualification_expires_at: qExpires,
  };
  /** The RPC echo for a connector grant: the stored scope is the submitted scope. */
  const connectorRpc: Rpc = (_config, _path, init) => {
    const p = JSON.parse(String(init.body)) as Record<string, string>;
    return Promise.resolve(Response.json({
      tenantId: p.p_workspace_key, workspaceId: p.p_workspace_key, userId: OWNER, scope: p.p_scope,
      stage: "qualification", releaseRevision: p.p_release_revision, releaseReceiptSha256: p.p_release_receipt_sha256,
      termsVersion: p.p_terms_version, termsReceiptSha256: p.p_terms_receipt_sha256,
      processingTermsReceiptSha256: p.p_processing_terms_receipt_sha256, grantedAt: p.p_granted_at,
      expiresAt: p.p_expires_at, grantReceiptSha256: p.p_grant_receipt_sha256, idempotentReplay: false,
    }));
  };
  const issueC = (allowQualification = true) => issueProcessingWorkspaceGrant({ workspaceKey: WORKSPACE,
    scope: connector, now, env: { VERCEL_GIT_COMMIT_SHA: revision }, publicDir: root, allowQualification });

  beforeEach(() => {
    store.release = [connectorRow];
    store.acceptance = acceptance({ scope: connector });
    store.rpc = connectorRpc;
  });

  it("issues an hour-bounded connector qualification grant from the owner's connector-scope acceptance", async () => {
    const result = await issueC();
    expect(result).toMatchObject({ ok: true, grant: { scope: connector, stage: "qualification", expiresAt: qExpires } });
    if (!result.ok) throw new Error("unreachable");
    expect(rpcBody()).toMatchObject({ p_scope: connector, p_grant_receipt_sha256: workspaceGrantSha256(result.grant) });
    expect(JSON.parse(String(request.mock.calls.find((c) =>
      c[1] === "/rest/v1/rpc/current_foundation_processing_terms_acceptance")![2].body))).toMatchObject({ p_scope: connector });
    expect(admitsWorkspace(qualification, result.grant,
      { tenantId: WORKSPACE, workspaceId: WORKSPACE, scope: connector, releaseRevision: revision }, now.toISOString())).toBe(true);
  });

  it("refuses without a connector-scope acceptance, without opt-in, and for a direct-upload-shaped row", async () => {
    store.acceptance = acceptance();
    await expect(issueC()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
    store.acceptance = acceptance({ scope: connector });
    await expect(issueC(false)).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_QUALIFICATION_ONLY" });
    store.release = [{ ...connectorRow, missing: [QUALIFICATION_PENDING] }];
    await expect(issueC()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_INVALID" });
    expect(wroteGrant()).toBe(false);
  });
});
