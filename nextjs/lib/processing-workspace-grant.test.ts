import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admitsWorkspace, evaluateScopedRelease, requiredReleaseEvidence, workspaceGrantSha256,
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
const OWNER = "11111111-1111-4111-8111-111111111111";
const evaluatedAt = "2026-09-29T00:00:00.000Z";
const now = new Date("2026-09-30T00:00:00.000Z");
const evidence = requiredReleaseEvidence(scope).map((precondition) => ({
  precondition, satisfied: true, evidence: `test:${precondition}`, checkedAt: evaluatedAt,
}));
const release = evaluateScopedRelease({ scope, releaseRevision: revision, evidence, now: evaluatedAt });

const releaseRow = (overrides: Record<string, unknown> = {}) => ({
  schema_version: release.schemaVersion, scope, release_revision: revision, allowed: true,
  receipt_sha256: release.receiptSha256, evidence, missing: [], evaluated_at: evaluatedAt,
  recorded_at: "2026-09-29T00:00:01.000Z", ...overrides,
});
const acceptance = (overrides: Record<string, unknown> = {}) => ({
  acceptanceId: "22222222-2222-4222-8222-222222222222", workspaceKey: WORKSPACE, userId: OWNER,
  actorRole: "owner", authorizationRevision: 3, scope, termsVersion: manifest.version,
  terms: manifest.terms, processing: manifest.processing, acceptedAt: "2026-09-29T12:00:00.000Z",
  idempotentReplay: false, ...overrides,
});
/** Plays the RPC: echoes the submitted grant back, as a fresh insert or a stored replay. */
function grantRpc(replay?: { grantedAt: string; expiresAt: string }) {
  return (_config: unknown, _path: string, init: RequestInit) => {
    const p = JSON.parse(String(init.body)) as Record<string, string>;
    const stored = {
      tenantId: p.p_workspace_key, workspaceId: p.p_workspace_key, userId: OWNER, scope,
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

let root: string;
const issue = (at = now, env: Record<string, string | undefined> = { VERCEL_GIT_COMMIT_SHA: revision }) =>
  issueProcessingWorkspaceGrant({ workspaceKey: WORKSPACE, scope, now: at, env, publicDir: root });
const rpcBody = () => JSON.parse(String(request.mock.calls[2][2].body)) as Record<string, string>;

beforeEach(async () => {
  vi.clearAllMocks();
  config.mockReturnValue({ url: "https://example.supabase.co", serviceRoleKey: "s".repeat(48) });
  root = await mkdtemp(join(tmpdir(), "grant-"));
  await mkdir(join(root, "policy"));
  await writeFile(join(root, "policy/processing-terms-2026-09-30.json"), JSON.stringify(manifest));
  await writeFile(join(root, TERMS.slice(1)), "terms fixture");
  await writeFile(join(root, PROCESSING.slice(1)), "processing fixture");
  request
    .mockResolvedValueOnce(Response.json([releaseRow()]))
    .mockResolvedValueOnce(Response.json(acceptance()))
    .mockImplementationOnce(grantRpc());
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("processing workspace grant", () => {
  it("issues a gate-admissible grant bound to the deployed release and the owner's acceptance", async () => {
    const result = await issue();
    expect(result).toMatchObject({ ok: true, idempotentReplay: false });
    if (!result.ok) throw new Error("unreachable");
    expect(request.mock.calls[0][1]).toContain(`release_revision=eq.${revision}`);
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
    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(acceptance()))
      .mockImplementationOnce(grantRpc(first.grant));
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
      userId: "c0a1a1a1-0000-4000-8000-000000000001", scope, releaseRevision: revision,
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
    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(acceptance({ workspaceKey: "pilot-2222222222224222" })));
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
    expect(request).toHaveBeenCalledTimes(2);

    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(acceptance()))
      .mockImplementationOnce((c: unknown, p: string, init: RequestInit) => grantRpc()(c, p, {
        ...init, body: JSON.stringify({ ...JSON.parse(String(init.body)), p_workspace_key: "pilot-2222222222224222" }),
      }));
    await expect(issue()).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_STORE_FAILED" });
  });

  it("closes when the published manifest changed or the owner no longer holds a current acceptance", async () => {
    await writeFile(join(root, TERMS.slice(1)), "edited terms");
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_UNAVAILABLE" });
    expect(request).toHaveBeenCalledTimes(1); // the release read; no acceptance lookup, no grant write
    await writeFile(join(root, TERMS.slice(1)), "terms fixture");

    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(acceptance({ terms: { path: TERMS, sha256: hash("old terms") } })));
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });

    // current_foundation_processing_terms_acceptance answers null once the owner changes or is revoked.
    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(null));
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });

    // An owner change that races between the read and the locked RPC.
    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(acceptance()))
      .mockReturnValueOnce(rpcError("workspace_grant_acceptance_required"));
    await expect(issue()).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
  });

  it("never renews over a refused release or an explicit workspace refusal", async () => {
    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow({ allowed: false, missing: ["x"] })]));
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    expect(request).toHaveBeenCalledTimes(1);

    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(acceptance()))
      .mockReturnValueOnce(rpcError("workspace_grant_release_changed"));
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_CHANGED" });

    request.mockReset()
      .mockResolvedValueOnce(Response.json([releaseRow()]))
      .mockResolvedValueOnce(Response.json(acceptance()))
      .mockReturnValueOnce(rpcError("workspace_grant_refused"));
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
  });

  it("caps expiry at release evaluation + 30 days and refuses an expired release", async () => {
    const lateNow = new Date("2026-10-28T00:00:00.000Z");
    const result = await issue(lateNow);
    expect(result).toMatchObject({ ok: true, grant: { expiresAt: "2026-10-29T00:00:00.000Z" } });

    request.mockReset().mockResolvedValueOnce(Response.json([releaseRow()]));
    await expect(issue(new Date("2026-10-29T00:00:00.001Z"))).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_STALE" });
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
      request.mockReset().mockResolvedValueOnce(Response.json([row]));
      await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_INVALID" });
    }
    request.mockReset().mockResolvedValueOnce(Response.json([]));
    await expect(issue()).resolves.toEqual({ ok: false, code: "SCOPED_RELEASE_NOT_FOUND" });
    config.mockReturnValue(null);
    await expect(issue()).resolves.toEqual({ ok: false, code: "WORKSPACE_GRANT_STORE_NOT_CONFIGURED" });
  });
});
