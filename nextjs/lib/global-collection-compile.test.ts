import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueCorpusCompile } from "./compile-job-store";
import { corpusIdFor } from "./corpus-id";
import { globalCollectionCompileEnabled, judgeGlobalCollectionInput, GLOBAL_COLLECTION_MAX_BYTES } from "./global-collection-compile";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const documentIds = Array.from({ length: 13 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
function qualify() {
  vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "1");
  vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
  vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256", `sha256:${"a".repeat(64)}`);
}

describe("bounded private whole-collection compilation", () => {
  it("requires both closed runtime flags and an explicitly pinned Core release", () => {
    expect(globalCollectionCompileEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "1");
    expect(globalCollectionCompileEnabled()).toBe(false);
    qualify();
    expect(globalCollectionCompileEnabled()).toBe(true);
  });
  it("accepts13 bounded inputs and refuses overflow, duplicate membership and excessive regions", () => {
    const docs = documentIds.map((documentId) => ({ documentId, regions: [{}] }));
    expect(judgeGlobalCollectionInput(docs)).toBe(true);
    expect(judgeGlobalCollectionInput([...docs, docs[0]])).toBe(false);
    expect(judgeGlobalCollectionInput([{ documentId: "a", regions: Array.from({ length: 10001 }, () => ({})) }])).toBe(false);
    expect(judgeGlobalCollectionInput([{ documentId: "a", regions: ["x".repeat(GLOBAL_COLLECTION_MAX_BYTES)] }])).toBe(false);
    expect(judgeGlobalCollectionInput(Array.from({ length: 129 }, (_, i) => ({ documentId: String(i) })))).toBe(false);
  });
  it("durably enqueues one full13-document collection in a separate legacy-safe corpus namespace", async () => {
    qualify();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/foundation_compile_jobs?")) return Response.json([]);
      const body = JSON.parse(String(init?.body)); calls.push({ url: String(url), body });
      return Response.json([{ job_id: body.p_job_id, state: "preflight", created: true,
        corpus_id: body.p_corpus_id, batch_index: body.p_batch_index, idempotency_key: body.p_idempotency_key }]);
    });
    const result = await enqueueCorpusCompile({ workspaceKey: "pilot-alpha", createdByUserId: "00000000-0000-4000-8000-000000000001", authorizationRevision: 1, connectorViewerEnabled: false, documentIds });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/rpc/enqueue_foundation_global_collection_job");
    expect(calls[0].body.p_document_ids).toEqual(documentIds);
    expect(calls[0].body.p_batch_count).toBe(1);
    expect(calls[0].body.p_corpus_id).not.toBe(corpusIdFor("pilot-alpha", documentIds));
  });
});
