import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "acct", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("./r2-objects", () => ({
  listImmutableWorkspaceObjects: (...args: unknown[]) => listed(...args),
  getWorkspaceOcrJson: (...args: unknown[]) => fetched(...args),
  putWorkspaceCollectionCandidate: (...args: unknown[]) => put(...args),
}));
vi.mock("./core-runtime-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core-runtime-v2")>()),
  readProductCoreV2Env: () => ({ url: "https://core-v2.example", hmac: "x".repeat(32) }),
  dispatchProductCoreV2: (...args: unknown[]) => dispatched(...args),
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
});
