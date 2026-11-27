import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-PROJ-K2: the per-member projection, through the real decision and the real retrieval pipeline.

  Only the network (`fetch` -> PostgREST) and the package store are stubbed. The fixture is one World
  with two sources: D1 in the member's scope, D2 not. D2's units outrank D1's in every source and share
  D1's claim and entity ids, so any place the pipeline consulted D2 before filtering would show up in
  the ranks, the counts or the context limit.
*/
const h = vi.hoisted(() => ({ loadCandidate: vi.fn(), signer: vi.fn() }));
vi.mock("./collection-storage", () => ({ loadPreferredCollectionCandidate: h.loadCandidate }));
vi.mock("./r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()), readR2SignerEnv: h.signer,
}));
vi.mock("./collection-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-download")>()),
  validateReviewableCollectionArtifact: (value: { package?: unknown }) => (value && value.package ? value : null),
}));

import {
  decideMemberProjection, memberProjectionMode, projectionAdmits, projectionShadowFields, projectSourceGroups,
  recordProjectionShadow, type ProjectionDecision,
} from "./member-projection";
import { PROJECTION_WINDOW_EXHAUSTED, runRetrievalPipeline } from "./retrieval-pipeline";
import { buildPublicRetrievalRoute } from "./model-attempt-receipt";
import { getWorldFreshness } from "./world-store";
import { buildBgeM3BaselineProfile } from "./retrieval-profile";
import type { EmbedderAdapter } from "./embedder-adapter";
import type { RerankerAdapter } from "./reranker-adapter";

const WS = "pilot-acme01";
const MEMBER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const D1 = "00000001-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const D2 = "00000002-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const D3 = "00000003-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const COLLECTION = `collection-${"a".repeat(32)}`;
const DIGEST = `sha256:${"1".repeat(64)}`;
const RUN_ID = `retrieval-run-${"b".repeat(32)}`;
const PROFILE = buildBgeM3BaselineProfile(WS, "rev-embed-fixture", "rev-rerank-fixture");
const viewer = (workspaceRole: string, authorizationRevision = 7) => ({ workspaceKey: WS, userId: MEMBER, workspaceRole, authorizationRevision });

type Row = { unit_id: string; document_id: string; text: string; claim_ids: string[]; entity_ids: string[] };
const row = (id: string, document_id: string, text: string): Row => ({
  unit_id: `retrieval-unit-${id}`, document_id, text, claim_ids: ["claim-notice"], entity_ids: ["entity-acme"],
});
// Six hidden units first, four visible ones after: hidden text names "Globex", the entity a reader of
// D2 alone would learn about.
const HIDDEN = [1, 2, 3, 4, 5, 6].map(n => row(`h${n}`, D2, `Globex notice period termination clause ${n}`));
const VISIBLE = [1, 2, 3, 4].map(n => row(`v${n}`, D1, `Acme notice period termination clause ${n}`));
const ids = (rows: Row[]) => rows.map(r => r.unit_id);

type World = { units: Row[]; lexical: string[]; dense: string[] };
let world: World;
let readable: (asked: string[]) => unknown;
let calls: Array<{ path: string; body: unknown }>;
let failDocumentMap = false;
let infoLines: string[];

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_".padEnd(48, "x"));
  h.signer.mockReturnValue({ accountId: "a", accessKeyId: "i", secretAccessKey: "s", bucket: "b" });
  h.loadCandidate.mockResolvedValue({ ok: true, value: { key: "k", artifact: pkg(D1, D2) } });
  world = { units: [...HIDDEN, ...VISIBLE], lexical: ids([...HIDDEN, ...VISIBLE]), dense: ids([HIDDEN[2]!, VISIBLE[1]!, HIDDEN[0]!, VISIBLE[0]!]) };
  readable = (asked) => asked.filter(id => id === D1);
  calls = [];
  failDocumentMap = false;
  rerankerSaw = [];
  infoLines = [];
  vi.spyOn(console, "info").mockImplementation((line: unknown) => { infoLines.push(String(line)); });
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: decodeURIComponent(url.pathname + url.search), body });
    const name = /\/rpc\/([a-z_0-9]+)$/.exec(url.pathname)?.[1];
    if (name === "member_readable_document_ids") return json(readable(body.p_document_ids));
    if (name === "connector_documents_blocked") return json(false);
    if (name === "search_foundation_retrieval_units_lexical") return json(world.lexical.slice(0, body.p_limit).map(unit_id => ({ unit_id })));
    if (name === "search_foundation_retrieval_units_dense") return json(world.dense.slice(0, body.p_limit).map(unit_id => ({ unit_id })));
    if (url.pathname.endsWith("/foundation_retrieval_profiles")) return json([{ id: PROFILE.id }]);
    if (url.pathname.endsWith("/foundation_retrieval_compile_runs")) return json([{ run_id: RUN_ID, status: "completed" }]);
    if (url.pathname.endsWith("/foundation_retrieval_units")) {
      const select = url.searchParams.get("select") ?? "";
      if (failDocumentMap && select === "unit_id,document_id") return json({ message: "down" }, 500);
      const wanted = /^in\.\((.*)\)$/.exec(url.searchParams.get("unit_id") ?? "")?.[1]?.split(",");
      const rows = wanted ? world.units.filter(unit => wanted.includes(unit.unit_id)) : world.units;
      return json(rows.map(unit => ({
        ...Object.fromEntries(select.split(",").map(field => [field, (unit as Record<string, unknown>)[field] ?? null])),
        ...(select.includes("text") ? { unit_type: "section", document_version_key: "c".repeat(64), page_number1: 1,
          bbox1000: [1, 2, 3, 4], evidence_ids: [`evidence-${unit.unit_id}`], authority: null } : {}),
      })));
    }
    throw new Error(`unexpected fetch ${url.pathname}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A stored candidate whose source manifest names these product documents. */
function pkg(...documentIds: string[]) {
  return { package: { files: [
    { path: "source/collection-files.json", content: JSON.stringify(documentIds.map(documentId => ({ documentId }))) },
    { path: "rag/documents.jsonl", content: documentIds.map(documentId => JSON.stringify({ documentId })).join("\n") },
  ] } };
}

const embedder: EmbedderAdapter = {
  identity: () => ({ provider: PROFILE.embedding.provider, model: PROFILE.embedding.model, revision: PROFILE.embedding.revision,
    dimension: PROFILE.embedding.dimension, normalize: PROFILE.embedding.normalize }),
  embedQuery: async () => ({ status: "ok" as const, vectors: [new Array(PROFILE.embedding.dimension).fill(0.01)],
    receipt: { provider: "f", model: "f", revision: "f", dimension: PROFILE.embedding.dimension, normalize: true,
      inputDigest: "sha256:x", outputDigest: "sha256:y", durationMs: 1, timedOut: false } }),
  embedDocuments: async () => { throw new Error("not used"); },
};
let rerankerSaw: string[][] = [];
const reranker: RerankerAdapter = {
  identity: () => ({ provider: "f", model: "f", revision: "f" }),
  rerank: async (_query, candidates) => {
    rerankerSaw.push(candidates.map(candidate => candidate.text));
    return { status: "ok" as const, ranked: candidates.map((candidate, index) => ({ id: candidate.id, score: index })),
      receipt: { provider: "f", model: "f", revision: "f", candidateCount: candidates.length, inputDigest: "sha256:x",
        outputDigest: "sha256:y", durationMs: 1, timedOut: false } };
  },
};
const run = (projection?: ProjectionDecision | null) => runRetrievalPipeline({
  workspaceKey: WS, collectionId: COLLECTION, worldManifestDigest: DIGEST, worldStateId: "ws-1",
  question: "notice period termination", profile: PROFILE, embedder, reranker,
  candidateLimit: 6, contextLimit: 3, ...(projection === undefined ? {} : { projection }),
});
const partial = (allowed: string[]): ProjectionDecision => ({
  kind: "partial", key: "7:sha256:x", allowedDocumentIds: new Set(allowed), sourceCount: 2, admittedSourceCount: 1,
});

describe("the decision", () => {
  it("is off unless enabled; enabled alone is shadow; enforce needs both", () => {
    expect(memberProjectionMode({})).toBe("off");
    expect(memberProjectionMode({ TAVONEL_MEMBER_PROJECTION_ENFORCE: "true" })).toBe("off");
    expect(memberProjectionMode({ TAVONEL_MEMBER_PROJECTION_ENABLED: "1" })).toBe("off");
    expect(memberProjectionMode({ TAVONEL_MEMBER_PROJECTION_ENABLED: "true" })).toBe("shadow");
    expect(memberProjectionMode({ TAVONEL_MEMBER_PROJECTION_ENABLED: "true", TAVONEL_MEMBER_PROJECTION_ENFORCE: "true" })).toBe("enforce");
  });

  it("answers owners and admins `all` without a read, keyed by their authorization revision", async () => {
    for (const role of ["owner", "admin"]) {
      await expect(decideMemberProjection(viewer(role), COLLECTION, DIGEST)).resolves.toEqual({ kind: "all", key: "7:all" });
    }
    expect(calls).toEqual([]);
    expect(h.loadCandidate).not.toHaveBeenCalled();
  });

  it("is `all` for a member with every source, `partial` with some, refused with none", async () => {
    readable = (asked) => asked;
    await expect(decideMemberProjection(viewer("member"), COLLECTION, DIGEST)).resolves.toEqual({ kind: "all", key: "7:all" });

    readable = (asked) => asked.filter(id => id === D1);
    const decided = await decideMemberProjection(viewer("member"), COLLECTION, DIGEST);
    expect(decided).toMatchObject({ kind: "partial", sourceCount: 2, admittedSourceCount: 1 });
    expect(decided.kind === "partial" && [...decided.allowedDocumentIds]).toEqual([D1]);
    // The read sends the World's sources and the member's id, nothing chosen by the caller.
    expect(calls.at(-1)?.body).toEqual({ p_workspace_key: WS, p_user_id: MEMBER, p_document_ids: [D1, D2] });

    readable = () => [];
    // Nothing admitted is the whole-World gate's own refusal: same code, same status.
    await expect(decideMemberProjection(viewer("member"), COLLECTION, DIGEST)).resolves.toEqual({
      kind: "refused", refusal: { code: "MEMBER_SOURCE_SCOPE_DENIED", status: 403 },
    });
  });

  it("keys a projection by revision AND admitted set: a narrowed scope at the same revision is a new key", async () => {
    h.loadCandidate.mockResolvedValue({ ok: true, value: { key: "k", artifact: pkg(D1, D2, D3) } });
    readable = (asked) => asked.filter(id => id !== D3);
    const wide = await decideMemberProjection(viewer("member"), COLLECTION, DIGEST);
    readable = (asked) => asked.filter(id => id === D1);
    const narrow = await decideMemberProjection(viewer("member"), COLLECTION, DIGEST);
    const later = await decideMemberProjection(viewer("member", 8), COLLECTION, DIGEST);
    const keys = [wide, narrow, later].map(decision => decision.kind === "partial" ? decision.key : null);
    expect(keys.every(key => key !== null && /^\d+:sha256:[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]!.startsWith("7:") && keys[1]!.startsWith("7:") && keys[2]!.startsWith("8:")).toBe(true);
  });

  it.each([
    ["the scope store errors", () => { readable = () => { throw new Error("socket"); }; }, "MEMBER_SOURCE_SCOPE_UNAVAILABLE"],
    ["the scope store names an id it was not asked", () => { readable = () => [D1, D3]; }, "MEMBER_SOURCE_SCOPE_UNAVAILABLE"],
    ["no signer", () => { h.signer.mockReturnValue(null); }, "MEMBER_SOURCE_SCOPE_UNAVAILABLE"],
    ["the package store is down", () => { h.loadCandidate.mockResolvedValue({ ok: false, code: "READ_FAILED" }); }, "MEMBER_SOURCE_SCOPE_UNAVAILABLE"],
    ["no package", () => { h.loadCandidate.mockResolvedValue({ ok: false, code: "NOT_FOUND" }); }, "MEMBER_SOURCE_SCOPE_DENIED"],
    ["an unreadable package", () => { h.loadCandidate.mockResolvedValue({ ok: true, value: { key: "k", artifact: { package: { files: [] } } } }); }, "MEMBER_SOURCE_SCOPE_DENIED"],
  ])("fails closed when %s", async (_label, arrange, code) => {
    arrange();
    const decided = await decideMemberProjection(viewer("member"), COLLECTION, DIGEST);
    expect(decided).toMatchObject({ kind: "refused", refusal: { code } });
    // The refusal carries a code and a status, never a count or an id.
    expect(JSON.stringify(decided)).not.toMatch(/0000000[123]-/);
  });

  it("admits a source only when every carrier of its bytes is readable", () => {
    // One source carried by two uploads (D1, D2), another by D3. D2 unreadable takes D1 with it.
    const decided = projectSourceGroups(1, [[D1, D2], [D3]], new Set([D1, D3]));
    expect(decided.kind === "partial" && [...decided.allowedDocumentIds]).toEqual([D3]);
    expect(projectionAdmits(decided, [D1])).toBe(false);
    expect(projectionAdmits(decided, [D3])).toBe(true);
    expect(projectionAdmits(decided, [D3, D1])).toBe(false);
    // A unit that names no source is not shown; a refused decision admits nothing; `all` admits.
    expect(projectionAdmits(decided, [])).toBe(false);
    expect(projectionAdmits({ kind: "refused", refusal: { code: "MEMBER_SOURCE_SCOPE_DENIED", status: 403 } }, [D3])).toBe(false);
    expect(projectionAdmits({ kind: "all", key: "1:all" }, [D1])).toBe(true);
  });

  it("logs the shadow comparison as counts and labels only", () => {
    const decided = projectSourceGroups(1, [[D1], [D2]], new Set([D1]));
    recordProjectionShadow(projectionShadowFields("search", true, decided));
    expect(infoLines).toHaveLength(1);
    expect(JSON.parse(infoLines[0]!)).toEqual({
      event: "member_projection_shadow", endpoint: "search", today: "refused", projected: "partial",
      sources: 2, admittedSources: 1, disagree: false,
    });
    expect(infoLines[0]).not.toMatch(/0000000[12]-|sha256/);
  });
});

describe("the retrieval pipeline, projected", () => {
  it("is unchanged when the projection is absent, null or `all`: same requests, same packet", async () => {
    const baseline = await run();
    const baselineCalls = calls.map(call => call.path);
    for (const projection of [null, { kind: "all", key: "7:all" } as const]) {
      calls = [];
      await expect(run(projection)).resolves.toEqual(baseline);
      expect(calls.map(call => call.path)).toEqual(baselineCalls);
    }
    // And today's pipeline is what the fixture says it is: the hidden units fill the context.
    expect(baseline.ok && baseline.packet.items.map(item => item.unitId).every(id => id.includes("-h"))).toBe(true);
  });

  it("ranks, counts and cuts exactly as a World holding only the admitted source would", async () => {
    const projected = await run(partial([D1]));
    const projectedReranker = rerankerSaw;
    // The same question against a World that never contained D2.
    world = { units: VISIBLE, lexical: ids(VISIBLE), dense: ids([VISIBLE[1]!, VISIBLE[0]!]) };
    rerankerSaw = [];
    const alone = await run();
    expect(projected.ok && alone.ok).toBe(true);
    if (!projected.ok || !alone.ok) return;
    expect(projected.packet).toEqual(alone.packet);
    const { lexicalCandidateCount, denseCandidateCount, fusedCandidateCount } = alone.diagnostics;
    expect(projected.diagnostics).toMatchObject({ lexicalCandidateCount, denseCandidateCount, fusedCandidateCount });
    // N1: the structure pool is an unordered 2000-row read; a projected viewer gets no count from it.
    expect(projected.diagnostics.structureCandidateCount).toBeNull();
    expect(projected.diagnostics.degradations).toEqual(alone.diagnostics.degradations);
    expect(projected.diagnostics.contextCutoff).toEqual(alone.diagnostics.contextCutoff);
    expect(projectedReranker).toEqual(rerankerSaw);
  });

  it("fills K with admitted units although hidden ones outrank them, never K minus the hidden", async () => {
    const result = await run(partial([D1]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.items).toHaveLength(3);
    expect(result.packet.items.every(item => item.unitId.includes("-v"))).toBe(true);
    // The window is widened for a projected query only.
    const limits = calls.filter(call => call.path.includes("/rpc/search_")).map(call => (call.body as { p_limit: number }).p_limit);
    expect(limits).toEqual([500, 500]);
  });

  it("never reads hidden text, never shows it to the reranker, never counts it", async () => {
    const result = await run(partial([D1]));
    if (!result.ok) throw new Error(result.code);
    const textReads = calls.filter(call => call.path.includes("/foundation_retrieval_units?") && call.path.includes("text"));
    expect(textReads.length).toBeGreaterThan(0);
    for (const read of textReads) expect(read.path).not.toMatch(/retrieval-unit-h\d/);
    expect(rerankerSaw.flat().some(text => text.includes("Globex"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("Globex");
    expect(result.diagnostics).toMatchObject({ lexicalCandidateCount: 4, denseCandidateCount: 2, structureCandidateCount: null });
  });

  it("fails closed when the unit-to-document map cannot be read", async () => {
    failDocumentMap = true;
    await expect(run(partial([D1]))).resolves.toEqual({ ok: false, code: "RETRIEVAL_STORE_READ_FAILED" });
    expect(rerankerSaw).toEqual([]);
  });

  it("abstains, without saying why, when nothing admitted matches", async () => {
    const result = await run(partial([D3]));
    if (!result.ok) throw new Error(result.code);
    expect(result.packet.items).toEqual([]);
    expect(result.packet.abstentionReasons).toEqual(["no retrieval source returned a candidate for this question"]);
    expect(result.diagnostics).toMatchObject({ lexicalCandidateCount: 0, denseCandidateCount: 0, fusedCandidateCount: 0 });
    // An unsaturated window is exhaustive: no incompleteness is claimed.
    expect(result.diagnostics.degradations).not.toContain(PROJECTION_WINDOW_EXHAUSTED);
  });
});

/*
  E1 (review r1): a source that fills its 500-unit window with hidden units may have pushed the
  member's own units past it. The result must say it may be incomplete -- without a count.
*/
describe("a saturated projected window", () => {
  const many = Array.from({ length: 500 }, (_unused, n) => row(`s${n}`, D2, `Globex notice period termination filler ${n}`));
  const saturate = (dense: string[]) => {
    world = { units: [...many, ...VISIBLE], lexical: ids([...many, ...VISIBLE]), dense };
  };

  it("degrades, and the public route names `access_scope_incomplete`, when admitted units may lie past the window", async () => {
    saturate(ids([VISIBLE[1]!, VISIBLE[0]!]));
    const result = await run(partial([D1]));
    if (!result.ok) throw new Error(result.code);
    expect(result.packet.items.length).toBeGreaterThan(0);
    expect(result.diagnostics.degradations).toContain(PROJECTION_WINDOW_EXHAUSTED);
    expect(buildPublicRetrievalRoute([], result.diagnostics.degradations).degradationClasses).toEqual(["access_scope_incomplete"]);
    // The id-to-document read was batched (5 x 100 + the rest), and still read no text.
    expect(calls.filter(call => call.path.includes("select=unit_id,document_id")).length).toBe(6);
  });

  it("never abstains as if nothing existed: the reason says the result may be incomplete, and no count", async () => {
    saturate(ids([many[0]!]));
    const result = await run(partial([D1]));
    if (!result.ok) throw new Error(result.code);
    expect(result.packet.items).toEqual([]);
    expect(result.packet.abstentionReasons).toEqual(["results may be incomplete for this viewer's access"]);
    expect(JSON.stringify(result.packet)).not.toMatch(/\b500\b|Globex|0000000[12]-/);
  });

  it("claims nothing when the window held enough admitted units", async () => {
    // 500 rows, six of them admitted near the top: candidateLimit (6) is met inside the window.
    world = {
      units: [...many, ...VISIBLE, row("v5", D1, "Acme notice 5"), row("v6", D1, "Acme notice 6")],
      lexical: [...ids([...VISIBLE, row("v5", D1, "x"), row("v6", D1, "x")]), ...ids(many)].slice(0, 500),
      dense: [],
    };
    const result = await run(partial([D1]));
    if (!result.ok) throw new Error(result.code);
    expect(result.diagnostics.degradations).not.toContain(PROJECTION_WINDOW_EXHAUSTED);
  });

  it("is never claimed without a projection, however full the window", async () => {
    saturate(ids([VISIBLE[1]!]));
    const result = await run();
    if (!result.ok) throw new Error(result.code);
    expect(result.diagnostics.degradations).not.toContain(PROJECTION_WINDOW_EXHAUSTED);
  });
});

/* N2 (review r1): the World's `observedAt` is read over the admitted sources only. */
describe("freshness for a projected viewer", () => {
  const JOB = [{ settled_at: "2026-11-20T00:00:00.000Z", blocked_resolved_at: null, document_ids: [D1, D2], candidate_manifest_digest: null }];
  beforeEach(() => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push({ path: decodeURIComponent(url.pathname + url.search), body: null });
      if (url.pathname.endsWith("/foundation_compile_jobs")) return json(JOB);
      if (url.pathname.endsWith("/source_versions")) {
        const asked = /^in\.\((.*)\)$/.exec(url.searchParams.get("source_id") ?? "")?.[1]?.split(",") ?? [];
        const times: Record<string, string> = { [D1]: "2026-11-01T00:00:00.000Z", [D2]: "2026-11-19T00:00:00.000Z" };
        return json(asked.map(id => times[id]).filter(Boolean).sort().reverse().slice(0, 1).map(observed_at => ({ observed_at })));
      }
      return json([]);
    });
  });

  it("reads observedAt over every source without a projection, as before", async () => {
    await expect(getWorldFreshness(WS, COLLECTION)).resolves.toMatchObject({ observedAt: "2026-11-19T00:00:00.000Z" });
  });

  it("reads observedAt over the admitted sources only, and none when none of the job's sources is admitted", async () => {
    await expect(getWorldFreshness(WS, COLLECTION, { admittedDocumentIds: new Set([D1]) }))
      .resolves.toMatchObject({ observedAt: "2026-11-01T00:00:00.000Z" });
    calls = [];
    await expect(getWorldFreshness(WS, COLLECTION, { admittedDocumentIds: new Set([D3]) }))
      .resolves.toMatchObject({ observedAt: null });
    expect(calls.some(call => call.path.includes("/source_versions"))).toBe(false);
  });
});
