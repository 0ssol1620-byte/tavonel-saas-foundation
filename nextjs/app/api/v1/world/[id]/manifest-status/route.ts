import { NextResponse } from "next/server";
import { bindConsumerContext, releaseConsumerContext, resolveBoundSnapshot } from "@/lib/consumer-context-api";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { getManifestActivationStatus } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const SHA256 = /^sha256:[a-f0-9]{64}$/;

/*
  GET /v1/world/{id}/manifest-status?digest=sha256:... -- is the copy I hold still the current
  one (audit TM06)?

  Rollback restores a prior revision. It does not undo downstream use of an older answer, and
  it cannot reach into a signed Compiled World Package somebody already downloaded: that
  package verifies offline, by design, and offline verification is not remotely revocable.
  Both facts are already published on the product pages, and this endpoint does not soften
  either one.

  What it adds is the check an online consumer can make for itself. `active: false` says a
  different version is the one this workspace answers from now. It does not say the held copy
  was withdrawn, expired or deleted, and nothing here deletes anybody's copy.

  `knownToWorkspace: false` is its own answer: this workspace has no record of ever promoting
  that digest. Returning `active: false` alone would let a typo read as a staleness signal.
*/
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "worlds:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "WORLD_ID_INVALID" }, { status: 400, headers: NO_STORE });
  }
  // A consumer context is bound to the principal just verified, before anything is read.
  const binding = bindConsumerContext(request.headers, auth.principal, { scope: "worlds:read", collectionId: id });
  if (!binding.ok) return NextResponse.json({ code: binding.code }, { status: binding.status, headers: NO_STORE });
  const digest = new URL(request.url).searchParams.get("digest") ?? "";
  if (!SHA256.test(digest)) {
    return NextResponse.json({ code: "MANIFEST_DIGEST_INVALID" }, { status: 400, headers: NO_STORE });
  }
  // Bound: the active World is resolved before the status is read. Legacy reads exactly as before.
  const snapshot = binding.bound ? await resolveBoundSnapshot(binding, auth.principal.workspaceKey) : null;
  if (snapshot && !snapshot.ok) return NextResponse.json({ code: snapshot.code }, { status: snapshot.status, headers: NO_STORE });
  const status = await getManifestActivationStatus(auth.principal.workspaceKey, id, digest);
  if (!status.ok) {
    return NextResponse.json(
      { code: status.code },
      { status: status.code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : status.code === "WORLD_STORE_READ_FAILED" || status.code === "WORLD_STORE_NOT_CONFIGURED" ? 503 : 400, headers: NO_STORE },
    );
  }
  const body = { code: "MANIFEST_STATUS", manifestStatus: status.status };
  if (!binding.bound || !snapshot) return NextResponse.json(body, { headers: NO_STORE });
  /*
    The answer is measured against the active digest the status read itself saw. The payload names
    no world_state_id, so that half is the resolved row's -- and only while the payload's active
    digest is the resolved one. Any other digest means the World moved under the read, which is
    refused rather than acknowledged as either World.
  */
  const servedDigest = status.status.activeManifestDigest;
  const released = await releaseConsumerContext({
    request, principal: auth.principal, scope: "worlds:read", bound: binding, snapshot,
    served: servedDigest === snapshot.resolved.snapshot.manifestDigest
      ? { worldStateId: snapshot.world.worldStateId, manifestDigest: servedDigest }
      : null,
  });
  if (!released.ok) return NextResponse.json({ code: released.code }, { status: released.status, headers: NO_STORE });
  return NextResponse.json(body, { headers: { ...released.headers } });
}
