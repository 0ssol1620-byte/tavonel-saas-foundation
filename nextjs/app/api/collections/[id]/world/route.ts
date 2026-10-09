import { NextResponse } from "next/server";
import {
  bindConsumerContext,
  releaseConsumerContext,
  resolveBoundSnapshot,
  snapshotOf,
  type ConsumerSnapshot,
} from "@/lib/consumer-context-api";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import {
  getFoundationActiveWorld,
  listFoundationWorldVersions,
  type ActiveWorld,
  type WorldVersionRow,
} from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

/*
  The pair a bound payload was built from: its activeWorld row's, while the version list beside it
  agrees. A list naming another version active, or this one's world_state_id superseded or under
  another digest, means the World moved between the resolution and the list read, which is refused
  rather than acknowledged as either World. A row the 50-row list does not reach says nothing.
*/
function servedSnapshot(activeWorld: ActiveWorld, versions: readonly WorldVersionRow[]): ConsumerSnapshot | null {
  const served = snapshotOf(activeWorld);
  for (const version of versions) {
    if (version.world_state_id === served.worldStateId) {
      if (version.lifecycle_status !== "active" || version.manifest_digest !== served.manifestDigest) return null;
    } else if (version.lifecycle_status === "active") {
      return null;
    }
  }
  return served;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeFoundationRequest(request, "worlds:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json(
      { code: "COLLECTION_ID_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }
  // A consumer context is bound to the principal just verified, before anything is read.
  const binding = bindConsumerContext(request.headers, auth.principal, { scope: "worlds:read", collectionId: id });
  if (!binding.ok) return NextResponse.json({ code: binding.code }, { status: binding.status, headers: NO_STORE });
  if (binding.bound) {
    /*
      Bound: the activeWorld is the row the context resolved against -- the active World for
      latest, or the exact active pin -- never a second read of whichever World is active now. The
      versions list is read as before; the release then revalidates authorization and source
      admission and reads the active World once more before anything is acknowledged.
    */
    const snapshot = await resolveBoundSnapshot(binding, auth.principal.workspaceKey);
    if (!snapshot.ok) return NextResponse.json({ code: snapshot.code }, { status: snapshot.status, headers: NO_STORE });
    const versions = await listFoundationWorldVersions(auth.principal.workspaceKey, id);
    if (!versions.ok) return NextResponse.json({ code: versions.code }, { status: 503, headers: NO_STORE });
    const body = { code: "OK", activeWorld: snapshot.world, versions: versions.versions };
    const released = await releaseConsumerContext({
      request, principal: auth.principal, scope: "worlds:read", bound: binding, snapshot,
      served: servedSnapshot(body.activeWorld, body.versions),
    });
    if (!released.ok) return NextResponse.json({ code: released.code }, { status: released.status, headers: NO_STORE });
    return NextResponse.json(body, { headers: { ...released.headers } });
  }
  const active = await getFoundationActiveWorld(auth.principal.workspaceKey, id);
  if (!active.ok) {
    return NextResponse.json(
      { code: active.code },
      {
        status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 404 : 503,
        headers: NO_STORE,
      }
    );
  }
  const versions = await listFoundationWorldVersions(
    auth.principal.workspaceKey,
    id
  );
  if (!versions.ok)
    return NextResponse.json(
      { code: versions.code },
      { status: 503, headers: NO_STORE }
    );
  return NextResponse.json(
    { code: "OK", activeWorld: active.world, versions: versions.versions },
    { headers: NO_STORE }
  );
}
