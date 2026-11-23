import { NextResponse } from "next/server";
import {
  bindConsumerContext,
  releaseConsumerContext,
  resolveBoundSnapshot,
  snapshotOf,
} from "@/lib/consumer-context-api";
import { memberCollectionScopeRefusal } from "@/lib/member-source-scope";
import { authorizeFoundationRequest, type FoundationPrincipal } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import {
  ACTIVE_WORLD_PAGE_DEFAULT,
  ACTIVE_WORLD_PAGE_MAX,
  listFoundationActiveWorlds,
} from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const storeStatus = (code: string) => (code === "WORLD_STORE_READ_FAILED" || code === "WORLD_STORE_NOT_CONFIGURED" ? 503 : 400);
// ponytail: a member's page reads the package of every World it passes to learn its sources, so the
// walk is bounded; past MEMBER_SCAN_PAGES full store pages it refuses rather than guess. Upgrade path:
// a stored per-World source set.
const MEMBER_SCAN_PAGES = 4;

/*
  A member's page (WO-C-T3): only Worlds whose every source is in their scope, and nothing about
  the others -- no count, no id. The cursor is therefore always the id of a World this page
  returned, never one it dropped, which is why the walk continues past dropped rows instead of
  handing back the store's own cursor. A last page may come back empty.
*/
async function memberPage(principal: FoundationPrincipal, limit: number, cursor: string | null) {
  type World = Extract<Awaited<ReturnType<typeof listFoundationActiveWorlds>>, { ok: true }>["worlds"][number];
  const kept: World[] = [];
  let after = cursor;
  for (let page = 0; page < MEMBER_SCAN_PAGES; page++) {
    const listed = await listFoundationActiveWorlds(principal.workspaceKey, { limit: ACTIVE_WORLD_PAGE_MAX, cursor: after });
    if (!listed.ok) return { ok: false as const, code: listed.code, status: storeStatus(listed.code) };
    const refusals = await Promise.all(listed.worlds.map((world) =>
      memberCollectionScopeRefusal(principal, world.collectionId, world.manifestDigest)));
    for (const [index, world] of listed.worlds.entries()) {
      const refusal = refusals[index];
      if (refusal?.status === 503) return { ok: false as const, code: refusal.code, status: 503 };
      if (refusal) continue;
      kept.push(world);
      if (kept.length === limit) return { ok: true as const, worlds: kept, nextCursor: world.collectionId };
    }
    if (listed.nextCursor === null) return { ok: true as const, worlds: kept, nextCursor: null };
    after = listed.nextCursor;
  }
  return { ok: false as const, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE", status: 503 };
}

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
    const scopeRefusal = await memberCollectionScopeRefusal(auth.principal, world.collectionId, world.manifestDigest);
    if (scopeRefusal) return NextResponse.json({ code: scopeRefusal.code }, { status: scopeRefusal.status, headers: NO_STORE });
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

  const member = auth.principal.workspaceRole !== "owner" && auth.principal.workspaceRole !== "admin";
  const listed = member
    ? await memberPage(auth.principal, limit, cursor)
    : await listFoundationActiveWorlds(auth.principal.workspaceKey, { limit, cursor });
  if (!listed.ok) {
    return NextResponse.json(
      { code: listed.code },
      { status: "status" in listed && typeof listed.status === "number" ? listed.status : storeStatus(listed.code), headers: NO_STORE },
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
