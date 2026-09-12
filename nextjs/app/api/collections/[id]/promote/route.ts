import { NextResponse } from "next/server";
import { checkActivationRateLimit } from "@/lib/activation-rate-limit";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { validatePromotableCollectionArtifact } from "@/lib/collection-download";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";
import { assertEquivalenceGate } from "@/lib/equivalence-gate";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { recordServerFunnel } from "@/lib/funnel-events";
import {
  checkCurrentSourceVersions,
  collectionCandidateKey,
  COLLECTION_ID_PATTERN,
  DOCUMENT_ID_PATTERN,
} from "@/lib/immutable-keys";
import { getWorkspaceCollectionCandidate, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { ensureRetrievalIndexForActiveWorld } from "@/lib/retrieval-index-status";
import { promoteFoundationCandidate } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/*
 * Promotion now also compiles the World's retrieval index (audit R4-01), which embeds every
 * compiled unit, so this handler needs the same wall clock /ask has rather than the platform
 * default. The compile is idempotent per world version: a request that dies mid-compile leaves
 * either a `running` run no query can read or a `failed` one, and the retry -- or
 * POST /v1/collections/{id}/retrieval-index -- converges on a single completed run.
 *
 * ponytail: inline compile, bounded by this function's deadline. A corpus large enough to
 * outlast 60s of embedding needs the compile moved onto the compile-job worker; the recompile
 * endpoint is the recovery path until then, and the reported index state says plainly when it
 * is missing rather than letting /ask look healthy while it serves the fallback.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 2_048) {
    return NextResponse.json(
      { code: "PROMOTION_METADATA_TOO_LARGE" },
      { status: 413, headers: NO_STORE }
    );
  }
  const user = await getRequestUser(request);
  if (!user)
    return NextResponse.json(
      { code: "AUTH_REQUIRED" },
      { status: 401, headers: NO_STORE }
    );
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json(
      { code: "COLLECTION_ID_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }
  let body: {
    manifestDigest?: unknown;
    expectedCurrentManifest?: unknown;
    reason?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "INVALID_JSON" },
      { status: 400, headers: NO_STORE }
    );
  }
  const manifestDigest =
    typeof body.manifestDigest === "string" ? body.manifestDigest : "";
  const expectedCurrentManifest =
    body.expectedCurrentManifest === null
      ? null
      : typeof body.expectedCurrentManifest === "string"
        ? body.expectedCurrentManifest
        : undefined;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (
    !SHA256.test(manifestDigest) ||
    expectedCurrentManifest === undefined ||
    (expectedCurrentManifest !== null &&
      !SHA256.test(expectedCurrentManifest)) ||
    reason.length < 8 ||
    reason.length > 500
  ) {
    return NextResponse.json(
      { code: "WORLD_PROMOTION_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }

  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });
  const { membership } = access;
  const productAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "activation", membership.role);
  if (!productAccess.ok) return NextResponse.json({ code: productAccess.code }, { status: productAccess.status, headers: NO_STORE });
  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json(
      { code: "PROMOTION_ROLE_REQUIRED" },
      { status: 403, headers: NO_STORE }
    );
  }
  /*
    The self-serve ceiling (FD-02 repair). Checked after the plan and role gates and before any
    storage read, so a caller over the hour's limit spends nothing: 429 with a typed code, and a
    Retry-After the client can honour. `lib/activation-rate-limit.ts` explains why it is counted
    off the durable audit rows rather than held in memory.
  */
  const ceiling = await checkActivationRateLimit(membership.workspaceId, "world_activation");
  if (!ceiling.ok) {
    return NextResponse.json(
      { code: ceiling.code },
      {
        status: ceiling.status,
        headers: { ...NO_STORE, "Retry-After": String(ceiling.retryAfterSeconds) },
      }
    );
  }
  const signer = readR2SignerEnv();
  if (!signer)
    return NextResponse.json(
      { code: "SIGNER_NOT_CONFIGURED" },
      { status: 503, headers: NO_STORE }
    );
  const key = collectionCandidateKey(
    membership.workspaceId,
    id,
    manifestDigest.slice(7)
  );
  if (!key)
    return NextResponse.json(
      { code: "COLLECTION_KEY_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  const loaded = await getWorkspaceCollectionCandidate(
    signer,
    membership.workspaceId,
    key
  );
  if (!loaded.ok) {
    return NextResponse.json(
      { code: loaded.code },
      { status: loaded.code === "NOT_FOUND" ? 404 : 503, headers: NO_STORE }
    );
  }
  const artifact = validatePromotableCollectionArtifact(loaded.json, id);
  const stored = loaded.json as {
    manifestDigest?: unknown;
    sourceDocuments?: Array<{ documentId?: unknown; versionKey?: unknown }>;
    coreExecution?: {
      runtime?: unknown;
      worldStateId?: unknown;
      receipt?: { outputSha256?: unknown; candidatePromotion?: unknown };
    };
  };
  if (
    !artifact ||
    stored.manifestDigest !== manifestDigest ||
    stored.coreExecution?.runtime !== "tavonel-python-core-v2" ||
    typeof stored.coreExecution.worldStateId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(
      stored.coreExecution.worldStateId
    ) ||
    typeof stored.coreExecution.receipt?.outputSha256 !== "string" ||
    !SHA256.test(stored.coreExecution.receipt.outputSha256) ||
    stored.coreExecution.receipt.candidatePromotion !== false
  ) {
    return NextResponse.json(
      { code: "WORLD_CANDIDATE_NOT_PROMOTABLE" },
      { status: 422, headers: NO_STORE }
    );
  }

  /*
    The full-rebuild equivalence gate (audit TM02), on the receipt as it was stored.

    It runs before the pointer moves, because a World nobody compared is not a World to hand to
    consumers. What it adds over the candidate check above is the part nothing re-checks at
    promote time: that the receipt is *readable*. `validatePromotableCollectionArtifact` refuses
    an `equivalence: "failed"` verdict, and `dispatchProductCoreV2` refuses a receipt whose
    artifact counts do not add up -- but the object promoted here is read back out of immutable
    storage, and it may have been written by a build that predates either check. An unreadable
    verdict or an unaccounted artifact is therefore refused here rather than promoted on trust.

    `not_run` passes with its reason attached: every compile on this deployment reports it while
    TM01's revision-compile flag is off, and refusing it would refuse every promotion. It is
    never reported as equivalence.
  */
  const equivalence = assertEquivalenceGate(stored.coreExecution.receipt);
  if (!equivalence.ok) {
    return NextResponse.json(
      { code: "WORLD_EQUIVALENCE_REFUSED", equivalence: { status: equivalence.status, detail: equivalence.detail } },
      { status: 409, headers: NO_STORE }
    );
  }

  const sourceDocuments = stored.sourceDocuments;
  if (
    !Array.isArray(sourceDocuments) ||
    sourceDocuments.length === 0 ||
    sourceDocuments.some((item) =>
      typeof item?.documentId !== "string" || !DOCUMENT_ID_PATTERN.test(item.documentId) ||
      typeof item?.versionKey !== "string" || !/^[a-f0-9]{32,64}$/i.test(item.versionKey)
    )
  ) {
    return NextResponse.json(
      { code: "WORLD_CANDIDATE_SOURCE_BINDING_INVALID" },
      { status: 422, headers: NO_STORE }
    );
  }
  const currentObjects = await listImmutableWorkspaceObjects(signer, membership.workspaceId);
  if (!currentObjects.ok) {
    return NextResponse.json(
      { code: currentObjects.code },
      { status: 503, headers: NO_STORE }
    );
  }
  const currentSources = checkCurrentSourceVersions(
    membership.workspaceId,
    currentObjects.objects,
    sourceDocuments as Array<{ documentId: string; versionKey: string }>
  );
  if (!currentSources.ok) {
    return NextResponse.json(
      { code: currentSources.code, documentIds: currentSources.documentIds },
      { status: 409, headers: NO_STORE }
    );
  }
  const sourceAccess = await checkConnectorSourceAccess(
    membership.workspaceId,
    sourceDocuments.map((item) => item.documentId as string)
  );
  if (!sourceAccess.ok) {
    return NextResponse.json(
      { code: sourceAccess.code },
      { status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503, headers: NO_STORE }
    );
  }
  const currentUser = await getRequestUser(request);
  const currentPilot = currentUser ? foundationPilotAccess(currentUser.id) : null;
  if (
    !currentUser || currentUser.id !== user.id ||
    !currentPilot || currentPilot.membership.workspaceId !== membership.workspaceId ||
    (currentPilot.membership.role !== "owner" && currentPilot.membership.role !== "admin")
  ) {
    return NextResponse.json({ code: "AUTHORIZATION_CHANGED_RETRY" }, { status: 403, headers: NO_STORE });
  }
  const currentProductAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "activation", currentPilot.membership.role);
  if (!currentProductAccess.ok) return NextResponse.json({ code: currentProductAccess.code }, {
    status: currentProductAccess.status, headers: NO_STORE,
  });

  const promoted = await promoteFoundationCandidate({
    workspaceKey: membership.workspaceId,
    collectionId: id,
    manifestDigest,
    candidateObjectKey: key,
    worldStateId: stored.coreExecution.worldStateId,
    coreOutputSha256: stored.coreExecution.receipt.outputSha256,
    actorUserId: user.id,
    expectedCurrentManifest,
    reason,
  });
  if (!promoted.ok) {
    return NextResponse.json(
      { code: promoted.code },
      {
        status: promoted.code === "ACTIVE_WORLD_CONFLICT" ? 409 : 503,
        headers: NO_STORE,
      }
    );
  }
  /*
    The World is active from here on. Everything below reports; nothing below can fail the
    promotion (audit R4-01).

    Compiling the retrieval index is what makes the hybrid pipeline reachable at all: before
    this call existed, `compileRetrievalArtifacts` had no production caller, so every /ask in
    production answered from the excerpt-concatenation fallback and every /search returned 409.
    It runs after the pointer moved because 0021's trigger refuses a run against a world that
    is not active -- the run can only legally exist once the promotion has committed.
  */
  const retrievalIndex = await ensureRetrievalIndexForActiveWorld({
    workspaceKey: membership.workspaceId,
    collectionId: id,
    worldManifestDigest: manifestDigest,
    artifact: loaded.json,
    actorUserId: user.id,
  });
  /*
    A2's server truth, fired after the index attempt rather than after the pointer move: a World
    that is active but has no queryable index answers from the fallback, and a funnel that
    counted both as the same activation would report the degraded one as a success. `status`
    carries which one it is.

    `source_revision_applied` is the same promotion seen from J3: a request that names the
    manifest it expects to replace is a revision of a World that was already active, and a first
    activation sends `null`. Both come off the request the caller already had to make correctly,
    so neither needs a second read of the pointer.
  */
  recordServerFunnel("world_activated", {
    status: retrievalIndex.status,
    sources: String(sourceDocuments.length),
  });
  if (expectedCurrentManifest !== null) {
    recordServerFunnel("source_revision_applied", { status: retrievalIndex.status });
  }
  return NextResponse.json(
    { code: "WORLD_ACTIVE", world: promoted.result, retrievalIndex },
    { headers: NO_STORE }
  );
}
