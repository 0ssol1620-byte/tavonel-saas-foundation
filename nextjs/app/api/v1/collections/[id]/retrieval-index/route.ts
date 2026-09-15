import { NextResponse } from "next/server";
import { checkActivationRateLimit } from "@/lib/activation-rate-limit";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { foundationPilotAccess } from "@/lib/foundation-pilot";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { getWorkspaceCollectionCandidate } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import {
  ensureRetrievalIndexForActiveWorld,
  readRetrievalIndexState,
} from "@/lib/retrieval-index-status";
import { getFoundationActiveWorld } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/*
  POST /v1/collections/{id}/retrieval-index -- rebuild the compiled retrieval index for a World
  that is already active (audit R4-01).

  This is the recovery path for the only failure promotion is allowed to survive: the pointer
  moved, the index did not compile, and /ask says so in `retrievalNotice`. Without it the only
  way back to a compiled index would be to promote something again, which is a human decision
  about knowledge and not a retry button.

  It compiles nothing that is not already the active World. There is no collection argument
  beyond the path id, no manifest argument, and no way to ask for an index over a candidate
  nobody accepted -- the manifest comes from `foundation_active_worlds`, so this endpoint
  cannot be used to make an unpromoted candidate queryable.

  Authorization is deliberately stricter than /ask. Rebuilding an index spends embedder time, so
  it takes the compile scope and exactly the bar promotion takes -- the `activation` level, asked
  with the caller's real workspace role -- because this is the recovery path for a promotion that
  half-succeeded. A plan that may promote and may not rebuild the index its own promote compiles
  would leave that plan's Worlds answering from the fallback with no way back. It is not a
  promotion and it changes no knowledge: a derived cache is rebuilt.

  The scope check therefore asks `authorizeFoundationRequest` for `observer`, and the plan
  question is the activation one below, where the membership role is known --
  `authorizeFoundationRequest` resolves the principal before any membership row is read and
  cannot ask it. R9 finding #2: the `studio` argument that used to sit here was also the whole
  plan gate, undocumented on the Search page, and it refused a Developer owner who could promote.

  GET is not offered here. The index state is already on the World read model, on /ask and on
  /search; a fourth place to read it from is a fourth place for it to disagree.
*/
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:compile", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "COLLECTION_ID_INVALID" }, { status: 400, headers: NO_STORE });
  }

  const pilot = foundationPilotAccess(auth.principal.userId);
  if (!pilot || pilot.membership.workspaceId !== auth.principal.workspaceKey) {
    return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });
  }
  // Before the role refusal, so the plan answer a caller gets here is the plan answer promotion
  // gives them: an evaluation trial, and a plan that cannot activate at all, are told that rather
  // than told their role is wrong.
  const activation = await authorizeFoundationProduct(
    auth.principal.workspaceKey, auth.principal.userId, "activation", pilot.membership.role,
  );
  if (!activation.ok) {
    return NextResponse.json({ code: activation.code }, { status: activation.status, headers: NO_STORE });
  }
  if (pilot.membership.role !== "owner" && pilot.membership.role !== "admin") {
    return NextResponse.json({ code: "RETRIEVAL_COMPILE_ROLE_REQUIRED" }, { status: 403, headers: NO_STORE });
  }

  const workspaceKey = auth.principal.workspaceKey;
  /*
    The self-serve ceiling (FD-02 repair). This route is the one that spends embedder time on
    purpose, so it is bounded per workspace per hour, off the compile runs it writes itself --
    which means the rebuilds promotion triggers count against the same budget, and they should:
    the budget is embedder time, not button presses. 429 with a typed code and a Retry-After.
  */
  const ceiling = await checkActivationRateLimit(workspaceKey, "retrieval_index_rebuild");
  if (!ceiling.ok) {
    return NextResponse.json(
      { code: ceiling.code },
      { status: ceiling.status, headers: { ...NO_STORE, "Retry-After": String(ceiling.retryAfterSeconds) } },
    );
  }
  const active = await getFoundationActiveWorld(workspaceKey, id);
  if (!active.ok) {
    return NextResponse.json(
      { code: active.code },
      { status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503, headers: NO_STORE },
    );
  }

  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  const loaded = await getWorkspaceCollectionCandidate(signer, workspaceKey, active.world.candidateObjectKey);
  if (!loaded.ok) {
    return NextResponse.json(
      { code: loaded.code },
      { status: loaded.code === "NOT_FOUND" ? 404 : 503, headers: NO_STORE },
    );
  }

  const before = await readRetrievalIndexState({
    workspaceKey,
    collectionId: id,
    worldManifestDigest: active.world.manifestDigest,
  });
  const retrievalIndex = await ensureRetrievalIndexForActiveWorld({
    workspaceKey,
    collectionId: id,
    worldManifestDigest: active.world.manifestDigest,
    artifact: loaded.json,
    actorUserId: auth.principal.userId,
  });
  /*
    A compile that could not produce a queryable index is a 503, not a 200 with a sad field.
    The caller asked for one thing; reporting success for a failed rebuild is how a retry loop
    ends up believing the index is there. `retrievalIndex.errorClass` names which failure.
  */
  return NextResponse.json(
    {
      code: retrievalIndex.status === "compiled" ? "RETRIEVAL_INDEX_COMPILED" : "RETRIEVAL_INDEX_NOT_COMPILED",
      // `true` when a completed run already existed: this call changed nothing, which is what
      // idempotent-per-world-version means from the caller's side.
      alreadyCompiled: before.status === "compiled",
      activeWorld: {
        manifestDigest: active.world.manifestDigest,
        revision: active.world.revision,
        worldStateId: active.world.worldStateId,
      },
      retrievalIndex,
    },
    { status: retrievalIndex.status === "compiled" ? 200 : 503, headers: NO_STORE },
  );
}
