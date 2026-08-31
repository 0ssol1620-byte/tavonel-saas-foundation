import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { runRetrievalPipeline } from "@/lib/retrieval-pipeline";
import {
  buildProductionRetrievalProfile,
  createProductionEmbedderAdapter,
  createProductionRerankerAdapter,
  readRetrievalRuntimeEnv,
} from "@/lib/retrieval-runtime-config";
import { getFoundationActiveWorld } from "@/lib/world-store";

// POST /v1/collections/{id}/search -- evidence-rich candidates, no generated prose.
//
// /search and /ask are deliberately separate (audit §22): search returns the retrieved units
// with their provenance and per-source ranks so a caller (or an agent) can decide for itself,
// while /ask returns a grounded generated answer. Collapsing them would force every consumer
// that only wants evidence to pay for generation and to parse prose to get back to the facts.
//
// This is the first product surface to run the real Retrieval Compiler pipeline
// (lexical + dense + structure -> RRF -> reranker -> World Gate -> ContextPacket) rather than
// the excerpt-concatenation fallback.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

// Read failures that mean "this tenant has no queryable index yet" are a 409 (a state the
// caller can fix by compiling), not a 500 (our fault) and not a 404 (the collection exists).
const CONFLICT_CODES = new Set(["RETRIEVAL_RUN_NOT_FOUND", "RETRIEVAL_PROFILE_NOT_FOUND"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 2_048) {
    return NextResponse.json({ code: "QUERY_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  }

  // Same scope as /ask: search is a read of the same active world through the same tenant
  // boundary, so it must not require a broader grant than asking the same question does.
  const auth = await authorizeFoundationRequest(request, "ask:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });

  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "COLLECTION_ID_INVALID" }, { status: 400, headers: NO_STORE });
  }

  let body: { query?: unknown; limit?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }

  const query = typeof body.query === "string" ? body.query : "";
  if (query.normalize("NFKC").replace(/\s+/g, " ").trim().length < 3 || query.length > 500) {
    return NextResponse.json({ code: "QUERY_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const requestedLimit = typeof body.limit === "number" ? body.limit : 10;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 25) {
    return NextResponse.json({ code: "LIMIT_INVALID" }, { status: 400, headers: NO_STORE });
  }

  const active = await getFoundationActiveWorld(auth.principal.workspaceKey, id);
  if (!active.ok) {
    return NextResponse.json(
      { code: active.code },
      { status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503, headers: NO_STORE },
    );
  }

  // A missing GPU runtime is a degradation, not a failure: the pipeline falls back to
  // lexical + structure and reports it in `degradations`, so the caller can tell a
  // full-pipeline result from a degraded one instead of silently receiving weaker retrieval.
  const runtimeEnv = readRetrievalRuntimeEnv();
  const profile = buildProductionRetrievalProfile(auth.principal.workspaceKey);

  const result = await runRetrievalPipeline({
    workspaceKey: auth.principal.workspaceKey,
    collectionId: id,
    worldManifestDigest: active.world.manifestDigest,
    worldStateId: active.world.worldStateId,
    question: query,
    profile,
    embedder: runtimeEnv ? createProductionEmbedderAdapter(runtimeEnv) : null,
    reranker: runtimeEnv ? createProductionRerankerAdapter(runtimeEnv) : null,
    contextLimit: requestedLimit,
  });

  if (!result.ok) {
    return NextResponse.json(
      { code: result.code },
      { status: CONFLICT_CODES.has(result.code) ? 409 : result.code === "RETRIEVAL_QUESTION_INVALID" ? 400 : 503, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      code: result.packet.items.length > 0 ? "SEARCH_RESULTS" : "SEARCH_EMPTY",
      activeWorld: {
        manifestDigest: active.world.manifestDigest,
        revision: active.world.revision,
        worldStateId: active.world.worldStateId,
      },
      // The packet itself is the contract every surface shares (§20). It is returned whole
      // rather than reshaped per endpoint, so /search, /ask, MCP and the CLI cannot drift
      // into four subtly different evidence formats.
      contextPacket: result.packet,
      // Retrieval telemetry (§39/§46): why these units, and what ran or did not.
      retrieval: {
        compileRunId: result.diagnostics.compileRunId,
        retrievalProfile: result.diagnostics.retrievalProfileId,
        lexicalCandidates: result.diagnostics.lexicalCandidateCount,
        denseCandidates: result.diagnostics.denseCandidateCount,
        structureCandidates: result.diagnostics.structureCandidateCount,
        fusedCandidates: result.diagnostics.fusedCandidateCount,
        rerankerApplied: result.diagnostics.rerankerApplied,
        gateRejections: result.diagnostics.gateRejections,
        degradations: result.diagnostics.degradations,
      },
    },
    { headers: NO_STORE },
  );
}
