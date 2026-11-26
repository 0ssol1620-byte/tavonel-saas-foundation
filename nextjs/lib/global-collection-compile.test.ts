import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueCorpusCompile } from "./compile-job-store";
import { CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { CORE_V2_MAX_REQUEST_BYTES } from "./core-runtime-v2";
import { corpusIdFor } from "./corpus-id";
import { planCorpusBatches } from "./corpus-batching";
import { CORE_CLIENT_TIMEOUT_MS } from "./execution-budget";
import {
  CORE_OUTPUT_BUDGET_ENV, GLOBAL_COLLECTION_MAX_BYTES, GLOBAL_COLLECTION_MAX_REGIONS,
  globalCollectionCompileEnabled, judgeGlobalCollectionInput, judgeOneWorldSelection,
  type OneWorldBound, type OneWorldSelection,
} from "./global-collection-compile";
import { MAX_COLLECTION_JSON_BYTES } from "./r2-objects";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const documentIds = Array.from({ length: 13 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
/** Production's Core output budget (96 MiB, ADR 0011 §0), as the env value the deployment would carry. */
const BUDGET_96_MIB = 96 * 1024 * 1024;
function qualify() {
  vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "1");
  vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
  vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256", `sha256:${"a".repeat(64)}`);
}
const fitting = (ids = documentIds): OneWorldSelection => ({
  documents: ids.map((documentId) => ({ documentId, pages: 2, regions: 10, bytes: 1_000 })),
  measured: { coreOutputBytes: 1_000_000, storedCandidateBytes: 1_000_000, coreMs: 10_000 },
});
const asEnv = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const env = () => asEnv({ [CORE_OUTPUT_BUDGET_ENV]: String(BUDGET_96_MIB) });
/** Judges a selection whose ids are its figures' ids, or the 13 standard documents when there are none. */
const judge = (selection: OneWorldSelection | undefined, e?: NodeJS.ProcessEnv) => judgeOneWorldSelection(
  Array.isArray(selection?.documents) && selection.documents.every((d) => typeof d?.documentId === "string")
    ? selection.documents.map((d) => d.documentId) : documentIds, selection, e);
const measuredWith = (patch: Record<string, unknown>) =>
  ({ ...fitting(), measured: { ...fitting().measured, ...patch } }) as OneWorldSelection;

function stubStore() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("/foundation_compile_jobs?")) return Response.json([]);
    const body = JSON.parse(String(init?.body)); calls.push({ url: String(url), body });
    return Response.json([{ job_id: body.p_job_id, state: "preflight", created: true,
      corpus_id: body.p_corpus_id, batch_index: body.p_batch_index, idempotency_key: body.p_idempotency_key }]);
  });
  return calls;
}
const rpcNames = (calls: Array<{ url: string }>) => calls.map((call) => call.url.split("/rpc/")[1]);
const enqueue = (selection?: OneWorldSelection) => enqueueCorpusCompile({ workspaceKey: "pilot-alpha",
  createdByUserId: "00000000-0000-4000-8000-000000000001", authorizationRevision: 1, connectorViewerEnabled: false,
  documentIds, ...(selection ? { selection } : {}) });

describe("bounded private whole-collection compilation", () => {
  it("requires both closed runtime flags and an explicitly pinned Core release", () => {
    expect(globalCollectionCompileEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "1");
    expect(globalCollectionCompileEnabled()).toBe(false);
    qualify();
    expect(globalCollectionCompileEnabled()).toBe(true);
  });
  it("accepts13 bounded inputs and refuses overflow, duplicate membership and excessive regions", () => {
    const docs = documentIds.map((documentId) => ({ documentId, regions: [{}] }));
    expect(judgeGlobalCollectionInput(docs)).toBe(true);
    expect(judgeGlobalCollectionInput([...docs, docs[0]])).toBe(false);
    expect(judgeGlobalCollectionInput([{ documentId: "a", regions: Array.from({ length: 10001 }, () => ({})) }])).toBe(false);
    expect(judgeGlobalCollectionInput([{ documentId: "a", regions: ["x".repeat(GLOBAL_COLLECTION_MAX_BYTES)] }])).toBe(false);
    expect(judgeGlobalCollectionInput(Array.from({ length: 129 }, (_, i) => ({ documentId: String(i) })))).toBe(false);
  });
  it("durably enqueues one full13-document collection in a separate legacy-safe corpus namespace", async () => {
    qualify();
    // WO-BIG-2: the whole-collection job is chosen only for a selection shown to fit every bound.
    vi.stubEnv(CORE_OUTPUT_BUDGET_ENV, String(BUDGET_96_MIB));
    const calls = stubStore();
    const result = await enqueue(fitting());
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/rpc/enqueue_foundation_global_collection_job");
    expect(calls[0].body.p_document_ids).toEqual(documentIds);
    expect(calls[0].body.p_batch_count).toBe(1);
    expect(calls[0].body.p_corpus_id).not.toBe(corpusIdFor("pilot-alpha", documentIds));
  });
});

describe("WO-BIG-2: the global-collection flag no longer requires the revision flag", () => {
  it("is on with its own flag and a pinned release, revision unset; off without either", () => {
    const pin = `sha256:${"a".repeat(64)}`;
    expect(globalCollectionCompileEnabled(asEnv({ TAVONEL_GLOBAL_COLLECTION_COMPILE: "1", TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256: pin }))).toBe(true);
    expect(globalCollectionCompileEnabled(asEnv({ TAVONEL_GLOBAL_COLLECTION_COMPILE: "0", TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256: pin, TAVONEL_CORE_V2_REVISION_COMPILE: "1" }))).toBe(false);
    expect(globalCollectionCompileEnabled(asEnv({ TAVONEL_GLOBAL_COLLECTION_COMPILE: "1", TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256: "sha256:abc" }))).toBe(false);
  });
});

describe("WO-BIG-2: does this selection fit one World, bound by bound", () => {
  it("judges against the existing constants, not new numbers", () => {
    expect(GLOBAL_COLLECTION_MAX_BYTES).toBeLessThan(CORE_V2_MAX_REQUEST_BYTES);
    expect(judge(fitting(), env()).checks.map(({ bound, limit }) => [bound, limit])).toEqual([
      ["documents", CORPUS_MAX_DOCUMENTS], ["regions", GLOBAL_COLLECTION_MAX_REGIONS], ["input_bytes", GLOBAL_COLLECTION_MAX_BYTES],
      ["core_output_bytes", BUDGET_96_MIB], ["stored_candidate_bytes", MAX_COLLECTION_JSON_BYTES], ["core_wall_clock_ms", CORE_CLIENT_TIMEOUT_MS],
    ]);
  });

  it("fits only when every bound fits", () => {
    expect(judge(fitting(), env()).verdict).toBe("fits");
  });

  const ids = (n: number) => Array.from({ length: n }, (_, i) => `doc-${i}`);
  const withDocs = (documents: OneWorldSelection["documents"]): OneWorldSelection => ({ ...fitting(), documents });
  const cases: Array<[OneWorldBound, OneWorldSelection, OneWorldSelection]> = [
    ["documents",
      withDocs(ids(CORPUS_MAX_DOCUMENTS).map((documentId) => ({ documentId, pages: 1, regions: 1, bytes: 100 }))),
      withDocs(ids(CORPUS_MAX_DOCUMENTS + 1).map((documentId) => ({ documentId, pages: 1, regions: 1, bytes: 100 })))],
    ["regions",
      withDocs([{ documentId: "a", pages: 1, regions: 9_999, bytes: 100 }, { documentId: "b", pages: 1, regions: 1, bytes: 100 }]),
      withDocs([{ documentId: "a", pages: 1, regions: 10_000, bytes: 100 }, { documentId: "b", pages: 1, regions: 1, bytes: 100 }])],
    // Two members: their bytes plus "[", "]" and one comma are the array's bytes.
    ["input_bytes",
      withDocs([{ documentId: "a", pages: 1, regions: 1, bytes: GLOBAL_COLLECTION_MAX_BYTES - 103 }, { documentId: "b", pages: 1, regions: 1, bytes: 100 }]),
      withDocs([{ documentId: "a", pages: 1, regions: 1, bytes: GLOBAL_COLLECTION_MAX_BYTES - 102 }, { documentId: "b", pages: 1, regions: 1, bytes: 100 }])],
    ["core_output_bytes", measuredWith({ coreOutputBytes: BUDGET_96_MIB }), measuredWith({ coreOutputBytes: BUDGET_96_MIB + 1 })],
    ["stored_candidate_bytes", measuredWith({ storedCandidateBytes: MAX_COLLECTION_JSON_BYTES }), measuredWith({ storedCandidateBytes: MAX_COLLECTION_JSON_BYTES + 1 })],
    ["core_wall_clock_ms", measuredWith({ coreMs: CORE_CLIENT_TIMEOUT_MS }), measuredWith({ coreMs: CORE_CLIENT_TIMEOUT_MS + 1 })],
  ];
  it.each(cases)("%s: at the bound fits, one past it does not, and no other bound moves", (bound, atBound, past) => {
    expect(judge(atBound, env()).verdict).toBe("fits");
    const verdict = judge(past, env());
    expect(verdict.verdict).toBe("does_not_fit");
    expect(verdict.checks.filter((item) => item.status !== "fits").map((item) => [item.bound, item.status])).toEqual([[bound, "over"]]);
  });

  it("refuses to promise when a size or a bound is unknown, never defaulting to fits", () => {
    expect(judge(undefined, env()).verdict).toBe("unknown");
    expect(judge({ documents: fitting().documents }, env()).verdict).toBe("unknown");
    for (const key of ["coreOutputBytes", "storedCandidateBytes", "coreMs"]) {
      for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "1", 2 ** 53]) {
        expect(judge(measuredWith({ [key]: bad }), env()).verdict, `${key}=${String(bad)}`).toBe("unknown");
      }
    }
    // Production's budget not known on this side: no default, no promise.
    for (const budget of [undefined, "", "0", "-1", "1e8", "96MiB", " 100663296", String(MAX_COLLECTION_JSON_BYTES + 1)]) {
      const e = (budget === undefined ? {} : { [CORE_OUTPUT_BUDGET_ENV]: budget }) as NodeJS.ProcessEnv;
      const verdict = judge(fitting(), e);
      expect(verdict.checks.find((item) => item.bound === "core_output_bytes")!.status, String(budget)).toBe("unknown");
      expect(verdict.verdict).toBe("unknown");
    }
    // A document whose own figures are missing, malformed or duplicated makes the input unknown.
    const base = fitting().documents;
    const malformed: unknown[][] = [
      [],
      [...base.slice(1), { ...base[0], pages: Number.NaN }],
      [...base.slice(1), { ...base[0], regions: -1 }],
      [...base.slice(1), { ...base[0], bytes: 1 }],
      [...base.slice(1), { ...base[0], bytes: "1000" }],
      [...base.slice(1), { documentId: base[0].documentId }],
      [...base.slice(1), null],
      [...base, base[0]],
    ];
    for (const documents of malformed) {
      const verdict = judge({ ...fitting(), documents } as unknown as OneWorldSelection, env());
      expect(verdict.verdict).toBe("unknown");
      expect(verdict.checks.filter((item) => ["regions", "input_bytes"].includes(item.bound)).map((item) => item.status)).toEqual(["unknown", "unknown"]);
    }
    // Figures of other documents are not this selection's figures.
    expect(judgeOneWorldSelection([...documentIds.slice(1), "doc-other"], fitting(), env()).verdict).toBe("unknown");
    expect(judgeOneWorldSelection(documentIds, fitting(documentIds.slice(1)), env()).verdict).toBe("unknown");
    // An over bound still wins over an unknown one, so the sentence can say what does not fit.
    expect(judge({ ...fitting(), measured: { coreMs: CORE_CLIENT_TIMEOUT_MS + 1 } }, env()).verdict).toBe("does_not_fit");
  });

  it("speaks in documents and pages, and never names a bound, figure or limit", () => {
    const heavy = withDocs(ids(13).map((documentId) => ({ documentId, pages: 2, regions: 1_000, bytes: 1_000 })));
    const sentences = {
      fits: judge(fitting(), env()).sentence,
      input: judge(heavy, env()).sentence,
      unknown: judge({ documents: fitting().documents }, env()).sentence,
      output: judge(measuredWith({ coreOutputBytes: BUDGET_96_MIB + 1 }), env()).sentence,
      clock: judge(measuredWith({ coreMs: CORE_CLIENT_TIMEOUT_MS + 1 }), env()).sentence,
    };
    expect(sentences).toEqual({
      fits: "These 13 documents (26 pages) fit one World.",
      // 13,000 regions in 13 equal documents: three of them have to be left out.
      input: "These 13 documents (26 pages) are more than one World can be compiled from: 3 documents (6 pages) too many. They are compiled as 2 separate Worlds that are not merged.",
      unknown: "Whether these 13 documents (26 pages) fit one World is not known yet. They are compiled as 2 separate Worlds that are not merged.",
      output: "These 13 documents (26 pages) compile to more than one World can hold. They are compiled as 2 separate Worlds that are not merged.",
      clock: "These 13 documents (26 pages) take longer to compile than one World is given. They are compiled as 2 separate Worlds that are not merged.",
    });
    for (const sentence of Object.values(sentences)) {
      expect(sentence).not.toMatch(/region|byte|MiB|MB|second|ms\b|threshold|score|budget|10,?000|4,?194,?304|100,?663,?296|52,?000|128/i);
    }
  });
});

/*
  The class: a selection-time "fits" that the compile-time judge would refuse. The verdict sums
  per-document figures; the compile judge measures the real array. They agree only if the framing
  arithmetic is exact, so this goes through real JSON of synthetic documents at and past each bound.
*/
describe("WO-BIG-2: the selection-time verdict and the compile-time judge agree on real documents", () => {
  type Doc = { documentId: string; regions: Array<{ text: string }>; pad: string };
  const figures = (docs: Doc[]): OneWorldSelection => ({
    documents: docs.map((d) => ({ documentId: d.documentId, pages: 1, regions: d.regions.length, bytes: Buffer.byteLength(JSON.stringify(d), "utf8") })),
    measured: fitting().measured,
  });
  function padTo(docs: Doc[], total: number) {
    docs[docs.length - 1].pad = "x".repeat(total - Buffer.byteLength(JSON.stringify(docs), "utf8"));
    expect(Buffer.byteLength(JSON.stringify(docs), "utf8")).toBe(total);
    return docs;
  }
  // Non-ASCII text on purpose: bytes, not characters, are what is bounded.
  const make = (n: number, regionsEach: number): Doc[] => Array.from({ length: n }, (_, i) => ({
    documentId: `doc-${i}`, regions: Array.from({ length: regionsEach }, (_, r) => ({ text: `Synthetic line ${r} — ü` })), pad: "",
  }));
  const sets: Array<[string, Doc[]]> = [
    ["bytes at the bound", padTo(make(13, 40), GLOBAL_COLLECTION_MAX_BYTES)],
    ["bytes one past", padTo(make(13, 40), GLOBAL_COLLECTION_MAX_BYTES + 1)],
    ["regions at the bound", make(40, 250)],
    ["regions one past", [...make(40, 250), { documentId: "extra", regions: [{ text: "x" }], pad: "" }]],
    ["one document", make(1, 3)],
    ["129 documents", make(129, 1)],
  ];
  it.each(sets)("%s", (_, docs) => {
    const inputFits = judge(figures(docs), env()).checks.slice(0, 3).every((item) => item.status === "fits");
    expect(inputFits).toBe(judgeGlobalCollectionInput(docs));
  });
  it("covers both outcomes", () => {
    expect(sets.map(([, docs]) => judgeGlobalCollectionInput(docs))).toEqual([true, false, true, false, true, false]);
  });
});

/*
  Shadow comparison, Foundation half (ADR 0011 §4 C ladder): the whole selection against the reduce of
  its parts, on synthetic input. The parts cover the whole exactly once, and the whole's figures are
  the reduce of the parts' figures, so a verdict can be judged from figures recorded per part. The Core
  half -- canonical World of the whole compile == corpus_reduce(parts) -- is Core's benchmark
  (ADR 0011 §3.2) and does not run here.
*/
describe("WO-BIG-2: whole vs reduce(parts) on synthetic input", () => {
  it("the parts partition the whole and their figures reduce to the whole's", () => {
    const docs = Array.from({ length: 30 }, (_, i) => ({ documentId: `doc-${String(i).padStart(2, "0")}`,
      regions: Array.from({ length: 1 + (i * 7) % 23 }, (_, r) => ({ text: `line ${r}` })) }));
    const byId = new Map(docs.map((d) => [d.documentId, d]));
    const parts = planCorpusBatches(docs.map((d) => d.documentId)).map((batch) => batch.documentIds.map((id) => byId.get(id)!));
    expect(parts.length).toBe(3);
    expect(parts.flat().map((d) => d.documentId).sort()).toEqual(docs.map((d) => d.documentId).sort());
    expect(new Set(parts.flat().map((d) => d.documentId)).size).toBe(docs.length);

    const arrayBytes = (items: typeof docs) => Buffer.byteLength(JSON.stringify(items), "utf8");
    const reducedRegions = parts.reduce((total, part) => total + part.reduce((s, d) => s + d.regions.length, 0), 0);
    // Each part's array bytes minus its own framing, plus the whole's framing.
    const reducedBytes = parts.reduce((total, part) => total + arrayBytes(part) - (part.length + 1), 0) + docs.length + 1;
    expect(reducedRegions).toBe(docs.reduce((s, d) => s + d.regions.length, 0));
    expect(reducedBytes).toBe(arrayBytes(docs));

    const whole = judge({
      documents: parts.flat().map((d) => ({ documentId: d.documentId, pages: 1, regions: d.regions.length, bytes: Buffer.byteLength(JSON.stringify(d), "utf8") })),
      measured: fitting().measured,
    }, env());
    expect(whole.checks.find((item) => item.bound === "regions")!.figure).toBe(reducedRegions);
    expect(whole.checks.find((item) => item.bound === "input_bytes")!.figure).toBe(reducedBytes);
    expect(whole.verdict === "fits").toBe(judgeGlobalCollectionInput(docs));
  });
});

describe("WO-BIG-2: the enqueue choice under each verdict", () => {
  it("flag off: today's parts whatever the selection says, and no verdict", async () => {
    vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "0");
    vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256", `sha256:${"a".repeat(64)}`);
    vi.stubEnv(CORE_OUTPUT_BUDGET_ENV, String(BUDGET_96_MIB));
    const withSelection = stubStore();
    const a = await enqueue(fitting());
    const withoutSelection = stubStore();
    const b = await enqueue();
    for (const [calls, result] of [[withSelection, a], [withoutSelection, b]] as const) {
      expect(rpcNames(calls)).toEqual(["enqueue_foundation_compile_job", "enqueue_foundation_compile_job"]);
      expect(calls[0].body.p_corpus_id).toBe(corpusIdFor("pilot-alpha", documentIds));
      expect(result.ok && "oneWorld" in result.value).toBe(false);
    }
    expect(withSelection.map((c) => ({ ...c.body, p_job_id: null }))).toEqual(withoutSelection.map((c) => ({ ...c.body, p_job_id: null })));
  });

  it("flag on, fits: one whole-collection job", async () => {
    qualify(); vi.stubEnv(CORE_OUTPUT_BUDGET_ENV, String(BUDGET_96_MIB));
    const calls = stubStore();
    const result = await enqueue(fitting());
    expect(rpcNames(calls)).toEqual(["enqueue_foundation_global_collection_job"]);
    expect(result.ok && result.value.oneWorld?.verdict).toBe("fits");
  });

  const notOne: Array<[string, OneWorldSelection | undefined]> = [
    ["input over", { ...fitting(), documents: documentIds.map((documentId) => ({ documentId, pages: 2, regions: 1_000, bytes: 1_000 })) }],
    ["Core output over", measuredWith({ coreOutputBytes: BUDGET_96_MIB + 1 })],
    ["stored candidate over", measuredWith({ storedCandidateBytes: MAX_COLLECTION_JSON_BYTES + 1 })],
    ["wall clock over", measuredWith({ coreMs: CORE_CLIENT_TIMEOUT_MS + 1 })],
    ["nothing measured", { documents: fitting().documents }],
    ["no figures at all", undefined],
  ];
  it.each(notOne)("flag on, %s: today's parts, with the sentence that says why", async (_, selection) => {
    qualify(); vi.stubEnv(CORE_OUTPUT_BUDGET_ENV, String(BUDGET_96_MIB));
    const calls = stubStore();
    const result = await enqueue(selection);
    expect(rpcNames(calls)).toEqual(["enqueue_foundation_compile_job", "enqueue_foundation_compile_job"]);
    expect(calls[0].body.p_corpus_id).toBe(corpusIdFor("pilot-alpha", documentIds));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.batchCount).toBe(2);
    expect(result.value.oneWorld?.verdict).not.toBe("fits");
    expect(result.value.oneWorld?.sentence).toContain("2 separate Worlds that are not merged");
  });

  it("flag on, Core output budget not configured on this side: parts, never one", async () => {
    qualify();
    const calls = stubStore();
    const result = await enqueue(fitting());
    expect(calls).toHaveLength(2);
    expect(result.ok && result.value.oneWorld?.verdict).toBe("unknown");
  });

  it("flag on, figures for other documents than the selection: refused before any write", async () => {
    qualify(); vi.stubEnv(CORE_OUTPUT_BUDGET_ENV, String(BUDGET_96_MIB));
    const calls = stubStore();
    const other = fitting([...documentIds.slice(1), "00000000-0000-4000-8000-999999999999"]);
    const short = fitting(documentIds.slice(1));
    const duplicated = fitting([...documentIds.slice(1), documentIds[1]]);
    for (const selection of [other, short, duplicated, { documents: "x" } as unknown as OneWorldSelection]) {
      expect(await enqueue(selection)).toEqual({ ok: false, code: "COMPILE_JOB_SCOPE_INVALID" });
    }
    expect(calls).toHaveLength(0);
  });
});
