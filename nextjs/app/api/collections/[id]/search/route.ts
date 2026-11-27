import { NextResponse } from "next/server";
import {
  bindConsumerContext,
  releaseConsumerContext,
  resolveBoundSnapshot,
  snapshotOf,
} from "@/lib/consumer-context-api";
import { authorizeFoundationRequest, revalidateFoundationAuthorization } from "@/lib/developer-auth";
import { spendTrialSessionQuery } from "@/lib/trial-ai-access";
import { meterKnowledgeQuery, type KquMeter } from "@/lib/kqu-meter";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { memberCollectionScopeRefusal } from "@/lib/member-source-scope";
import {
  decideMemberProjection, memberProjectionMode, projectionShadowFields, recordProjectionShadow,
} from "@/lib/member-projection";
import { runRetrievalPipeline } from "@/lib/retrieval-pipeline";
import { DERIVED_DATA_REFUSED } from "@/lib/derived-data-admission";
import {
  resolveConfiguredProductionRetrievalRuntime,
} from "@/lib/retrieval-runtime-config";
import { readRetrievalIndexState, retrievalIndexNotice } from "@/lib/retrieval-index-status";
import { getFoundationActiveWorld, getWorldFreshness, listFoundationWorldVersions } from "@/lib/world-store";
import { parseTemporal, resolveWorldAtKnownAt, temporalBlock } from "@/lib/world-activation-history";
import {
  attemptedRetrievalModelRoles,
  attemptedRetrievalModelRolesOnFailure,
  buildPublicRetrievalRoute,
  persistRetrievalModelAttempt,
} from "@/lib/model-attempt-receipt";

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
/*
 * The same bound as /ask and /api/mcp (WO-CAT-8): a search holds a knowledge query unit from admission
 * to settlement, and the hold stops reserving after five minutes (20261117150000). The database also
 * refuses to count a hold that expired (20261117160000), so this is the platform half, not the proof.
 */
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

// Read failures that mean "this tenant has no queryable index yet" are a 409 (a state the
// caller can fix by compiling), not a 500 (our fault) and not a 404 (the collection exists).
const CONFLICT_CODES = new Set(["RETRIEVAL_RUN_NOT_FOUND", "RETRIEVAL_PROFILE_NOT_FOUND"]);

/** One answered search is one knowledge query unit (lib/kqu-meter.ts); a refusal or failure is none. */
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return meterKnowledgeQuery((meter) => search(request, context, meter));
}

async function search(request: Request, context: { params: Promise<{ id: string }> }, meter: KquMeter) {
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
  // A consumer context is bound to the principal just verified, before anything is read.
  const binding = bindConsumerContext(request.headers, auth.principal, { scope: "ask:read", collectionId: id });
  if (!binding.ok) return NextResponse.json({ code: binding.code }, { status: binding.status, headers: NO_STORE });
  const bound = binding.bound ? binding : null;

  let body: { query?: unknown; limit?: unknown; known_at?: unknown; valid_at?: unknown; as_of?: unknown };
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
  // Typed time (D18-2) is parsed and resolved, and a historical index checked, before a trial
  // unit is spent: a refused time is never a metered query.
  const temporal = parseTemporal(body);
  if (!temporal.ok) return NextResponse.json({ code: temporal.code }, { status: temporal.status, headers: NO_STORE });
  let activeAtAdmission: Awaited<ReturnType<typeof getFoundationActiveWorld>> | null = null;
  let historical: { manifestDigest: string; worldStateId: string } | null = null;
  let temporalMeta: ReturnType<typeof temporalBlock> | null = null;
  if (temporal.knownAt !== null) {
    // A bound context names its exact World already; a second clock would contradict it.
    if (bound) return NextResponse.json({ code: "KNOWN_AT_WITH_CONTEXT" }, { status: 400, headers: NO_STORE });
    const resolved = await resolveWorldAtKnownAt(auth.principal.workspaceKey, id, temporal.knownAt);
    if (!resolved.ok) return NextResponse.json({ code: resolved.code }, { status: resolved.status, headers: NO_STORE });
    // One read of the active World, kept: whichever World is served is the one resolved for T,
    // never "whatever is active by the time retrieval starts".
    activeAtAdmission = await getFoundationActiveWorld(auth.principal.workspaceKey, id);
    if (!activeAtAdmission.ok) {
      return NextResponse.json(
        { code: activeAtAdmission.code },
        { status: activeAtAdmission.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503, headers: NO_STORE },
      );
    }
    const current = activeAtAdmission.world.manifestDigest === resolved.manifestDigest;
    if (!current) {
      const unavailable = () => NextResponse.json({ code: "HISTORICAL_INDEX_UNAVAILABLE" }, { status: 409, headers: NO_STORE });
      const versions = await listFoundationWorldVersions(auth.principal.workspaceKey, id);
      if (!versions.ok) return NextResponse.json({ code: versions.code }, { status: 503, headers: NO_STORE });
      const version = versions.versions.find((row) => row.manifest_digest === resolved.manifestDigest);
      if (!version) return unavailable();
      const indexState = await readRetrievalIndexState({
        workspaceKey: auth.principal.workspaceKey, collectionId: id, worldManifestDigest: resolved.manifestDigest,
      });
      if (indexState.status !== "compiled") return unavailable();
      // The pipeline re-checks source access and derived-data admission on the hydrated units
      // against today's state, so a source denied since T refuses the search rather than leaking.
      historical = { manifestDigest: resolved.manifestDigest, worldStateId: version.world_state_id };
    }
    temporalMeta = temporalBlock(temporal.knownAt, resolved, current);
  }
  const metered = await spendTrialSessionQuery(auth.principal);
  if (!metered.ok) return NextResponse.json({ code: metered.code }, { status: metered.status, headers: NO_STORE });

  // A bound context resolves its exact World here, before retrieval; legacy reads the active World
  // as before. Either way retrieval runs against this one row.
  const resolution = bound ? await resolveBoundSnapshot(bound, auth.principal.workspaceKey) : null;
  if (resolution && !resolution.ok) {
    return NextResponse.json({ code: resolution.code }, { status: resolution.status, headers: NO_STORE });
  }
  const active = resolution
    ? { ok: true as const, world: resolution.world }
    : activeAtAdmission ?? await getFoundationActiveWorld(auth.principal.workspaceKey, id);
  if (!active.ok) {
    return NextResponse.json(
      { code: active.code },
      { status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503, headers: NO_STORE },
    );
  }

  // A missing GPU runtime is a degradation, not a failure: the pipeline falls back to
  // lexical + structure and reports it in `degradations`, so the caller can tell a
  // full-pipeline result from a degraded one instead of silently receiving weaker retrieval.
  // The allowance, before the index read and retrieval.
  const served = historical ?? active.world;
  // A member searches a World only when every source behind the served version is in their scope.
  // WO-PROJ-K2, flag off: exactly that, nothing else read. Shadow: the projection is decided too
  // and compared, counts only, while this gate still decides. Enforce: a member with part of the
  // World in scope is served the projection, filtered inside the pipeline before ranking.
  const projectionMode = memberProjectionMode();
  const decision = projectionMode === "off" ? null : await decideMemberProjection(auth.principal, id, served.manifestDigest);
  const projection = projectionMode === "enforce" && decision?.kind === "partial" ? decision : null;
  if (!projection) {
    const scopeRefusal = await memberCollectionScopeRefusal(auth.principal, id, served.manifestDigest);
    if (decision) recordProjectionShadow(projectionShadowFields("search", scopeRefusal !== null, decision));
    if (scopeRefusal) return NextResponse.json({ code: scopeRefusal.code }, { status: scopeRefusal.status, headers: NO_STORE });
  }
  const admitted = await meter.admit(auth.principal);
  if (!admitted.ok) return NextResponse.json({ code: admitted.code }, { status: admitted.status, headers: NO_STORE });
  const indexStateAtAdmission = await readRetrievalIndexState({
    workspaceKey: auth.principal.workspaceKey,
    collectionId: id,
    worldManifestDigest: served.manifestDigest,
  });
  const runtimeResolution = await resolveConfiguredProductionRetrievalRuntime({
    workspaceKey: auth.principal.workspaceKey, collectionId: id,
    endpoint: "search", query, indexStatus: indexStateAtAdmission.status,
  });
  if (!runtimeResolution.ok) {
    return NextResponse.json({ code: "RETRIEVAL_RUNTIME_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
  const runtime = runtimeResolution.runtime;

  const result = await runRetrievalPipeline({
    workspaceKey: auth.principal.workspaceKey,
    collectionId: id,
    worldManifestDigest: served.manifestDigest,
    worldStateId: served.worldStateId,
    question: query,
    profile: runtime.profile,
    routerDecision: runtime.routerDecision,
    modelAttempt: runtime.controlPlaneLineage ? {
      endpoint: "search",
      modelRoute: runtime.decision,
      controlPlaneLineage: runtime.controlPlaneLineage,
    } : null,
    embedder: runtime.embedder,
    reranker: runtime.reranker,
    contextLimit: requestedLimit,
    ...(projection ? { projection } : {}),
  });

  if (!result.ok) {
    const attemptedRoles = attemptedRetrievalModelRolesOnFailure(runtime, result.code);
    const persisted = await persistRetrievalModelAttempt({
      endpoint: "search", workspaceKey: auth.principal.workspaceKey, collectionId: id,
      worldManifestDigest: served.manifestDigest, query,
      modelRoute: runtime.decision, attemptedRoles, degradations: [],
      execution: { outcome: "failed", failureClass: "downstream_failure" },
    });
    if (!persisted.ok) {
      return NextResponse.json({ code: persisted.code }, { status: 503, headers: NO_STORE });
    }
    /*
      A 409 here has exactly one cause worth explaining -- there is no compiled index for this
      active world -- and until now the response was the bare code. Search has no fallback, so
      this is the whole answer the caller gets, and it has to carry what to do about it: which
      state the index is in, and why it is in that state (audit R4-01, Q02).
    */
    const conflict = CONFLICT_CODES.has(result.code);
    const indexState = conflict ? indexStateAtAdmission : null;
    const authorizedNow = await revalidateFoundationAuthorization(
      request, auth.principal, "ask:read", "observer",
    );
    if (!authorizedNow.ok) {
      return NextResponse.json(
        { code: authorizedNow.code },
        { status: authorizedNow.status, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        code: result.code,
        ...(indexState
          ? {
              retrievalPath: "compiled-retrieval-v1",
              retrievalIndex: indexState,
              retrievalNotice: retrievalIndexNotice(indexState),
            }
          : {}),
      },
      { status: conflict ? 409 : result.code === "RETRIEVAL_QUESTION_INVALID" ? 400
        : result.code === DERIVED_DATA_REFUSED ? 403 : 503, headers: NO_STORE },
    );
  }

  const attemptedRoles = attemptedRetrievalModelRoles(runtime, result.diagnostics);
  const persisted = await persistRetrievalModelAttempt({
    endpoint: "search",
    workspaceKey: auth.principal.workspaceKey,
    collectionId: id,
    worldManifestDigest: served.manifestDigest,
    query,
    modelRoute: runtime.decision,
    attemptedRoles,
    degradations: result.diagnostics.degradations,
  });
  if (!persisted.ok) {
    return NextResponse.json({ code: persisted.code }, { status: 503, headers: NO_STORE });
  }
  const publicRoute = buildPublicRetrievalRoute(attemptedRoles, result.diagnostics.degradations);

  const freshness = await getWorldFreshness(auth.principal.workspaceKey, id);
  const activeWorld = {
    manifestDigest: active.world.manifestDigest,
    revision: active.world.revision,
    worldStateId: active.world.worldStateId,
  };
  const payload = {
    code: result.packet.items.length > 0 ? "SEARCH_RESULTS" : "SEARCH_EMPTY",
    /*
      Search only ever runs the compiled pipeline -- there is no excerpt fallback here, which
      is why a missing index is a 409 rather than a weaker answer. The field is stated anyway,
      so /search and /ask can be read side by side without inferring which runtime answered
      from which endpoint you happened to call (audit Q02, M06).
    */
    retrievalPath: "compiled-retrieval-v1",
    // What did not run. A missing embedder degrades this to lexical + structure, and a
    // reranker outage degrades it to the fused order; both are named rather than silent.
    degradations: publicRoute.degradationClasses,
    activeWorld,
    freshness,
    ...(temporalMeta ? { temporal: temporalMeta } : {}),
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
      routeClass: publicRoute.routeClass,
      degradations: publicRoute.degradationClasses,
    },
  };

  if (!bound || !resolution) {
    // Retrieval and freshness can both cross process or provider boundaries. Re-resolve the
    // session/API key, workspace membership and product access after those awaits so a revocation
    // that lands while search is running cannot receive the completed evidence packet.
    const authorizedNow = await revalidateFoundationAuthorization(
      request, auth.principal, "ask:read", "observer",
    );
    if (!authorizedNow.ok) {
      return NextResponse.json(
        { code: authorizedNow.code },
        { status: authorizedNow.status, headers: NO_STORE },
      );
    }
    return NextResponse.json(payload, { headers: NO_STORE });
  }

  // Bound: the same late authorization, plus source admission and a last read of the active
  // World, all inside the release -- acknowledged with the pair the packet was retrieved from.
  const released = await releaseConsumerContext({
    request, principal: auth.principal, scope: "ask:read", bound, snapshot: resolution,
    served: snapshotOf(activeWorld),
  });
  if (!released.ok) return NextResponse.json({ code: released.code }, { status: released.status, headers: NO_STORE });
  return NextResponse.json(payload, { headers: { ...released.headers } });
}
