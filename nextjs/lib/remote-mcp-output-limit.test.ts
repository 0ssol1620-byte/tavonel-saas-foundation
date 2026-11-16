import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D19-7: a seeded 1,000-case property suite over /api/mcp output limits, abstention and revoke.

  Per case a random World answer (0-60 items, 0-20,000 characters of mixed ASCII, Hangul, CJK,
  emoji and combining marks, 1-10 evidence ids per item; a seeded ~3% of cases carry exactly one
  item with no evidence id) goes through search_world delivery, the canonical `search` and the
  canonical `fetch`. Each outcome is one of two things and nothing between:
    - success: the delivered text is within DELIVERY_PART_BUDGET_TOKENS and no item was dropped;
    - an explicit refusal: DELIVERY_ITEM_INVALID exactly when the case carries an item without an
      evidence id, otherwise a budget code whose stated token count is over the budget.
  An empty packet is an empty result with an abstention code, never an answer. A second token is
  revoked at a seeded case k: every call with it from case k on is a 401 and reaches no route.

  Reproducibility: case c is a pure function of (SEED, c). Its inputs come from its own PRNG and
  are drawn in full before any call, so no outcome can shift a later draw; the sealing IV and the
  clock are seeded per case too, so the same seed gives the same bytes and the same counts.

  The /api/v1 routes are replaced by one in-memory World (as in remote-mcp-facade.test.ts), so this
  proves the delivery contract of this repository. What a real host does with a large result, or
  its own context limit, is not proved here.
*/

const SEED = 20261117;
const CASES = 1000;
// Each `it` stays far under vitest's 60 s worker RPC timeout.
const BLOCK = 50;
const NOW = Date.UTC(2026, 10, 17);
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
// The sealed result id's IV is random bytes, and its token estimate moves with them; seeded per case it reproduces.
const sealing = vi.hoisted(() => ({ next: null as null | (() => number) }));

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  // Seeded only inside a case (module setup draws bytes too); every draw a case makes is seeded.
  const randomBytes = ((size: number) => sealing.next
    ? Buffer.from(Array.from({ length: size }, () => Math.floor(sealing.next!() * 256)))
    : real.randomBytes(size)) as typeof real.randomBytes;
  return { ...real, default: { ...real, randomBytes }, randomBytes };
});
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
const caseSeed = (c: number) => (SEED + Math.imul(c + 1, 0x9e3779b9)) >>> 0;
const revokeAt = 200 + Math.floor(prng(SEED)() * 600);
const ALPHABETS = [
  "abcdefghijklmnopqrstuvwxyz ",
  "가나다라마바사아자차카타파하 ",
  "文書契約支払期限遅延損害金",
  "\u{1F600}\u{1F4C4}\u{1F512}\u{1F9EA}",
  // Escaped, so no editor can recompose it: decomposed marks are their own estimator branch.
  "e\u0301a\u0308o\u0302 ",
  "0123456789.,;:%$ ",
];
const COMBINING = 4;

// The header's script list is a coverage claim. An editor that normalises the file (NFC or NFD) changes these
// alphabets without a diff anyone reads, so each claim is checked against the alphabets themselves.
it("every alphabet still feeds the estimator the scripts the header claims", () => {
  for (const script of [/[a-z]/, /\p{Script=Hangul}/u, /\p{Script=Han}/u, /\p{Extended_Pictographic}/u, /\p{Mn}/u, /[0-9]/]) {
    expect(ALPHABETS.some((alphabet) => script.test(alphabet)), String(script)).toBe(true);
  }
  // Only the combining alphabet is decomposed; normalisation in either direction flips one of these.
  ALPHABETS.forEach((alphabet, i) => expect(alphabet.normalize("NFC") !== alphabet, `alphabet ${i}`).toBe(i === COMBINING));
  // A combining mark splits the ASCII letter run and costs its own bytes; the precomposed form takes another branch.
  const marks = ALPHABETS[COMBINING]!;
  expect(estimateTokens(marks)).toBeGreaterThan(estimateTokens(marks.normalize("NFC")));
});

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

// Every draw of case c, made before any call: no outcome can change what a later draw is.
function makeCase(c: number) {
  const rand = prng(caseSeed(c));
  // Most cases are small enough to deliver; a long tail is large enough to be refused.
  const count = Math.floor(rand() * 61);
  const big = rand() < 0.3;
  // A small seeded share of cases carries exactly one item with no evidence id; every other item is valid, so the
  // budget decides those cases.
  const invalidAt = count > 0 && rand() < 0.03 ? Math.floor(rand() * count) : -1;
  const items = Array.from({ length: count }, (_, i) => {
    const length = big ? Math.floor(rand() * 20_001) : Math.floor(rand() * 400);
    const idCount = i === invalidAt ? 0 : 1 + Math.floor(rand() * 10);
    return {
      unitId: `u${i}`, text: text(rand, length), claimIds: [], entityIds: [], sourceVersionId: `dv_${i % 3}`,
      evidenceIds: Array.from({ length: idCount }, (_, k) => `ev_${c}_${i}_${k}`),
      pageNumber1: 1 + (i % 7), bbox1000: [10, 20, 300, 40], authority: "primary",
      retrieval: { lexicalRank: 1, denseRank: 2, structureRank: null, rerankerScore: 0.5 },
    };
  });
  return { count, invalidAt, items, pickDraw: rand() };
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
  // The sealed id carries an expiry; a fixed clock keeps its bytes, and so its token estimate, reproducible.
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.authenticateKey.mockImplementation(async (token: string) =>
    token === LIVE || (token === REVOKABLE && !revoked)
      ? { ok: true, principal: { kind: "api-key", keyId: `key-${token}`, workspaceKey: A, userId: "u-1", scopes: READ_SCOPES, authorizationRevision: 4 } }
      : { ok: false, code: "API_KEY_INVALID" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const BUDGET_CODES = {
  searchWorld: ["DELIVERY_OVER_TOOL_RESULT_BUDGET", "DELIVERY_ITEM_OVER_PART_BUDGET"],
  search: ["DELIVERY_OVER_TOOL_RESULT_BUDGET", "DELIVERY_ITEM_OVER_PART_BUDGET"],
  // fetch renders through the same delivery, so one region over the part budget is refused by name too.
  fetch: ["FETCH_OVER_BUDGET", "DELIVERY_ITEM_OVER_PART_BUDGET"],
} as const;
type Tool = keyof typeof BUDGET_CODES;
const REFUSAL = /^(DELIVERY_[A-Z_]+|FETCH_OVER_BUDGET)\b/;
function refusalCode(text: string): string {
  const match = REFUSAL.exec(text);
  if (!match) throw new Error(`refusal without a known code: ${text.slice(0, 80)}`);
  return match[1]!;
}
// A budget refusal states what it measured; that number has to be over the budget, or the refusal was wrong.
function refusedTokens(text: string): number {
  const match = /\b(\d+) estimated tokens\b/.exec(text);
  if (!match) throw new Error(`budget refusal without a token count: ${text.slice(0, 120)}`);
  return Number(match[1]);
}
function checkRefusal(tool_: Tool, text: string, invalid: boolean, label: string): string {
  const code = refusalCode(text);
  if (invalid) {
    expect(code, label).toBe("DELIVERY_ITEM_INVALID");
  } else {
    expect(BUDGET_CODES[tool_] as readonly string[], label).toContain(code);
    expect(refusedTokens(text), label).toBeGreaterThan(DELIVERY_PART_BUDGET_TOKENS);
  }
  return code;
}

type Outcome = "ok" | "empty" | `refused:${string}`;
type CaseRun = { invalid: boolean; searchWorld: Outcome; search: Outcome; fetch: Outcome | null; revokeProbe: number; bytes: string[] };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function runCase(c: number): Promise<CaseRun> {
  // Let the worker's RPC replies in between cases: the mocked routes answer on microtasks alone.
  await new Promise((resolve) => setImmediate(resolve));
  const { count, invalidAt, items, pickDraw } = makeCase(c);
  sealing.next = prng(caseSeed(c) ^ 0x5bd1e995);
  revoked = c >= revokeAt;
  world.items = items;
  world.evidence = new Map();
  for (const entry of items) {
    entry.evidenceIds.slice(0, 8).forEach((id, k) => world.evidence.set(id, {
      id, sourceId: "src-1", sourceVersionId: entry.sourceVersionId, page: entry.pageNumber1, bbox: entry.bbox1000,
      blockId: `b${k}`, excerpt: entry.text, authority: "primary", digest: "sha256:x",
    }));
  }
  const invalid = invalidAt >= 0;
  const label = `case ${c} (seed ${SEED}, ${count} items)`;
  const bytes: string[] = [];

  // search_world delivery
  const sw = await tool("search_world", { collectionId: WORLD, query: "payment terms", limit: 25 });
  bytes.push(digest(sw));
  expect(sw.status, label).toBe(200);
  let searchWorld: Outcome;
  if (sw.result.isError) {
    searchWorld = `refused:${checkRefusal("searchWorld", sw.result.content[0]!.text, invalid, label)}`;
  } else {
    expect(invalid, `${label}: an item without an evidence id was delivered`).toBe(false);
    const total = sw.result.content.reduce((sum, part) => sum + estimateTokens(part.text), 0);
    expect(total, label).toBeLessThanOrEqual(DELIVERY_PART_BUDGET_TOKENS);
    const packet = (sw.result.structuredContent as { contextPacket: { items: unknown[]; abstentionReasons: string[] } }).contextPacket;
    expect(packet.items.length, label).toBe(count);
    if (count === 0) expect(packet.abstentionReasons.length, label).toBeGreaterThan(0);
    searchWorld = count === 0 ? "empty" : "ok";
  }

  // canonical search
  const s = await tool("search", { query: "payment terms", world_id: WORLD, limit: 10 });
  bytes.push(digest(s));
  expect(s.status, label).toBe(200);
  let search: Outcome;
  let resultIds: string[] = [];
  if (s.result.isError) {
    search = `refused:${checkRefusal("search", s.result.content[0]!.text, invalid, label)}`;
  } else {
    expect(invalid, `${label}: an item without an evidence id was delivered`).toBe(false);
    const out = s.result.structuredContent as { results: Array<{ id: string }>; notice?: { code: string; abstention_reasons?: string[] } };
    expect(estimateTokens(JSON.stringify(out)), label).toBeLessThanOrEqual(DELIVERY_PART_BUDGET_TOKENS);
    expect(out.results.length, label).toBe(count);
    if (count === 0) {
      expect(out.notice?.code, label).toBe("SEARCH_EMPTY");
      expect(out.notice?.abstention_reasons?.length, label).toBeGreaterThan(0);
    }
    search = count === 0 ? "empty" : "ok";
    resultIds = out.results.map((r) => r.id);
  }

  // canonical fetch of one of the ids search handed out
  let fetch: Outcome | null = null;
  if (resultIds.length > 0) {
    const pick = Math.floor(pickDraw * resultIds.length);
    const f = await tool("fetch", { id: resultIds[pick]! });
    bytes.push(digest(f));
    expect(f.status, label).toBe(200);
    if (f.result.isError) {
      fetch = `refused:${checkRefusal("fetch", f.result.content[0]!.text, false, label)}`;
    } else {
      const out = f.result.structuredContent as { text: string; metadata: { evidence_ids: string[]; untrusted_content: boolean } };
      // fetch budgets the rendered files; every file ends in a newline, so the join only merges whitespace.
      expect(estimateTokens(out.text), label).toBeLessThanOrEqual(DELIVERY_PART_BUDGET_TOKENS);
      expect(out.metadata.evidence_ids, label).toEqual(items[pick]!.evidenceIds.slice(0, 8));
      expect(out.metadata.untrusted_content, label).toBe(true);
      fetch = "ok";
    }
  }

  // revoke: the second token dies at case revokeAt and every later call is a 401 that reaches nothing
  const before = world.routeCalls;
  const probe = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: c % 2 === 0 ? "search" : "search_world", arguments: c % 2 === 0 ? { query: "payment terms", world_id: WORLD } : { query: "payment terms", collectionId: WORLD } } }, REVOKABLE);
  if (c >= revokeAt) {
    expect(probe.status, label).toBe(401);
    expect(world.routeCalls, label).toBe(before);
  } else {
    expect(probe.status, label).toBe(200);
  }
  sealing.next = null;
  return { invalid, searchWorld, search, fetch, revokeProbe: probe.status, bytes };
}

describe("1,000 seeded output-limit, abstention and revoke cases", () => {
  const runs: CaseRun[] = [];

  for (let from = 0; from < CASES; from += BLOCK) {
    it(`seed ${SEED}: cases ${from}-${from + BLOCK - 1}`, { timeout: 55_000 }, async () => {
      for (let c = from; c < from + BLOCK; c += 1) runs[c] = await runCase(c);
    });
  }

  it("reached both sides of every limit", () => {
    expect(runs.filter(Boolean).length).toBe(CASES);
    const codes: Record<Tool, Record<string, number>> = { searchWorld: {}, search: {}, fetch: {} };
    const tally = { searchWorld: { ok: 0, refused: 0, empty: 0 }, search: { ok: 0, refused: 0, empty: 0 }, fetch: { ok: 0, refused: 0 }, revoked401: 0, liveBeforeRevoke: 0, invalidItemCases: 0 };
    for (const run of runs) {
      for (const tool_ of ["searchWorld", "search", "fetch"] as const) {
        const outcome = run[tool_];
        if (outcome === null) continue;
        if (outcome.startsWith("refused:")) {
          const code = outcome.slice("refused:".length);
          codes[tool_][code] = (codes[tool_][code] ?? 0) + 1;
          tally[tool_].refused += 1;
        } else {
          (tally[tool_] as Record<string, number>)[outcome] += 1;
        }
      }
      if (run.invalid) tally.invalidItemCases += 1;
      if (run.revokeProbe === 401) tally.revoked401 += 1;
      else tally.liveBeforeRevoke += 1;
    }
    console.info(`WO-D19-7 seed=${SEED} cases=${CASES} revokeAt=${revokeAt} tally=${JSON.stringify(tally)} codes=${JSON.stringify(codes)}`);
    expect(tally.searchWorld.ok + tally.search.ok + tally.fetch.ok).toBeGreaterThan(0);
    // Refusals must come from the budget itself, not only from invalid items.
    const budgetRefusals = (tool_: Tool) => BUDGET_CODES[tool_].reduce((sum, code) => sum + (codes[tool_][code] ?? 0), 0);
    expect(budgetRefusals("searchWorld")).toBeGreaterThan(0);
    expect(budgetRefusals("search")).toBeGreaterThan(0);
    expect(budgetRefusals("fetch")).toBeGreaterThan(0);
    expect(tally.invalidItemCases).toBeGreaterThan(0);
    expect(codes.searchWorld.DELIVERY_ITEM_INVALID).toBe(tally.invalidItemCases);
    expect(codes.search.DELIVERY_ITEM_INVALID).toBe(tally.invalidItemCases);
    expect(tally.searchWorld.empty + tally.search.empty).toBeGreaterThan(0);
    expect(tally.revoked401).toBe(CASES - revokeAt);
    expect(tally.liveBeforeRevoke).toBe(revokeAt);
  });

  it("replays any case alone to the same bytes, whatever ran before it", { timeout: 55_000 }, async () => {
    expect(runs.filter(Boolean).length).toBe(CASES);
    // The first and last case, both sides of the revoke, and the first cases that reached fetch or a search budget refusal.
    const nearBudget = runs
      .map((run, c) => ({ c, run }))
      .filter(({ run }) => run.fetch !== null || run.search === "refused:DELIVERY_OVER_TOOL_RESULT_BUDGET")
      .slice(0, 4)
      .map(({ c }) => c);
    for (const c of [0, revokeAt - 1, revokeAt, CASES - 1, ...nearBudget]) {
      await runCase(CASES - 1 - c);
      expect((await runCase(c)).bytes, `case ${c} (seed ${SEED})`).toEqual(runs[c]!.bytes);
    }
  });
});
