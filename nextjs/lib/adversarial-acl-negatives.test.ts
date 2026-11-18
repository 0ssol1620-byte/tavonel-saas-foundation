import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D15-3 / M4-03: named adversarial route negatives, expandable by a seeded generator.

  CONTRACT tests, not database tests (same limits as tenant-isolation-negative.test.ts): the
  stores are fakes that scope by workspace key the way the real ones do, so what is asserted is
  what a route can get wrong on its own -- which workspace it hands the store, the status class
  it answers with, and whether the body says more than {code, documentIds}. Deployed IDOR, BOLA
  and RLS behaviour is NOT proved here (EG-06).

  Per case: status in the refusal set, Cache-Control no-store, body keys within
  {code, documentIds}, no foreign key / id / title / count field / evidence text anywhere in
  the body, and every store call scoped to the caller. Foreign and unknown ids are compared
  byte for byte. Refusal CLASS is asserted, never an exact code: PR #247 changes some codes.

  `ADVERSARIAL_N` (default 50) is how many seeded generated cases run on top of the named
  table; the qualification run uses ADVERSARIAL_N=1000. `ADVERSARIAL_SEED` pins the stream.
*/

const MINE = "pilot-alpha";
const THEIRS = "pilot-beta";
const THEIR_COLLECTION = `collection-${"b".repeat(32)}`;
const UNKNOWN_COLLECTION = `collection-${"9".repeat(32)}`;
const THEIR_JOB = `cjob-${"b".repeat(32)}`;
const UNKNOWN_JOB = `cjob-${"9".repeat(32)}`;
const THEIR_DOCUMENT = "doc-beta-secret-0001";
const UNKNOWN_DOCUMENT = "doc-nobody-0002";
const EVIDENCE_TEXT = "BETA-EVIDENCE-SENTINEL-TEXT";
const THEIR_TITLE = "Beta Confidential Title";

const REFUSAL_STATUSES = new Set([400, 401, 403, 404, 409, 422, 503]);
const ALLOWED_BODY_KEYS = new Set(["code", "documentIds"]);
const COUNT_KEYS = ["count", "total", "sources", "items"];
const LEAKS = [THEIRS, THEIR_COLLECTION, THEIR_JOB, THEIR_DOCUMENT, EVIDENCE_TEXT, THEIR_TITLE];

// The fake data: only pilot-beta owns anything. A store answers absence for every other key.
const DATA: Record<string, { collections: Set<string>; jobs: Set<string>; documents: Set<string> }> = {
  [THEIRS]: {
    collections: new Set([THEIR_COLLECTION]),
    jobs: new Set([THEIR_JOB]),
    documents: new Set([THEIR_DOCUMENT]),
  },
};

const scopes: string[] = [];
const record = (workspace: unknown) => { scopes.push(String(workspace)); };

const h = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidate: vi.fn(),
  requestUser: vi.fn(),
  pilotAccess: vi.fn(),
  productAccess: vi.fn(),
  activationAccess: vi.fn(),
  spend: vi.fn(),
  activeWorld: vi.fn(),
  readModel: vi.fn(),
  loadCandidate: vi.fn(),
  signerEnv: vi.fn(),
  readJob: vi.fn(),
  advanceJob: vi.fn(),
  listObjects: vi.fn(),
  connector: vi.fn(),
  rateLimit: vi.fn(),
  getCandidate: vi.fn(),
  rollbackAccess: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: h.authorize,
  revalidateFoundationAuthorization: h.revalidate,
}));
vi.mock("@/lib/foundation-pilot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./foundation-pilot")>()),
  getRequestUser: h.requestUser,
  foundationPilotAccess: h.pilotAccess,
}));
vi.mock("@/lib/billing-product-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./billing-product-access")>()),
  authorizeFoundationProduct: h.productAccess,
}));
vi.mock("@/lib/trial-ai-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trial-ai-access")>()),
  authorizeWorldActivation: h.activationAccess,
  spendTrialSessionQuery: h.spend,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: h.activeWorld,
}));
vi.mock("@/lib/world-read-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-read-model")>()),
  loadWorldReadModel: h.readModel,
}));
vi.mock("@/lib/collection-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-storage")>()),
  loadPreferredCollectionCandidate: h.loadCandidate,
}));
vi.mock("@/lib/r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()),
  readR2SignerEnv: h.signerEnv,
}));
vi.mock("@/lib/compile-job-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compile-job-store")>()),
  readCompileJob: h.readJob,
  advanceCompileJob: h.advanceJob,
}));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  listImmutableWorkspaceObjects: h.listObjects,
  getWorkspaceCollectionCandidate: h.getCandidate,
}));
vi.mock("@/lib/activation-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./activation-rate-limit")>()),
  checkActivationRateLimit: h.rateLimit,
}));
vi.mock("@/lib/world-rollback-source-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-rollback-source-access")>()),
  checkRollbackSourceAccess: h.rollbackAccess,
}));
vi.mock("@/lib/connector-source-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connector-source-access")>()),
  checkConnectorSourceAccessForViewer: h.connector,
}));

import { POST as ask } from "../app/api/collections/[id]/ask/route";
import { GET as collectionGet } from "../app/api/collections/[id]/route";
import { GET as download } from "../app/api/collections/[id]/download/route";
import { POST as promote } from "../app/api/collections/[id]/promote/route";
import { POST as search } from "../app/api/collections/[id]/search/route";
import { POST as rollback } from "../app/api/collections/[id]/world/rollback/route";
import { POST as jobCancel } from "../app/api/compile-jobs/[jobId]/cancel/route";
import { GET as jobEvents } from "../app/api/compile-jobs/[jobId]/events/route";
import { GET as jobGet } from "../app/api/compile-jobs/[jobId]/route";
import { GET as candidates } from "../app/api/documents/[id]/candidates/route";
import { GET as documentSource } from "../app/api/documents/[id]/source/route";
import { GET as v1World } from "../app/api/v1/world/[id]/route";
import { GET as v1Lens } from "../app/api/v1/world/[id]/[lens]/route";

const alpha = { ok: true, principal: { kind: "api-key", workspaceKey: MINE, userId: "user-alpha", scopes: [], workspaceRole: "owner" } };
const alphaUser = { id: "user-alpha" };
const alphaPilot = (role: string) => ({ membership: { workspaceId: MINE, role } });

function resetFakes() {
  scopes.length = 0;
  h.authorize.mockResolvedValue(alpha);
  h.revalidate.mockResolvedValue(alpha);
  h.requestUser.mockResolvedValue(alphaUser);
  h.pilotAccess.mockReturnValue(alphaPilot("owner"));
  h.productAccess.mockResolvedValue({ ok: true });
  h.activationAccess.mockResolvedValue({ ok: true });
  h.spend.mockResolvedValue({ ok: true });
  h.signerEnv.mockReturnValue({ accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucket: "b" });
  h.connector.mockResolvedValue({ ok: true });
  // Without this the unmocked limiter answers 503 before any workspace-scoped lookup runs.
  h.rateLimit.mockResolvedValue({ ok: true });
  h.getCandidate.mockImplementation(async (_signer: unknown, workspace: string) => {
    record(workspace);
    return { ok: false, code: "NOT_FOUND" };
  });
  h.rollbackAccess.mockImplementation(async (workspace: string) => {
    record(workspace);
    return { ok: false, code: "ROLLBACK_TARGET_NOT_FOUND", status: 404 };
  });
  // Workspace-scoped stores: absence for everything the caller's workspace does not own.
  h.activeWorld.mockImplementation(async (workspace: string, id: string) => {
    record(workspace);
    return DATA[workspace]?.collections.has(id) ? { ok: false, code: "UNEXPECTED_HIT" } : { ok: false, code: "ACTIVE_WORLD_NOT_FOUND" };
  });
  h.readModel.mockImplementation(async (workspace: string) => {
    record(workspace);
    return { ok: false, code: "WORLD_NOT_FOUND", status: 404 };
  });
  h.loadCandidate.mockImplementation(async (_signer: unknown, workspace: string) => {
    record(workspace);
    return { ok: false, code: "NOT_FOUND" };
  });
  h.readJob.mockImplementation(async (workspace: string, id: string) => {
    record(workspace);
    if (!/^cjob-[a-f0-9]{32}$/.test(id)) return { ok: false, code: "COMPILE_JOB_SCOPE_INVALID" };
    return { ok: false, code: DATA[workspace]?.jobs.has(id) ? "UNEXPECTED_HIT" : "COMPILE_JOB_NOT_FOUND" };
  });
  h.advanceJob.mockImplementation(async (workspace: string) => {
    record(workspace);
    return { ok: false, code: "COMPILE_JOB_NOT_FOUND" };
  });
  h.listObjects.mockImplementation(async (_signer: unknown, workspace: string) => {
    record(workspace);
    return { ok: true, objects: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakes();
});

// ---- route registry -------------------------------------------------------------------------

type Kind = "collection" | "job" | "document" | "world";
type Route = {
  name: string;
  kind: Kind;
  call: (id: string, headers?: Record<string, string>) => Promise<Response>;
};

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
// Percent-encode only for the URL; the handler receives the decoded param, as Next does.
const url = (path: string) => `https://tavonel.test${path}?workspaceKey=${THEIRS}&workspace_key=${THEIRS}`;
const hostileHeaders = (extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  authorization: "Bearer tvnl_live_probe",
  "x-workspace-key": THEIRS,
  "x-tavonel-workspace": THEIRS,
  ...extra,
});
const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  new Request(url(path), { method: "POST", headers: hostileHeaders(headers), body: JSON.stringify(body) });
const get = (path: string, headers?: Record<string, string>) =>
  new Request(url(path), { headers: hostileHeaders(headers) });
const safe = (id: string) => encodeURIComponent(id);

const PROMOTION = {
  operationId: "11111111-1111-4111-8111-111111111111",
  manifestDigest: `sha256:${"a".repeat(64)}`,
  expectedCurrentManifest: null,
  expectedCurrentRevision: 0,
  reason: "adversarial probe reason",
};
const ROLLBACK = {
  operationId: "22222222-2222-4222-8222-222222222222",
  targetManifestDigest: `sha256:${"a".repeat(64)}`,
  expectedCurrentManifest: `sha256:${"c".repeat(64)}`,
  expectedCurrentRevision: 2,
  reason: "adversarial probe reason",
};

const ROUTES: Record<string, Route> = {
  collectionGet: { name: "GET collections/[id]", kind: "collection", call: (id, x) => collectionGet(get(`/api/collections/${safe(id)}`, x), params({ id })) },
  ask: { name: "POST collections/[id]/ask", kind: "collection", call: (id, x) => ask(post(`/api/collections/${safe(id)}/ask`, { question: "What changed in the filing?", workspaceKey: THEIRS }, x), params({ id })) },
  search: { name: "POST collections/[id]/search", kind: "collection", call: (id, x) => search(post(`/api/collections/${safe(id)}/search`, { query: "what changed", workspaceKey: THEIRS }, x), params({ id })) },
  download: { name: "GET collections/[id]/download", kind: "collection", call: (id, x) => download(get(`/api/collections/${safe(id)}/download`, x), params({ id })) },
  v1World: { name: "GET v1/world/[id]", kind: "world", call: (id, x) => v1World(get(`/api/v1/world/${safe(id)}`, x), params({ id })) },
  v1Lens: { name: "GET v1/world/[id]/evidence", kind: "world", call: (id, x) => v1Lens(get(`/api/v1/world/${safe(id)}/evidence`, x), params({ id, lens: "evidence" })) },
  promote: { name: "POST collections/[id]/promote", kind: "collection", call: (id, x) => promote(post(`/api/collections/${safe(id)}/promote`, PROMOTION, x), params({ id })) },
  rollback: { name: "POST collections/[id]/world/rollback", kind: "collection", call: (id, x) => rollback(post(`/api/collections/${safe(id)}/world/rollback`, ROLLBACK, x), params({ id })) },
  jobGet: { name: "GET compile-jobs/[jobId]", kind: "job", call: (id, x) => jobGet(get(`/api/compile-jobs/${safe(id)}`, x), params({ jobId: id })) },
  jobEvents: { name: "GET compile-jobs/[jobId]/events", kind: "job", call: (id, x) => jobEvents(get(`/api/compile-jobs/${safe(id)}/events`, x), params({ jobId: id })) },
  jobCancel: { name: "POST compile-jobs/[jobId]/cancel", kind: "job", call: (id, x) => jobCancel(post(`/api/compile-jobs/${safe(id)}/cancel`, {}, x), params({ jobId: id })) },
  documentSource: { name: "GET documents/[id]/source", kind: "document", call: (id, x) => documentSource(get(`/api/documents/${safe(id)}/source`, x), params({ id })) },
  candidates: { name: "GET documents/[id]/candidates", kind: "document", call: (id, x) => candidates(get(`/api/documents/${safe(id)}/candidates`, x), params({ id })) },
};

// Routes that authenticate through authorizeFoundationRequest (API key or session principal).
const KEYED = ["collectionGet", "ask", "search", "download", "v1World", "v1Lens", "jobGet", "jobEvents", "jobCancel"];
// Routes that authenticate through getRequestUser + foundationPilotAccess (session only).
const SESSION = ["promote", "rollback", "documentSource", "candidates"];

const foreignId = (kind: Kind) => (kind === "job" ? THEIR_JOB : kind === "document" ? THEIR_DOCUMENT : THEIR_COLLECTION);
const unknownId = (kind: Kind) => (kind === "job" ? UNKNOWN_JOB : kind === "document" ? UNKNOWN_DOCUMENT : UNKNOWN_COLLECTION);

const TRAVERSAL = ["../../pilot-beta/collections", "..%2f..%2fetc%2fpasswd", `${THEIR_COLLECTION}/../${"d".repeat(32)}`, "collection-%2e%2e", "%00", "a/b"];
const OVERSIZED = "x".repeat(10_000);

// ---- the assertions every refusal must satisfy ------------------------------------------------

async function assertRefusal(label: string, response: Response, attackIds: string[] = []) {
  const text = await response.text();
  // Documents routes' own no-store gaps are asserted separately (NO_STORE_GAPS), not hidden.
  expect(REFUSAL_STATUSES.has(response.status), `${label}: status ${response.status}`).toBe(true);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error(`${label}: body is not JSON: ${text.slice(0, 80)}`); }
  expect(typeof body === "object" && body !== null && !Array.isArray(body), `${label}: body is an object`).toBe(true);
  const record_ = body as Record<string, unknown>;
  for (const key of Object.keys(record_)) expect(ALLOWED_BODY_KEYS.has(key), `${label}: key ${key}`).toBe(true);
  for (const key of COUNT_KEYS) expect(key in record_, `${label}: count field ${key}`).toBe(false);
  if ("documentIds" in record_) {
    expect(Array.isArray(record_.documentIds), `${label}: documentIds is an array`).toBe(true);
    for (const id of record_.documentIds as unknown[]) expect(typeof id === "string" && !LEAKS.includes(id), `${label}: documentId`).toBe(true);
  }
  for (const leak of [...LEAKS, ...attackIds.filter((id) => id.length > 0)]) {
    expect(text.includes(leak), `${label}: body contains ${leak.slice(0, 40)}`).toBe(false);
  }
  // Every store hop was asked about the caller's workspace and nobody else's.
  for (const scope of scopes) expect(scope, `${label}: store scope`).toBe(MINE);
  return { status: response.status, text, cache: response.headers.get("cache-control") };
}

// Source routes that do not yet send Cache-Control on every refusal. Recorded, not tolerated
// silently: the final describe asserts the gap still exists, so closing it fails that test and
// forces the entry out of this list. Fixing the routes is outside this work order's scope.
const NO_STORE_GAPS = new Set<string>(["documentSource"]);

function assertNoStore(key: string, label: string, cache: string | null) {
  if (NO_STORE_GAPS.has(key) && cache !== "no-store") return;
  expect(cache, `${label}: Cache-Control`).toBe("no-store");
}

// ---- named cases -----------------------------------------------------------------------------

type Named = { name: string; run: () => Promise<void> };
const named: Named[] = [];
const add = (name: string, run: () => Promise<void>) => named.push({ name, run });

for (const key of [...KEYED, ...SESSION]) {
  const route = ROUTES[key]!;
  const isKeyed = KEYED.includes(key);

  if (isKeyed) {
    add(`${route.name}: no credential`, async () => {
      h.authorize.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status: 401 });
      const r = await assertRefusal("no credential", await route.call(foreignId(route.kind)));
      expect(r.status).toBe(401);
      assertNoStore(key, "no credential", r.cache);
      expect(scopes).toEqual([]);
    });
    add(`${route.name}: revoked API key`, async () => {
      h.authorize.mockResolvedValue({ ok: false, code: "API_KEY_REVOKED", status: 401 });
      const r = await assertRefusal("revoked key", await route.call(foreignId(route.kind)));
      expect(r.status).toBe(401);
      assertNoStore(key, "revoked key", r.cache);
      expect(scopes).toEqual([]);
    });
    add(`${route.name}: key without the route's scope`, async () => {
      h.authorize.mockResolvedValue({ ok: false, code: "SCOPE_FORBIDDEN", status: 403 });
      const r = await assertRefusal("scope", await route.call(foreignId(route.kind)));
      expect(r.status).toBe(403);
      assertNoStore(key, "scope", r.cache);
    });
  } else {
    add(`${route.name}: no credential`, async () => {
      h.requestUser.mockResolvedValue(null);
      const r = await assertRefusal("no credential", await route.call(foreignId(route.kind)));
      expect(r.status).toBe(401);
      assertNoStore(key, "no credential", r.cache);
      expect(scopes).toEqual([]);
    });
    add(`${route.name}: session user outside the pilot`, async () => {
      h.pilotAccess.mockReturnValue(null);
      const r = await assertRefusal("no pilot", await route.call(foreignId(route.kind)));
      expect(r.status).toBe(403);
      assertNoStore(key, "no pilot", r.cache);
    });
    add(`${route.name}: member downgraded, product access refused`, async () => {
      h.productAccess.mockResolvedValue({ ok: false, code: "PLAN_REQUIRED", status: 403 });
      h.activationAccess.mockResolvedValue({ ok: false, code: "PLAN_REQUIRED", status: 403 });
      const r = await assertRefusal("downgraded", await route.call(foreignId(route.kind)));
      expect(r.status).toBe(403);
      assertNoStore(key, "downgraded", r.cache);
    });
  }

  add(`${route.name}: foreign id answers as absence`, async () => {
    const r = await assertRefusal("foreign id", await route.call(foreignId(route.kind)), [foreignId(route.kind)]);
    assertNoStore(key, "foreign id", r.cache);
    // A refusal before the store ran proves nothing about tenant scoping.
    if (key === "promote" || key === "rollback") expect(scopes.length, "store was asked").toBeGreaterThan(0);
  });
  add(`${route.name}: foreign id is byte-identical to an unknown id`, async () => {
    const foreign = await assertRefusal("foreign", await route.call(foreignId(route.kind)), [foreignId(route.kind)]);
    const unknown = await assertRefusal("unknown", await route.call(unknownId(route.kind)), [unknownId(route.kind)]);
    if (key === "promote" || key === "rollback") expect(scopes.length, "store was asked").toBeGreaterThan(0);
    expect(foreign.status).toBe(unknown.status);
    expect(foreign.text).toBe(unknown.text);
  });
  add(`${route.name}: path-traversal id`, async () => {
    for (const id of TRAVERSAL) {
      const r = await assertRefusal(`traversal ${id}`, await route.call(id), [id]);
      expect(r.status === 400 || r.status === 404 || r.status === 409 || r.status === 503, `traversal ${id}`).toBe(true);
      assertNoStore(key, `traversal ${id}`, r.cache);
    }
  });
  add(`${route.name}: oversized id`, async () => {
    const r = await assertRefusal("oversized", await route.call(OVERSIZED), [OVERSIZED]);
    assertNoStore(key, "oversized", r.cache);
  });
}

// Session-route authorisation edges that only apply to the activation endpoints.
for (const key of ["promote", "rollback"] as const) {
  add(`${ROUTES[key]!.name}: member downgraded to observer mid-session`, async () => {
    h.pilotAccess.mockReturnValue(alphaPilot("observer"));
    const r = await assertRefusal("observer", await ROUTES[key]!.call(THEIR_COLLECTION), [THEIR_COLLECTION]);
    expect(r.status).toBe(403);
    expect(r.cache).toBe("no-store");
  });
  add(`${ROUTES[key]!.name}: member downgraded to viewer role`, async () => {
    h.pilotAccess.mockReturnValue(alphaPilot("viewer"));
    const r = await assertRefusal("viewer", await ROUTES[key]!.call(THEIR_COLLECTION), [THEIR_COLLECTION]);
    expect(r.status).toBe(403);
  });
}

add("v1 world lens: lens outside the six is refused before any read", async () => {
  const response = await v1Lens(get(`/api/v1/world/${THEIR_COLLECTION}/..%2f..%2fdocuments`), params({ id: THEIR_COLLECTION, lens: "../../documents" }));
  const r = await assertRefusal("lens", response, [THEIR_COLLECTION]);
  expect(r.status).toBe(404);
  expect(h.readModel).not.toHaveBeenCalled();
  expect(h.activeWorld).not.toHaveBeenCalled();
});
for (const lens of ["workspace", "ADMIN", "evidence%00", "evidence/../../x", "", "__proto__"]) {
  add(`v1 world lens: unknown lens ${JSON.stringify(lens)}`, async () => {
    const response = await v1Lens(get(`/api/v1/world/${THEIR_COLLECTION}/x`), params({ id: THEIR_COLLECTION, lens }));
    const r = await assertRefusal("lens", response, [THEIR_COLLECTION]);
    expect(r.status).toBe(404);
    expect(h.readModel).not.toHaveBeenCalled();
  });
}

add("GET collections/[id]: connector source revoked after the candidate loaded", async () => {
  // The candidate load succeeds and names two sources; the connector check then says one was revoked.
  const documentIds = ["doc-mine-1", "doc-mine-2"];
  vi.resetModules();
  vi.doMock("@/lib/collection-download", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./collection-download")>()),
    validateReviewableCollectionArtifact: () => ({ stub: true }),
  }));
  vi.doMock("@/lib/collection-source-access", () => ({ collectionSourceDocumentIds: () => documentIds }));
  vi.doMock("@/lib/developer-auth", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./developer-auth")>()),
    authorizeFoundationRequest: async () => alpha,
  }));
  vi.doMock("@/lib/collection-storage", () => ({
    loadPreferredCollectionCandidate: async (_s: unknown, workspace: string) => {
      record(workspace);
      return { ok: true, value: { key: "k", artifact: { title: THEIR_TITLE, evidence: EVIDENCE_TEXT } } };
    },
  }));
  vi.doMock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ accountId: "a", accessKeyId: "i", secretAccessKey: "s", bucket: "b" }) }));
  vi.doMock("@/lib/connector-source-access", () => ({
    checkConnectorSourceAccessForViewer: async (workspace: string) => {
      record(workspace);
      return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED", documentIds };
    },
  }));
  const fresh = await import("../app/api/collections/[id]/route");
  const response = await fresh.GET(get(`/api/collections/${UNKNOWN_COLLECTION}`), params({ id: UNKNOWN_COLLECTION }));
  const r = await assertRefusal("connector revoked", response);
  expect(r.status).toBe(403);
  expect(r.cache).toBe("no-store");
  expect(JSON.parse(r.text)).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  vi.doUnmock("@/lib/collection-download");
  vi.doUnmock("@/lib/collection-source-access");
  vi.doUnmock("@/lib/developer-auth");
  vi.doUnmock("@/lib/collection-storage");
  vi.doUnmock("@/lib/r2-synthetic-canary");
  vi.doUnmock("@/lib/connector-source-access");
  vi.resetModules();
});

add("POST promote: oversized metadata refused before authentication", async () => {
  const response = await promote(
    new Request(url(`/api/collections/${THEIR_COLLECTION}/promote`), {
      method: "POST",
      headers: hostileHeaders({ "content-length": "999999" }),
      body: "{}",
    }),
    params({ id: THEIR_COLLECTION }),
  );
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain(THEIRS);
  expect(h.requestUser).not.toHaveBeenCalled();
});
add("POST rollback: oversized metadata refused before authentication", async () => {
  const response = await rollback(
    new Request(url(`/api/collections/${THEIR_COLLECTION}/world/rollback`), {
      method: "POST",
      headers: hostileHeaders({ "content-length": "999999" }),
      body: "{}",
    }),
    params({ id: THEIR_COLLECTION }),
  );
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(h.requestUser).not.toHaveBeenCalled();
});

// ---- seeded generator -------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const N = Math.max(0, Number.parseInt(process.env.ADVERSARIAL_N ?? "50", 10) || 0);
const SEED = Number.parseInt(process.env.ADVERSARIAL_SEED ?? "20261116", 10) || 20261116;

const MUTATIONS: Array<(id: string, rnd: () => number) => string> = [
  (id) => id.toUpperCase(),
  (id) => `${id}/..`,
  (id) => `../${id}`,
  (id) => `${id}%00`,
  (id) => `${id}\u0000`,
  (id) => encodeURIComponent(id),
  (id) => `${id} `,
  (id) => ` ${id}`,
  (id) => id.slice(0, -1),
  (id, rnd) => id + "f".repeat(1 + Math.floor(rnd() * 5000)),
  (id) => `${id}?workspaceKey=${THEIRS}`,
  (id) => `${id};${THEIRS}`,
  (id) => id.replace(/[a-f0-9]/g, "０"),
  () => "..",
  () => "%2e%2e%2f",
  () => "pilot-beta",
  () => "collection-",
  () => "__proto__",
];
const PICKABLE = [...KEYED, ...SESSION];

describe("named adversarial route negatives (M4-03)", () => {
  it("has at least 50 named cases", () => {
    expect(named.length).toBeGreaterThanOrEqual(50);
    expect(new Set(named.map((entry) => entry.name)).size).toBe(named.length);
  });
  for (const entry of named) it(entry.name, entry.run);
});

describe(`seeded generated negatives (ADVERSARIAL_N=${N}, seed ${SEED})`, () => {
  it("is reproducible: the same seed yields the same stream", () => {
    const a = mulberry32(SEED); const b = mulberry32(SEED);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it(`runs ${N} generated cases within the refusal contract`, async () => {
    const rnd = mulberry32(SEED);
    const failures: string[] = [];
    for (let i = 0; i < N; i += 1) {
      vi.clearAllMocks();
      resetFakes();
      const key = PICKABLE[Math.floor(rnd() * PICKABLE.length)]!;
      const route = ROUTES[key]!;
      const base = rnd() < 0.5 ? foreignId(route.kind) : unknownId(route.kind);
      const id = MUTATIONS[Math.floor(rnd() * MUTATIONS.length)]!(base, rnd);
      // Half the cases also fail authentication in a random way; the rest are authenticated as alpha.
      const authFailure = rnd();
      if (authFailure < 0.15) {
        h.authorize.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status: 401 });
        h.requestUser.mockResolvedValue(null);
      } else if (authFailure < 0.3) {
        h.authorize.mockResolvedValue({ ok: false, code: "API_KEY_REVOKED", status: 401 });
        h.pilotAccess.mockReturnValue(alphaPilot("observer"));
      } else if (authFailure < 0.4) {
        h.productAccess.mockResolvedValue({ ok: false, code: "PLAN_REQUIRED", status: 403 });
        h.activationAccess.mockResolvedValue({ ok: false, code: "PLAN_REQUIRED", status: 403 });
      }
      const smuggle = rnd() < 0.5 ? { "x-forwarded-workspace": THEIRS, "x-tenant": THEIRS, cookie: `workspace=${THEIRS}` } : undefined;
      const label = `#${i} ${route.name} id=${JSON.stringify(id.slice(0, 60))}`;
      try {
        const response = await route.call(id, smuggle);
        const r = await assertRefusal(label, response, id.length >= 8 && id !== ".." ? [id] : []);
        if (!NO_STORE_GAPS.has(key)) expect(r.cache, `${label}: Cache-Control`).toBe("no-store");
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures, failures.slice(0, 5).join("\n")).toEqual([]);
  });
});

describe("recorded gaps", () => {
  it("documents source and candidates still omit Cache-Control on some refusals (route fix is out of scope)", async () => {
    h.requestUser.mockResolvedValue(alphaUser);
    const invalid = await documentSource(get("/api/documents/x/source"), params({ id: "../x" }));
    const missing = await documentSource(get("/api/documents/y/source"), params({ id: UNKNOWN_DOCUMENT }));
    const seen = [invalid.headers.get("cache-control"), missing.headers.get("cache-control")];
    // If this fails the routes were fixed: delete the entry from NO_STORE_GAPS and this test.
    expect(seen).toContain(null);
  });
});
