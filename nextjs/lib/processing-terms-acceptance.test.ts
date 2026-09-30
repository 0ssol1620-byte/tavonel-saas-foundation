import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPublishedProcessingTerms,
  parseProcessingTermsAcceptanceRequest,
  parseProcessingTermsManifest,
  recordProcessingTermsAcceptance,
  type ProcessingTermsManifest,
} from "./processing-terms-acceptance";

const TERMS = "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md";
const PROCESSING = "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md";
const hash = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const manifest: ProcessingTermsManifest = {
  version: "2026-09-30",
  terms: { path: TERMS, sha256: hash("terms fixture") },
  processing: { path: PROCESSING, sha256: hash("processing fixture") },
};
const USER = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "pilot-1111111111114111";

describe("manifest", () => {
  it("accepts only the pinned version and document paths", () => {
    expect(parseProcessingTermsManifest(manifest)).toEqual(manifest);
    expect(parseProcessingTermsManifest({ ...manifest, version: "2026-10-01" })).toBeNull();
    expect(parseProcessingTermsManifest({ ...manifest, terms: { ...manifest.terms, path: "/policy/TAVONEL_DPA_v2_2026-09-23.md" } })).toBeNull();
    expect(parseProcessingTermsManifest({ ...manifest, terms: { ...manifest.terms, sha256: "sha256:ABC" } })).toBeNull();
    expect(parseProcessingTermsManifest({ ...manifest, draft: true })).toBeNull();
    expect(parseProcessingTermsManifest({ ...manifest, processing: { ...manifest.processing, url: "x" } })).toBeNull();
  });
});

describe("published documents", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "terms-"));
    await mkdir(join(root, "policy"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const publish = async (terms = "terms fixture") => {
    await writeFile(join(root, "policy/processing-terms-2026-09-30.json"), JSON.stringify(manifest));
    await writeFile(join(root, TERMS.slice(1)), terms);
    await writeFile(join(root, PROCESSING.slice(1)), "processing fixture");
  };

  it("verifies both documents against the manifest", async () => {
    await publish();
    await expect(loadPublishedProcessingTerms(root)).resolves.toEqual({ ok: true, manifest });
  });

  it("closes when the manifest or a document is missing", async () => {
    await expect(loadPublishedProcessingTerms(root)).resolves.toMatchObject({ ok: false, status: 503 });
    await writeFile(join(root, "policy/processing-terms-2026-09-30.json"), JSON.stringify(manifest));
    await expect(loadPublishedProcessingTerms(root)).resolves.toMatchObject({ ok: false, code: "PROCESSING_TERMS_UNAVAILABLE" });
  });

  it("closes when a published document no longer matches its hash", async () => {
    await publish("terms fixture, edited");
    await expect(loadPublishedProcessingTerms(root)).resolves.toMatchObject({ ok: false, status: 503 });
  });
});

describe("acceptance request", () => {
  const body = { accepted: true, version: manifest.version, terms: manifest.terms, processing: manifest.processing, scope: "direct_upload" };

  it("accepts the exact offer for a known scope", () => {
    expect(parseProcessingTermsAcceptanceRequest(body, manifest)).toEqual({ ok: true, scope: "direct_upload" });
    expect(parseProcessingTermsAcceptanceRequest({ ...body, scope: "connector" }, manifest)).toEqual({ ok: true, scope: "connector" });
  });

  it.each([
    ["workspaceId", { ...body, workspaceId: "pilot-attacker" }],
    ["userId", { ...body, userId: USER }],
    ["unknown scope", { ...body, scope: "all" }],
    ["array", [body]],
  ])("rejects %s", (_, value) => {
    expect(parseProcessingTermsAcceptanceRequest(value, manifest)).toMatchObject({ ok: false, status: 400 });
  });

  it.each([false, "true", 1])("requires accepted === true, not %s", (accepted) => {
    expect(parseProcessingTermsAcceptanceRequest({ ...body, accepted }, manifest))
      .toEqual({ ok: false, code: "PROCESSING_TERMS_NOT_ACCEPTED", status: 400 });
  });

  it.each([
    ["version", { ...body, version: "2026-09-23" }],
    ["terms hash", { ...body, terms: { ...manifest.terms, sha256: hash("other") } }],
    ["processing hash", { ...body, processing: { ...manifest.processing, sha256: hash("other") } }],
    ["processing path", { ...body, processing: { ...manifest.processing, path: "/policy/TAVONEL_DPA_v2_2026-09-23.md" } }],
  ])("refuses a stale or different %s", (_, value) => {
    expect(parseProcessingTermsAcceptanceRequest(value, manifest))
      .toEqual({ ok: false, code: "PROCESSING_TERMS_OFFER_CHANGED", status: 409 });
  });
});

describe("recordProcessingTermsAcceptance", () => {
  const fetchMock = vi.fn();
  const receipt = {
    acceptanceId: "22222222-2222-4222-8222-222222222222",
    workspaceKey: WORKSPACE, userId: USER, actorRole: "owner", authorizationRevision: 3,
    scope: "direct_upload", termsVersion: manifest.version, terms: manifest.terms, processing: manifest.processing,
    acceptedAt: "2026-09-30T01:00:00.000Z", idempotentReplay: false,
  };
  const input = { workspaceKey: WORKSPACE, userId: USER, scope: "direct_upload" as const, manifest, requestId: "req-terms-0001" };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "s".repeat(40));
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends server-derived authority and the verified offer to the narrow RPC", async () => {
    fetchMock.mockResolvedValue(Response.json(receipt));
    await expect(recordProcessingTermsAcceptance(input)).resolves.toEqual({ ok: true, receipt });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://db.example.test/rest/v1/rpc/record_foundation_processing_terms_acceptance");
    expect(JSON.parse(init.body)).toEqual({
      p_workspace_key: WORKSPACE, p_actor_user_id: USER, p_scope: "direct_upload",
      p_terms_version: "2026-09-30", p_terms_path: TERMS, p_terms_sha256: manifest.terms.sha256,
      p_processing_path: PROCESSING, p_processing_sha256: manifest.processing.sha256,
      p_request_id: "req-terms-0001",
    });
  });

  it("maps a database owner refusal to 403", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: "processing_terms_acceptance_forbidden" }, { status: 400 }));
    await expect(recordProcessingTermsAcceptance(input)).resolves.toEqual({ ok: false, code: "WORKSPACE_OWNER_REQUIRED", status: 403 });
  });

  it.each([
    ["another workspace", { workspaceKey: "pilot-other" }],
    ["another user", { userId: "33333333-3333-4333-8333-333333333333" }],
    ["another scope", { scope: "connector" }],
    ["another hash", { processing: { path: PROCESSING, sha256: hash("x") } }],
    ["a non-owner", { actorRole: "admin" }],
  ])("refuses a store receipt for %s", async (_, patch) => {
    fetchMock.mockResolvedValue(Response.json({ ...receipt, ...patch }));
    await expect(recordProcessingTermsAcceptance(input)).resolves.toEqual({ ok: false, code: "PROCESSING_TERMS_STORE_INVALID", status: 503 });
  });

  it("fails closed without store configuration or on network failure", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(recordProcessingTermsAcceptance(input)).resolves.toMatchObject({ ok: false, status: 503 });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "s".repeat(40));
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(recordProcessingTermsAcceptance(input)).resolves.toMatchObject({ ok: false, code: "PROCESSING_TERMS_STORE_FAILED" });
  });

  it("rejects malformed authority before calling the store", async () => {
    await expect(recordProcessingTermsAcceptance({ ...input, userId: "not-a-uuid" })).resolves.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
