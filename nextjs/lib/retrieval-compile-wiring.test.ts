import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";

/*
  Audit R4-01: the compiled retrieval pipeline, wired.

  `compileRetrievalArtifacts` -- the entire write side of the Retrieval Compiler -- had no
  production caller. The consequence was not an edge case for some worlds: every /ask in
  production answered from the excerpt-concatenation fallback and every /search returned 409,
  permanently, and no test said so because no test promoted a candidate and then asked a
  question.

  This one does. Three real route handlers run in sequence against one in-memory PostgREST:
  promote, then search, then ask. Everything between them is production code --
  compileRetrievalUnits, the run lifecycle, findLatestCompletedRun, the lexical/dense/structure
  stages, RRF, the World Gate, buildContextPacket and answerFromContextPacket. Only the network
  boundary is replaced, the same line retrieval-pipeline.test.ts and retrieval-compile.test.ts
  draw: there is no local Postgres here, so this cannot prove the 0023 RPC bodies are right
  (supabase/tests/foundation_retrieval_search_rpc.sql does that). What it proves is the thing
  that had no coverage at all: that promotion produces an index a later query actually reads.

  The failure path is asserted just as hard, because it is the one that decides how this
  behaves in production: a compile that cannot run must not take the promotion down with it,
  and it must not leave /ask looking healthy.
*/

const { getUser, pilotAccess, productAccess, getCandidate, listObjects, promote, sourceAccess, activeWorld, freshness } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    pilotAccess: vi.fn(),
    productAccess: vi.fn(),
    getCandidate: vi.fn(),
    listObjects: vi.fn(),
    promote: vi.fn(),
    sourceAccess: vi.fn(),
    activeWorld: vi.fn(),
    freshness: vi.fn(),
  }));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: productAccess }));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  getWorkspaceCollectionCandidate: getCandidate,
  listImmutableWorkspaceObjects: listObjects,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
/*
  The FD-02 self-serve ceiling, passed through: it is asserted in
  `lib/activation-rate-limit.test.ts` and exercised per route in
  `lib/world-activation-plan-gate.test.ts`, and a limiter that read the audit tables from here
  would answer every case with a transport error instead of the behaviour under test.
*/
vi.mock("@/lib/activation-rate-limit", () => ({ checkActivationRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  promoteFoundationCandidate: promote,
  getFoundationActiveWorld: activeWorld,
  getWorldFreshness: freshness,
}));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess }));
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: async () => ({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: USER, keyId: "key-1", scopes: ["ask:read"] },
  }),
  revalidateFoundationAuthorization: async (_request: Request, expected: unknown) => ({ ok: true, principal: expected }),
}));

import { POST as promoteRoute } from "../app/api/collections/[id]/promote/route";
import { POST as searchRoute } from "../app/api/collections/[id]/search/route";
import { POST as askRoute } from "../app/api/collections/[id]/ask/route";
import { EMPTY_WORLD_FRESHNESS } from "./world-store";
import { resetWorkspaceCostGuard } from "./workspace-cost-guard";
import { buildProductionRetrievalProfile } from "./retrieval-runtime-config";
import { readRetrievalIndexState, retrievalIndexNotice } from "./retrieval-index-status";

// The promote route's own validator requires this shape, so the workspace key has to satisfy
// both WORKSPACE_ID_PATTERN (object keys) and the retrieval schema's `pilot-` pattern.
const WORKSPACE = "pilot-wiring";
const USER = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const PROFILE = buildProductionRetrievalProfile(WORKSPACE);

function ocrInput(documentId: string, versionKey: string, text: string): CollectionOcrInput {
  const sanitizedKey = `immutable/${WORKSPACE}/${WORKSPACE}/${documentId}/${versionKey}/sanitized.pdf`;
  return {
    documentId,
    versionKey,
    sanitizedKey,
    ocrJsonKey: sanitizedKey.replace("sanitized.pdf", "ocr.json"),
    pageCount: 1,
    text,
    inputSha256: `sha256:${versionKey}`,
    sourceImmutableKey: sanitizedKey,
    regions: [{
      regionId: `${documentId}-p1-b1`, pageIndex0: 0, pageNumber1: 1, order: 0,
      blockType: "paragraph", text, bbox1000: [80, 120, 920, 320], confidence: 0.99,
      authority: "contractual",
    }],
  };
}

const compiled = compileCollectionCandidate([
  ocrInput("doc-one", "a".repeat(64), "The termination notice period is thirty days."),
  ocrInput("doc-two", "b".repeat(64), "Warranty coverage lasts twenty four months."),
]);
const ARTIFACT = {
  ...compiled,
  coreExecution: {
    status: "completed",
    runtime: "tavonel-python-core-v2",
    worldStateId: "world-state-wiring",
    /*
      The artifact counts and the verdict are what `dispatchProductCoreV2` stores and what the
      promote route's equivalence gate now reads (audit TM02). `not_run` is what every compile
      on this deployment reports, and it promotes.
    */
    receipt: {
      requestId: "core-proof",
      outputSha256: compiled.manifestDigest,
      candidatePromotion: false,
      equivalence: "not_run",
      totalArtifacts: 8,
      rebuiltArtifacts: 8,
      workAvoidedArtifacts: 0,
    },
  },
};
const COLLECTION = ARTIFACT.collectionId;
const MANIFEST = ARTIFACT.manifestDigest;
const params = Promise.resolve({ id: COLLECTION });

/* ------------------------------------------------------- the in-memory PostgREST */

type Row = Record<string, unknown>;
let runs: Row[];
let units: Row[];
let refuseRunInsert: boolean;
let refuseUnitInsert: boolean;
let failRunReads: boolean;
let failCompletedRunReads: boolean;
let requests: string[];

function jsonResponse(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
}

/** PostgREST's `col=eq.value` filters, honoured so a test cannot pass on an unscoped query. */
function matchesFilters(href: string, row: Row, columns: string[]) {
  const query = decodeURIComponent(href.split("?")[1] ?? "");
  return columns.every((column) => {
    const match = new RegExp(`(?:^|&)${column}=eq\\.([^&]*)`).exec(query);
    return match === null || String(row[column] ?? "") === match[1];
  });
}

beforeEach(() => {
  runs = [];
  units = [];
  refuseRunInsert = false;
  refuseUnitInsert = false;
  failRunReads = false;
  failCompletedRunReads = false;
  requests = [];
  resetWorkspaceCostGuard();

  getUser.mockReset().mockResolvedValue({ id: USER });
  pilotAccess.mockReset().mockReturnValue({ membership: { workspaceId: WORKSPACE, role: "owner" } });
  productAccess.mockReset().mockResolvedValue({ ok: true });
  getCandidate.mockReset().mockResolvedValue({ ok: true, json: ARTIFACT });
  listObjects.mockReset().mockResolvedValue({
    ok: true,
    objects: ARTIFACT.sourceDocuments.flatMap((document) => [
      { key: document.sanitizedKey, size: 100, lastModified: "2026-09-10T00:00:00.000Z" },
      { key: document.ocrJsonKey, size: 100, lastModified: "2026-09-10T00:01:00.000Z" },
    ]),
  });
  promote.mockReset().mockResolvedValue({ ok: true, result: { status: "active" } });
  sourceAccess.mockReset().mockResolvedValue({ ok: true });
  activeWorld.mockReset().mockResolvedValue({
    ok: true,
    world: {
      workspaceKey: WORKSPACE,
      collectionId: COLLECTION,
      manifestDigest: MANIFEST,
      revision: 1,
      updatedAt: "2026-09-11T00:00:00.000Z",
      candidateObjectKey: `immutable/${WORKSPACE}/${WORKSPACE}/collections/${COLLECTION}/${MANIFEST.slice(7)}/candidate-world.json`,
      worldStateId: "world-state-wiring",
      coreOutputSha256: MANIFEST,
    },
  });
  freshness.mockReset().mockResolvedValue({ ...EMPTY_WORLD_FRESHNESS, activeManifestDigest: MANIFEST });

  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_".padEnd(48, "x"));

  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push(`${method} ${href.split("/rest/v1/")[1] ?? href}`);

    if (href.includes("/rpc/connector_documents_blocked")) return jsonResponse(false);
    if (href.includes("/rpc/search_foundation_retrieval_units_lexical")) {
      // Every written unit, in write order. Ranking is not what this test is about; that the
      // lexical source is reached at all with the run the compile produced is.
      return jsonResponse(units.map((row) => ({ unit_id: row.unit_id, rank: 1 })));
    }
    if (href.includes("/rpc/search_foundation_retrieval_units_dense")) return jsonResponse([]);

    if (href.includes("foundation_retrieval_profiles")) {
      return method === "POST" ? jsonResponse(null) : jsonResponse([{ id: PROFILE.id }]);
    }
    if (href.includes("foundation_retrieval_compile_runs")) {
      if (method === "POST") {
        if (refuseRunInsert) return jsonResponse({ message: "world_not_active" }, false);
        runs.push({ ...(body as Row), started_at: new Date().toISOString() });
        return jsonResponse(null);
      }
      if (method === "PATCH") {
        const target = runs.find((row) => matchesFilters(href, row, ["workspace_key", "run_id"]));
        if (target) Object.assign(target, body as Row);
        return jsonResponse(null);
      }
      if (failRunReads) return jsonResponse({ message: "down" }, false);
      if (failCompletedRunReads && /(?:^|&)status=eq\.completed/.test(href)) {
        return jsonResponse({ message: "down" }, false);
      }
      const selected = runs.filter((row) =>
        matchesFilters(href, row, ["workspace_key", "collection_id", "world_manifest_digest", "retrieval_profile_id", "status"]),
      );
      // Both readers ask for `order=started_at.desc` with `limit=1`, and both narrow with
      // `status=eq.…` when they mean one status. The mock honours exactly that -- newest
      // first, nothing else -- so a reader that leaned on how the status strings happen to
      // sort would fail here instead of passing by accident.
      const ordered = [...selected].sort((left, right) =>
        String(right.started_at ?? "").localeCompare(String(left.started_at ?? "")),
      );
      const limit = /(?:^|&)limit=(\d+)/.exec(href);
      return jsonResponse(limit ? ordered.slice(0, Number(limit[1])) : ordered);
    }
    if (href.includes("foundation_retrieval_units")) {
      if (method === "POST") {
        if (refuseUnitInsert) return jsonResponse({ message: "write refused" }, false);
        units.push(...(body as Row[]));
        return jsonResponse(null);
      }
      const wanted = /unit_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(href));
      if (wanted) {
        const ids = new Set(wanted[1].split(",").filter(Boolean));
        return jsonResponse(units.filter((row) => ids.has(String(row.unit_id))));
      }
      return jsonResponse(units);
    }
    if (href.includes("foundation_retrieval_embeddings")) return jsonResponse(null);
    throw new Error(`unexpected fetch to ${href}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetWorkspaceCostGuard();
});

function promoteRequest() {
  return new Request(`https://tavonel.test/api/collections/${COLLECTION}/promote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer session" },
    body: JSON.stringify({ manifestDigest: MANIFEST, expectedCurrentManifest: null, reason: "Reviewed exact evidence." }),
  });
}

function queryRequest(path: "search" | "ask", value: string) {
  return new Request(`https://tavonel.test/api/collections/${COLLECTION}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer tvnl_live_probe" },
    body: JSON.stringify(path === "search" ? { query: value } : { question: value }),
  });
}

describe("promotion compiles the retrieval index", () => {
  it("makes search answer 200 with results instead of 409, and ask use the compiled path", async () => {
    const promoted = await promoteRoute(promoteRequest(), { params });
    expect(promoted.status).toBe(200);
    const promotedBody = await promoted.json();
    expect(promotedBody.code).toBe("WORLD_ACTIVE");
    expect(promotedBody.retrievalIndex).toMatchObject({ status: "compiled", errorClass: null });
    // The run row and the units exist, bound to this world version and this workspace.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      workspace_key: WORKSPACE,
      collection_id: COLLECTION,
      world_manifest_digest: MANIFEST,
      status: "completed",
    });
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((row) => row.workspace_key === WORKSPACE)).toBe(true);

    const searched = await searchRoute(queryRequest("search", "termination notice period"), { params });
    expect(searched.status).toBe(200);
    const searchBody = await searched.json();
    expect(searchBody.code).toBe("SEARCH_RESULTS");
    expect(searchBody.retrievalPath).toBe("compiled-retrieval-v1");
    expect(searchBody.contextPacket.items.length).toBeGreaterThan(0);
    expect(searchBody.degradations).toEqual(expect.any(Array));

    const asked = await askRoute(queryRequest("ask", "termination notice period"), { params });
    expect(asked.status).toBe(200);
    const askBody = await asked.json();
    expect(askBody.retrievalPath).toBe("compiled-retrieval-v1");
    expect(askBody.code).toBe("GROUNDED_ANSWER");
    // R4-02: the compiled path used to return citations with no answer text at all.
    expect(askBody.answerMode).toBe("evidence_excerpts");
    expect(typeof askBody.answer).toBe("string");
    expect(askBody.answer.length).toBeGreaterThan(0);
    expect(askBody.citations.length).toBeGreaterThan(0);
    expect(askBody.receipt.manifestDigest).toBe(MANIFEST);
  });

  it("does not compile twice for the same world version", async () => {
    expect((await promoteRoute(promoteRequest(), { params })).status).toBe(200);
    const unitsAfterFirst = units.length;

    const second = await promoteRoute(promoteRequest(), { params });
    expect(second.status).toBe(200);
    expect((await second.json()).retrievalIndex.status).toBe("compiled");
    // Idempotent per world version: the retry read the completed run and stopped there.
    expect(runs).toHaveLength(1);
    expect(units).toHaveLength(unitsAfterFirst);
  });
});

describe("a retrieval compile that fails does not fail the promotion", () => {
  it("still activates the World, and says the index failed rather than staying silent", async () => {
    refuseUnitInsert = true;

    const promoted = await promoteRoute(promoteRequest(), { params });
    // The pointer moved. A derived cache is not allowed to veto a human decision about
    // knowledge -- and it is not allowed to hide either.
    expect(promoted.status).toBe(200);
    const body = await promoted.json();
    expect(body.code).toBe("WORLD_ACTIVE");
    expect(body.retrievalIndex.status).toBe("failed");
    expect(body.retrievalIndex.errorClass).toBe("RETRIEVAL_COMPILE_UNIT_WRITE_FAILED");
    expect(promote).toHaveBeenCalledOnce();
    // The run row is durable and marked failed, which is what makes the state readable later
    // instead of only in the promotion's own response.
    expect(runs[0]).toMatchObject({ status: "failed" });

    const asked = await askRoute(queryRequest("ask", "termination notice period"), { params });
    expect(asked.status).toBe(200);
    const askBody = await asked.json();
    expect(askBody.retrievalPath).toBe("excerpt-concatenation-fallback");
    expect(askBody.answerMode).toBe("evidence_excerpts");
    // The notice names the state, not just the absence: "no index yet" and "the index failed"
    // are different operator problems and used to read identically.
    expect(askBody.retrievalIndex.status).toBe("failed");
    expect(askBody.retrievalNotice).toContain("failed to build");

    const searched = await searchRoute(queryRequest("search", "termination notice period"), { params });
    expect(searched.status).toBe(409);
    const searchBody = await searched.json();
    expect(searchBody.code).toBe("RETRIEVAL_RUN_NOT_FOUND");
    expect(searchBody.retrievalIndex.status).toBe("failed");
    expect(searchBody.retrievalNotice).toContain("failed to build");
  });

  it("reports a refused run as failed to the promoter, and as missing to a later reader", async () => {
    /*
      The honest limit, asserted rather than described.

      When the run row itself is refused -- 0021's trigger on a superseded world, or a store
      outage -- nothing durable is written, so the promotion's own response is the only place
      that failure appears. A later /ask reads an empty run table and correctly reports
      `missing`: there is no run. Making that read say `failed` would need somewhere to record
      it, which means a column, which means a migration this lane does not write. The lane
      report names this gap; this test is what stops it being forgotten.
    */
    refuseRunInsert = true;

    const promoted = await promoteRoute(promoteRequest(), { params });
    expect(promoted.status).toBe(200);
    expect((await promoted.json()).retrievalIndex).toMatchObject({
      status: "failed",
      errorClass: "RETRIEVAL_COMPILE_RUN_REJECTED",
    });
    expect(runs).toHaveLength(0);

    const asked = await askRoute(queryRequest("ask", "termination notice period"), { params });
    const askBody = await asked.json();
    expect(askBody.retrievalPath).toBe("excerpt-concatenation-fallback");
    expect(askBody.retrievalIndex.status).toBe("missing");
    expect(askBody.retrievalNotice).toContain("no compiled retrieval index exists");
  });

  it("reports an unreadable run table as failed rather than as a world with no index", async () => {
    /*
      Fail closed: a state that cannot be read is never reported as compiled, and never as a
      plain "not indexed yet" that an operator would sit and wait out.

      Read directly rather than through /ask, because /ask does not reach this state: a store
      read failure is not in its FALLBACK_CODES, so an outage is a 503 rather than a quiet
      downgrade to the weaker path. That is the older, correct behaviour and this test leaves
      it alone -- what is asserted here is what the index state says when it is asked.
    */
    failRunReads = true;
    const state = await readRetrievalIndexState({
      workspaceKey: WORKSPACE,
      collectionId: COLLECTION,
      worldManifestDigest: MANIFEST,
    });
    expect(state.status).toBe("failed");
    expect(state.errorClass).toBe("RETRIEVAL_STORE_READ_FAILED");
    expect(retrievalIndexNotice(state)).toContain("RETRIEVAL_STORE_READ_FAILED");

    const asked = await askRoute(queryRequest("ask", "termination notice period"), { params });
    expect(asked.status).toBe(503);
    expect((await asked.json()).code).toBe("RETRIEVAL_STORE_READ_FAILED");
  });
});

describe("which run describes the index, when several exist for one world version", () => {
  /*
    The precedence between runs used to be an artifact of the status strings.

    `findLatestRun` asked PostgREST for `order=status.asc` and took the first row, which put a
    `completed` run first only because "completed" sorts before "failed", "pending" and
    "running". Nothing in the code said so, and a fifth status in 0020's CHECK constraint --
    "aborted", "blocked", "canceled" -- would have outranked a queryable index silently. The
    precedence is now two explicit reads, and these are the two cases that tell the difference.
  */

  function run(id: string, status: string, startedAt: string, errorReason: string | null = null) {
    runs.push({
      run_id: `retrieval-run-${id.repeat(32).slice(0, 32)}`,
      workspace_key: WORKSPACE,
      collection_id: COLLECTION,
      world_manifest_digest: MANIFEST,
      retrieval_profile_id: PROFILE.id,
      status,
      started_at: startedAt,
      error_reason: errorReason,
    });
  }

  const scope = { workspaceKey: WORKSPACE, collectionId: COLLECTION, worldManifestDigest: MANIFEST };

  it("keeps a completed run authoritative over a newer failed retry", async () => {
    run("a", "completed", "2026-09-11T00:00:00.000Z");
    run("b", "failed", "2026-09-11T01:00:00.000Z", "RETRIEVAL_COMPILE_EMBED_FAILED");

    const state = await readRetrievalIndexState(scope);
    // The index is still queryable: a later attempt that failed did not delete the units.
    expect(state.status).toBe("compiled");
    expect(state.errorClass).toBeNull();
  });

  it("reports the newest attempt when none completed, rather than the alphabetically first", async () => {
    run("c", "failed", "2026-09-11T00:00:00.000Z", "RETRIEVAL_COMPILE_EMBED_FAILED");
    run("d", "running", "2026-09-11T01:00:00.000Z");

    const state = await readRetrievalIndexState(scope);
    // The old ordering answered `failed` here, because "failed" < "running" -- reporting a
    // stale failure while a rebuild was in flight. The current state is the rebuild.
    expect(state.status).toBe("missing");
    expect(state.errorClass).toBe("RETRIEVAL_COMPILE_RUN_INCOMPLETE");
  });

  it("fails closed when the completed-run read fails, instead of answering from the second read", async () => {
    // Fail closed on the two-read path: the first read decides whether a queryable index
    // exists, so a read that did not complete must not be treated as "no completed run".
    run("e", "completed", "2026-09-11T00:00:00.000Z");
    failCompletedRunReads = true;

    const state = await readRetrievalIndexState(scope);
    expect(state.status).toBe("failed");
    expect(state.errorClass).toBe("RETRIEVAL_STORE_READ_FAILED");
  });
});
