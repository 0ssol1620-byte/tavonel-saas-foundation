import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
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
import {
  WORKSPACE_ASK_CONCURRENCY,
  acquireWorkspaceSlot,
  checkIdempotency,
  rememberIdempotent,
} from "@/lib/workspace-cost-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/*
 * The cheapest request on the surface to issue, and one of the most expensive to serve: an
 * embedder, a reranker and a Core turn (blueprint §32, S-21). Until now nothing bounded it but
 * the edge's 60/min/IP, which bounds one laptop rather than one workspace.
 *
 * `maxDuration` is the platform half of the promise the concurrency slot makes: a request that
 * runs forever holds its slot until the slot's own deadline, and neither number is a limit if
 * only one of them exists.
 */
export const maxDuration = 60;

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

type Answered = { status: number; body: Record<string, unknown> };

/**
 * The answer itself, as a value rather than as a Response.
 *
 * Split out so the cost guard in `POST` can wrap it: a slot has to be released on every exit
 * path including the thrown one, and a completed answer has to be remembered for the retry that
 * carries the same idempotency key. Neither is possible while every branch returns from the
 * handler directly. The branches, their codes and their statuses are unchanged.
 */
async function answerQuestion(workspaceKey: string, id: string, question: string): Promise<Answered> {
  const active = await getFoundationActiveWorld(workspaceKey, id);
  if (!active.ok) {
    return {
      status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503,
      body: { code: active.code },
    };
  }

  const activeWorld = {
    manifestDigest: active.world.manifestDigest,
    revision: active.world.revision,
    worldStateId: active.world.worldStateId,
  };

  // --- Preferred path: the compiled retrieval pipeline ----------------------------------
  const runtimeEnv = readRetrievalRuntimeEnv();
  const pipeline = await runRetrievalPipeline({
    workspaceKey,
    collectionId: id,
    worldManifestDigest: active.world.manifestDigest,
    worldStateId: active.world.worldStateId,
    question,
    profile: buildProductionRetrievalProfile(workspaceKey),
    embedder: runtimeEnv ? createProductionEmbedderAdapter(runtimeEnv) : null,
    reranker: runtimeEnv ? createProductionRerankerAdapter(runtimeEnv) : null,
  });

  if (pipeline.ok) {
    return {
      status: 200,
      body: {
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
    };
  }
  if (!FALLBACK_CODES.has(pipeline.code)) {
    return {
      status: pipeline.code === "RETRIEVAL_QUESTION_INVALID" ? 400 : 503,
      body: { code: pipeline.code },
    };
  }

  // --- Fallback: excerpt concatenation over the promoted artifact ------------------------
  const signer = readR2SignerEnv();
  if (!signer) return { status: 503, body: { code: "SIGNER_NOT_CONFIGURED" } };
  const loaded = await getWorkspaceCollectionCandidate(signer, workspaceKey, active.world.candidateObjectKey);
  if (!loaded.ok) return { status: 503, body: { code: loaded.code } };
  const artifact = validatePromotableCollectionArtifact(loaded.json, id);
  if (!artifact || artifact.manifestDigest !== active.world.manifestDigest) {
    return { status: 422, body: { code: "ACTIVE_WORLD_ARTIFACT_INVALID" } };
  }
  const answer = answerGroundedQuestion(loaded.json, question);
  if (!answer || answer.receipt.manifestDigest !== active.world.manifestDigest) {
    return { status: 422, body: { code: "ACTIVE_WORLD_RETRIEVAL_INVALID" } };
  }
  return {
    status: 200,
    body: {
      code: answer.status === "grounded" ? "GROUNDED_ANSWER" : "ANSWER_ABSTAINED",
      // Named explicitly so a caller can never mistake a fallback answer for a full-pipeline
      // one; `retrievalNotice` says why this path was taken.
      retrievalPath: "excerpt-concatenation-fallback",
      retrievalNotice: "no compiled retrieval index exists for this active world yet",
      activeWorld,
      ...answer,
    },
  };
}

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
  const parsed = await readBoundedJson(request, 2_048);
  if (!parsed.ok) return NextResponse.json(
    { code: parsed.code === "REQUEST_TOO_LARGE" ? "QUESTION_TOO_LARGE" : "INVALID_JSON" },
    { status: parsed.status, headers: NO_STORE }
  );
  const body = parsed.value as { question?: unknown };
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

  /*
   * Idempotency before concurrency, deliberately.
   *
   * A retry storm is the common way this route gets expensive, and a replay costs no slot at
   * all. Taking the slot first would let the storm exhaust the workspace's concurrency with
   * requests that were never going to do any work.
   */
  const workspaceKey = auth.principal.workspaceKey;
  const idempotencyKey = request.headers.get("idempotency-key");
  const requestDigest = `${id}\n${question}`;
  const idempotency = checkIdempotency<Answered>("ask", workspaceKey, idempotencyKey, requestDigest);
  if (!idempotency.ok) {
    return NextResponse.json(
      { code: idempotency.code },
      { status: idempotency.code === "IDEMPOTENCY_CONFLICT" ? 409 : 400, headers: NO_STORE },
    );
  }
  if (idempotency.replay) {
    return NextResponse.json(idempotency.value.body, {
      status: idempotency.value.status,
      headers: { ...NO_STORE, "X-Tavonel-Idempotent-Replay": "true" },
    });
  }

  const lease = acquireWorkspaceSlot("ask", workspaceKey, WORKSPACE_ASK_CONCURRENCY);
  if (!lease.ok) {
    return NextResponse.json(
      { code: lease.code, concurrencyLimit: WORKSPACE_ASK_CONCURRENCY },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "5" } },
    );
  }
  try {
    const answered = await answerQuestion(workspaceKey, id, question);
    // Only a completed answer is remembered. Replaying a 503 would turn a transient outage into
    // a ten-minute one for every client that retried politely with the same key.
    if (answered.status === 200) {
      rememberIdempotent("ask", workspaceKey, idempotencyKey, requestDigest, answered);
    }
    return NextResponse.json(answered.body, { status: answered.status, headers: NO_STORE });
  } finally {
    lease.release();
  }
}
