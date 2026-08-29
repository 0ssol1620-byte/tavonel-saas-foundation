import { NextResponse } from "next/server";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { validatePromotableCollectionArtifact } from "@/lib/collection-download";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { answerGroundedQuestion } from "@/lib/grounded-ask";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { getWorkspaceCollectionCandidate } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { getFoundationActiveWorld } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

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

  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });
  const { membership } = access;
  const productAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "observer");
  if (!productAccess.ok) return NextResponse.json({ code: productAccess.code }, { status: productAccess.status, headers: NO_STORE });
  const active = await getFoundationActiveWorld(membership.workspaceId, id);
  if (!active.ok) {
    return NextResponse.json(
      { code: active.code },
      {
        status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503,
        headers: NO_STORE,
      }
    );
  }
  const signer = readR2SignerEnv();
  if (!signer)
    return NextResponse.json(
      { code: "SIGNER_NOT_CONFIGURED" },
      { status: 503, headers: NO_STORE }
    );
  const loaded = await getWorkspaceCollectionCandidate(
    signer,
    membership.workspaceId,
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
      activeWorld: {
        manifestDigest: active.world.manifestDigest,
        revision: active.world.revision,
        worldStateId: active.world.worldStateId,
      },
      ...answer,
    },
    { headers: NO_STORE }
  );
}
