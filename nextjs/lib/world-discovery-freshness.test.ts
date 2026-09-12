import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Audit X01 (world discovery), TM04 (freshness) and TM06 (is my copy still current).

  All three are reads over tables that already existed, so the risk is not that they compute
  something wrong -- it is that they compute it for the wrong tenant, or that they fill a gap
  with a plausible value. Both are what this file checks.

  The fetch stub is a small PostgREST that honours `col=eq.value`, so a query that dropped its
  workspace scope returns another workspace's rows and the negative test below fails. That is
  the only way to test tenant scope without a database: assert that the scope is in the request
  AND that removing it would change the answer.
*/

const WORKSPACE = "pilot-acme01";
const OTHER = "pilot-rival9";
const COLLECTION_A = `collection-${"a".repeat(32)}`;
const COLLECTION_B = `collection-${"b".repeat(32)}`;
const COLLECTION_C = `collection-${"c".repeat(32)}`;
const MANIFEST_1 = `sha256:${"1".repeat(64)}`;
const MANIFEST_2 = `sha256:${"2".repeat(64)}`;

type Row = Record<string, unknown>;

function pointer(workspaceKey: string, collectionId: string, manifestDigest: string): Row {
  return {
    workspace_key: workspaceKey,
    collection_id: collectionId,
    manifest_digest: manifestDigest,
    revision: 1,
    updated_at: "2026-09-11T00:00:00.000Z",
  };
}

let tables: Record<string, Row[]>;
let requests: string[];
let failTables: Set<string>;

function jsonResponse(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
}

function applyFilters(href: string, rows: Row[]) {
  const query = decodeURIComponent(href.split("?")[1] ?? "");
  let filtered = rows;
  for (const part of query.split("&")) {
    const [column, predicate] = part.split("=");
    if (!predicate) continue;
    if (predicate.startsWith("eq.")) {
      const value = predicate.slice(3);
      filtered = filtered.filter((row) => String(row[column] ?? "") === value);
    }
    if (predicate.startsWith("gt.")) {
      const value = predicate.slice(3);
      filtered = filtered.filter((row) => String(row[column] ?? "") > value);
    }
    if (predicate.startsWith("in.")) {
      const values = new Set(predicate.slice(3).replace(/^\(|\)$/g, "").split(","));
      filtered = filtered.filter((row) => values.has(String(row[column] ?? "")));
    }
  }
  const order = /(?:^|&)order=([^&.]+)\.(asc|desc)/.exec(query);
  if (order) {
    const [, column, direction] = order;
    filtered = [...filtered].sort((left, right) => {
      const compared = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
      return direction === "desc" ? -compared : compared;
    });
  }
  const limit = /(?:^|&)limit=(\d+)/.exec(query);
  return limit ? filtered.slice(0, Number(limit[1])) : filtered;
}

beforeEach(() => {
  requests = [];
  failTables = new Set();
  tables = {
    foundation_active_worlds: [
      pointer(WORKSPACE, COLLECTION_A, MANIFEST_1),
      pointer(WORKSPACE, COLLECTION_B, MANIFEST_1),
      pointer(WORKSPACE, COLLECTION_C, MANIFEST_1),
      // The row that must never appear in this workspace's page.
      pointer(OTHER, `collection-${"9".repeat(32)}`, MANIFEST_2),
    ],
    foundation_world_versions: [
      {
        workspace_key: WORKSPACE, collection_id: COLLECTION_A, manifest_digest: MANIFEST_1,
        lifecycle_status: "active", last_activated_at: "2026-09-10T10:00:00.000Z",
        created_at: "2026-09-10T09:00:00.000Z",
      },
    ],
    foundation_compile_jobs: [
      {
        workspace_key: WORKSPACE, collection_id: COLLECTION_A,
        settled_at: "2026-09-10T08:00:00.000Z",
        blocked_resolved_at: "2026-09-10T07:30:00.000Z",
        document_ids: ["doc-one", "doc-two"],
      },
    ],
    source_versions: [
      { source_id: "doc-one", observed_at: "2026-09-09T06:00:00.000Z" },
      { source_id: "doc-two", observed_at: "2026-09-09T07:00:00.000Z" },
      // Another tenant's source, reachable only if the document id filter were dropped.
      { source_id: "doc-rival", observed_at: "2030-01-01T00:00:00.000Z" },
    ],
  };

  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_".padEnd(48, "x"));
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    requests.push(href);
    const table = Object.keys(tables).find((name) => href.includes(`/rest/v1/${name}?`));
    if (!table) throw new Error(`unexpected fetch to ${href}`);
    if (failTables.has(table)) return jsonResponse({ message: "down" }, false);
    return jsonResponse(applyFilters(href, tables[table]));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

import {
  ACTIVE_WORLD_PAGE_MAX,
  getManifestActivationStatus,
  getWorldFreshness,
  listFoundationActiveWorlds,
} from "./world-store";

describe("listing a workspace's active Worlds", () => {
  it("returns this workspace's Worlds and never another's", async () => {
    const listed = await listFoundationActiveWorlds(WORKSPACE);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.worlds.map((world) => world.collectionId)).toEqual([COLLECTION_A, COLLECTION_B, COLLECTION_C]);
    expect(listed.nextCursor).toBeNull();
    // The scope is in the request, not only in the result. A query that lost it would return
    // the rival row above and fail the assertion before this one.
    expect(requests.every((href) => href.includes(`workspace_key=eq.${WORKSPACE}`))).toBe(true);
  });

  it("cannot be asked for another workspace, because the key is the only way in", async () => {
    /*
      There is no cross-tenant form of this call. The workspace is a required positional
      argument the route fills from the authorized principal, and it is the value put on the
      query -- so asking as OTHER returns OTHER's single row and nothing of this workspace's.
      A caller who does not hold OTHER's credential never reaches this function with OTHER.
    */
    const asOther = await listFoundationActiveWorlds(OTHER);
    expect(asOther.ok).toBe(true);
    if (!asOther.ok) return;
    expect(asOther.worlds).toHaveLength(1);
    expect(asOther.worlds.map((world) => world.collectionId)).not.toContain(COLLECTION_A);
  });

  it("pages with a keyset cursor and stops without inventing one", async () => {
    const first = await listFoundationActiveWorlds(WORKSPACE, { limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.worlds.map((world) => world.collectionId)).toEqual([COLLECTION_A, COLLECTION_B]);
    expect(first.nextCursor).toBe(COLLECTION_B);

    const second = await listFoundationActiveWorlds(WORKSPACE, { limit: 2, cursor: first.nextCursor });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.worlds.map((world) => world.collectionId)).toEqual([COLLECTION_C]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a limit or cursor it cannot honour instead of clamping quietly", async () => {
    expect(await listFoundationActiveWorlds(WORKSPACE, { limit: ACTIVE_WORLD_PAGE_MAX + 1 })).toEqual({
      ok: false,
      code: "WORLD_PAGE_LIMIT_INVALID",
    });
    expect(await listFoundationActiveWorlds(WORKSPACE, { limit: 0 })).toEqual({
      ok: false,
      code: "WORLD_PAGE_LIMIT_INVALID",
    });
    expect(await listFoundationActiveWorlds(WORKSPACE, { limit: 5, cursor: "not-a-collection" })).toEqual({
      ok: false,
      code: "WORLD_PAGE_CURSOR_INVALID",
    });
    expect(await listFoundationActiveWorlds("pilot bad key")).toEqual({ ok: false, code: "WORLD_ID_INVALID" });
  });

  it("fails the page rather than returning one row short when a row does not parse", async () => {
    // Dropping the unreadable row would hand the caller a page silently missing one of their
    // own Worlds, which is worse than an error they can see.
    tables.foundation_active_worlds = [{ ...pointer(WORKSPACE, COLLECTION_A, MANIFEST_1), revision: 0 }];
    expect(await listFoundationActiveWorlds(WORKSPACE)).toEqual({
      ok: false,
      code: "ACTIVE_WORLD_BINDING_INVALID",
    });
  });
});

describe("is the manifest I hold still the active one", () => {
  it("says yes for the active digest and no for a superseded one, without promising a recall", async () => {
    const active = await getManifestActivationStatus(WORKSPACE, COLLECTION_A, MANIFEST_1);
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(active.status).toMatchObject({
      active: true,
      activeManifestDigest: MANIFEST_1,
      knownToWorkspace: true,
      lifecycleStatus: "active",
      activatedAt: "2026-09-10T10:00:00.000Z",
    });

    tables.foundation_world_versions.push({
      workspace_key: WORKSPACE, collection_id: COLLECTION_A, manifest_digest: MANIFEST_2,
      lifecycle_status: "superseded", last_activated_at: "2026-09-08T10:00:00.000Z",
      created_at: "2026-09-08T09:00:00.000Z",
    });
    const stale = await getManifestActivationStatus(WORKSPACE, COLLECTION_A, MANIFEST_2);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.status.active).toBe(false);
    expect(stale.status.lifecycleStatus).toBe("superseded");
    expect(stale.status.activeManifestDigest).toBe(MANIFEST_1);
  });

  it("distinguishes a digest this workspace never promoted from one that was superseded", async () => {
    const unknown = await getManifestActivationStatus(WORKSPACE, COLLECTION_A, `sha256:${"f".repeat(64)}`);
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    // Answering `active: false` alone would let a typo read as a staleness signal.
    expect(unknown.status.knownToWorkspace).toBe(false);
    expect(unknown.status.lifecycleStatus).toBeNull();
    expect(unknown.status.activatedAt).toBeNull();
  });

  it("refuses a malformed digest and a collection with nothing promoted", async () => {
    expect(await getManifestActivationStatus(WORKSPACE, COLLECTION_A, "sha256:nope")).toEqual({
      ok: false,
      code: "MANIFEST_DIGEST_INVALID",
    });
    tables.foundation_active_worlds = [];
    expect(await getManifestActivationStatus(WORKSPACE, COLLECTION_A, MANIFEST_1)).toEqual({
      ok: false,
      code: "ACTIVE_WORLD_NOT_FOUND",
    });
  });
});

describe("freshness keeps four clocks apart", () => {
  it("reads each one from its own column", async () => {
    const freshness = await getWorldFreshness(WORKSPACE, COLLECTION_A);
    expect(freshness).toEqual({
      // The newest source version among the documents this collection's compile job listed.
      observedAt: "2026-09-09T07:00:00.000Z",
      processedAt: "2026-09-10T08:00:00.000Z",
      reviewedAt: "2026-09-10T07:30:00.000Z",
      activatedAt: "2026-09-10T10:00:00.000Z",
      activeManifestDigest: MANIFEST_1,
      candidateAwaitingActivation: false,
      candidateManifestDigest: null,
    });
    // The rival source dated 2030 is in the table and is not in the answer: the document ids
    // came off a workspace-scoped compile-job row.
    expect(JSON.stringify(freshness)).not.toContain("2030");
  });

  it("tells a reader they are on the previous active World when a newer version exists", async () => {
    tables.foundation_world_versions.push({
      workspace_key: WORKSPACE, collection_id: COLLECTION_A, manifest_digest: MANIFEST_2,
      lifecycle_status: "superseded", last_activated_at: "2026-09-11T10:00:00.000Z",
      created_at: "2026-09-11T09:00:00.000Z",
    });
    const freshness = await getWorldFreshness(WORKSPACE, COLLECTION_A);
    expect(freshness.candidateAwaitingActivation).toBe(true);
    expect(freshness.candidateManifestDigest).toBe(MANIFEST_2);
    // The activated clock still belongs to the version being answered from, not the newer one.
    expect(freshness.activatedAt).toBe("2026-09-10T10:00:00.000Z");
  });

  /*
    G3's read side (`20260911120200`). A candidate that was compiled and never promoted has no
    row in `foundation_world_versions` -- that table only learns a digest at promotion, which is
    the event this flag exists to wait for -- so before the compile job recorded its digest the
    only way to see one was for the caller to hand it over. The three cases below are the whole
    precedence: the recorded digest answers with no hint at all, a caller's hint still wins over
    it, and a job that recorded nothing (every job older than the column) degrades to the
    previous answer rather than guessing.
  */
  it("reads an unpromoted candidate from the digest the compile job recorded, with no hint", async () => {
    tables.foundation_compile_jobs[0].candidate_manifest_digest = MANIFEST_2;
    const freshness = await getWorldFreshness(WORKSPACE, COLLECTION_A);
    expect(freshness).toMatchObject({ candidateAwaitingActivation: true, candidateManifestDigest: MANIFEST_2 });
    // The column is read, not inferred: the request has to ask for it.
    expect(requests.some((href) => href.includes("candidate_manifest_digest"))).toBe(true);
  });

  it("prefers the caller's candidate over the recorded one, and ignores a recorded active digest", async () => {
    tables.foundation_compile_jobs[0].candidate_manifest_digest = MANIFEST_2;
    const hinted = await getWorldFreshness(WORKSPACE, COLLECTION_A, {
      candidateManifestDigest: `sha256:${"3".repeat(64)}`,
    });
    expect(hinted.candidateManifestDigest).toBe(`sha256:${"3".repeat(64)}`);
    // A compile that produced what is already active is not a waiting candidate.
    tables.foundation_compile_jobs[0].candidate_manifest_digest = MANIFEST_1;
    const active = await getWorldFreshness(WORKSPACE, COLLECTION_A);
    expect(active).toMatchObject({ candidateAwaitingActivation: false, candidateManifestDigest: null });
  });

  it("reads false for a compile that predates the digest column instead of inventing one", async () => {
    delete tables.foundation_compile_jobs[0].candidate_manifest_digest;
    const freshness = await getWorldFreshness(WORKSPACE, COLLECTION_A);
    expect(freshness).toMatchObject({ candidateAwaitingActivation: false, candidateManifestDigest: null });
  });

  it("takes a candidate the caller already loaded, since the database cannot see an unpromoted one", async () => {
    const hinted = await getWorldFreshness(WORKSPACE, COLLECTION_A, { candidateManifestDigest: MANIFEST_2 });
    expect(hinted).toMatchObject({ candidateAwaitingActivation: true, candidateManifestDigest: MANIFEST_2 });
    // A hint equal to the active digest is not a waiting candidate.
    const same = await getWorldFreshness(WORKSPACE, COLLECTION_A, { candidateManifestDigest: MANIFEST_1 });
    expect(same.candidateAwaitingActivation).toBe(false);
  });

  it("leaves a clock null rather than borrowing a neighbouring one", async () => {
    failTables.add("foundation_compile_jobs");
    const freshness = await getWorldFreshness(WORKSPACE, COLLECTION_A);
    expect(freshness.processedAt).toBeNull();
    expect(freshness.reviewedAt).toBeNull();
    // observedAt depends on the compile job's document ids, so it is null too -- and it is
    // null, not the activation time standing in for it.
    expect(freshness.observedAt).toBeNull();
    expect(freshness.activatedAt).toBe("2026-09-10T10:00:00.000Z");

    failTables.add("foundation_active_worlds");
    failTables.add("foundation_world_versions");
    const blind = await getWorldFreshness(WORKSPACE, COLLECTION_A);
    expect(blind).toEqual({
      observedAt: null,
      processedAt: null,
      reviewedAt: null,
      activatedAt: null,
      activeManifestDigest: null,
      candidateAwaitingActivation: false,
      candidateManifestDigest: null,
    });
  });

  it("answers an invalid id with nulls instead of a query", async () => {
    const freshness = await getWorldFreshness("pilot bad", COLLECTION_A);
    expect(freshness.activeManifestDigest).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
