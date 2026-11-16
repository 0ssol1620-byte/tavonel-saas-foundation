import { NextResponse } from "next/server";
import {
  bindConsumerContext,
  releaseConsumerContext,
  resolveBoundSnapshot,
  worldModelSnapshot,
} from "@/lib/consumer-context-api";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { SAFE_ID, loadWorldReadModel } from "@/lib/world-read-model";
import { pageTokenKey, sealClaims, unsealClaims } from "@/lib/sealed-claims";
import { getFoundationActiveWorld } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const LENSES = new Set(["objects", "relations", "evidence", "history", "files", "review"]);

/*
  Bounded lens reads (audit X06).

  `objects`, `relations` and `evidence` are the lenses that grow with the World, and until now
  every read returned the whole set -- the MCP tools fetched an entire lens and then filtered
  client-side to one item. On a large graph that is exactly the "large graph exploration" gap
  the audit names.

  Paging is opt-in, deliberately. Defaulting to a page would silently truncate every existing
  consumer, including those by-id lookups, which would start reporting NOT_FOUND for anything
  past the first page. A request with no `limit` still returns the full lens, and
  `page.limit: null` says which of the two answers this is, so a client cannot mistake an
  unpaged response for page one.

  The bound matches `search_world`'s (1 to 50), so the developer surface has one pagination
  idiom rather than three. The cursor is the last item id the caller saw: keyset, not an
  offset, and stable because the read model's order is derived from the canonical model. A
  cursor naming an id this lens does not contain is a 400, never an empty page -- answering an
  unrecognised cursor with "no more results" is a silent truncation.
*/
const PAGE_MAX = 50;
const PAGEABLE = new Set(["objects", "relations", "evidence"]);
const PAGE_TOKEN_PURPOSE = "tavonel.world_lens_page.v1";
const PAGE_TOKEN_TTL_MS = 15 * 60 * 1000;

type Identified = { id: string };

function paginate(items: Identified[], limit: number, cursor: string | null) {
  const start = cursor === null ? 0 : items.findIndex((item) => item.id === cursor) + 1;
  if (cursor !== null && start === 0) return null;
  const page = items.slice(start, start + limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: start + limit < items.length && last ? last.id : null,
    total: items.length,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string; lens: string }> }) {
  const auth = await authorizeFoundationRequest(request, "worlds:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id, lens } = await context.params;
  // A consumer context is bound to the principal just verified, before anything is read.
  const binding = bindConsumerContext(request.headers, auth.principal, { scope: "worlds:read", collectionId: id });
  if (!binding.ok) return NextResponse.json({ code: binding.code }, { status: binding.status, headers: NO_STORE });
  if (!LENSES.has(lens)) return NextResponse.json({ code: "WORLD_LENS_NOT_FOUND" }, { status: 404, headers: NO_STORE });

  const search = new URL(request.url).searchParams;
  const rawLimit = search.get("limit");
  let cursor = search.get("cursor");
  const rawIds = search.get("ids");
  const pageToken = search.get("page_token");
  const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: NO_STORE });
  const paged = rawLimit !== null || cursor !== null || pageToken !== null;
  if ((paged || rawIds !== null) && !PAGEABLE.has(lens)) return fail("WORLD_LENS_NOT_PAGEABLE", 400);

  // By-id read (F30-06): the named items only, never mixed with paging.
  let ids: string[] | null = null;
  if (rawIds !== null) {
    if (paged) return fail("WORLD_IDS_WITH_PAGE", 400);
    if (search.getAll("ids").length > 1) return fail("WORLD_IDS_INVALID", 400);
    ids = rawIds.split(",");
    if (ids.length > PAGE_MAX || new Set(ids).size !== ids.length || !ids.every((value) => SAFE_ID.test(value))) {
      return fail("WORLD_IDS_INVALID", 400);
    }
  }

  // A page token carries its own limit and cursor. Its claims are checked against the principal
  // and path before anything is read, and against the served World and access revision after.
  const tokenKey = pageTokenKey();
  let limit = rawLimit === null ? null : Number(rawLimit);
  let tokenClaims: Record<string, unknown> | null = null;
  if (pageToken !== null) {
    if (search.getAll("page_token").length > 1) return fail("PAGE_TOKEN_INVALID", 400);
    if (!tokenKey) return fail("PAGE_TOKEN_SIGNER_NOT_CONFIGURED", 503);
    if (rawLimit !== null || cursor !== null) return fail("PAGE_TOKEN_INVALID", 400);
    tokenClaims = unsealClaims(PAGE_TOKEN_PURPOSE, pageToken, tokenKey);
    if (
      !tokenClaims || tokenClaims.v !== 1 || tokenClaims.w !== auth.principal.workspaceKey || tokenClaims.c !== id ||
      tokenClaims.l !== lens || typeof tokenClaims.k !== "string" || typeof tokenClaims.d !== "string" ||
      typeof tokenClaims.exp !== "number" || !Number.isInteger(tokenClaims.n)
    ) return fail("PAGE_TOKEN_INVALID", 400);
    if (tokenClaims.exp < Date.now()) return fail("PAGE_TOKEN_STALE", 400);
    limit = tokenClaims.n as number;
    cursor = tokenClaims.k;
  }
  if (paged && (limit === null || !Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX)) {
    // A cursor with no limit lands here too: it asks for "the next page" of an unbounded read,
    // which is not a page this endpoint can produce.
    return NextResponse.json({ code: "WORLD_PAGE_LIMIT_INVALID" }, { status: 400, headers: NO_STORE });
  }

  // Bound: resolved before the World is read, and the read is the resolved digest, never the
  // preferred candidate. Legacy reads the active World list_worlds reports, and the preferred
  // candidate only when no World is active; a pointer that cannot be read is an outage, never a
  // reason to answer with some other candidate.
  const snapshot = binding.bound ? await resolveBoundSnapshot(binding, auth.principal.workspaceKey) : null;
  if (snapshot && !snapshot.ok) return NextResponse.json({ code: snapshot.code }, { status: snapshot.status, headers: NO_STORE });
  let selected: string | undefined;
  if (snapshot) selected = snapshot.resolved.snapshot.manifestDigest;
  else {
    const active = await getFoundationActiveWorld(auth.principal.workspaceKey, id);
    if (active.ok) selected = active.world.manifestDigest;
    else if (active.code !== "ACTIVE_WORLD_NOT_FOUND") {
      return NextResponse.json({ code: active.code }, { status: active.code === "WORLD_ID_INVALID" ? 400 : 503, headers: NO_STORE });
    }
  }
  const loaded = await loadWorldReadModel(auth.principal.workspaceKey, id, selected);
  if (!loaded.ok) return NextResponse.json({ code: loaded.code, bytes: loaded.bytes, bound: loaded.bound }, { status: loaded.status, headers: NO_STORE });
  const shared = {
    code: "OK",
    world: loaded.model.world,
    contract: loaded.model.contract,
    freshness: loaded.model.freshness,
  };

  if (tokenClaims && (tokenClaims.a !== auth.principal.authorizationRevision || tokenClaims.d !== loaded.model.world.manifestDigest)) {
    // Access or the World moved between pages: a walk must not splice two of them.
    return fail("PAGE_TOKEN_STALE", 409);
  }

  let body: Record<string, unknown>;
  if (ids) {
    const byId = new Map((loaded.model[lens as "objects" | "relations" | "evidence"] as Identified[]).map((item) => [item.id, item]));
    const items = ids.flatMap((value) => byId.get(value) ?? []);
    body = {
      ...shared,
      [lens]: items,
      selection: { requested: ids.length, found: items.length, missing: ids.filter((value) => !byId.has(value)) },
      page: { limit: null, cursor: null, nextCursor: null, total: null },
    };
  } else if (paged && limit !== null) {
    const all = loaded.model[lens as "objects" | "relations" | "evidence"] as Identified[];
    const page = paginate(all, limit, cursor);
    if (!page) {
      return NextResponse.json({ code: "WORLD_PAGE_CURSOR_INVALID" }, { status: 400, headers: NO_STORE });
    }
    body = {
      ...shared,
      [lens]: page.items,
      page: {
        limit, cursor, nextCursor: page.nextCursor, total: page.total,
        ...(tokenKey ? {
          nextPageToken: page.nextCursor === null ? null : sealClaims(PAGE_TOKEN_PURPOSE, {
            v: 1, w: auth.principal.workspaceKey, c: id, l: lens, d: loaded.model.world.manifestDigest,
            a: auth.principal.authorizationRevision, k: page.nextCursor, n: limit, exp: Date.now() + PAGE_TOKEN_TTL_MS,
          }, tokenKey),
        } : {}),
      },
    };
  } else {
    const payload = lens === "files"
      ? { files: loaded.model.files, signature: loaded.model.signature }
      : { [lens]: loaded.model[lens as keyof Pick<typeof loaded.model, "objects" | "relations" | "evidence" | "history" | "review">] };
    const whole = (payload as Record<string, unknown>)[lens];
    body = {
      ...shared,
      ...payload,
      page: { limit: null, cursor: null, nextCursor: null, total: Array.isArray(whole) ? whole.length : null },
    };
  }

  if (!binding.bound || !snapshot) return NextResponse.json(body, { headers: NO_STORE });
  // Acknowledged only for the World the model itself says it was built from.
  const released = await releaseConsumerContext({
    request, principal: auth.principal, scope: "worlds:read", bound: binding, snapshot,
    served: worldModelSnapshot(loaded.model),
  });
  if (!released.ok) return NextResponse.json({ code: released.code }, { status: released.status, headers: NO_STORE });
  return NextResponse.json(body, { headers: { ...released.headers } });
}
