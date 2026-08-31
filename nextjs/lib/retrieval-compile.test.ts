import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileRetrievalArtifacts } from "./retrieval-compile";
import { buildBgeM3BaselineProfile } from "./retrieval-profile";
import type { CollectionCandidateArtifact } from "./collection-compiler";
import type { EmbedderAdapter } from "./embedder-adapter";

// Drives the REAL write-side orchestrator. As in retrieval-pipeline.test.ts, only the
// network boundary (`fetch` -> PostgREST) is stubbed; compileRetrievalUnits,
// embedDocumentsForProfile and the run lifecycle are production code.
//
// The assertions deliberately target the ordering guarantees, because those are what make a
// partially-written index invisible rather than half-used: the run row must exist before any
// unit is written, and it must only reach `completed` after both units and embeddings are
// durable.

const WORKSPACE = "pilot-acme01";
const COLLECTION = "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MANIFEST = `sha256:${"1".repeat(64)}`;
const ACTOR = "11111111-2222-3333-4444-555555555555";
const PROFILE = buildBgeM3BaselineProfile(WORKSPACE, "rev-embed-fixture", "rev-rerank-fixture");

// A minimal artifact carrying two page/bbox-bound rag chunks -- the same shape
// collection-compiler.ts emits and grounded-ask.ts's parseChunks consumes. Every field
// parseChunk() requires is present (chunkId, logicalId, text, sourceId, sourceVersionId,
// evidenceId, pageNumber1, bbox1000, authority); a fixture missing one of them parses to
// zero chunks and would make every assertion below vacuously pass through NO_UNITS.
function buildArtifact(): CollectionCandidateArtifact {
  const chunks = [
    {
      chunkId: "chunk-1",
      logicalId: "doc-1#region-1",
      sourceId: "doc-1",
      sourceVersionId: "c".repeat(64),
      text: "계약 해지 통보 기간은 30일입니다.",
      pageNumber1: 1,
      bbox1000: [10, 20, 30, 40],
      claimIds: ["claim-term"],
      entityIds: ["entity-acme"],
      evidenceId: "evidence-1",
      authority: "official_policy",
      authorityTier: "official",
      authorityScore: 0.8,
    },
    {
      chunkId: "chunk-2",
      logicalId: "doc-2#region-1",
      sourceId: "doc-2",
      sourceVersionId: "d".repeat(64),
      text: "The notice period is 45 days.",
      pageNumber1: 2,
      bbox1000: [11, 21, 31, 41],
      claimIds: [],
      entityIds: ["entity-acme"],
      evidenceId: "evidence-2",
      authority: "signed_contract",
      authorityTier: "contract",
      authorityScore: 0.9,
    },
  ];

  return {
    collectionId: COLLECTION,
    manifestDigest: MANIFEST,
    ontology: {
      nodes: [
        { id: "claim-term", label: "계약 해지 통보 기간은 30일입니다.", kind: "claim" },
        { id: "entity-acme", label: "Acme", kind: "entity" },
      ],
      edges: [],
    },
    package: {
      files: [
        {
          path: "rag/chunks.jsonl",
          mediaType: "application/x-ndjson",
          sizeBytes: 0,
          sha256: "0".repeat(64),
          content: chunks.map((chunk) => JSON.stringify(chunk)).join("\n"),
        },
      ],
    },
  } as unknown as CollectionCandidateArtifact;
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let failOn: string | null;

function jsonResponse(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  failOn = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_".padEnd(48, "x"));

  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const method = init?.method ?? "GET";
    calls.push({ url: href, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (failOn && href.includes(failOn)) return jsonResponse({ message: "rejected" }, false);
    return jsonResponse([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubEmbedder(overrides?: { dimension?: number; fail?: boolean }): EmbedderAdapter {
  const dimension = overrides?.dimension ?? PROFILE.embedding.dimension;
  const receipt = {
    provider: PROFILE.embedding.provider,
    model: PROFILE.embedding.model,
    revision: PROFILE.embedding.revision,
    dimension,
    normalize: true,
    inputDigest: "sha256:x",
    outputDigest: "sha256:y",
    durationMs: 1,
    timedOut: false,
  };
  return {
    identity: () => ({
      provider: PROFILE.embedding.provider,
      model: PROFILE.embedding.model,
      revision: PROFILE.embedding.revision,
      dimension: PROFILE.embedding.dimension,
      normalize: PROFILE.embedding.normalize,
    }),
    embedDocuments: async (texts) =>
      overrides?.fail
        ? { status: "error" as const, reason: "GPU endpoint unreachable", receipt: { ...receipt, outputDigest: null } }
        : { status: "ok" as const, vectors: texts.map(() => new Array(dimension).fill(0.02)), receipt },
    embedQuery: async () => ({ status: "error" as const, reason: "not used", receipt: { ...receipt, outputDigest: null } }),
  };
}

const baseInput = () => ({
  workspaceKey: WORKSPACE,
  collectionId: COLLECTION,
  worldManifestDigest: MANIFEST,
  artifact: buildArtifact(),
  profile: PROFILE,
  actorUserId: ACTOR,
  embedder: stubEmbedder(),
});

function urlsInOrder() {
  return calls.map((call) => call.url);
}

describe("retrieval compile orchestration", () => {
  it("registers the profile, opens a run, writes units and embeddings, then completes", async () => {
    const result = await compileRetrievalArtifacts(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.unitCount).toBeGreaterThan(0);
    expect(result.embeddingCount).toBe(result.unitCount);
    expect(result.runId).toMatch(/^retrieval-run-[a-f0-9]{32}$/);

    const order = urlsInOrder();
    const profileAt = order.findIndex((url) => url.includes("foundation_retrieval_profiles"));
    const runAt = order.findIndex((url) => url.includes("foundation_retrieval_compile_runs"));
    const unitsAt = order.findIndex((url) => url.includes("foundation_retrieval_units"));
    const embeddingsAt = order.findIndex((url) => url.includes("foundation_retrieval_embeddings"));

    // Ordering is the guarantee that makes a crashed run invisible rather than half-used.
    expect(profileAt).toBeLessThan(runAt);
    expect(runAt).toBeLessThan(unitsAt);
    expect(unitsAt).toBeLessThan(embeddingsAt);
  });

  it("only marks the run completed after both units and embeddings are durable", async () => {
    const result = await compileRetrievalArtifacts(baseInput());
    expect(result.ok).toBe(true);

    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    const patch = patches[0].body as Record<string, unknown>;
    expect(patch.status).toBe("completed");
    expect(patch.unit_count).toBeGreaterThan(0);

    // The completion PATCH must be the LAST write, after the embedding insert.
    const lastEmbeddingAt = urlsInOrder().lastIndexOf(
      urlsInOrder().filter((url) => url.includes("foundation_retrieval_embeddings")).slice(-1)[0],
    );
    expect(calls.indexOf(patches[0])).toBeGreaterThan(lastEmbeddingAt);
  });

  it("computes FTS search_tokens at write time so the lexical index is not empty", async () => {
    await compileRetrievalArtifacts(baseInput());
    const unitInsert = calls.find(
      (call) => call.url.includes("foundation_retrieval_units") && call.method === "POST",
    );
    expect(unitInsert).toBeDefined();
    const rows = unitInsert?.body as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Array.isArray(row.search_tokens)).toBe(true);
      expect((row.search_tokens as string[]).length).toBeGreaterThan(0);
      expect(row.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it("still produces a usable lexical-only index when no embedder is configured", async () => {
    const result = await compileRetrievalArtifacts({ ...baseInput(), embedder: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitCount).toBeGreaterThan(0);
    expect(result.embeddingCount).toBe(0);
    expect(result.degradations.join(" ")).toContain("no embedder configured");
    expect(calls.some((call) => call.url.includes("foundation_retrieval_embeddings"))).toBe(false);
  });

  it("fails the run on an embedding provider outage rather than completing a half-built index", async () => {
    const result = await compileRetrievalArtifacts({ ...baseInput(), embedder: stubEmbedder({ fail: true }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED");

    // The run must be explicitly marked failed, not left dangling.
    const patch = calls.find((call) => call.method === "PATCH")?.body as Record<string, unknown>;
    expect(patch.status).toBe("failed");
    expect(String(patch.error_reason)).toContain("unreachable");
  });

  it("distinguishes an incompatible embedding space from a provider outage", async () => {
    const result = await compileRetrievalArtifacts({ ...baseInput(), embedder: stubEmbedder({ dimension: 8 }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A 8D vector against a 1024D profile is an integrity failure, not an availability one.
    expect(result.code).toBe("RETRIEVAL_COMPILE_EMBEDDING_INCOMPATIBLE");
    expect(calls.some((call) => call.url.includes("foundation_retrieval_embeddings"))).toBe(false);
  });

  it("does not open a run when the artifact yields no units", async () => {
    const empty = buildArtifact();
    (empty.package.files as Array<{ path: string; content: string }>)[0].content = "";
    const result = await compileRetrievalArtifacts({ ...baseInput(), artifact: empty });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RETRIEVAL_COMPILE_NO_UNITS");
    expect(calls.some((call) => call.url.includes("foundation_retrieval_compile_runs"))).toBe(false);
  });

  it("surfaces a rejected run (e.g. the 0021 superseded-world trigger) instead of writing units anyway", async () => {
    failOn = "foundation_retrieval_compile_runs";
    const result = await compileRetrievalArtifacts(baseInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RETRIEVAL_COMPILE_RUN_REJECTED");
    expect(calls.some((call) => call.url.includes("foundation_retrieval_units"))).toBe(false);
  });
});
