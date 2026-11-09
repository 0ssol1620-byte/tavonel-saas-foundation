import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  E2 (PROGRAM-2026-11-04 §4.E): the answerability gate and its shadow wiring in the Ask route.

  Proved here: each rule fires in its order and reports which one; a held conflict is never resolved;
  dates and years are not amounts; the threshold has no default. TAVONEL_ASK_ANSWERABILITY_MODE off
  computes nothing, shadow logs one line bound to the answer receipt and changes no byte served, on
  either Ask path; anything else is off and says so.

  Not proved: that the gate is right. That is the pre-registered holdout verdict in
  eval/ask-quality/e2, and nothing here tunes it.
*/

const { authorize, revalidate, activeWorld, pipeline, sourceIds, sourceAccess, candidate, evaluate } = vi.hoisted(() => ({
  authorize: vi.fn(), revalidate: vi.fn(), activeWorld: vi.fn(), pipeline: vi.fn(), sourceIds: vi.fn(), sourceAccess: vi.fn(),
  candidate: vi.fn(), evaluate: vi.fn(),
}));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: sourceIds }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess, checkConnectorSourceAccessForViewer: sourceAccess }));
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
  revalidateFoundationAuthorization: revalidate,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: activeWorld,
}));
vi.mock("@/lib/retrieval-pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-pipeline")>()),
  runRetrievalPipeline: pipeline,
}));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  getWorkspaceCollectionCandidate: candidate,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("@/lib/collection-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-download")>()),
  validatePromotableCollectionArtifact: (json: { manifestDigest: string }) => ({ manifestDigest: json.manifestDigest }),
}));
vi.mock("./answerability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerability")>();
  evaluate.mockImplementation(actual.evaluateAnswerability);
  return { ...actual, evaluateAnswerability: evaluate };
});

import { POST as ask } from "../app/api/collections/[id]/ask/route";
import { evaluateAnswerability, type AnswerabilityInput } from "./answerability";
import { ANSWERABILITY_SHADOW_EVENT, answerabilityMode } from "./answerability-shadow";
import { questionSha256 } from "./answer-receipt-signing";
import { buildContextPacket } from "./context-packet";
import { resetWorkspaceCostGuard } from "./workspace-cost-guard";

const coverage = { processedSources: 1, unprocessedSources: null };
const input = (question: string, texts: string[], heldConflicts: number | null = 0): AnswerabilityInput => ({
  question, evidence: texts.map((text, index) => ({ evidenceId: `ev-${index}`, text })), heldConflicts, worldCoverage: coverage,
});

describe("evaluateAnswerability: the rules, in order", () => {
  it("no evidence -> NOT_IN_WORLD (NO_EVIDENCE), whatever else holds", () => {
    expect(evaluateAnswerability(input("What is the notice period?", [], 3), { coverageThreshold: 0 }))
      .toMatchObject({ status: "NOT_IN_WORLD", reason: "NO_EVIDENCE", evidenceCount: 0, numericAnchor: null, conflicts: 3 });
  });

  it("a held conflict -> CONFLICTED before the numeric and coverage rules; null conflicts is not a conflict", () => {
    expect(evaluateAnswerability(input("How much was revenue in 2019?", ["no amount"], 1), { coverageThreshold: 1 }))
      .toMatchObject({ status: "CONFLICTED", reason: "HELD_CONFLICT" });
    expect(evaluateAnswerability(input("What is the notice period?", ["The notice period is ninety days."], null), { coverageThreshold: 0 }))
      .toMatchObject({ status: "ANSWERABLE", conflicts: null });
  });

  it("an amount question with no evidence item stating an amount with its year -> NOT_IN_WORLD (NO_NUMERIC_ANCHOR)", () => {
    const question = "What was revenue for the fiscal year ended June 30, 2019, in US dollars?";
    // Dates, years and document references are not amounts.
    expect(evaluateAnswerability(input(question, ["Revenue for the fiscal year ended June 30, 2019 is described in Item 7 and Note 12."]), { coverageThreshold: 0 }))
      .toMatchObject({ status: "NOT_IN_WORLD", reason: "NO_NUMERIC_ANCHOR", numericQuestion: true, numericAnchor: false, questionYears: ["2019"] });
    // An amount without the year, and the year without an amount, in different items, is still no anchor.
    expect(evaluateAnswerability(input(question, ["Revenue was $47,061 million.", "Fiscal 2019 was a good year."]), { coverageThreshold: 0 }).numericAnchor).toBe(false);
    expect(evaluateAnswerability(input(question, ["2019 2018 Revenue $ 47,061 $ 41,000"]), { coverageThreshold: 0 }))
      .toMatchObject({ status: "ANSWERABLE", numericAnchor: true });
  });

  it("a question that does not ask for an amount never fires the numeric rule", () => {
    expect(evaluateAnswerability(input("Who signs the agreement?", ["The agreement is signed by the parties."]), { coverageThreshold: 0 }))
      .toMatchObject({ status: "ANSWERABLE", numericQuestion: false, numericAnchor: null });
  });

  it("term coverage below the threshold -> PARTIAL; at or above it -> ANSWERABLE; the terms are reported", () => {
    const verdict = evaluateAnswerability(input("What is the notice period for termination?", ["The notice period is ninety days."]), { coverageThreshold: 0.8 });
    expect(verdict).toMatchObject({ status: "PARTIAL", reason: "TERM_COVERAGE_BELOW_THRESHOLD", missingTerms: ["termination"] });
    expect(verdict.coveredTerms).toEqual(["is", "notice", "period"]);
    expect(verdict.termCoverage).toBeCloseTo(3 / 4);
    expect(evaluateAnswerability(input("What is the notice period for termination?", ["The notice period is ninety days."]), { coverageThreshold: 0.75 }).status).toBe("ANSWERABLE");
  });

  it("refuses a missing or out-of-range threshold and a malformed conflict count instead of guessing", () => {
    for (const threshold of [Number.NaN, -0.1, 1.1, undefined as unknown as number]) {
      expect(() => evaluateAnswerability(input("What is it?", ["it"]), { coverageThreshold: threshold })).toThrow(/coverageThreshold/);
    }
    expect(() => evaluateAnswerability(input("What is it?", ["it"], -1), { coverageThreshold: 0 })).toThrow(/heldConflicts/);
    expect(() => evaluateAnswerability(input("What is it?", ["it"], 0.5), { coverageThreshold: 0 })).toThrow(/heldConflicts/);
  });

  it("never produces OUT_OF_SCHEMA: there is no certified schema to read yet", () => {
    const statuses = ["", "x", "How much?", "What is the notice period?"].map(question =>
      evaluateAnswerability(input(question, ["notice 5"]), { coverageThreshold: 1 }).status);
    expect(statuses).not.toContain("OUT_OF_SCHEMA");
  });
});

describe("TAVONEL_ASK_ANSWERABILITY_MODE", () => {
  it("reads off and shadow; anything else, on included, is off and logged as a configuration error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const value of [undefined, "", "off", " off "]) expect(answerabilityMode({ TAVONEL_ASK_ANSWERABILITY_MODE: value })).toBe("off");
      expect(answerabilityMode({ TAVONEL_ASK_ANSWERABILITY_MODE: "shadow" })).toBe("shadow");
      expect(error).not.toHaveBeenCalled();
      for (const value of ["on", "SHADOW", "true", "1"]) expect(answerabilityMode({ TAVONEL_ASK_ANSWERABILITY_MODE: value }), value).toBe("off");
      expect(error).toHaveBeenCalledTimes(4);
      expect(String(error.mock.calls[0]![0])).toContain("TAVONEL_ASK_ANSWERABILITY_MODE_INVALID");
    } finally { error.mockRestore(); }
  });
});

const WORKSPACE = "pilot-answerability";
const COLLECTION = `collection-${"b".repeat(32)}`;
const DIGEST = `sha256:${"e".repeat(64)}`;
const QUESTION = "What is the notice period?";
const params = Promise.resolve({ id: COLLECTION });
const request = () => new Request(`https://tavonel.test/api/collections/${COLLECTION}/ask`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer tvnl_live_probe" },
  body: JSON.stringify({ question: QUESTION }),
});

beforeEach(() => {
  evaluate.mockClear();
  [authorize, revalidate, activeWorld, pipeline, sourceIds, sourceAccess, candidate].forEach(mock => mock.mockReset());
  resetWorkspaceCostGuard();
  sourceIds.mockResolvedValue({ ok: true, documentIds: ["source-a", "source-b"] });
  sourceAccess.mockResolvedValue({ ok: true });
  revalidate.mockImplementation(async (_request, expected) => ({ ok: true, principal: expected }));
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: "user-1", scopes: [], authorizationRevision: 7, workspaceRole: "owner" },
  });
  activeWorld.mockResolvedValue({
    ok: true,
    world: { manifestDigest: DIGEST, revision: 3, worldStateId: "world-state-1", candidateObjectKey: `candidates/${WORKSPACE}/${COLLECTION}/candidate.json` },
  });
  pipeline.mockResolvedValue({
    ok: true,
    packet: buildContextPacket([{
      unitId: "unit-notice", text: "The notice period is ninety days.", claimIds: [], entityIds: [], sourceVersionId: "version-a",
      evidenceIds: ["evidence-notice"], pageNumber1: 2, bbox1000: [10, 20, 900, 80], authority: "official", lexicalRank: 1,
    }], { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: QUESTION, heldConflicts: [{ claimIds: ["c1", "c2"], reason: "held" }] }),
    diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [] },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetWorkspaceCostGuard();
});

async function served(mode: string | undefined) {
  if (mode !== undefined) vi.stubEnv("TAVONEL_ASK_ANSWERABILITY_MODE", mode);
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const response = await ask(request(), { params });
    const lines = info.mock.calls.map(([line]) => String(line)).filter(line => line.includes(ANSWERABILITY_SHADOW_EVENT));
    return { status: response.status, text: await response.text(), lines };
  } finally { info.mockRestore(); }
}

describe("Ask route, compiled path", () => {
  it("off: the gate is never computed and nothing is logged", async () => {
    const off = await served(undefined);
    expect(off.status).toBe(200);
    expect(evaluate).not.toHaveBeenCalled();
    expect(off.lines).toEqual([]);
    expect(off.text).not.toContain("answerability\":{");
  });

  it("shadow: one line bound to the receipt, with counts and never the question's words; the served bytes are off's", async () => {
    const off = await served("off");
    const shadow = await served("shadow");
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(shadow.status).toBe(200);
    expect(shadow.text).toBe(off.text);
    expect(shadow.lines).toHaveLength(1);
    const line = JSON.parse(shadow.lines[0]!);
    const body = JSON.parse(shadow.text);
    expect(line).toMatchObject({
      event: ANSWERABILITY_SHADOW_EVENT, collectionId: COLLECTION, questionSha256: questionSha256(QUESTION),
      outputSha256: body.receipt.outputSha256, retrievalPath: "compiled-retrieval-v1", servedStatus: "grounded",
      status: "CONFLICTED", reason: "HELD_CONFLICT", conflicts: 1, evidenceCount: 1,
      worldCoverage: { processedSources: 2, unprocessedSources: null },
    });
    for (const word of ["notice", "period", QUESTION]) expect(shadow.lines[0]).not.toContain(word);
  });

  it("shadow: a gate that throws is logged and the answer is served unchanged", async () => {
    const off = await served("off");
    evaluate.mockImplementationOnce(() => { throw new Error("boom"); });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const shadow = await served("shadow");
      expect(shadow.text).toBe(off.text);
      expect(shadow.lines).toEqual([]);
      expect(error.mock.calls.map(([line]) => String(line)).some(line => line.includes("answerability_shadow_failed"))).toBe(true);
    } finally { error.mockRestore(); }
  });
});

describe("Ask route, excerpt fallback path", () => {
  beforeEach(() => {
    pipeline.mockResolvedValue({ ok: false, code: "RETRIEVAL_RUN_NOT_FOUND" });
    const chunk = (id: string, text: string) => JSON.stringify({
      chunkId: `chunk-${id}`, logicalId: `logical-${id}`, text, sourceId: "source-a", sourceVersionId: "version-a",
      evidenceId: `evidence-${id}`, pageNumber1: 1, bbox1000: [0, 0, 1000, 1000], authority: "official",
    });
    candidate.mockResolvedValue({
      ok: true,
      json: {
        collectionId: COLLECTION, manifestDigest: DIGEST,
        package: { files: [{ path: "rag/chunks.jsonl", content: `${chunk("notice", "The notice period is ninety days.")}\n${chunk("other", "Unrelated text about lunch.")}\n` }] },
      },
    });
  });

  it("shadow reads the cited chunks' full text, reports no conflict information as null, and serves off's bytes", async () => {
    const off = await served("off");
    expect(JSON.parse(off.text).retrievalPath).toBe("excerpt-concatenation-fallback");
    const shadow = await served("shadow");
    expect(shadow.text).toBe(off.text);
    const line = JSON.parse(shadow.lines[0]!);
    expect(line).toMatchObject({ retrievalPath: "excerpt-concatenation-fallback", status: "ANSWERABLE", conflicts: null, evidenceCount: 1 });
    expect(evaluate.mock.calls[0]![0].evidence).toEqual([{ evidenceId: "evidence-notice", text: "The notice period is ninety days." }]);
  });

  it("off never parses for the gate", async () => {
    await served(undefined);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
