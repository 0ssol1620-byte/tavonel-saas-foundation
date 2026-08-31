import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { validatePromotableCollectionArtifact } from "@/lib/collection-download";
import { answerGroundedQuestion } from "@/lib/grounded-ask";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { getWorkspaceCollectionCandidate } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { runRetrievalPipeline } from "@/lib/retrieval-pipeline";
import {
  buildProductionRetrievalProfile,
  createProductionEmbedderAdapter,
  createProductionRerankerAdapter,
  readRetrievalRuntimeEnv,
} from "@/lib/retrieval-runtime-config";
import { getFoundationActiveWorld } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

// /ask now prefers the compiled Retrieval Compiler pipeline (lexical + dense + structure ->
// RRF -> reranker -> World Gate -> ContextPacket) and falls back to the original
// excerpt-concatenation path in grounded-ask.ts when no compiled retrieval index exists for
// the active world.
//
// The fallback is kept deliberately, not left behind out of caution: a tenant whose world was
// promoted before any retrieval compile run -- or whose run failed -- must still be able to
// ask a question and get a real, evidence-bound answer. That path is qualified, tested, and
// cannot hallucinate a citation (it builds citations directly from evidence). What it is NOT
// is the full pipeline, so the response says which path answered rather than presenting both
// as the same thing.
//
// Only a genuinely missing index falls back. A database outage, an invalid question, or any
// other pipeline failure is returned as an error: silently answering from a weaker path when
// the real one is broken would hide exactly the failure an operator needs to see.
const FALLBACK_CODES = new Set(["RETRIEVAL_RUN_NOT_FOUND", "RETRIEVAL_PROFILE_NOT_FOUND"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 2_048) {
    return NextResponse.json(
      { code: "QUESTION_TOO_LARGE" },
      { status: 413, headers: NO_STORE }
    );
  }
  const auth = await authorizeFoundationRequest(request, "ask:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json(
      { code: "COLLECTION_ID_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }
  let body: { question?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "INVALID_JSON" },
      { status: 400, headers: NO_STORE }
    );
  }
  const question = typeof body.question === "string" ? body.question : "";
  if (
    question.normalize("NFKC").replace(/\s+/g, " ").trim().length < 3 ||
    question.length > 500
  ) {
    return NextResponse.json(
      { code: "QUESTION_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }

  const active = await getFoundationActiveWorld(auth.principal.workspaceKey, id);
  if (!active.ok) {
    return NextResponse.json(
      { code: active.code },
      {
        status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503,
        headers: NO_STORE,
      }
    );
  }

  const activeWorld = {
    manifestDigest: active.world.manifestDigest,
    revision: active.world.revision,
    worldStateId: active.world.worldStateId,
  };

  // --- Preferred path: the compiled retrieval pipeline ----------------------------------
  const runtimeEnv = readRetrievalRuntimeEnv();
  const pipeline = await runRetrievalPipeline({
    workspaceKey: auth.principal.workspaceKey,
    collectionId: id,
    worldManifestDigest: active.world.manifestDigest,
    worldStateId: active.world.worldStateId,
    question,
    profile: buildProductionRetrievalProfile(auth.principal.workspaceKey),
    embedder: runtimeEnv ? createProductionEmbedderAdapter(runtimeEnv) : null,
    reranker: runtimeEnv ? createProductionRerankerAdapter(runtimeEnv) : null,
  });

  if (pipeline.ok) {
    return NextResponse.json(
      {
        code: pipeline.packet.items.length > 0 ? "GROUNDED_ANSWER" : "ANSWER_ABSTAINED",
        retrievalPath: "compiled-retrieval-v1",
        activeWorld,
        contextPacket: pipeline.packet,
        retrieval: {
          compileRunId: pipeline.diagnostics.compileRunId,
          retrievalProfile: pipeline.diagnostics.retrievalProfileId,
          rerankerApplied: pipeline.diagnostics.rerankerApplied,
          gateRejections: pipeline.diagnostics.gateRejections,
          degradations: pipeline.diagnostics.degradations,
        },
      },
      { headers: NO_STORE }
    );
  }
  if (!FALLBACK_CODES.has(pipeline.code)) {
    return NextResponse.json(
      { code: pipeline.code },
      { status: pipeline.code === "RETRIEVAL_QUESTION_INVALID" ? 400 : 503, headers: NO_STORE }
    );
  }

  // --- Fallback: excerpt concatenation over the promoted artifact ------------------------
  const signer = readR2SignerEnv();
  if (!signer)
    return NextResponse.json(
      { code: "SIGNER_NOT_CONFIGURED" },
      { status: 503, headers: NO_STORE }
    );
  const loaded = await getWorkspaceCollectionCandidate(
    signer,
    auth.principal.workspaceKey,
    active.world.candidateObjectKey
  );
  if (!loaded.ok)
    return NextResponse.json(
      { code: loaded.code },
      { status: 503, headers: NO_STORE }
    );
  const artifact = validatePromotableCollectionArtifact(loaded.json, id);
  if (!artifact || artifact.manifestDigest !== active.world.manifestDigest) {
    return NextResponse.json(
      { code: "ACTIVE_WORLD_ARTIFACT_INVALID" },
      { status: 422, headers: NO_STORE }
    );
  }
  const answer = answerGroundedQuestion(loaded.json, question);
  if (
    !answer ||
    answer.receipt.manifestDigest !== active.world.manifestDigest
  ) {
    return NextResponse.json(
      { code: "ACTIVE_WORLD_RETRIEVAL_INVALID" },
      { status: 422, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    {
      code:
        answer.status === "grounded" ? "GROUNDED_ANSWER" : "ANSWER_ABSTAINED",
      // Named explicitly so a caller can never mistake a fallback answer for a full-pipeline
      // one; `retrievalNotice` says why this path was taken.
      retrievalPath: "excerpt-concatenation-fallback",
      retrievalNotice: "no compiled retrieval index exists for this active world yet",
      activeWorld,
      ...answer,
    },
    { headers: NO_STORE }
  );
}
