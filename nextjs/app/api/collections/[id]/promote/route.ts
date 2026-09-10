import { NextResponse } from "next/server";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { validatePromotableCollectionArtifact } from "@/lib/collection-download";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import {
  checkCurrentSourceVersions,
  collectionCandidateKey,
  COLLECTION_ID_PATTERN,
  DOCUMENT_ID_PATTERN,
} from "@/lib/immutable-keys";
import { getWorkspaceCollectionCandidate, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { promoteFoundationCandidate } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const productAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "studio");
  if (!productAccess.ok) return NextResponse.json({ code: productAccess.code }, { status: productAccess.status, headers: NO_STORE });
  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json(
      { code: "PROMOTION_ROLE_REQUIRED" },
      { status: 403, headers: NO_STORE }
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
  const currentProductAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "studio");
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
  return NextResponse.json(
    { code: "WORLD_ACTIVE", world: promoted.result },
    { headers: NO_STORE }
  );
}
