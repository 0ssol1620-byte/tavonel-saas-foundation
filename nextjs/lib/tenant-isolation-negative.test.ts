import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  Blueprint 2026-09-08 §35: one cross-tenant evidence leak is a severity-1 incident, so the
  routes that reach tenant data are probed here with an id that belongs to someone else.

  What these prove and what they do not. They are CONTRACT tests, not database tests: vitest
  runs with no Postgres and no R2, so what is asserted is the thing a route can get wrong on
  its own -- which workspace key it hands the store. The store's own scoping is proved
  separately by pgTAP (supabase/tests/tenant_rls_matrix.sql,
  supabase/tests/foundation_retrieval_search_rpc.sql) and those run under `supabase db test`,
  not here. Read together they cover the hop; read alone neither does.

  The probe is the same on every route: authenticate as pilot-alpha, ask for a collection that
  belongs to pilot-beta, and try to talk the route into pilot-beta's scope through every input
  a client controls -- the path id, a query parameter, and a header. The route passes only if
  the store was called with pilot-alpha regardless, and the answer carries no data.

  Existing coverage this deliberately does not repeat: foreign document id and foreign source
  version (document-source-route.test.ts), foreign R2 key prefix (r2-objects.test.ts), foreign
  collection id inside a downloaded artifact (collection-download.test.ts), foreign retrieval
  unit (world-gate.test.ts).
*/

const MINE = "pilot-alpha";
const THEIRS = "pilot-beta";
const THEIR_COLLECTION = `collection-${"b".repeat(32)}`;

const { authorize, activeWorld, readModel, loadCandidate, signerEnv } = vi.hoisted(() => ({
  authorize: vi.fn(),
  activeWorld: vi.fn(),
  readModel: vi.fn(),
  loadCandidate: vi.fn(),
  signerEnv: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: activeWorld,
}));
vi.mock("@/lib/world-read-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-read-model")>()),
  loadWorldReadModel: readModel,
}));
vi.mock("@/lib/collection-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-storage")>()),
  loadPreferredCollectionCandidate: loadCandidate,
}));
vi.mock("@/lib/r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()),
  readR2SignerEnv: signerEnv,
}));

import { POST as ask } from "../app/api/collections/[id]/ask/route";
import { GET as download } from "../app/api/collections/[id]/download/route";
import { GET as worldLens } from "../app/api/v1/world/[id]/[lens]/route";
import { TOOLS, validateInput } from "../public/developer/tavonel-mcp.mjs";

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: MINE, userId: "user-alpha", scopes: [] },
  });
  signerEnv.mockReturnValue({ accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucket: "b" });
  // What a workspace-scoped store answers for an id it cannot see: absence, with no hint that
  // the id exists at all for somebody else.
  activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  readModel.mockResolvedValue({ ok: false, code: "WORLD_NOT_FOUND", status: 404 });
  loadCandidate.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
});

// Every client-controlled place a workspace could be smuggled in, on one request.
function hostile(path: string) {
  return new Request(
    `https://tavonel.test${path}?workspaceKey=${THEIRS}&workspace_key=${THEIRS}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tvnl_live_probe",
        "x-workspace-key": THEIRS,
        "x-tavonel-workspace": THEIRS,
      },
      body: JSON.stringify({ question: "What changed in the filing?", workspaceKey: THEIRS }),
    },
  );
}

function hostileGet(path: string) {
  return new Request(
    `https://tavonel.test${path}?workspaceKey=${THEIRS}&manifest=${"c".repeat(64)}`,
    { headers: { authorization: "Bearer tvnl_live_probe", "x-workspace-key": THEIRS } },
  );
}

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

describe("Ask with a World id from another workspace", () => {
  it("resolves the active World in the caller's workspace, never the one the request names", async () => {
    const response = await ask(hostile(`/api/collections/${THEIR_COLLECTION}/ask`), params({ id: THEIR_COLLECTION }));

    expect(activeWorld).toHaveBeenCalledTimes(1);
    expect(activeWorld.mock.calls[0]![0]).toBe(MINE);
    expect(activeWorld.mock.calls[0]![1]).toBe(THEIR_COLLECTION);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "ACTIVE_WORLD_NOT_FOUND" });
  });

  it("answers the same whether or not the collection exists for its real owner", async () => {
    // The refusal is the store's absence verdict, unmodified. A different status or code for
    // "exists but not yours" would make the route an existence oracle for other tenants.
    const mine = `collection-${"a".repeat(32)}`;
    const first = await ask(hostile(`/api/collections/${mine}/ask`), params({ id: mine }));
    const second = await ask(hostile(`/api/collections/${THEIR_COLLECTION}/ask`), params({ id: THEIR_COLLECTION }));
    expect(first.status).toBe(second.status);
    expect(await first.json()).toEqual(await second.json());
  });
});

describe("signed export for a collection in another workspace", () => {
  it("loads the candidate from the caller's workspace and signs nothing", async () => {
    const response = await download(
      hostileGet(`/api/collections/${THEIR_COLLECTION}/download`),
      params({ id: THEIR_COLLECTION }),
    );

    expect(loadCandidate).toHaveBeenCalledTimes(1);
    // (signer, workspaceId, collectionId, manifestDigest)
    expect(loadCandidate.mock.calls[0]![1]).toBe(MINE);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ code: "NOT_FOUND" });
  });
});

describe("evidence lens for a World in another workspace", () => {
  it("reads the World read model in the caller's workspace", async () => {
    const response = await worldLens(
      hostileGet(`/api/v1/world/${THEIR_COLLECTION}/evidence`),
      params({ id: THEIR_COLLECTION, lens: "evidence" }),
    );

    expect(readModel).toHaveBeenCalledTimes(1);
    expect(readModel.mock.calls[0]![0]).toBe(MINE);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "WORLD_NOT_FOUND" });
  });

  it("refuses a lens name that is not one of the six", async () => {
    // The lens is interpolated into the response shape; an unknown one must not reach it.
    const response = await worldLens(
      hostileGet(`/api/v1/world/${THEIR_COLLECTION}/../../documents`),
      params({ id: THEIR_COLLECTION, lens: "../../documents" }),
    );
    expect(response.status).toBe(404);
    expect(readModel).not.toHaveBeenCalled();
  });
});

describe("MCP resource path from another workspace", () => {
  type Tool = {
    name: string;
    inputSchema: { properties: Record<string, unknown> };
    request: (input: Record<string, unknown>) => { method: string; path: string };
  };
  const tools = Object.fromEntries((TOOLS as Tool[]).map((tool) => [tool.name, tool]));

  it("refuses a collectionId that is a path rather than an id, before the network", () => {
    for (const candidate of [
      `../../${THEIRS}/collections`,
      `${THEIR_COLLECTION}/../${"d".repeat(32)}`,
      `https://tavonel.test/api/v1/world/${THEIR_COLLECTION}`,
      `${THEIR_COLLECTION}%2f..%2fdocuments`,
    ]) {
      expect(() => validateInput(tools.get_world, { collectionId: candidate }), candidate)
        .toThrow(/collectionId is not a collection id/);
    }
  });

  it("has no tool that accepts a workspace argument at all", () => {
    // The workspace comes from the API key server-side. A tool that took one as an argument
    // would be asking the client which tenant it would like to be.
    for (const tool of TOOLS as Tool[]) {
      expect(Object.keys(tool.inputSchema.properties).filter((key) => /workspace|tenant|org/i.test(key)), tool.name)
        .toEqual([]);
    }
  });

  it("puts a well-formed foreign collection id in the path unchanged, and relies on the API to refuse it", () => {
    // Deliberate: the client cannot know whose collection an id is. This records that the
    // refusal is the server's job -- the tests above are what prove the server does it.
    const request = tools.get_world.request({ collectionId: THEIR_COLLECTION });
    expect(request.path).toBe(`/api/v1/world/${THEIR_COLLECTION}`);
    expect(request.method).toBe("GET");
  });
});
