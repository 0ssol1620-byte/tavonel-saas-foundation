import { NextResponse } from "next/server";
import {
  bindConsumerContext,
  releaseConsumerContext,
  resolveBoundSnapshot,
  snapshotOf,
} from "@/lib/consumer-context-api";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import {
  ACTIVE_WORLD_PAGE_DEFAULT,
  ACTIVE_WORLD_PAGE_MAX,
  listFoundationActiveWorlds,
} from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

/*
  GET /v1/collections -- the workspace's active Worlds (audit X01).

  This is the endpoint whose absence the MCP server documented: `get_world` needed a collection
  id, nothing listed them, and an agent holding only an API key had no way to discover one
  without a person pasting it in. The honest answer was to say so; the better answer is to
  build the read, which is what this is.

  Only active Worlds appear. A candidate nobody promoted is not discoverable here, because
  discovery that surfaced unaccepted candidates would hand an agent a list in which some
  entries are organizational truth and some are not.

  The workspace comes from the authorized principal and nowhere else -- there is no workspace
  query parameter, and `listFoundationActiveWorlds` takes the key as a required argument it
  puts on every request. A key cannot widen its own scope by asking differently.
*/
export async function GET(request: Request) {
  const auth = await authorizeFoundationRequest(request, "collections:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  // No collection in this path: a bound context's own collection is what the list narrows to.
  const binding = bindConsumerContext(request.headers, auth.principal, { scope: "collections:read", collectionId: null });
  if (!binding.ok) return NextResponse.json({ code: binding.code }, { status: binding.status, headers: NO_STORE });

  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? ACTIVE_WORLD_PAGE_DEFAULT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVE_WORLD_PAGE_MAX) {
    return NextResponse.json({ code: "WORLD_PAGE_LIMIT_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const cursor = params.get("cursor");
  if (cursor !== null && !COLLECTION_ID_PATTERN.test(cursor)) {
    return NextResponse.json({ code: "WORLD_PAGE_CURSOR_INVALID" }, { status: 400, headers: NO_STORE });
  }

  if (binding.bound) {
    /*
      Bound: the list is the bound collection alone, built from the resolved active row rather
      than filtered out of a workspace page, so no other collection is ever read for it. The
      cursor keeps its meaning -- a cursor at or past the collection is an empty last page -- and
      a collection with no active World here has nothing to narrow to.
    */
    const snapshot = await resolveBoundSnapshot(binding, auth.principal.workspaceKey);
    if (!snapshot.ok) return NextResponse.json({ code: snapshot.code }, { status: snapshot.status, headers: NO_STORE });
    const world = snapshot.world;
    const collections = cursor === null || world.collectionId > cursor
      ? [{ collectionId: world.collectionId, manifestDigest: world.manifestDigest, revision: world.revision, updatedAt: world.updatedAt }]
      : [];
    const released = await releaseConsumerContext({
      request, principal: auth.principal, scope: "collections:read", bound: binding, snapshot,
      served: snapshotOf(world),
    });
    if (!released.ok) return NextResponse.json({ code: released.code }, { status: released.status, headers: NO_STORE });
    return NextResponse.json(
      { code: "COLLECTIONS_LISTED", collections, page: { limit, cursor: cursor ?? null, nextCursor: null } },
      { headers: { ...released.headers } },
    );
  }

  const listed = await listFoundationActiveWorlds(auth.principal.workspaceKey, { limit, cursor });
  if (!listed.ok) {
    return NextResponse.json(
      { code: listed.code },
      { status: listed.code === "WORLD_STORE_READ_FAILED" || listed.code === "WORLD_STORE_NOT_CONFIGURED" ? 503 : 400, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    {
      code: "COLLECTIONS_LISTED",
      collections: listed.worlds,
      // `null` means this was the last page. A cursor is the last collection id on this page,
      // passed straight back as `?cursor=` -- no opaque offset, nothing to decode.
      page: { limit, cursor: cursor ?? null, nextCursor: listed.nextCursor },
    },
    { headers: NO_STORE },
  );
}
