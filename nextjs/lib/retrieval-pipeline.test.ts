import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRetrievalPipeline } from "./retrieval-pipeline";
import { buildBgeM3BaselineProfile } from "./retrieval-profile";
import type { EmbedderAdapter } from "./embedder-adapter";
import type { RerankerAdapter } from "./reranker-adapter";

// Drives the REAL orchestrator (retrieval-pipeline.ts) end to end. Every stage below is
// production code -- expandedTokens, reciprocalRankFusion, rankByStructuralOverlap,
// rerankWithFallback, applyWorldGate, buildContextPacket -- and the only thing replaced is
// the network boundary: `fetch`, which retrieval-store.ts uses to reach PostgREST.
//
// That boundary is where the honest line sits. There is no local Postgres/Docker here, so
// this cannot prove the 0023 RPC bodies execute correctly against real rows -- that is what
// supabase/tests/foundation_retrieval_search_rpc.sql is for, run under `supabase db test`.
// What this DOES prove is the part that had no coverage at all before: that the stages
// compose, in the right order, with the right data flowing between them, and that the
// pipeline degrades and fails closed where it claims to.
//
// The fetch stub asserts on the actual request URLs and bodies, so a change that silently
// stopped calling the dense RPC, or dropped the workspace scope from a query, fails here.

const WORKSPACE = "pilot-acme01";
const COLLECTION = "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RUN_ID = "retrieval-run-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MANIFEST = `sha256:${"1".repeat(64)}`;
const WORLD_STATE = "ws_candidate_pipeline";

const PROFILE = buildBgeM3BaselineProfile(WORKSPACE, "rev-embed-fixture", "rev-rerank-fixture");

type StoredUnit = {
  unit_id: string;
  unit_type: string;
  document_id: string;
  document_version_key: string;
  text: string;
  page_number1: number | null;
  bbox1000: number[] | null;
  claim_ids: string[];
  entity_ids: string[];
  evidence_ids: string[];
  authority: string | null;
};

function unit(overrides: Partial<StoredUnit> & { unit_id: string }): StoredUnit {
  return {
    unit_type: "section",
    document_id: "doc-1",
    document_version_key: "c".repeat(64),
    text: `text for ${overrides.unit_id}`,
    page_number1: 1,
    bbox1000: [10, 20, 30, 40],
    claim_ids: [],
    entity_ids: [],
    evidence_ids: [`evidence-${overrides.unit_id}`],
    authority: "official_policy",
    ...overrides,
  };
}

const UNITS: StoredUnit[] = [
  unit({ unit_id: "retrieval-unit-1", text: "계약 해지 통보 기간은 30일입니다.", claim_ids: ["claim-term"], entity_ids: ["entity-acme"] }),
  unit({ unit_id: "retrieval-unit-2", text: "The notice period is 45 days.", claim_ids: ["claim-term"], entity_ids: ["entity-acme"] }),
  unit({ unit_id: "retrieval-unit-3", text: "Unrelated appendix content.", claim_ids: [], entity_ids: [] }),
];

// What each stubbed source returns, mutable per test.
type Scenario = {
  runRows: unknown[];
  lexicalIds: string[];
  denseIds: string[];
  units: StoredUnit[];
  failLexicalRpc: boolean;
};

let scenario: Scenario;
let requests: Array<{ url: string; body: unknown }>;

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as unknown as Response;
}

beforeEach(() => {
  scenario = {
    runRows: [
      {
        run_id: RUN_ID,
        workspace_key: WORKSPACE,
        collection_id: COLLECTION,
        world_manifest_digest: MANIFEST,
        retrieval_profile_id: PROFILE.id,
        status: "completed",
        unit_count: UNITS.length,
        embedding_count: UNITS.length,
      },
    ],
    lexicalIds: ["retrieval-unit-1", "retrieval-unit-3"],
    denseIds: ["retrieval-unit-2", "retrieval-unit-1"],
    units: UNITS,
    failLexicalRpc: false,
  };
  requests = [];

  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_".padEnd(48, "x"));

  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: href, body });

    if (href.includes("/rpc/search_foundation_retrieval_units_lexical")) {
      if (scenario.failLexicalRpc) return jsonResponse({ message: "boom" }, false);
      return jsonResponse(scenario.lexicalIds.map((id) => ({ unit_id: id, rank: 1 })));
    }
    if (href.includes("/rpc/search_foundation_retrieval_units_dense")) {
      return jsonResponse(scenario.denseIds.map((id) => ({ unit_id: id, distance: 0.1 })));
    }
    if (href.includes("/foundation_retrieval_compile_runs")) {
      return jsonResponse(scenario.runRows);
    }
    if (href.includes("/foundation_retrieval_units")) {
      // Honour the `unit_id=in.(...)` filter the way PostgREST would, so a test cannot pass
      // by accident when the pipeline requests the wrong ids.
      const match = /unit_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(href));
      if (match) {
        const wanted = new Set(match[1].split(",").filter(Boolean));
        return jsonResponse(scenario.units.filter((row) => wanted.has(row.unit_id)));
      }
      return jsonResponse(scenario.units);
    }
    throw new Error(`unexpected fetch to ${href}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubEmbedder(dimension = PROFILE.embedding.dimension): EmbedderAdapter {
  return {
    identity: () => ({
      provider: PROFILE.embedding.provider,
      model: PROFILE.embedding.model,
      revision: PROFILE.embedding.revision,
      dimension: PROFILE.embedding.dimension,
      normalize: PROFILE.embedding.normalize,
    }),
    embedQuery: async () => ({
      status: "ok" as const,
      vectors: [new Array(dimension).fill(0.01)],
      receipt: {
        provider: "fixture", model: "fixture", revision: "fixture",
        dimension, normalize: true, inputDigest: "sha256:x", outputDigest: "sha256:y",
        durationMs: 1, timedOut: false,
      },
    }),
    embedDocuments: async () => ({
      status: "error" as const,
      reason: "not used in this test",
      receipt: {
        provider: "fixture", model: "fixture", revision: "fixture",
        dimension, normalize: true, inputDigest: "sha256:x", outputDigest: null,
        durationMs: 1, timedOut: false,
      },
    }),
  };
}

function stubReranker(behaviour: "ok" | "error"): RerankerAdapter {
  return {
    identity: () => ({ provider: "fixture", model: "fixture", revision: "fixture" }),
    rerank: async (_query, candidates) =>
      behaviour === "error"
        ? {
            status: "error" as const,
            reason: "provider unreachable",
            receipt: {
              provider: "fixture", model: "fixture", revision: "fixture",
              candidateCount: candidates.length,
              inputDigest: "sha256:x", outputDigest: null, durationMs: 1, timedOut: false,
            },
          }
        : {
            status: "ok" as const,
            // Deliberately REVERSES the fused order, so a test asserting reranked output
            // cannot pass if the pipeline silently ignored the reranker.
            ranked: candidates.map((candidate, index) => ({ id: candidate.id, score: index })),
            receipt: {
              provider: "fixture", model: "fixture", revision: "fixture",
              candidateCount: candidates.length,
              inputDigest: "sha256:x", outputDigest: "sha256:y", durationMs: 1, timedOut: false,
            },
          },
  };
}

const baseInput = () => ({
  workspaceKey: WORKSPACE,
  collectionId: COLLECTION,
  worldManifestDigest: MANIFEST,
  worldStateId: WORLD_STATE,
  question: "계약 해지 통보 기간은 얼마입니까?",
  profile: PROFILE,
  embedder: stubEmbedder(),
  reranker: stubReranker("ok"),
});

describe("retrieval pipeline orchestration", () => {
  it("runs all three sources, fuses them, and returns a ContextPacket", async () => {
    const result = await runRetrievalPipeline(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.packet.retrievalProfile).toBe(PROFILE.id);
    expect(result.packet.worldVersion).toBe(WORLD_STATE);
    expect(result.packet.items.length).toBeGreaterThan(0);

    // Every source actually ran and contributed.
    expect(result.diagnostics.lexicalCandidateCount).toBe(2);
    expect(result.diagnostics.denseCandidateCount).toBe(2);
    expect(result.diagnostics.fusedCandidateCount).toBeGreaterThan(0);

    // Both RPCs were really called, with tenant scope bound.
    const rpcCalls = requests.filter((request) => request.url.includes("/rpc/"));
    expect(rpcCalls.some((call) => call.url.includes("lexical"))).toBe(true);
    expect(rpcCalls.some((call) => call.url.includes("dense"))).toBe(true);
    for (const call of rpcCalls) {
      expect((call.body as Record<string, unknown>).p_workspace_key).toBe(WORKSPACE);
      expect((call.body as Record<string, unknown>).p_compile_run_id).toBe(RUN_ID);
    }
  });

  it("carries per-source ranks into the packet so a developer can see why a unit was chosen", async () => {
    const result = await runRetrievalPipeline(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // unit-1 was returned by BOTH lexical (rank 1) and dense (rank 2), so both ranks must be
    // present -- that is the audit's §39 retrieval-debug requirement, not decoration.
    const first = result.packet.items.find((item) => item.unitId === "retrieval-unit-1");
    expect(first).toBeDefined();
    expect(first?.retrieval.lexicalRank).toBe(1);
    expect(first?.retrieval.denseRank).toBe(2);
    expect(first?.retrieval.rerankerScore).not.toBeNull();
  });

  it("binds every packet item to real evidence and page/bbox provenance", async () => {
    const result = await runRetrievalPipeline(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const item of result.packet.items) {
      expect(item.evidenceIds.length).toBeGreaterThan(0);
      expect(item.sourceVersionId).toHaveLength(64);
      expect(item.pageNumber1).toBe(1);
      expect(item.bbox1000).toEqual([10, 20, 30, 40]);
    }
  });

  it("degrades to lexical+structure when no embedder is configured, and says so", async () => {
    const result = await runRetrievalPipeline({ ...baseInput(), embedder: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.denseCandidateCount).toBe(0);
    expect(result.diagnostics.degradations.join(" ")).toContain("dense retrieval skipped");
    // Degradation must NOT empty the answer: lexical still produced items.
    expect(result.packet.items.length).toBeGreaterThan(0);
    expect(requests.some((request) => request.url.includes("/rpc/search_foundation_retrieval_units_dense"))).toBe(false);
  });

  it("degrades to the fused order when the reranker provider fails, without failing the request", async () => {
    const result = await runRetrievalPipeline({ ...baseInput(), reranker: stubReranker("error") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.rerankerApplied).toBe(false);
    expect(result.diagnostics.degradations.join(" ")).toContain("provider unreachable");
    expect(result.packet.items.length).toBeGreaterThan(0);
  });

  it("refuses a query embedding from the wrong embedding space instead of querying pgvector with it", async () => {
    // The compatibility guard must hold even if an adapter's declared identity looked fine:
    // a 8D vector against a 1024D profile is not comparable and must never reach a distance.
    const result = await runRetrievalPipeline({ ...baseInput(), embedder: stubEmbedder(8) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.degradations.join(" ")).toContain("1024D");
    expect(requests.some((request) => request.url.includes("/rpc/search_foundation_retrieval_units_dense"))).toBe(false);
  });

  it("fails closed when no completed compile run exists for the active world", async () => {
    scenario.runRows = [];
    const result = await runRetrievalPipeline(baseInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RETRIEVAL_RUN_NOT_FOUND");
  });

  it("fails closed when the database cannot be read at all, rather than answering from nothing", async () => {
    scenario.failLexicalRpc = true;
    const result = await runRetrievalPipeline(baseInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RETRIEVAL_STORE_READ_FAILED");
  });

  it("abstains explicitly when no source returns a candidate, rather than implying no such fact exists", async () => {
    scenario.lexicalIds = [];
    scenario.denseIds = [];
    const result = await runRetrievalPipeline(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.items).toHaveLength(0);
    expect(result.packet.abstentionReasons.length).toBeGreaterThan(0);
  });

  it("rejects a unit with no bound evidence at the World Gate instead of letting it into context", async () => {
    scenario.units = [
      unit({ unit_id: "retrieval-unit-1", evidence_ids: [] }),
      unit({ unit_id: "retrieval-unit-3" }),
    ];
    scenario.lexicalIds = ["retrieval-unit-1", "retrieval-unit-3"];
    scenario.denseIds = [];
    const result = await runRetrievalPipeline(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diagnostics.gateRejections).toContainEqual({
      unitId: "retrieval-unit-1",
      reason: "NO_EVIDENCE_BOUND",
    });
    expect(result.packet.items.map((item) => item.unitId)).not.toContain("retrieval-unit-1");
  });

  it("rejects an invalid question before touching the database", async () => {
    const result = await runRetrievalPipeline({ ...baseInput(), question: "  a  " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RETRIEVAL_QUESTION_INVALID");
    expect(requests).toHaveLength(0);
  });

  it("never asks for more context items than the caller allowed", async () => {
    const result = await runRetrievalPipeline({ ...baseInput(), contextLimit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.items.length).toBeLessThanOrEqual(1);
  });
});
