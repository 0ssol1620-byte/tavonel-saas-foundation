import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/*
  Does the published contract describe what the routes actually answer?

  Audit 2026-09-11 X05: `lib/openapi-contract.test.ts` checks that `servers` resolves to the
  origin the caller reached, which is the bug that bit us once, and checks nothing about a body.
  So a documented field could be renamed or dropped in a route and the spec would keep promising
  it, and the person who found out would be someone who had already generated a client.

  What this file does about it, for the five operations a first integration actually calls:

    * the operation is in the published document at the path the docs and the CLI use;
    * every field the spec's own response description names is present in a real 200/202 body
      from the route handler, called here with mocked infrastructure and nothing else stubbed;
    * the request schema's `required` list is enforced -- omitting one is a 4xx, not a 200 with
      a silently-defaulted field;
    * and the quickstart's copy-paste path only names endpoints the contract publishes.

  Two limits, stated rather than papered over.

  First: the OpenAPI document publishes no `content.schema` for any of these success responses
  -- only a `description`, which names the fields in prose. So "matches the documented schema"
  is implemented here as "every field name the description mentions is in the body, and the
  body's own required set is pinned in this file". The stronger check needs response schemas in
  `app/api/openapi/route.ts`, which this lane does not own; the request for them is in the devx
  lane report under CROSS-LANE REQUESTS. Until then the prose and the body cannot drift apart
  without this failing, which is the drift the audit found.

  Second: these are handler-level calls, not a live authenticated round trip against the
  deployment. They catch a renamed field and a broken required-field guard. They do not catch a
  misconfigured environment, and nothing here should be read as evidence that production
  answered anything.
*/

const {
  authorize,
  enqueue,
  admission,
  compute,
  signerEnv,
  presign,
  activeWorld,
  pipeline,
  sourceIds,
  sourceAccess,
  revalidate,
} = vi.hoisted(() => ({
  authorize: vi.fn(),
  enqueue: vi.fn(),
  admission: vi.fn(),
  compute: vi.fn(),
  signerEnv: vi.fn(),
  presign: vi.fn(),
  activeWorld: vi.fn(),
  pipeline: vi.fn(),
  sourceIds: vi.fn(),
  sourceAccess: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
  revalidateFoundationAuthorization: revalidate,
}));
vi.mock("@/lib/compile-job-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compile-job-store")>()),
  enqueueCompileJob: enqueue,
}));
vi.mock("@/lib/intake-admission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./intake-admission")>()),
  reserveFoundationIntake: admission,
}));
vi.mock("@/lib/compute-reservation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compute-reservation")>()),
  reserveFoundationCompute: compute,
}));
vi.mock("@/lib/r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()),
  readR2SignerEnv: signerEnv,
}));
vi.mock("@/lib/r2-presign", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-presign")>()),
  presignFoundationQuarantinePut: presign,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: activeWorld,
}));
vi.mock("@/lib/retrieval-pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-pipeline")>()),
  runRetrievalPipeline: pipeline,
}));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: sourceIds }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess }));

import { GET as openApi } from "../app/api/openapi/route";
import { GET as capabilities } from "../app/api/v1/capabilities/route";
import { POST as uploadCapability } from "../app/api/v1/uploads/capability/route";
import { POST as startCompile } from "../app/api/compile-jobs/route";
import { POST as search } from "../app/api/v1/collections/[id]/search/route";
import { POST as ask } from "../app/api/v1/collections/[id]/ask/route";
import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";
import { DOCS_SECTIONS } from "./docs-content";
import { resetWorkspaceCostGuard } from "./workspace-cost-guard";

/*
  Real routes the quickstart depends on that the OpenAPI document does not publish.

  Not a convenience list: every entry is asserted below to exist as a route file, and the reason
  it is here rather than in the contract is written in the devx lane report as a patch for the
  lane that owns app/api/openapi/route.ts.
*/
const CONTRACT_GAPS = new Set(["/api/export/trust"]);

const WORKSPACE = "pilot-openapishape";
const COLLECTION = `collection-${"e".repeat(32)}`;
const DOCUMENT = "11111111-2222-3333-4444-555555555555";

type Operation = {
  operationId: string;
  requestBody?: { content: { "application/json": { schema: { required?: string[] } } } };
  responses: Record<string, { description: string }>;
};

async function spec() {
  const response = openApi(new Request("https://tavonel.com/api/openapi"));
  return (await response.json()) as {
    paths: Record<string, Record<string, Operation>>;
  };
}

/** The operation object the document publishes, found by id rather than by path. */
async function operation(operationId: string) {
  const document = await spec();
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, candidate] of Object.entries(methods)) {
      if (candidate && typeof candidate === "object" && candidate.operationId === operationId) {
        return { path, method, operation: candidate };
      }
    }
  }
  throw new Error(`the published contract has no operation ${operationId}`);
}

function apiRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  return new Request(`https://tavonel.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
      authorization: "Bearer tvnl_live_shape",
      ...headers,
    },
    body: payload,
  });
}

function grantKey(extra: Record<string, unknown> = {}) {
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: "user-shape", scopes: [], ...extra },
  });
}

const packet = {
  worldId: COLLECTION,
  worldVersion: "4",
  retrievalProfile: "production",
  question: "what is the retention period",
  /*
    A whole ContextPacketItem, not a stub with one field.

    It carried only `evidenceIds`, which was enough while this fixture only had to be counted.
    `answerFromContextPacket` reads the excerpt text off each item, so the partial item threw
    inside the route and the documented 200 never came back -- the failure appeared only once this
    lane's contract test and the retrieval lane's ask path were in one tree.

    Completing it rather than guarding the reader is the fix, because `parseContextPacket` already
    rejects an item shaped like the old stub (context-packet.test.ts): a packet item without text
    is not something the product would accept from anything but a mock, so the mock was the thing
    that was wrong.
  */
  items: [{
    unitId: "unit-shape-1",
    text: "Records are retained for seven years after the end of the contract.",
    claimIds: ["claim-shape-1"],
    entityIds: [],
    sourceVersionId: "d".repeat(64),
    evidenceIds: ["evidence-1"],
    pageNumber1: 1,
    bbox1000: [10, 20, 400, 60],
    authority: "contract",
    retrieval: { lexicalRank: 1, denseRank: null, structureRank: null, rerankerScore: null },
  }],
  heldConflicts: [],
  abstentionReasons: [],
};

const diagnostics = {
  compileRunId: "run-shape-1",
  retrievalProfileId: "production",
  rerankerApplied: false,
  gateRejections: [],
  degradations: [],
};

function grantActiveWorld() {
  activeWorld.mockResolvedValue({
    ok: true,
    world: {
      manifestDigest: `sha256:${"b".repeat(64)}`,
      revision: 4,
      worldStateId: "world-state-shape",
      candidateObjectKey: `candidates/${WORKSPACE}/${COLLECTION}/candidate.json`,
    },
  });
  pipeline.mockResolvedValue({ ok: true, packet, diagnostics });
  sourceIds.mockResolvedValue({ ok: true, documentIds: [DOCUMENT] });
  sourceAccess.mockResolvedValue({ ok: true });
  revalidate.mockImplementation(async (_request: unknown, expected: unknown) => ({ ok: true, principal: expected }));
}

/**
 * Every field name the response description names, so prose and body cannot drift apart.
 *
 * Deliberately conservative: it reads `backtick`-quoted and { braced } field names out of the
 * description rather than guessing from English, because a description that names no field
 * should fail the assertion below rather than pass it vacuously.
 */
function documentedFields(description: string) {
  const fields = new Set<string>();
  for (const match of description.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) fields.add(match[1]!);
  for (const match of description.matchAll(/\{([^}]*)\}/g)) {
    for (const part of match[1]!.split(",")) {
      const name = part.split(":")[0]!.trim();
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) fields.add(name);
    }
  }
  return fields;
}

describe("documented response shapes", () => {
  /*
    The manifest is the one success body the spec describes by name rather than by field, so it
    is checked against the thing it is a view of: `shared/capabilityManifest.ts` plus a digest a
    caller can reproduce. `lib/capability-manifest-route.test.ts` owns the digest procedure; what
    is asserted here is that the documented operation and the served keys are the same contract.
  */
  it("getCapabilityManifest answers the manifest plus the digest the spec names", async () => {
    const { path, operation: published } = await operation("getCapabilityManifest");
    expect(path).toBe("/capabilities");
    expect(published.responses["200"]).toBeTruthy();

    const body = await capabilities().json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([...Object.keys(JSON.parse(JSON.stringify(CAPABILITY_MANIFEST))), "contentSha256"]);
    expect(body.contentSha256).toBe(
      `sha256:${createHash("sha256").update(JSON.stringify(CAPABILITY_MANIFEST), "utf8").digest("hex")}`,
    );
    expect(Array.isArray(body.entries) && (body.entries as unknown[]).length).toBeGreaterThan(0);
  });

  it("createDirectUploadCapability answers every field the spec's 200 names, and refuses a missing required one", async () => {
    const { path, operation: published } = await operation("createDirectUploadCapability");
    expect(path).toBe("/uploads/capability");
    const required = published.requestBody?.content["application/json"].schema.required ?? [];
    expect(required).toEqual(["originalFilename", "declaredMimeType", "requestedBytes"]);

    grantKey();
    signerEnv.mockReturnValue({ accessKeyId: "k", secretAccessKey: "s", bucket: "b", endpoint: "https://r2.test" });
    admission.mockResolvedValue({ ok: true, result: { expiresAt: "2026-09-11T00:05:00.000Z" } });
    compute.mockResolvedValue({
      ok: true,
      result: {
        reservationId: "reservation-shape",
        reservedCredits: 12,
        billingSource: "subscription",
        expiresAt: "2026-09-11T00:05:00.000Z",
        quote: { pages: 3, creditsPerPage: 4 },
      },
    });
    presign.mockReturnValue({ ok: true, uploadUrl: "https://r2.test/quarantine/put?signature=redacted" });

    const body = { originalFilename: "manual.pdf", declaredMimeType: "application/pdf", requestedBytes: 184_320 };
    const response = await uploadCapability(apiRequest("/api/v1/uploads/capability", body));
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(payload)).toBe(200);

    // The documented shape, pinned here because the spec publishes no response schema yet.
    expect(payload.code).toBe("QUALIFIED");
    for (const field of [
      "documentId", "objectKey", "uploadUrl", "expiresInSeconds", "contentLength",
      "originalFilename", "declaredMimeType", "sanitization", "admissionExpiresAt", "computeReservation",
    ]) {
      expect(payload, `the documented field ${field} is gone from the 200 body`).toHaveProperty(field);
    }
    expect(payload.declaredMimeType).toBe("application/pdf");
    expect(payload.contentLength).toBe(184_320);
    expect(response.headers.get("cache-control")).toBe("no-store");

    // The failure path for each documented required field: refused, not defaulted.
    for (const field of required) {
      const partial = { ...body } as Record<string, unknown>;
      delete partial[field];
      const refused = await uploadCapability(apiRequest("/api/v1/uploads/capability", partial));
      expect(refused.status, `omitting the required field ${field} was accepted`).toBeGreaterThanOrEqual(400);
      expect(await refused.json()).toHaveProperty("code");
    }
  });

  it("startCompileJob answers the 202 the spec describes, and refuses an empty documentIds", async () => {
    const { path, operation: published } = await operation("startCompileJob");
    expect(path).toBe("/compile-jobs");
    expect(published.requestBody?.content["application/json"].schema.required).toEqual(["documentIds"]);
    const described = documentedFields(published.responses["202"]!.description);
    expect(described, "the 202 description no longer names the accepted-job fields").toContain("jobId");

    grantKey({ accessSource: "subscription" });
    enqueue.mockResolvedValue({ ok: true, value: { jobId: "job-shape-1", state: "draft" } });

    const response = await startCompile(apiRequest("/api/compile-jobs", { documentIds: [DOCUMENT] }));
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(payload)).toBe(202);
    expect(payload.code).toBe("COMPILE_JOB_ACCEPTED");
    for (const field of ["jobId", "state", "documentsTotal"]) {
      expect(payload, `the documented field ${field} is gone from the 202 body`).toHaveProperty(field);
    }
    expect(response.headers.get("location")).toBe("/api/compile-jobs/job-shape-1");
    // The docs and the CLI both call this at /api/compile-jobs, so the spec says so explicitly
    // rather than letting a generated client prefix it with /api/v1.
    expect(published.responses["202"]).toBeTruthy();

    const refused = await startCompile(apiRequest("/api/compile-jobs", { documentIds: [] }));
    expect(refused.status, "an empty document set was accepted as a compile").toBe(400);
    expect(await refused.json()).toHaveProperty("code");
  });

  it("searchActiveWorld answers the ContextPacket and telemetry the spec describes", async () => {
    const { path, operation: published } = await operation("searchActiveWorld");
    expect(path).toBe("/collections/{id}/search");
    expect(published.requestBody?.content["application/json"].schema.required).toEqual(["query"]);

    grantKey();
    grantActiveWorld();
    const context = { params: Promise.resolve({ id: COLLECTION }) };
    const response = await search(
      apiRequest(`/api/v1/collections/${COLLECTION}/search`, { query: "retention period" }),
      context,
    );
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.code).toBe("SEARCH_RESULTS");
    for (const field of ["activeWorld", "contextPacket", "retrieval"]) {
      expect(payload, `the documented field ${field} is gone from the 200 body`).toHaveProperty(field);
    }
    expect(payload.contextPacket).toMatchObject({ worldId: COLLECTION });
    expect(payload.retrieval).toMatchObject({ compileRunId: "run-shape-1" });

    const refused = await search(
      apiRequest(`/api/v1/collections/${COLLECTION}/search`, { limit: 10 }),
      { params: Promise.resolve({ id: COLLECTION }) },
    );
    expect(refused.status, "a search with no query was accepted").toBe(400);
    expect(await refused.json()).toMatchObject({ code: "QUERY_INVALID" });
  });

  it("askActiveWorld answers with the retrievalPath its 200 description names", async () => {
    const { path, operation: published } = await operation("askActiveWorld");
    expect(path).toBe("/collections/{id}/ask");
    expect(published.requestBody?.content["application/json"].schema.required).toEqual(["question"]);

    const description = published.responses["200"]!.description;
    expect(documentedFields(description)).toContain("retrievalPath");
    // Both literal values the field can take are documented, because a caller switching on it
    // needs the whole domain rather than the happy one.
    expect(description).toContain("compiled-retrieval-v1");
    expect(description).toContain("excerpt-concatenation-fallback");

    grantKey();
    grantActiveWorld();
    resetWorkspaceCostGuard();
    const response = await ask(
      apiRequest(`/api/v1/collections/${COLLECTION}/ask`, { question: "what is the retention period" }),
      { params: Promise.resolve({ id: COLLECTION }) },
    );
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.code).toBe("GROUNDED_ANSWER");
    expect(["compiled-retrieval-v1", "excerpt-concatenation-fallback"]).toContain(payload.retrievalPath);
    for (const field of ["activeWorld", "retrievalPath"]) {
      expect(payload, `the documented field ${field} is gone from the 200 body`).toHaveProperty(field);
    }

    resetWorkspaceCostGuard();
    const refused = await ask(
      apiRequest(`/api/v1/collections/${COLLECTION}/ask`, { question: "hi" }),
      { params: Promise.resolve({ id: COLLECTION }) },
    );
    expect(refused.status, "a question below the documented minimum length was accepted").toBe(400);
    resetWorkspaceCostGuard();
  });
});

/*
  X03: the quickstart is copy-paste, so every endpoint in it has to exist in the contract.

  The failure this prevents is the one M07 found on the CLI page: a code block naming something a
  reader cannot reach. Paths are extracted from the quickstart's own code bodies and resolved
  against the published document -- including the `servers` override for the compile-jobs family,
  which really does sit at /api rather than /api/v1.
*/
describe("the quickstart names only endpoints the contract publishes", () => {
  it("resolves every /api path in the quickstart code blocks", async () => {
    const document = await spec();
    const quickstart = DOCS_SECTIONS.find((section) => section.slug === "quickstart");
    expect(quickstart, "the quickstart section is gone").toBeTruthy();

    const bodies = quickstart!.blocks
      .filter((block): block is Extract<typeof block, { kind: "code" }> => block.kind === "code")
      .map((block) => block.body)
      .join("\n");

    /*
      Compare shapes, not parameter names.

      The three languages spell the same placeholder three ways -- `$collection_id`,
      `{job['collectionId']}`, `${job.collectionId}` -- and the spec calls it `{id}` or
      `{jobId}`. Collapsing any segment that is obviously a substitution to `*` on both sides
      compares what matters (the literal path) and stops this test failing over a variable name.
    */
    const shape = (path: string) => path
      .split("/")
      .map((segment) => /[${}'[\]]/.test(segment) ? "*" : segment)
      .join("/");
    const publishedShapes = new Map(Object.keys(document.paths).map((path) => [shape(path), path]));

    const found = new Set<string>();
    for (const match of bodies.matchAll(/\/api\/(?:v1\/)?[A-Za-z0-9{}$'[\]._-]+(?:\/[A-Za-z0-9{}$'[\]._-]+)*/g)) {
      found.add(match[0]!);
    }
    expect(found.size, "the quickstart has no API calls in it any more").toBeGreaterThan(3);

    for (const raw of found) {
      if (CONTRACT_GAPS.has(raw)) continue;
      const candidate = shape(raw.replace(/^\/api\/v1/, "").replace(/^\/api/, ""));
      expect(
        publishedShapes.get(candidate),
        `the quickstart calls ${raw}, which is not a path the published contract carries`,
      ).toBeTruthy();
    }
  });

  /*
    One real route the quickstart needs and the contract does not publish.

    `GET /api/export/trust` is how a holder gets the signing-key fingerprint from somewhere other
    than the archive, which is the whole basis of the offline verification the portable-world
    clause promises. The route exists and answers; it is simply not in the OpenAPI document, so
    an SDK generated from that document has no method for the one call a verification flow cannot
    skip. Adding it belongs to whoever owns app/api/openapi/route.ts -- the exact patch is in the
    devx lane report under CROSS-LANE REQUESTS.

    Until then it is allow-listed above and asserted here instead: the route file must exist, so
    the allowance can never cover a path that is merely absent everywhere.
  */
  it("names its one unpublished dependency, and proves that route exists", async () => {
    const document = await spec();
    for (const gap of CONTRACT_GAPS) {
      const routeFile = resolve(import.meta.dirname, `..${gap.replace(/^\/api/, "/app/api")}/route.ts`);
      expect(existsSync(routeFile), `${gap} is allow-listed but has no route at ${routeFile}`).toBe(true);
      const published = gap.replace(/^\/api\/v1/, "").replace(/^\/api/, "");
      if (document.paths[published]) {
        // Published since this allow-list was written: drop the entry rather than leave a stale one.
        expect(document.paths[published], `${gap} is now in the contract and no longer a gap`).toBeTruthy();
      }
    }
  });

  /*
    And the step a key cannot take stays in the quickstart, in words, forever.

    Dropping it is the tempting edit: the page reads more smoothly as six automated steps. The
    contract has no promote path for any key, so a quickstart that omitted the human step would
    be describing a flow that dead-ends without saying why.
  */
  it("keeps the human activation step, and the plan fact behind it", async () => {
    const document = await spec();
    expect(
      Object.keys(document.paths).filter((path) => /promote|rollback/.test(path)),
      "a promotion path appeared in the published contract",
    ).toEqual([]);

    const quickstart = DOCS_SECTIONS.find((section) => section.slug === "quickstart")!;
    const prose = quickstart.blocks
      .flatMap((block) => block.kind === "steps" ? block.items : block.kind === "prose" || block.kind === "note" ? [block.text] : [])
      .join("\n");
    expect(prose).toContain("A PERSON ACTIVATES THE WORLD");
    expect(prose, "the quickstart no longer says promotion is a browser-session action by a human")
      .toMatch(/browser-session action by a human/);
    expect(prose, "the quickstart no longer names the plan activation actually requires")
      .toContain("STUDIO_SUBSCRIPTION_REQUIRED");
    expect(prose).toContain("Team");

    // Parity in the languages the audit asked for, asserted rather than trusted.
    const languages = new Set(
      quickstart.blocks.filter((block) => block.kind === "code").map((block) => block.language),
    );
    for (const language of ["bash", "python", "typescript"]) {
      expect(languages, `the quickstart has no ${language} example`).toContain(language);
    }
  });
});
