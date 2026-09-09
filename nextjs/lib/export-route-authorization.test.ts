import { generateKeyPairSync } from "node:crypto";
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate } from "./collection-compiler";
import { createExportSigner } from "./export-signing";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), revalidate: vi.fn(), load: vi.fn(), release: vi.fn(), signer: vi.fn(),
}));
vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: mocks.authorize,
  revalidateFoundationAuthorization: mocks.revalidate,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ bucket: "test" }) }));
vi.mock("@/lib/collection-storage", () => ({ loadPreferredCollectionCandidate: mocks.load }));
vi.mock("@/lib/export-signing", async (original) => ({
  ...await original<typeof import("./export-signing")>(), readExportSignerEnv: mocks.signer,
}));
vi.mock("@/lib/workspace-operation-guard", () => ({ acquireWorkspaceOperation: async () => ({
  ok: true, replay: false, release: mocks.release,
}) }));
import { GET as direct } from "../app/api/collections/[id]/download/route";
import { GET as versioned } from "../app/api/v1/collections/[id]/download/route";

const compiled = compileCollectionCandidate([{
  documentId: "export-auth-fixture", versionKey: "a".repeat(64),
  sanitizedKey: "immutable/test/test/doc/version/sanitized.pdf",
  ocrJsonKey: "immutable/test/test/doc/version/ocr.json", pageCount: 1,
  inputSha256: `sha256:${"a".repeat(64)}`,
  sourceImmutableKey: "immutable/test/test/doc/version/sanitized.pdf",
  text: "A source-grounded export authorization fixture.",
}]);
const artifact = { ...compiled, coreExecution: { status: "review_required",
  runtime: "tavonel-foundation-core-deterministic-v1", receipt: {
    requestId: "export-auth-test", outputSha256: compiled.manifestDigest, candidatePromotion: false,
  },
} };
const principal = { kind: "api-key", workspaceKey: "test-export-auth", userId: "test-user", scopes: ["collections:download"] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, principal });
  mocks.revalidate.mockResolvedValue({ ok: true, principal });
  mocks.load.mockResolvedValue({ ok: true, value: { artifact } });
  mocks.release.mockResolvedValue(undefined);
  const { privateKey } = generateKeyPairSync("ed25519");
  mocks.signer.mockReturnValue(createExportSigner({ keyId: "export-auth-test",
    privateKeyPkcs8DerBase64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  }));
});

describe.each([["direct", direct], ["v1", versioned]] as const)("%s export authorization", (_, route) => {
  function run() {
    return route(new Request(`https://tavonel.test/api/collections/${compiled.collectionId}/download`),
      { params: Promise.resolve({ id: compiled.collectionId }) });
  }
  it("preserves a readable signed reviewable ZIP for an authorized user", async () => {
    const response = await run();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(files["signatures/export-manifest.ed25519.json"]).toBeDefined();
  });
  it.each(["load", "release"] as const)("refuses access revoked during %s without returning archive bytes", async (boundary) => {
    let reached!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const parked = new Promise<void>(resolve => { resume = resolve; });
    mocks[boundary].mockImplementationOnce(async () => {
      reached(); await parked;
      return boundary === "load" ? { ok: true, value: { artifact } } : undefined;
    });
    const pending = run();
    await entered;
    mocks.revalidate.mockResolvedValue({ ok: false, code: "API_KEY_REVOKED", status: 401 });
    resume();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).not.toBe("application/zip");
    expect(await response.json()).toEqual({ code: "API_KEY_REVOKED" });
    expect(mocks.release).toHaveBeenCalled();
  });
});
