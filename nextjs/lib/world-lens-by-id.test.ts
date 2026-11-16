import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D18-1: the bounded by-id lens read (`?ids=`) and the sealed `page_token`.

  The properties worth a test each: a by-id read returns exactly the named items without paging
  the whole lens; a page token can only continue the walk it was issued for -- same workspace,
  collection, lens, World version and access revision -- and says nothing about anyone else's
  tenant when it does not; and a request without the new parameters is byte-for-byte what it was.
*/

const { authorize, readModel, activeWorld } = vi.hoisted(() => ({ authorize: vi.fn(), readModel: vi.fn(), activeWorld: vi.fn() }));

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

import { GET as getLens } from "../app/api/v1/world/[id]/[lens]/route";
import { EMPTY_WORLD_FRESHNESS } from "./world-store";

const WORKSPACE = "pilot-acme01";
const COLLECTION = `collection-${"a".repeat(32)}`;
const MANIFEST = `sha256:${"1".repeat(64)}`;
const SECRET = "x".repeat(40);
const evId = (index: number) => `ev-${String(index).padStart(32, "0")}`;

function model(count: number, manifest = MANIFEST) {
  return {
    world: { id: COLLECTION, manifestDigest: manifest, status: "active", revision: { state: "read", value: 1 } },
    contract: { origin: "compiled_artifact" },
    freshness: { ...EMPTY_WORLD_FRESHNESS, activeManifestDigest: manifest },
    objects: [],
    relations: [],
    evidence: Array.from({ length: count }, (_, index) => ({ id: evId(index) })),
    history: [],
    files: [],
    review: { state: "not_yet" },
    signature: { state: "not_yet" },
  };
}

function principal(workspaceKey = WORKSPACE, authorizationRevision = 3) {
  return { ok: true, principal: { kind: "api-key", workspaceKey, userId: "u", keyId: "k", scopes: [], authorizationRevision } };
}

async function get(query: string, lens = "evidence", id = COLLECTION) {
  const response = await getLens(new Request(`https://tavonel.test/api/v1/world/${id}/${lens}${query}`, { headers: { authorization: "Bearer tvnl_live_probe" } }), {
    params: Promise.resolve({ id, lens }),
  });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", SECRET);
  authorize.mockResolvedValue(principal());
  activeWorld.mockResolvedValue({ ok: true, world: { manifestDigest: MANIFEST, revision: 1, worldStateId: "ws-1", candidateObjectKey: "x" } });
  readModel.mockResolvedValue({ ok: true, model: model(150) });
});
afterEach(() => vi.unstubAllEnvs());

describe("?ids= by-id read", () => {
  it("returns exactly the requested items in request order, deep in the lens, with no paging", async () => {
    const { status, body } = await get(`?ids=${evId(120)},${evId(3)}`);
    expect(status).toBe(200);
    expect(body.evidence).toEqual([{ id: evId(120) }, { id: evId(3) }]);
    expect(body.selection).toEqual({ requested: 2, found: 2, missing: [] });
    expect(body.page).toEqual({ limit: null, cursor: null, nextCursor: null, total: null });
  });

  it("reaches real-shaped evidence and Core object ids", async () => {
    const real = `evidence-${"5a37461b274e4465a2ef791b17dcf2b4"}:chunk-${"c803befa746ca0715c5c835b73530773"}`;
    const ko = `ko_document_${"a1".repeat(16)}`;
    readModel.mockResolvedValue({ ok: true, model: { ...model(0), evidence: [{ id: real }], objects: [{ id: ko }] } });
    expect((await get(`?ids=${real}`)).body.evidence).toEqual([{ id: real }]);
    expect((await get(`?ids=${ko}`, "objects")).body.objects).toEqual([{ id: ko }]);
  });

  it("refuses a repeated ids or page_token parameter", async () => {
    expect((await get(`?ids=${evId(1)}&ids=${evId(2)}`)).body.code).toBe("WORLD_IDS_INVALID");
    expect((await get("?page_token=a&page_token=b")).body.code).toBe("PAGE_TOKEN_INVALID");
  });

  it("lists the ids it did not find", async () => {
    const { body } = await get(`?ids=${evId(1)},${evId(999)}`);
    expect(body.evidence).toEqual([{ id: evId(1) }]);
    expect(body.selection).toEqual({ requested: 2, found: 1, missing: [evId(999)] });
  });

  it("refuses malformed, empty, repeated and oversized id lists", async () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => evId(index)).join(",");
    for (const query of ["?ids=", "?ids=bad%20id", `?ids=${evId(1)},`, `?ids=${evId(1)},${evId(1)}`, `?ids=${tooMany}`]) {
      const { status, body } = await get(query);
      expect([status, body.code, query]).toEqual([400, "WORLD_IDS_INVALID", query]);
    }
    expect(readModel).not.toHaveBeenCalled();
  });

  it("refuses ids with paging parameters, and on a lens that has no ids", async () => {
    for (const extra of ["&limit=2", `&cursor=${evId(1)}`, "&page_token=abc"]) {
      expect((await get(`?ids=${evId(1)}${extra}`)).body.code).toBe("WORLD_IDS_WITH_PAGE");
    }
    expect((await get(`?ids=${evId(1)}`, "history")).body.code).toBe("WORLD_LENS_NOT_PAGEABLE");
  });
});

describe("legacy reads are unchanged", () => {
  it("unpaged and cursor responses carry no new fields without a signing secret", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "");
    const whole = await get("");
    expect(whole.body.page).toEqual({ limit: null, cursor: null, nextCursor: null, total: 150 });
    expect(whole.body.evidence).toHaveLength(150);
    expect(whole.body).not.toHaveProperty("selection");
    const paged = await get("?limit=2");
    expect(paged.body.page).toEqual({ limit: 2, cursor: null, nextCursor: evId(1), total: 150 });
    const next = await get(`?limit=2&cursor=${evId(1)}`);
    expect(next.body.page).toEqual({ limit: 2, cursor: evId(1), nextCursor: evId(3), total: 150 });
  });

  it("unpaged responses are identical with or without the secret", async () => {
    const withSecret = await get("");
    vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "");
    expect(await get("")).toEqual(withSecret);
  });
});

describe("page_token", () => {
  async function walkByToken() {
    const ids: string[] = [];
    let page = await get("?limit=40");
    ids.push(...page.body.evidence.map((item: { id: string }) => item.id));
    while (page.body.page.nextPageToken) {
      page = await get(`?page_token=${page.body.page.nextPageToken}`);
      expect(page.status).toBe(200);
      ids.push(...page.body.evidence.map((item: { id: string }) => item.id));
    }
    return ids;
  }

  it("walks the lens to the same items a cursor walk reaches", async () => {
    const byToken = await walkByToken();
    const byCursor: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { evidence: { id: string }[]; page: { nextCursor: string | null } } } = await get(`?limit=40${cursor ? `&cursor=${cursor}` : ""}`);
      byCursor.push(...page.body.evidence.map((item) => item.id));
      cursor = page.body.page.nextCursor;
    } while (cursor);
    expect(byToken).toHaveLength(150);
    expect(byToken).toEqual(byCursor);
  });

  it("is null on the last page", async () => {
    expect((await get("?limit=50&cursor=" + evId(99))).body.page.nextPageToken).toBeNull();
  });

  it("refuses a tampered token", async () => {
    const token = (await get("?limit=2")).body.page.nextPageToken as string;
    const raw = Buffer.from(token, "base64url");
    raw[raw.length - 1] ^= 1;
    const { status, body } = await get(`?page_token=${raw.toString("base64url")}`);
    expect([status, body.code]).toEqual([400, "PAGE_TOKEN_INVALID"]);
  });

  it("refuses a token minted for another lens, and one sent beside limit or cursor", async () => {
    const token = (await get("?limit=2")).body.page.nextPageToken as string;
    expect((await get(`?page_token=${token}`, "objects")).body.code).toBe("PAGE_TOKEN_INVALID");
    expect((await get(`?page_token=${token}&limit=2`)).body.code).toBe("PAGE_TOKEN_INVALID");
    expect((await get(`?page_token=${token}`, "history")).body.code).toBe("WORLD_LENS_NOT_PAGEABLE");
  });

  it("refuses another workspace's token without naming any workspace", async () => {
    authorize.mockResolvedValue(principal("pilot-rival9"));
    const token = (await get("?limit=2")).body.page.nextPageToken as string;
    authorize.mockResolvedValue(principal(WORKSPACE));
    const response = await get(`?page_token=${token}`);
    expect([response.status, response.body]).toEqual([400, { code: "PAGE_TOKEN_INVALID" }]);
    expect(JSON.stringify(response.body)).not.toContain("rival");
  });

  it("answers 409 when the World was promoted between pages", async () => {
    const token = (await get("?limit=2")).body.page.nextPageToken as string;
    const other = `sha256:${"2".repeat(64)}`;
    readModel.mockResolvedValue({ ok: true, model: model(150, other) });
    const { status, body } = await get(`?page_token=${token}`);
    expect([status, body.code]).toEqual([409, "PAGE_TOKEN_STALE"]);
  });

  it("answers 409 when the access revision changed between pages", async () => {
    const token = (await get("?limit=2")).body.page.nextPageToken as string;
    authorize.mockResolvedValue(principal(WORKSPACE, 4));
    const { status, body } = await get(`?page_token=${token}`);
    expect([status, body.code]).toEqual([409, "PAGE_TOKEN_STALE"]);
  });

  it("expires after fifteen minutes", async () => {
    vi.useFakeTimers();
    try {
      const token = (await get("?limit=2")).body.page.nextPageToken as string;
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);
      const { status, body } = await get(`?page_token=${token}`);
      expect([status, body.code]).toEqual([400, "PAGE_TOKEN_STALE"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("issues no token without a signing secret, and refuses one it cannot read", async () => {
    const token = (await get("?limit=2")).body.page.nextPageToken as string;
    vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "");
    expect((await get("?limit=2")).body.page).not.toHaveProperty("nextPageToken");
    const { status, body } = await get(`?page_token=${token}`);
    expect([status, body.code]).toEqual([503, "PAGE_TOKEN_SIGNER_NOT_CONFIGURED"]);
  });
});
