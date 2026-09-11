import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  D7-03. What the compile route does with a source that was read before regions existed.

  It used to compile it. `buildProductCoreV2Request` filled the Core's mandatory `regions` with
  one invented entry -- page 1, no bbox, the whole document as its text -- so every citation from
  that document pointed at the cover page. A customer who followed the evidence to check a fact
  landed somewhere the fact is not, and because the bbox was omitted rather than invented the UI
  drew a page with no highlight, which reads as a rendering glitch rather than as misattribution.

  These tests drive `runCollectionCompile`, which is the one body both the public route and the
  durable job worker call, so the refusal reaches both. The R2 layer is stubbed because the
  question is what the compile does with what it read, not how it read it.
*/

const listed = vi.fn();
const fetched = vi.fn();
const put = vi.fn();
const dispatched = vi.fn();
const sourceAccess = vi.fn();

vi.mock("./r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "acct", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
const priorCandidate = vi.fn();
const activeWorld = vi.fn();

vi.mock("./r2-objects", () => ({
  listImmutableWorkspaceObjects: (...args: unknown[]) => listed(...args),
  getWorkspaceOcrJson: (...args: unknown[]) => fetched(...args),
  putWorkspaceCollectionCandidate: (...args: unknown[]) => put(...args),
  getWorkspaceCollectionCandidate: (...args: unknown[]) => priorCandidate(...args),
}));
vi.mock("./world-store", () => ({
  getFoundationActiveWorld: (...args: unknown[]) => activeWorld(...args),
}));
vi.mock("./core-runtime-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core-runtime-v2")>()),
  readProductCoreV2Env: () => ({ url: "https://core-v2.example", hmac: "x".repeat(32) }),
  dispatchProductCoreV2: (...args: unknown[]) => dispatched(...args),
  /*
    Enough of an artifact to reach persistence, and no more: these tests are about which
    request the Core is sent, not about what the projection makes of the answer -- that is
    core-runtime-v2.test.ts, which drives the real projection.
  */
  projectProductCoreV2Candidate: () => ({
    collectionId: `collection-${"0".repeat(32)}`,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    lifecycle: "candidate",
    sourceDocuments: [],
    blueprint: {},
    directoryPlan: [],
    ontology: { nodes: [], edges: [] },
    validation: { status: "passed", counts: {} },
    reviewReasons: [],
  }),
}));
vi.mock("./connector-source-access", () => ({
  checkConnectorSourceAccess: (workspaceId: string, documentIds: string[]) => sourceAccess(workspaceId, documentIds),
}));

const { runCollectionCompile } = await import("./collection-compile-run");

const WS = "pilot";
const VERSION = "a".repeat(64);
const DOCUMENT = "doc-legacy-ocr";
const PREFIX = `immutable/${WS}/${WS}/${DOCUMENT}/${VERSION}`;

function ocrResult(schemaVersion: string, regions: unknown) {
  const text = "The pump was inspected and the reading stayed inside the policy limits.";
  return {
    schemaVersion,
    pageCount: 1,
    text,
    inputSha256: `sha256:${VERSION}`,
    sourceImmutableKey: `${PREFIX}/sanitized.pdf`,
    ...(regions === undefined ? {} : { regions }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => sourceAccess.mockReset().mockResolvedValue({ ok: true }));

function readyWorkspace() {
  listed.mockResolvedValue({
    ok: true,
    objects: [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024 },
      { key: `${PREFIX}/ocr.json`, size: 512 },
    ],
  });
}

describe("a source read before region capture", () => {
  it("is refused with OCR_REGIONS_REQUIRED and never dispatched to the Core", async () => {
    readyWorkspace();
    // A v1 OCR result: real text, no record of where any of it was on the page.
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v1", undefined) });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(422);
      expect(run.code).toBe("OCR_REGIONS_REQUIRED");
      expect(run.payload).toEqual({ documentIds: [DOCUMENT] });
    }
    // Nothing was compiled, nothing was charged for, and nothing was written.
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("is refused the same way when the result is v2 but carries an empty region list", async () => {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", []) });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("OCR_REGIONS_REQUIRED");
    expect(dispatched).not.toHaveBeenCalled();
  });

  /*
    The two refusals stay distinguishable.

    A malformed OCR result is ours to fix; a document with no regions is "re-read the source".
    Collapsing both into OCR_BINDING_INVALID would leave the customer with one message for two
    different actions.
  */
  it("is told apart from a malformed OCR binding", async () => {
    readyWorkspace();
    fetched.mockResolvedValue({
      ok: true,
      json: { ...ocrResult("tavonel.ocr_result.v2", [{ regionId: "native-p0001" }]), inputSha256: "sha256:not-the-version-key" },
    });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("OCR_BINDING_INVALID");
      expect(run.status).toBe(422);
    }
  });

  it("still waits rather than failing when the reading has not finished", async () => {
    listed.mockResolvedValue({ ok: true, objects: [{ key: `${PREFIX}/sanitized.pdf`, size: 1024 }] });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("OCR_NOT_READY");
      expect(run.status).toBe(409);
    }
  });

  it("does not compile an older OCR result when a newer sanitized version is still being read", async () => {
    const newer = "b".repeat(64);
    listed.mockResolvedValue({ ok: true, objects: [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: `${PREFIX}/ocr.json`, size: 512, lastModified: "2026-09-09T00:01:00.000Z" },
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048,
        lastModified: "2026-09-10T00:00:00.000Z" },
    ] });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("OCR_NOT_READY");
    expect(fetched).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("refuses a multi-version source whose current version cannot be ordered", async () => {
    const newer = "c".repeat(64);
    listed.mockResolvedValue({ ok: true, objects: [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024 },
      { key: `${PREFIX}/ocr.json`, size: 512 },
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048 },
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/ocr.json`, size: 512 },
    ] });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("SOURCE_VERSION_AMBIGUOUS");
      expect(run.payload).toEqual({ documentIds: [DOCUMENT] });
    }
    expect(fetched).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("revalidates source versions after OCR load and before Core dispatch", async () => {
    const newer = "d".repeat(64);
    const first = [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: `${PREFIX}/ocr.json`, size: 512, lastModified: "2026-09-09T00:01:00.000Z" },
    ];
    listed.mockResolvedValueOnce({ ok: true, objects: first }).mockResolvedValueOnce({ ok: true, objects: [
      ...first,
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048,
        lastModified: "2026-09-10T00:00:00.000Z" },
    ] });
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [
      {
        regionId: "native-p0001",
        pageIndex0: 0,
        pageNumber1: 1,
        order: 0,
        blockType: "paragraph",
        bbox1000: [0, 0, 1000, 1000],
        text: "The pump was inspected and the reading stayed inside the policy limits.",
        confidence: 1,
        authority: "official",
      },
    ]) });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("SOURCE_VERSION_CHANGED");
      expect(run.payload).toEqual({ documentIds: [DOCUMENT] });
    }
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("refuses persistence when a source changes during Core execution", async () => {
    const newer = "e".repeat(64);
    const first = [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: `${PREFIX}/ocr.json`, size: 512, lastModified: "2026-09-09T00:01:00.000Z" },
    ];
    listed
      .mockResolvedValueOnce({ ok: true, objects: first })
      .mockResolvedValueOnce({ ok: true, objects: first })
      .mockResolvedValueOnce({ ok: true, objects: [
        ...first,
        { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048,
          lastModified: "2026-09-10T00:00:00.000Z" },
      ] });
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [
      {
        regionId: "native-p0001",
        pageIndex0: 0,
        pageNumber1: 1,
        order: 0,
        blockType: "paragraph",
        bbox1000: [0, 0, 1000, 1000],
        text: "The pump was inspected and the reading stayed inside the policy limits.",
        confidence: 1,
        authority: "official",
      },
    ]) });
    dispatched.mockResolvedValue({
      ok: true,
      result: {
        status: "completed",
        runtime: "tavonel-python-core-v2",
        candidate: { worldStateId: "world-1", reviewReasons: [] },
        receipt: { requestId: "request-1", outputSha256: `sha256:${"f".repeat(64)}`, candidatePromotion: false },
      },
    });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("SOURCE_VERSION_CHANGED");
    expect(dispatched).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
  });

  it("does not dispatch a source whose connector access was revoked", async () => {
    readyWorkspace();
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("CONNECTOR_SOURCE_ACCESS_DENIED");
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

/*
  TM01. Whether a compile asks the Core for a revision of an existing World, and when it will
  not.

  `route.operationClass` was the literal "initial_compile" on every call and
  `previousActiveWorld` was never sent, so the selective-recompile branch in `compiler.py` --
  `plan_recompilation`, then `verify_equivalence` -- has never run in production and
  `receipt.equivalence` has always been "not_run". This drives the four states that matter: the
  flag off, the flag on with a usable prior World, the flag on with no prior World at all, and
  the flag on with a prior World this code cannot faithfully describe.

  The last one is the one worth reading. It refuses. Compiling from scratch there would look
  like success and produce a diff claiming every unit in the corpus is new, which is a false
  record of what changed rather than a missing optimisation.
*/
describe("a re-compile of a collection that already has an active World", () => {
  const SNAPSHOT = {
    worldStateId: "ws_previous_1",
    manifestDigest: `sha256:${"b".repeat(64)}`,
    artifactHashes: { "canonical/model": `sha256:${"c".repeat(64)}` },
    units: [{
      logicalId: "unit-1",
      sourceId: "src-1",
      sourceVersionId: "srcv-1",
      sourceContentSha256: `sha256:${"d".repeat(64)}`,
      text: "The pump was inspected and the reading stayed inside the policy limits.",
      documentPath: ["Sources", DOCUMENT],
      anchor: `${DOCUMENT}#p1`,
      neighbourAnchors: [],
      evidenceId: "ev-1",
      pageNumber1: 1,
      authority: "official",
      identityState: "matched",
    }],
  };

  function readableSource() {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });
    dispatched.mockResolvedValue({
      ok: true,
      result: {
        status: "completed",
        runtime: "tavonel-python-core-v2",
        candidate: { worldStateId: "world-2", reviewReasons: [] },
        receipt: { requestId: "request-2", outputSha256: `sha256:${"f".repeat(64)}`, candidatePromotion: false },
      },
    });
    put.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
  }

  /** What the world store returns for a collection that has been promoted once. */
  function promotedOnce() {
    activeWorld.mockResolvedValue({
      ok: true,
      world: {
        workspaceKey: WS,
        collectionId: "collection-unused-by-this-assertion",
        manifestDigest: SNAPSHOT.manifestDigest,
        revision: 1,
        updatedAt: "2026-09-10T00:00:00.000Z",
        candidateObjectKey: "immutable/pilot/pilot/collections/c/x/candidate-world.json",
        worldStateId: SNAPSHOT.worldStateId,
        coreOutputSha256: `sha256:${"e".repeat(64)}`,
      },
    });
  }

  it("never looks for a prior World while the flag is unset", async () => {
    readableSource();
    promotedOnce();

    await runCollectionCompile(WS, [DOCUMENT]);

    expect(activeWorld).not.toHaveBeenCalled();
    expect(priorCandidate).not.toHaveBeenCalled();
    expect(dispatched.mock.calls[0]?.[4] ?? null).toBeNull();
  });

  it("sends the prior World to the Core when the flag is on and the snapshot is complete", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    priorCandidate.mockResolvedValue({ ok: true, json: { revisionCompile: SNAPSHOT } });

    await runCollectionCompile(WS, [DOCUMENT]);

    expect(dispatched.mock.calls[0]?.[4]).toEqual(SNAPSHOT);
    vi.unstubAllEnvs();
  });

  it("compiles from scratch when this binding has no active World", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });

    await runCollectionCompile(WS, [DOCUMENT]);

    expect(priorCandidate).not.toHaveBeenCalled();
    expect(dispatched.mock.calls[0]?.[4] ?? null).toBeNull();
    vi.unstubAllEnvs();
  });

  it("refuses instead of compiling from scratch when the prior World cannot be described", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    // A candidate promoted before the flag existed: no snapshot was persisted with it.
    priorCandidate.mockResolvedValue({ ok: true, json: { collectionId: "collection-old" } });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(409);
      expect(run.code).toBe("REVISION_COMPILE_PRIOR_WORLD_UNREADABLE");
      expect(run.payload).toEqual({ manifestDigest: SNAPSHOT.manifestDigest });
    }
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("surfaces a world-store failure rather than treating it as no prior World", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    activeWorld.mockResolvedValue({ ok: false, code: "WORLD_STORE_READ_FAILED" });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(503);
      expect(run.code).toBe("WORLD_STORE_READ_FAILED");
    }
    expect(dispatched).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("forwards a Core refusal of the revision compile without persisting anything", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    priorCandidate.mockResolvedValue({ ok: true, json: { revisionCompile: SNAPSHOT } });
    // What a Core built before the incremental contract answers: a named refusal, not a World.
    dispatched.mockResolvedValue({ ok: false, code: "CORE_REQUEST_INVALID" });

    const run = await runCollectionCompile(WS, [DOCUMENT]);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(503);
      expect(run.code).toBe("CORE_REQUEST_INVALID");
    }
    expect(put).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
