import { beforeEach, expect, it, vi } from "vitest";
import { compileCollectionCandidate } from "./collection-compiler";
const mocks = vi.hoisted(() => ({ load: vi.fn(), access: vi.fn(), active: vi.fn() }));
vi.mock("./collection-storage", () => ({ loadPreferredCollectionCandidate: mocks.load }));
vi.mock("./connector-source-access", () => ({ checkConnectorSourceAccess: mocks.access }));
vi.mock("./world-store", () => ({ getFoundationActiveWorld: mocks.active, listFoundationWorldVersions: vi.fn() }));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ bucket: "fixture" }) }));
vi.mock("./developer-auth", () => ({ authorizeFoundationRequest: async () => ({ ok: true, principal: { workspaceKey: "pilot-acme01" } }) }));
import { loadWorldReadModel } from "./world-read-model";
import { GET as collectionGet } from "../app/api/collections/[id]/route";
const compiled = compileCollectionCandidate([{
  documentId: "source-access-fixture", versionKey: "a".repeat(64),
  sanitizedKey: "immutable/test/test/doc/version/sanitized.pdf", ocrJsonKey: "immutable/test/test/doc/version/ocr.json",
  pageCount: 1, inputSha256: `sha256:${"a".repeat(64)}`,
  sourceImmutableKey: "immutable/test/test/doc/version/sanitized.pdf", text: "A grounded source-access test.",
}]);
const artifact = { ...compiled, coreExecution: { status: "review_required",
  runtime: "tavonel-foundation-core-deterministic-v1", receipt: {
    requestId: "source-access", outputSha256: compiled.manifestDigest, candidatePromotion: false,
  },
} };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue({ ok: true, value: { artifact } });
  mocks.active.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  mocks.access.mockResolvedValue({ ok: true });
});
it("checks actual source inventory before returning a World model", async () => {
  expect((await loadWorldReadModel("pilot-acme01", compiled.collectionId)).ok).toBe(true);
  expect(mocks.access).toHaveBeenCalledWith("pilot-acme01", ["source-access-fixture"]);
});
it.each([
  ["CONNECTOR_SOURCE_ACCESS_DENIED", 403], ["CONNECTOR_SOURCE_ACCESS_UNAVAILABLE", 503],
])("returns no World model for %s", async (code, status) => {
  mocks.access.mockResolvedValue({ ok: false, code });
  expect(await loadWorldReadModel("pilot-acme01", compiled.collectionId)).toEqual({ ok: false, code, status });
});
it.each([true, false])("raw collection JSON respects source access %s", async allowed => {
  mocks.access.mockResolvedValue(allowed ? { ok: true } : { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  const response = await collectionGet(new Request(`https://tavonel.test/api/collections/${compiled.collectionId}`),
    { params: Promise.resolve({ id: compiled.collectionId }) });
  expect(response.status).toBe(allowed ? 200 : 403);
  const body = await response.json();
  if (allowed) expect(body.artifact).toBeDefined();
  else expect(body).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
});
