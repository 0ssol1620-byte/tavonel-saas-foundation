import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  pilot: vi.fn(),
  product: vi.fn(),
  access: vi.fn(),
  signer: vi.fn(),
  list: vi.fn(),
  group: vi.fn(),
  select: vi.fn(),
  connector: vi.fn(),
  presign: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: mocks.user, foundationPilotAccess: mocks.pilot }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: mocks.product }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: mocks.connector }));
vi.mock("@/lib/immutable-keys", () => ({
  DOCUMENT_ID_PATTERN: /^[A-Za-z0-9_-]+$/,
  groupImmutableDocuments: mocks.group,
  selectCurrentDocumentVersions: mocks.select,
}));
vi.mock("@/lib/r2-presign", () => ({ presignWorkspaceProgressGet: mocks.presign }));
vi.mock("@/lib/r2-objects", () => ({ listImmutableWorkspaceObjects: mocks.list }));
vi.mock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: mocks.signer }));

const documentId = "doc_123";
const versionKey = "a".repeat(64);
const sanitizedKey = `immutable/pilot-test/pilot-test/${documentId}/${versionKey}/sanitized.pdf`;

function setup() {
  mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.pilot.mockReturnValue({ membership: { workspaceId: "pilot-test" } });
  mocks.product.mockResolvedValue({ ok: true });
  mocks.access.mockReturnValue(undefined);
  mocks.signer.mockReturnValue({ bucket: "foundation" });
  mocks.list.mockResolvedValue({ ok: true, objects: [] });
  mocks.group.mockReturnValue([{ documentId, versionKey, sanitizedKey }]);
  mocks.select.mockReturnValue({
    documents: [{ documentId, versionKey, sanitizedKey }],
    ambiguousDocumentIds: [],
  });
  mocks.connector.mockResolvedValue({ ok: true });
  mocks.presign.mockReturnValue({ ok: true, readUrl: "https://bucket.invalid/progress" });
}

describe("authorized source-version progress descriptor", () => {
  beforeEach(() => { vi.clearAllMocks(); setup(); });

  it("returns the selected immutable version and sanitized-PDF digest from the server listing", async () => {
    const response = await GET(new Request("https://app.invalid?version=client-value&sourceSha256=sha256%3Adeadbeef"), { params: Promise.resolve({ id: documentId }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      documentId,
      versionKey,
      sourceImmutableKey: sanitizedKey,
      sourceSha256: `sha256:${versionKey}`,
    });
    expect(mocks.connector).toHaveBeenCalledWith("pilot-test", [documentId], "user-1");
    expect(mocks.presign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId: "pilot-test",
      key: sanitizedKey.replace(/sanitized\.pdf$/, "ocr-progress.json"),
    }));
  });

  it("does not issue a progress capability when connector source access is revoked", async () => {
    mocks.connector.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await GET(new Request("https://app.invalid"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(403);
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("does not issue a capability when the server cannot select one exact version", async () => {
    mocks.select.mockReturnValue({ documents: [], ambiguousDocumentIds: [documentId] });
    const response = await GET(new Request("https://app.invalid"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(409);
    expect(mocks.presign).not.toHaveBeenCalled();
  });
});
