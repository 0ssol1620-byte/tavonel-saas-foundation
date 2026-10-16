import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  consume: vi.fn(),
  readSecret: vi.fn(),
  deleteSecret: vi.fn(),
  putSecret: vi.fn(),
  createConnection: vi.fn(),
  exchange: vi.fn(),
  identity: vi.fn(),
  enqueue: vi.fn(),
  enqueueCorpus: vi.fn(),
}));

vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: m.gate }));
vi.mock("@/lib/connector-oauth", async (importOriginal) => ({
  ...await importOriginal<typeof import("./connector-oauth")>(),
  readOAuthProviderRuntime: () => ({ redirectUri: "https://tavonel.com/cb", clientSecretReference: "vault://client" }),
  exchangeOAuthCode: m.exchange,
  fetchOAuthProviderIdentity: m.identity,
}));
vi.mock("@/lib/connector-oauth-secrets", () => ({
  readOAuthSecretBrokerConfig: () => ({ url: "https://vault.test", token: "t" }),
  readOAuthSecret: m.readSecret,
  putOAuthSecret: m.putSecret,
  deleteOAuthSecret: m.deleteSecret,
}));
vi.mock("@/lib/connector-oauth-store", () => ({
  consumeOAuthAuthorization: m.consume,
  createOAuthConnection: m.createConnection,
}));
vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: vi.fn(async () => ({
    ok: true,
    principal: { workspaceKey: "pilot-abc123", userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1", accessSource: "paid" },
  })),
}));
vi.mock("@/lib/compile-job-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("./compile-job-store")>(),
  enqueueCompileJob: m.enqueue,
  enqueueCorpusCompile: m.enqueueCorpus,
}));
vi.mock("@/lib/funnel-events", () => ({ recordServerFunnel: vi.fn() }));

import { GET as oauthCallback } from "../app/api/v1/oauth-connectors/callback/[provider]/route";
import { POST as createCompileJob } from "../app/api/compile-jobs/route";

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.deleteSecret.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OAuth callback connector gate", () => {
  it("refuses before token exchange or secret read and still deletes the PKCE verifier", async () => {
    m.gate.mockResolvedValue(false);
    m.consume.mockResolvedValue({
      ok: true,
      authorization: {
        workspaceKey: "pilot-abc123",
        redirectUri: "https://tavonel.com/cb",
        pkceVerifierReference: "vault://pkce/verifier",
      },
    });
    const state = "s".repeat(43);
    const response = await oauthCallback(
      new Request(`https://tavonel.com/api/v1/oauth-connectors/callback/google_drive?code=abc&state=${state}`),
      { params: Promise.resolve({ provider: "google_drive" }) },
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("oauth")).toBe("failed");
    expect(location.searchParams.get("code")).toBe("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE");
    expect(m.gate).toHaveBeenCalledWith("pilot-abc123", "connector");
    expect(m.readSecret).not.toHaveBeenCalled();
    expect(m.exchange).not.toHaveBeenCalled();
    expect(m.identity).not.toHaveBeenCalled();
    expect(m.putSecret).not.toHaveBeenCalled();
    expect(m.createConnection).not.toHaveBeenCalled();
    expect(m.deleteSecret).toHaveBeenCalledWith(expect.anything(), "vault://pkce/verifier");
  });
});

describe("compile-jobs v2 origin classification", () => {
  const WS = "pilot-abc123";
  const DOC_A = "00000000-0000-4000-8000-00000000000a";
  const DOC_B = "00000000-0000-4000-8000-00000000000b";
  type Row = { workspace_key: string; document_id: string };

  function stubStore(bindings: Row[], admissions: Row[]) {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/rpc/connector_documents_blocked")) return new Response("false");
      if (url.pathname.endsWith("/rpc/assert_foundation_intake_compile_set")) {
        return new Response(JSON.stringify({ allowed: true, approvalRequired: false }), { headers: { "content-type": "application/json" } });
      }
      const rows = (url.pathname.endsWith("connector_document_bindings") ? bindings : admissions)
        .filter((r) => url.searchParams.get("document_id")!.includes(r.document_id));
      return new Response(JSON.stringify(rows), { headers: { "content-range": `0-${rows.length - 1}/${rows.length}` } });
    }));
  }
  const post = (documentIds: string[]) => createCompileJob(new Request("https://tavonel.com/api/compile-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentIds }),
  }));

  beforeEach(() => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
  });

  it("requires connector scope when any document has a connector binding", async () => {
    stubStore([{ workspace_key: WS, document_id: DOC_A }], [{ workspace_key: WS, document_id: DOC_B }]);
    m.gate.mockResolvedValue(false);
    const response = await post([DOC_A, DOC_B]);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" });
    expect(m.gate).toHaveBeenCalledExactlyOnceWith(WS, "connector");
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("never enqueues or consults the gate for a document with unknown origin", async () => {
    stubStore([], [{ workspace_key: WS, document_id: DOC_A }]);
    m.gate.mockResolvedValue(true);
    const response = await post([DOC_A, DOC_B]);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
    expect(m.gate).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.enqueueCorpus).not.toHaveBeenCalled();
  });

  it("enqueues a connector-bound set only after the connector gate admits it", async () => {
    stubStore([{ workspace_key: WS, document_id: DOC_A }], []);
    m.gate.mockResolvedValue(true);
    m.enqueue.mockResolvedValue({ ok: true, value: { jobId: "job-1", state: "queued", created: true } });
    const response = await post([DOC_A]);
    expect(response.status).toBe(202);
    expect(m.gate).toHaveBeenCalledExactlyOnceWith(WS, "connector");
    expect(m.enqueue).toHaveBeenCalledOnce();
  });
});
