import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  D13 / WO-D13-2. Customer data compiles on Core V2 or not at all. A V1-only deployment is refused
  before any source is read; nothing falls back to the V1 Core.
*/

const listed = vi.fn();
const fetched = vi.fn();
const v2Env = vi.fn<() => { url: string; hmac: string } | null>();
vi.mock("./r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "acct", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("./r2-objects", () => ({
  MAX_DERIVED_JSON_BYTES: 24 * 1024 * 1024,
  listImmutableWorkspaceObjects: (...args: unknown[]) => listed(...args),
  getWorkspaceOcrJson: (...args: unknown[]) => fetched(...args),
  serializeCollectionCandidate: vi.fn(),
  putSerializedCollectionCandidate: vi.fn(),
  getWorkspaceCollectionCandidate: vi.fn(),
}));
vi.mock("./world-store", () => ({ getFoundationActiveWorld: vi.fn() }));
vi.mock("./core-runtime-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core-runtime-v2")>()),
  readProductCoreV2Env: () => v2Env(),
}));
vi.mock("./compile-job-authority", () => ({
  authorizeCompileJobSourceAccess: async () => ({ ok: true }),
  compileJobAuthorityEnabled: () => false,
  classifyCompileJobSources: async () => ({ ok: true, scope: "direct_upload" }),
}));
vi.mock("./customer-source-scope", () => ({ readCustomerSourceScope: vi.fn() }));
vi.mock("./connector-compile-identity", () => ({ readConnectorCompileIdentities: vi.fn() }));
vi.mock("./enterprise-store", () => ({ appendServiceAuditEvent: vi.fn() }));
vi.mock("./customer-data-admission", () => ({ readCustomerSourceAuthorization: vi.fn() }));

const { runCollectionCompile } = await import("./collection-compile-run");

const WS = "pilot";
const DOCUMENT = "0c0c0c0c-0000-4000-8000-00000000000a";
const fetchSpy = vi.fn();

beforeEach(() => {
  v2Env.mockReset().mockReturnValue(null);
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("FOUNDATION_CORE_URL", "");
  vi.stubEnv("FOUNDATION_CORE_HMAC", "");
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Core V2 only", () => {
  it("refuses a V1-only deployment with CUSTOMER_DATA_CORE_V2_REQUIRED and touches no network", async () => {
    vi.stubEnv("FOUNDATION_CORE_URL", "https://core-v1.example");
    vi.stubEnv("FOUNDATION_CORE_HMAC", "x".repeat(32));
    const run = await runCollectionCompile(WS, [DOCUMENT]);
    expect(run).toMatchObject({ ok: false, status: 503, code: "CUSTOMER_DATA_CORE_V2_REQUIRED" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("reports CORE_NOT_CONFIGURED when neither Core is configured", async () => {
    const run = await runCollectionCompile(WS, [DOCUMENT]);
    expect(run).toMatchObject({ ok: false, status: 503, code: "CORE_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
  });

  it("proceeds past the Core gate when V2 is configured", async () => {
    v2Env.mockReturnValue({ url: "https://core-v2.example", hmac: "x".repeat(32) });
    // No receipt signer in this harness, so the next gate after the Core check is what answers.
    const run = await runCollectionCompile(WS, [DOCUMENT]);
    expect(run).toMatchObject({ ok: false, code: "COMPILE_RECEIPT_SIGNER_NOT_CONFIGURED" });
  });
});
