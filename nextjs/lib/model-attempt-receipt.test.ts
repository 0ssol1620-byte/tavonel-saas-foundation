import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readConfig, adminRequest } = vi.hoisted(() => ({
  readConfig: vi.fn(),
  adminRequest: vi.fn(),
}));

vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: readConfig,
  supabaseAdminRequest: adminRequest,
}));

import {
  attemptedRetrievalModelRoles,
  attemptedRetrievalModelRolesOnFailure,
  buildPublicRetrievalRoute,
  MODEL_ATTEMPT_RECEIPT_SCHEMA,
  persistRetrievalModelAttempt,
} from "./model-attempt-receipt";
import { buildOperatorStatusV1 } from "./operator-status";

const modelRoute = {
  schemaVersion: "retrieval-model-route/v1" as const,
  evaluatedAt: "2026-09-20T07:00:00.000Z",
  registrySource: "TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON" as const,
  selections: [{
    registryId: "private-registry-id",
    role: "embedder" as const,
    selected: true,
    reason: "SELECTED" as const,
    approvalId: "private-approval-id",
    verifiedAt: "2026-09-20T06:00:00.000Z",
    validUntil: "2026-09-21T06:00:00.000Z",
  }],
  fallbacks: [],
};

const base = {
  endpoint: "search" as const,
  workspaceKey: "private-workspace",
  collectionId: "private-collection",
  worldManifestDigest: `sha256:${"a".repeat(64)}`,
  query: "private customer question",
  modelRoute,
  attemptedRoles: ["embedder" as const],
  degradations: [] as string[],
};

beforeEach(() => {
  readConfig.mockReset();
  adminRequest.mockReset();
});

describe("internal model-attempt receipts and public projection", () => {
  it("retains bounded route truth while redacting selection detail and raw provider errors", () => {
    const publicRoute = buildPublicRetrievalRoute(
      ["embedder", "reranker"],
      ["reranker not applied: upstream said Bearer secret and model private-model failed"],
    );
    expect(publicRoute).toEqual({
      routeClass: "partial_model",
      degradationClasses: ["reranker_unavailable"],
    });
    const encoded = JSON.stringify(publicRoute);
    for (const forbidden of [
      "private-registry-id", "private-approval-id", "2026-09-20", "Bearer secret",
      "private-model", "registrySource", "selections", "features", "prompt", "costMatrix",
    ]) expect(encoded).not.toContain(forbidden);
  });

  it("recognizes only provider roles that actually reached their model-call boundary", () => {
    const embedder = { embedQuery: vi.fn() };
    const reranker = { rerank: vi.fn() };
    expect(attemptedRetrievalModelRoles(
      { embedder, reranker } as never,
      { rerankerApplied: false, degradations: [] },
    )).toEqual(["embedder"]);
    expect(attemptedRetrievalModelRoles(
      { embedder, reranker } as never,
      { rerankerApplied: false, degradations: ["reranker not applied: provider unavailable"] },
    )).toEqual(["embedder", "reranker"]);
    expect(attemptedRetrievalModelRoles(
      { embedder: null, reranker: null },
      { rerankerApplied: false, degradations: ["dense retrieval skipped: no embedder configured"] },
    )).toEqual([]);
    expect(attemptedRetrievalModelRolesOnFailure({ embedder } as never, "RETRIEVAL_STORE_FAILED"))
      .toEqual(["embedder"]);
    expect(attemptedRetrievalModelRolesOnFailure({ embedder } as never, "RETRIEVAL_RUN_NOT_FOUND"))
      .toEqual([]);
  });

  it("does not require a receipt store for lexical-only retrieval", async () => {
    const result = await persistRetrievalModelAttempt({ ...base, attemptedRoles: [] });
    expect(result).toEqual({ required: false, ok: true });
    expect(readConfig).not.toHaveBeenCalled();
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("fails closed after a model call when the internal store is unavailable", async () => {
    readConfig.mockReturnValue(null);
    await expect(persistRetrievalModelAttempt(base)).resolves.toEqual({
      required: true,
      ok: false,
      code: "MODEL_ATTEMPT_RECEIPT_UNAVAILABLE",
    });
  });

  it("records a bounded failure class when retrieval fails after the model call", async () => {
    readConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "secret" });
    adminRequest.mockResolvedValue(Response.json({ receiptId: "22222222-2222-4222-8222-222222222222" }));
    await persistRetrievalModelAttempt({
      ...base,
      execution: { outcome: "failed", failureClass: "downstream_failure" },
    });
    const body = JSON.parse(String(adminRequest.mock.calls[0][2].body));
    expect(body.p_receipt).toMatchObject({ outcome: "failed", failureClass: "downstream_failure" });
    expect(JSON.stringify(body)).not.toContain("RETRIEVAL_STORE_FAILED");
  });

  it("persists detailed selection only through the service-role RPC and stores query digests", async () => {
    readConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "secret" });
    adminRequest.mockResolvedValue(Response.json({ receiptId: "11111111-1111-4111-8111-111111111111" }));
    const result = await persistRetrievalModelAttempt(base);
    expect(result).toEqual({
      required: true,
      ok: true,
      receiptId: "11111111-1111-4111-8111-111111111111",
    });
    const [config, path, init] = adminRequest.mock.calls[0];
    expect(config).toEqual({ url: "https://project.supabase.co", serviceRoleKey: "secret" });
    expect(path).toBe("/rest/v1/rpc/record_model_attempt_receipt_v1");
    const body = JSON.parse(String(init.body));
    expect(body.p_receipt).toMatchObject({
      schemaVersion: MODEL_ATTEMPT_RECEIPT_SCHEMA,
      policyVersion: "retrieval-route-policy/v1",
      modelRoute,
      attemptedRoles: ["embedder"],
      outcome: "succeeded",
      failureClass: "none",
    });
    expect(body.p_receipt.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.p_receipt.tenantDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain(base.query);
    expect(JSON.stringify(body)).not.toContain(base.workspaceKey);
  });

  it("keeps operator metrics numeric and drops hostile routing/provider fields", () => {
    const source = Object.assign({
      state: "available" as const,
      evaluatedAt: "2026-09-20T07:00:00.000Z",
      freshness: { lastRunAt: "2026-09-20T06:59:00.000Z", ageMs: 60_000, ttlMs: 600_000 },
      availability: { passing: 3, total: 3 },
      window: { passingRuns: 4, totalRuns: 4, ratio: 1, successfulRequestLatencyP95Ms: 200, latencySamples: 4 },
      alerts: [],
      modelAttempts: {
        total: 8, receiptsRecorded: 7, receiptWriteFailures: 1,
        fullModel: 5, partialModel: 2, deterministic: 1,
        providerFailures: 2, invalidModelOutputs: 0, downstreamFailures: 1,
      },
    }, {
      registryId: "private-registry-id",
      approvalId: "private-approval-id",
      providerError: "Bearer secret",
      prompt: "private customer question",
    });
    const projected = buildOperatorStatusV1(source);
    expect(projected.modelAttempts).toEqual({
      total: 8, receiptsRecorded: 7, receiptWriteFailures: 1,
      routes: { fullModel: 5, partialModel: 2, deterministic: 1 },
      failures: { upstreamUnavailable: 2, invalidModelOutput: 0, downstreamFailure: 1 },
    });
    const encoded = JSON.stringify(projected);
    for (const forbidden of ["private-registry-id", "private-approval-id", "Bearer secret", "private customer question"])
      expect(encoded).not.toContain(forbidden);
  });

  it("locks the receipt ledger and writer to service role and makes rows append-only", () => {
    const migration = readFileSync(resolve(import.meta.dirname,
      "../../supabase/migrations/20260920131300_model_attempt_receipts.sql"), "utf8");
    expect(migration).toContain("enable row level security");
    expect(migration).toMatch(/revoke all on public\.foundation_model_attempt_receipts from public, anon, authenticated, service_role/i);
    expect(migration).toMatch(/grant execute on function public\.record_model_attempt_receipt_v1\(jsonb\) to service_role/i);
    expect(migration).toContain("foundation_model_attempt_receipts_append_only");
    expect(migration).toContain("jsonb_array_length(p_receipt->'attemptedRoles') = 0");
  });

  it("keeps detailed decisions on the receipt call and the public route on the bounded projection", () => {
    const root = resolve(import.meta.dirname, "..");
    for (const relative of [
      "app/api/collections/[id]/ask/route.ts",
      "app/api/collections/[id]/search/route.ts",
    ]) {
      const source = readFileSync(resolve(root, relative), "utf8");
      expect(source).toContain("modelRoute: runtime.decision");
      expect(source).toContain("buildPublicRetrievalRoute");
      expect(source).toContain("persistRetrievalModelAttempt");
      expect(source).toMatch(/routeClass:\s*publicRoute\.routeClass/);
      expect(source).toMatch(/degradations:\s*publicRoute\.degradationClasses/);
    }
  });
});
