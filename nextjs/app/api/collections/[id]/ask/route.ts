import { NextResponse } from "next/server";
import { authorizeFoundationRequest, revalidateFoundationAuthorization } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
import { recordServerFunnel } from "@/lib/funnel-events";
import { validatePromotableCollectionArtifact } from "@/lib/collection-download";
import { answerFromContextPacket, answerGroundedQuestion } from "@/lib/grounded-ask";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { getWorkspaceCollectionCandidate } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { readRetrievalIndexState, retrievalIndexNotice } from "@/lib/retrieval-index-status";
import { runRetrievalPipeline } from "@/lib/retrieval-pipeline";
import {
  buildProductionRetrievalProfile,
  createProductionEmbedderAdapter,
  createProductionRerankerAdapter,
  readRetrievalRuntimeEnv,
} from "@/lib/retrieval-runtime-config";
import { getFoundationActiveWorld, getWorldFreshness, type ActiveWorld } from "@/lib/world-store";
import { WORKSPACE_ASK_CONCURRENCY } from "@/lib/workspace-cost-guard";
import { acquireWorkspaceOperation } from "@/lib/workspace-operation-guard";
import { loadActiveWorldSourceIds } from "@/lib/active-world-source-access";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";

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

/*
 * One answer shape, both paths (audit R4-02).
 *
 * The compiled branch used to return a packet, diagnostics and the code GROUNDED_ANSWER with no
 * `answer` field at all -- only the fallback produced prose. That was survivable only because
 * the compiled branch was unreachable; wiring it (R4-01) without this would have shipped a
 * "successful" answer with no answer in it.
 *
 * `answerMode` is on both paths and has one value today. Ask is retriever-only: the answer is
 * the cited excerpts, and no model writes a word of it. The field exists so the day that
 * changes, a consumer can tell the difference from the response instead of from a changelog.
 */
const ANSWER_MODE = "evidence_excerpts";

type Answered = { status: number; body: Record<string, unknown> };

/**
 * The answer itself, as a value rather than as a Response.
 *
 * Split out so the cost guard in `POST` can wrap it: a slot has to be released on every exit
 * path including the thrown one, and a completed answer has to be remembered for the retry that
 * carries the same idempotency key. Neither is possible while every branch returns from the
 * handler directly. The branches, their codes and their statuses are unchanged.
 */
async function answerQuestion(workspaceKey: string, id: string, question: string, active: { world: ActiveWorld }): Promise<Answered> {

  const activeWorld = {
    manifestDigest: active.world.manifestDigest,
    revision: active.world.revision,
    worldStateId: active.world.worldStateId,
  };
  // Four clocks, and whether a newer version is waiting for a person (audit TM04). Read once
  // here so both paths carry the identical block.
  const freshness = await getWorldFreshness(workspaceKey, id);

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
    const answer = answerFromContextPacket(pipeline.packet, {
      collectionId: id,
      manifestDigest: active.world.manifestDigest,
    });
    return {
      status: 200,
      body: {
        // The code follows the ANSWER, not the packet's item count: a packet whose every item
        // lost its evidence binding is an abstention, and calling it GROUNDED_ANSWER because
        // units came back would be the exact claim the World Gate exists to prevent.
        code: answer.status === "grounded" ? "GROUNDED_ANSWER" : "ANSWER_ABSTAINED",
        retrievalPath: "compiled-retrieval-v1",
        answerMode: ANSWER_MODE,
        activeWorld,
        freshness,
        ...answer,
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
  //
  // Why the index is not there is part of the answer (audit R4-01). A world promoted before the
  // compile step existed, a compile that failed on an unreachable embedder and a run still in
  // flight are three different operator problems, and "no compiled retrieval index exists yet"
  // described all three identically. The run table already knows which one it is.
  const indexState = await readRetrievalIndexState({
    workspaceKey,
    collectionId: id,
    worldManifestDigest: active.world.manifestDigest,
  });
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
      // one; `retrievalNotice` says why this path was taken and `retrievalIndex` says which
      // state it is in, so a failed compile is visible rather than looking like a world that
      // was simply never indexed.
      retrievalPath: "excerpt-concatenation-fallback",
      retrievalNotice: retrievalIndexNotice(indexState),
      retrievalIndex: indexState,
      answerMode: ANSWER_MODE,
      activeWorld,
      freshness,
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
  const body = parsed.value as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question : "";
  if (
    question.normalize("NFKC").replace(/\s+/g, " ").trim().length < 3 ||
    question.length > 500
  ) {
    return NextResponse.json(
      { code: "QUESTION_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }

  // Resolve the current World before consulting a cache. A previous user's answer or a
  // superseded World must never be returned merely because the HTTP key was reused.
  const workspaceKey = auth.principal.workspaceKey;
  const idempotencyKey = request.headers.get("idempotency-key");
  const requestDigest = `${id}\n${question}`;
  const active = await getFoundationActiveWorld(workspaceKey, id);
  if (!active.ok) return NextResponse.json({ code: active.code }, {
    status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503, headers: NO_STORE,
  });
  const identity = JSON.stringify([auth.principal.kind, auth.principal.userId,
    auth.principal.keyId ?? null, [...auth.principal.scopes].sort(), id,
    active.world.manifestDigest, active.world.worldStateId, active.world.revision]);
  const lease = await acquireWorkspaceOperation("ask", workspaceKey, {
    key: idempotencyKey, identity, body: requestDigest,
  });
  if (!lease.ok) {
    return NextResponse.json(
      { code: lease.code, ...(lease.code === "WORKSPACE_CONCURRENCY_LIMIT"
        ? { concurrencyLimit: WORKSPACE_ASK_CONCURRENCY } : {}) },
      { status: lease.status, headers: { ...NO_STORE, "Retry-After": "5" } },
    );
  }
  let answered: Answered;
  let documentIds: string[];
  try {
    const sources = await loadActiveWorldSourceIds(workspaceKey, id, active.world);
    if (!sources.ok) return NextResponse.json({ code: sources.code }, { status: 503, headers: NO_STORE });
    documentIds = sources.documentIds;
    const sourceAccess = await checkConnectorSourceAccess(workspaceKey, documentIds);
    if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
      status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503, headers: NO_STORE,
    });
    answered = lease.replay ? lease.value : await answerQuestion(workspaceKey, id, question, active);
    if (answered.status === 200) {
      const authorizedNow = await revalidateFoundationAuthorization(request, auth.principal, "ask:read", "observer");
      if (!authorizedNow.ok) return NextResponse.json({ code: authorizedNow.code }, {
        status: authorizedNow.status, headers: NO_STORE,
      });
      const current = await getFoundationActiveWorld(workspaceKey, id);
      if (!current.ok) return NextResponse.json({ code: current.code }, { status: 503, headers: NO_STORE });
      if (current.world.manifestDigest !== active.world.manifestDigest
          || current.world.worldStateId !== active.world.worldStateId
          || current.world.revision !== active.world.revision) {
        return NextResponse.json({ code: "ACTIVE_WORLD_CHANGED_RETRY" }, { status: 409, headers: NO_STORE });
      }
    }
    // Only a completed answer is remembered. Replaying a 503 would turn a transient outage into
    // a ten-minute one for every client that retried politely with the same key.
    if (answered.status === 200 && !lease.replay) {
      const sourceAccess = await checkConnectorSourceAccess(workspaceKey, documentIds);
      if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
        status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503, headers: NO_STORE,
      });
      await lease.complete(answered);
    }
  } finally {
    if (!lease.replay) await lease.release();
  }
  // Cache completion and lease cleanup can await the database. Recheck after both,
  // including for old cached answers, before constructing a response containing knowledge.
  if (answered.status === 200) {
    const sourceAccess = await checkConnectorSourceAccess(workspaceKey, documentIds);
    if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
      status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503, headers: NO_STORE,
    });
  }
  /*
    A2's other half: the approved World answered a question with its evidence attached.

    The condition is the answer's own code, not the 200 -- an abstention is also a 200, and
    counting it as a grounded task is the claim the World Gate exists to prevent. A replay is
    skipped because the idempotency key served an answer that was already counted, and the
    `mode` says which retrieval path produced it, so a funnel reading cannot silently mix the
    compiled pipeline with the excerpt fallback.

    An API key is not a browser. Whoever holds one is an MCP client, a script or an agent, which
    is A3's "the same result used by an external consumer" -- the only external-consumption
    signal a request carries, and it carries no consumer identity with it.
  */
  if (answered.status === 200 && !lease.replay && answered.body.code === "GROUNDED_ANSWER") {
    recordServerFunnel("grounded_task_completed", {
      kind: auth.principal.kind,
      mode: answered.body.retrievalPath === "compiled-retrieval-v1" ? "compiled" : "fallback",
    });
    if (auth.principal.kind === "api-key") {
      recordServerFunnel("external_consumer_succeeded", { from: "ask" });
    }
  }
  return NextResponse.json(answered.body, { status: answered.status, headers: lease.replay
    ? { ...NO_STORE, "X-Tavonel-Idempotent-Replay": "true" } : NO_STORE });
}
