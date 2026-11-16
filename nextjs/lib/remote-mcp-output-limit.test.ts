import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D19-7: a seeded 1,000-case property suite over /api/mcp output limits, abstention and revoke.

  Per case a random World answer (0-60 items, 0-20,000 characters of mixed ASCII, Hangul, CJK,
  emoji and combining marks, 0-10 evidence ids) goes through search_world delivery, the canonical
  `search` and the canonical `fetch`. Each outcome is one of two things and nothing between:
    - success: the delivered text is within DELIVERY_PART_BUDGET_TOKENS and no item was dropped;
    - an explicit refusal that names a DELIVERY_* / FETCH_OVER_BUDGET / DELIVERY_ITEM_INVALID code.
  An empty packet is an empty result with an abstention code, never an answer. A second token is
  revoked at a seeded case k: every call with it from case k on is a 401 and reaches no route.

  The /api/v1 routes are replaced by one in-memory World (as in remote-mcp-facade.test.ts), so this
  proves the delivery contract of this repository. What a real host does with a large result, or
  its own context limit, is not proved here.
*/

const SEED = 20261117;
const CASES = 1000;
const A = "pilot-alpha";
const ORIGIN = "https://tavonel.test";
const WORLD = `collection-${"a".repeat(32)}`;
const DIGEST = `sha256:${"d".repeat(64)}`;
const READ_SCOPES = ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"];

const world = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  evidence: new Map<string, Record<string, unknown>>(),
  routeCalls: 0,
}));
const mocks = vi.hoisted(() => ({
  authenticateKey: vi.fn(),
  toolCall: vi.fn(async () => null),
  timing: vi.fn(async () => "not_recorded"),
}));

vi.mock("@/lib/operations-alert-triggers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-alert-triggers")>()),
  recordMcpToolCall: mocks.toolCall,
}));
vi.mock("@/lib/operations-e2e-timing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-e2e-timing")>()),
  recordFirstMcpAnswerTiming: mocks.timing,
}));
vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  authenticateDeveloperApiKey: mocks.authenticateKey,
}));
vi.mock("../app/api/v1/collections/route", () => ({
  GET: async () => {
    world.routeCalls += 1;
    return Response.json({ code: "COLLECTIONS_LISTED", collections: [{ collectionId: WORLD, manifestDigest: DIGEST, revision: 1 }], page: {} });
  },
}));
vi.mock("../app/api/v1/collections/[id]/search/route", () => ({
  POST: async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    await request.json();
    world.routeCalls += 1;
    return Response.json({
      code: world.items.length > 0 ? "SEARCH_RESULTS" : "SEARCH_EMPTY",
      retrievalPath: "compiled-retrieval-v1",
      degradations: [],
      activeWorld: { manifestDigest: DIGEST, revision: 1, worldStateId: "ws-1" },
      contextPacket: { worldId: id, worldVersion: "v1", retrievalProfile: "profile", question: "q", items: world.items, heldConflicts: [], abstentionReasons: world.items.length > 0 ? [] : ["NO_GROUNDED_REGION"] },
    });
  },
}));
vi.mock("../app/api/v1/world/[id]/[lens]/route", () => ({
  GET: async (request: Request) => {
    world.routeCalls += 1;
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",");
    return Response.json({
      code: "OK",
      world: { manifestDigest: DIGEST },
      evidence: ids.flatMap((value) => world.evidence.get(value) ?? []),
      selection: { requested: ids.length, found: 0, missing: [] },
    });
  },
}));

import { POST as mcp } from "../app/api/mcp/route";
import { DELIVERY_PART_BUDGET_TOKENS, estimateTokens } from "../public/developer/tavonel-mcp.mjs";

const LIVE = "tvnl_live_a";
const REVOKABLE = "tvnl_live_r";
let revoked = false;

// mulberry32: a small seeded generator, so a failing case number reproduces exactly.
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALPHABETS = [
  "abcdefghijklmnopqrstuvwxyz ",
  "가나다라마바사아자차카타파하 ",
  "文書契約支払期限遅延損害金",
  "\u{1F600}\u{1F4C4}\u{1F512}\u{1F9EA}",
  "éäô ",
  "0123456789.,;:%$ ",
];

function text(rand: () => number, length: number) {
  const alphabet = [...ALPHABETS[Math.floor(rand() * ALPHABETS.length)]!];
  let out = "";
  while (out.length < length) {
    // Mix a second alphabet in so one text is rarely single-script.
    const pool = rand() < 0.25 ? [...ALPHABETS[Math.floor(rand() * ALPHABETS.length)]!] : alphabet;
    out += pool[Math.floor(rand() * pool.length)];
  }
  // A lone surrogate half at the cut would be invalid text, so never cut inside a pair.
  return out.length > length && /[\uD800-\uDBFF]$/.test(out.slice(0, length)) ? out.slice(0, length - 1) : out.slice(0, length);
}

function rpc(body: unknown, token: string) {
  return mcp(new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
}
type ToolResult = { isError: boolean; content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown> };
async function tool(name: string, args: Record<string, unknown>, token = LIVE) {
  const response = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, token);
  const body = await response.json() as { result?: ToolResult };
  return { status: response.status, result: body.result as ToolResult };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_CANONICAL_TOOLS", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", A);
  revoked = false;
  mocks.authenticateKey.mockImplementation(async (token: string) =>
    token === LIVE || (token === REVOKABLE && !revoked)
      ? { ok: true, principal: { kind: "api-key", keyId: `key-${token}`, workspaceKey: A, userId: "u-1", scopes: READ_SCOPES, authorizationRevision: 4 } }
      : { ok: false, code: "API_KEY_INVALID" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const REFUSAL = /^(DELIVERY_[A-Z_]+|FETCH_OVER_BUDGET)\b/;

describe("1,000 seeded output-limit, abstention and revoke cases", () => {
  it(`holds on seed ${SEED}`, { timeout: 600_000 }, async () => {
    const rand = prng(SEED);
    const revokeAt = 200 + Math.floor(rand() * 600);
    const tally = { searchWorld: { ok: 0, refused: 0, empty: 0 }, search: { ok: 0, refused: 0, empty: 0 }, fetch: { ok: 0, refused: 0 }, revoked401: 0, liveBeforeRevoke: 0 };

    for (let c = 0; c < CASES; c += 1) {
      // Most cases are small enough to deliver; a long tail is large enough to be refused.
      const count = Math.floor(rand() * 61);
      const big = rand() < 0.3;
      const items = Array.from({ length: count }, (_, i) => {
        const length = big ? Math.floor(rand() * 20_001) : Math.floor(rand() * 400);
        const idCount = Math.floor(rand() * 11);
        return {
          unitId: `u${i}`, text: text(rand, length), claimIds: [], entityIds: [], sourceVersionId: `dv_${i % 3}`,
          evidenceIds: Array.from({ length: idCount }, (_, k) => `ev_${c}_${i}_${k}`),
          pageNumber1: 1 + (i % 7), bbox1000: [10, 20, 300, 40], authority: "primary",
          retrieval: { lexicalRank: 1, denseRank: 2, structureRank: null, rerankerScore: 0.5 },
        };
      });
      world.items = items;
      world.evidence = new Map();
      for (const entry of items) {
        entry.evidenceIds.slice(0, 8).forEach((id, k) => world.evidence.set(id, {
          id, sourceId: "src-1", sourceVersionId: entry.sourceVersionId, page: entry.pageNumber1, bbox: entry.bbox1000,
          blockId: `b${k}`, excerpt: entry.text, authority: "primary", digest: "sha256:x",
        }));
      }
      const label = `case ${c} (seed ${SEED}, ${count} items)`;

      // search_world delivery
      const sw = await tool("search_world", { collectionId: WORLD, query: "payment terms", limit: 25 });
      expect(sw.status, label).toBe(200);
      if (sw.result.isError) {
        expect(sw.result.content[0]!.text, label).toMatch(REFUSAL);
        tally.searchWorld.refused += 1;
      } else {
        const total = sw.result.content.reduce((sum, part) => sum + estimateTokens(part.text), 0);
        expect(total, label).toBeLessThanOrEqual(DELIVERY_PART_BUDGET_TOKENS);
        const packet = (sw.result.structuredContent as { contextPacket: { items: unknown[]; abstentionReasons: string[] } }).contextPacket;
        expect(packet.items.length, label).toBe(count);
        if (count === 0) {
          expect(packet.abstentionReasons.length, label).toBeGreaterThan(0);
          tally.searchWorld.empty += 1;
        } else {
          tally.searchWorld.ok += 1;
        }
      }

      // canonical search
      const s = await tool("search", { query: "payment terms", world_id: WORLD, limit: 10 });
      expect(s.status, label).toBe(200);
      let resultIds: string[] = [];
      if (s.result.isError) {
        expect(s.result.content[0]!.text, label).toMatch(REFUSAL);
        tally.search.refused += 1;
      } else {
        const out = s.result.structuredContent as { results: Array<{ id: string }>; notice?: { code: string; abstention_reasons?: string[] } };
        expect(estimateTokens(JSON.stringify(out)), label).toBeLessThanOrEqual(DELIVERY_PART_BUDGET_TOKENS);
        expect(out.results.length, label).toBe(count);
        if (count === 0) {
          expect(out.notice?.code, label).toBe("SEARCH_EMPTY");
          expect(out.notice?.abstention_reasons?.length, label).toBeGreaterThan(0);
          tally.search.empty += 1;
        } else {
          tally.search.ok += 1;
        }
        resultIds = out.results.map((r) => r.id);
      }

      // canonical fetch of one of the ids search handed out
      if (resultIds.length > 0) {
        const pick = Math.floor(rand() * resultIds.length);
        const f = await tool("fetch", { id: resultIds[pick]! });
        expect(f.status, label).toBe(200);
        if (f.result.isError) {
          expect(f.result.content[0]!.text, label).toMatch(REFUSAL);
          tally.fetch.refused += 1;
        } else {
          const out = f.result.structuredContent as { text: string; metadata: { evidence_ids: string[]; untrusted_content: boolean } };
          // fetch budgets the rendered files; the join adds one newline between them.
          expect(estimateTokens(out.text), label).toBeLessThanOrEqual(DELIVERY_PART_BUDGET_TOKENS + 4);
          expect(out.metadata.evidence_ids, label).toEqual(items[pick]!.evidenceIds.slice(0, 8));
          expect(out.metadata.untrusted_content, label).toBe(true);
          tally.fetch.ok += 1;
        }
      }

      // revoke: the second token dies at case revokeAt and every later call is a 401 that reaches nothing
      if (c === revokeAt) revoked = true;
      const before = world.routeCalls;
      const probe = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: c % 2 === 0 ? "search" : "search_world", arguments: c % 2 === 0 ? { query: "payment terms", world_id: WORLD } : { query: "payment terms", collectionId: WORLD } } }, REVOKABLE);
      if (c >= revokeAt) {
        expect(probe.status, label).toBe(401);
        expect(world.routeCalls, label).toBe(before);
        tally.revoked401 += 1;
      } else {
        expect(probe.status, label).toBe(200);
        tally.liveBeforeRevoke += 1;
      }
    }

    console.info(`WO-D19-7 seed=${SEED} cases=${CASES} revokeAt=${revokeAt} tally=${JSON.stringify(tally)}`);
    // The suite means nothing if it never reached both sides of the limit.
    expect(tally.searchWorld.ok + tally.search.ok + tally.fetch.ok).toBeGreaterThan(0);
    expect(tally.searchWorld.refused + tally.search.refused + tally.fetch.refused).toBeGreaterThan(0);
    expect(tally.searchWorld.empty + tally.search.empty).toBeGreaterThan(0);
    expect(tally.revoked401).toBe(CASES - revokeAt);
    expect(tally.liveBeforeRevoke).toBe(revokeAt);
  });
});
