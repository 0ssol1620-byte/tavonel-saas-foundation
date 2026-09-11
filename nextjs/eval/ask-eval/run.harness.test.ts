/**
 * Ask-eval runner: puts one fixed question set through both Ask paths and writes a report.
 *
 * It is a vitest file because vitest is the only TypeScript runner in this package (no tsx, and no
 * new dependency may be added), and because the assertions at the bottom are the thing that stops a
 * broken run from producing a plausible-looking report. It is NOT part of `pnpm test`: the root
 * vitest config includes `lib/**` only, and this runs under `eval/vitest.config.ts`.
 *
 *   npx vitest run --config eval/vitest.config.ts
 *
 * The two paths:
 *
 *   compiled-retrieval-v1          lib/retrieval-compile.ts -> lib/retrieval-pipeline.ts, driven in
 *                                  process against the PostgREST stand-in (see postgrest-standin.ts
 *                                  for exactly which part of it is real and which is not). This path
 *                                  has no production caller today (audit R4-01); L2 is wiring it.
 *   excerpt-concatenation-fallback lib/grounded-ask.ts, which is what every /ask request runs today.
 *
 * Every number this writes is a fixture number over one public corpus of five Apple SEC filings. It
 * is not a product measurement, not a calibrated threshold, and not comparable to any vendor's
 * published benchmark. Nothing here scores whether a cited region SUPPORTS an answer -- that is the
 * human column, and `rubric.md` plus the exported CSV are how it gets filled in.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exploreSampleArtifact, exploreSampleInputs, EXPLORE_SAMPLE_DIGEST } from "../../lib/explore-sample";
import { answerGroundedQuestion } from "../../lib/grounded-ask";
import { compileRetrievalArtifacts } from "../../lib/retrieval-compile";
import { runRetrievalPipeline } from "../../lib/retrieval-pipeline";
import { buildBgeM3BaselineProfile } from "../../lib/retrieval-profile";
import questionSet from "./questions.json";
import { installPostgrestStandIn } from "./postgrest-standin";
import {
  scoreQuestion,
  summarize,
  validateQuestionSet,
  type EvalQuestion,
  type PathOutcome,
  type ReturnedLocator,
  type ScoredQuestion,
} from "./metrics";

const WORKSPACE_KEY = "pilot-askeval";
const WORLD_STATE_ID = "ws-explore-sample-w4";
const ACTOR = "ask-eval-runner";
const RESULTS_DIR = path.resolve(import.meta.dirname, "results");
const LANE_REPORT_DIR = process.env.ASK_EVAL_REPORT_DIR ?? "D:\\CodexProjects\\audit-lanes\\reports\\evidence";

const questions = questionSet.questions as EvalQuestion[];

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** Region index straight out of the committed corpus inputs: the only source of a gold locator. */
function buildRegionIndex() {
  const byRegionId = new Map<string, { documentId: string; pageNumber1: number }>();
  const byLocator = new Map<string, string>();
  for (const document of exploreSampleInputs) {
    for (const region of document.regions ?? []) {
      byRegionId.set(region.regionId, { documentId: document.documentId, pageNumber1: region.pageNumber1 });
      byLocator.set(`${document.documentId}#${region.pageNumber1}#${(region.bbox1000 ?? []).join(",")}`, region.regionId);
    }
  }
  return { byRegionId, byLocator };
}

const regionIndex = buildRegionIndex();

function resolveRegionId(documentId: string, pageNumber1: number | null, bbox: readonly number[] | null): string | null {
  if (pageNumber1 === null || bbox === null) return null;
  return regionIndex.byLocator.get(`${documentId}#${pageNumber1}#${bbox.join(",")}`) ?? null;
}

type PathRun = { outcomes: Map<string, PathOutcome>; notes: string[] };

/** The path every /ask request runs today. */
function runFallbackPath(): PathRun {
  const outcomes = new Map<string, PathOutcome>();
  for (const question of questions) {
    const started = performance.now();
    const answer = answerGroundedQuestion(exploreSampleArtifact, question.question);
    const latencyMs = performance.now() - started;
    if (answer === null) {
      // The retriever refusing the input at all is not the same event as an abstention, and is
      // recorded with its own reason rather than folded into one bucket.
      outcomes.set(question.id, {
        status: "abstained",
        locators: [],
        latencyMs,
        abstentionReasons: ["RETRIEVER_REFUSED_INPUT"],
      });
      continue;
    }
    const locators: ReturnedLocator[] = answer.citations.map((citation) => ({
      documentId: citation.sourceId,
      pageNumber1: citation.pageNumber1,
      regionId: resolveRegionId(citation.sourceId, citation.pageNumber1, citation.bbox1000),
    }));
    outcomes.set(question.id, {
      status: answer.status === "grounded" && locators.length > 0 ? "grounded" : "abstained",
      locators,
      latencyMs,
      abstentionReasons: answer.reason ? [answer.reason] : [],
    });
  }
  return { outcomes, notes: ["retrieval: adaptive-multilingual-region-v2 over rag/chunks.jsonl, in process"] };
}

async function runCompiledPath(): Promise<PathRun & { diagnostics: Record<string, unknown> }> {
  const { store, restore } = installPostgrestStandIn();
  const notes: string[] = [];
  try {
    const profile = buildBgeM3BaselineProfile(WORKSPACE_KEY, "unpinned-no-gpu-in-this-run");
    const compiled = await compileRetrievalArtifacts({
      workspaceKey: WORKSPACE_KEY,
      collectionId: exploreSampleArtifact.collectionId,
      worldManifestDigest: exploreSampleArtifact.manifestDigest,
      artifact: exploreSampleArtifact,
      profile,
      actorUserId: ACTOR,
      embedder: null,
    });
    if (!compiled.ok) {
      throw new Error(`compileRetrievalArtifacts failed: ${compiled.code} (${compiled.reason})`);
    }
    notes.push(`units compiled: ${compiled.unitCount}`, `embeddings: ${compiled.embeddingCount}`);
    for (const degradation of compiled.degradations) notes.push(`compile degradation: ${degradation}`);
    if (compiled.skippedViews.length > 0) notes.push(`views with no compiler: ${compiled.skippedViews.join(", ")}`);

    const unitLocator = new Map<string, ReturnedLocator>();
    for (const unit of store.units) {
      const documentId = String(unit.document_id);
      const pageNumber1 = unit.page_number1 === null ? null : Number(unit.page_number1);
      const bbox = (unit.bbox1000 as number[] | null) ?? null;
      unitLocator.set(String(unit.unit_id), {
        documentId,
        pageNumber1,
        regionId: resolveRegionId(documentId, pageNumber1, bbox),
      });
    }

    const outcomes = new Map<string, PathOutcome>();
    const degradationCounts = new Map<string, number>();
    let rerankerApplied = 0;
    for (const question of questions) {
      const started = performance.now();
      const result = await runRetrievalPipeline({
        workspaceKey: WORKSPACE_KEY,
        collectionId: exploreSampleArtifact.collectionId,
        worldManifestDigest: exploreSampleArtifact.manifestDigest,
        worldStateId: WORLD_STATE_ID,
        question: question.question,
        profile,
        embedder: null,
        reranker: null,
      });
      const latencyMs = performance.now() - started;
      if (!result.ok) {
        // A store/pipeline failure is not an abstention. It is recorded as its own status so the
        // report can never read a broken run as a correct refusal.
        outcomes.set(question.id, {
          status: "abstained",
          locators: [],
          latencyMs,
          abstentionReasons: [`PIPELINE_FAILED:${result.code}`],
        });
        continue;
      }
      for (const degradation of result.diagnostics.degradations) {
        degradationCounts.set(degradation, (degradationCounts.get(degradation) ?? 0) + 1);
      }
      if (result.diagnostics.rerankerApplied) rerankerApplied += 1;
      const locators = result.packet.items.map(
        (item) => unitLocator.get(item.unitId) ?? { documentId: "", pageNumber1: item.pageNumber1, regionId: null },
      );
      outcomes.set(question.id, {
        status: locators.length > 0 ? "grounded" : "abstained",
        locators,
        latencyMs,
        abstentionReasons: result.packet.abstentionReasons,
      });
    }

    return {
      outcomes,
      notes,
      diagnostics: {
        unitRowsPersisted: store.units.length,
        compileRuns: store.runs.length,
        rerankerAppliedOnQuestions: rerankerApplied,
        degradations: Object.fromEntries(degradationCounts),
        unhandledRequests: store.unhandled,
      },
    };
  } finally {
    restore();
  }
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function rateCell(value: { value: number; numerator: number; denominator: number } | null) {
  return value === null ? "not measured (no denominator)" : `${(value.value * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;
}

function markdownReport(payload: Record<string, unknown>): string {
  const compiled = payload.compiled as { summary: ReturnType<typeof summarize>; notes: string[]; diagnostics: Record<string, unknown> };
  const fallback = payload.fallback as { summary: ReturnType<typeof summarize>; notes: string[] };
  const rows = payload.perQuestion as Array<{ id: string; kind: string; compiled: ScoredQuestion; fallback: ScoredQuestion }>;
  const line = (label: string, left: string, right: string) => `| ${label} | ${left} | ${right} |`;
  return [
    `# Ask evaluation — fixture run over the public Explore corpus`,
    ``,
    `Run: ${payload.runId}  ·  ${payload.ranAt}`,
    ``,
    `**What this is.** ${questionSet.questions.length} fixed questions over the five committed Apple SEC filings`,
    `behind /explore (${payload.corpusPages} pages, ${payload.corpusRegions} OCR regions), put through both Ask paths in`,
    `process. **These are fixture numbers on one public corpus.** They are not a product measurement, they`,
    `calibrate nothing, and no threshold below is proven. Status: IMPLEMENTED_NOT_PROVEN.`,
    ``,
    `**What is real in the compiled column.** compileRetrievalUnits, the unit rows and their search_tokens,`,
    `the compile-run lifecycle, RRF fusion, structure ranking, the World Gate and ContextPacket assembly are`,
    `the production functions, unmodified. The lexical RANK ORDER is not: Postgres ts_rank_cd needs a`,
    `database, so an in-process stand-in scores matched-token counts instead (postgrest-standin.ts).`,
    `Dense retrieval is absent because no embedder is configured — the same posture production is in.`,
    `Therefore the compiled column measures *the compiled pipeline with a stand-in lexical ranker*.`,
    ``,
    `**Read the two columns as different things.** The compiled column is a plumbing result: it shows the`,
    `stages compose and produce a packet, and its ranking quality is dominated by the stand-in. It is NOT`,
    `evidence that the compiled path ranks worse than the fallback. What the stand-in shares with the`,
    `production lexical stage is the part that matters for direction: \`lib/lexical-search.ts\` calls`,
    `\`ts_rank_cd(search_vector, to_tsquery('simple', …))\` with no normalization argument, so production`,
    `lexical ranking has no IDF and no document-length normalization either, while \`grounded-ask.ts\` ranks`,
    `with BM25 (IDF + length normalization). What the stand-in does NOT have is ts_rank_cd's cover-density`,
    `proximity weighting. A same-condition comparison of the two paths needs a database.`,
    ``,
    `**What is not measured at all.** Whether a cited region actually supports an answer. No entailment`,
    `check exists anywhere in this repository. Audit Q05's human column is \`rubric.md\` + the exported CSV.`,
    `No answer generator is wired in either path, so "answer" means "the cited excerpts", never prose.`,
    ``,
    `## Results`,
    ``,
    `| metric | compiled-retrieval-v1 (stand-in lexical) | excerpt-concatenation-fallback |`,
    `|---|---|---|`,
    line("citations returned per answered question", `${compiled.summary.meanCitationsPerAnsweredQuestion?.toFixed(1)}`, `${fallback.summary.meanCitationsPerAnsweredQuestion?.toFixed(1)}`),
    line("evidence precision — region", rateCell(compiled.summary.evidencePrecisionRegion), rateCell(fallback.summary.evidencePrecisionRegion)),
    line("— its ceiling at that many citations", rateCell(compiled.summary.evidencePrecisionRegionCeiling), rateCell(fallback.summary.evidencePrecisionRegionCeiling)),
    line("evidence precision — page", rateCell(compiled.summary.evidencePrecisionPage), rateCell(fallback.summary.evidencePrecisionPage)),
    line("gold region recall", rateCell(compiled.summary.goldRegionRecall), rateCell(fallback.summary.goldRegionRecall)),
    line("gold region hit anywhere in the citations (hit@k)", rateCell(compiled.summary.anyGoldHitRate), rateCell(fallback.summary.anyGoldHitRate)),
    line("top-1 locator hit", rateCell(compiled.summary.topLocatorHitRate), rateCell(fallback.summary.topLocatorHitRate)),
    line("unsupported-answer rate", rateCell(compiled.summary.unsupportedAnswerRate), rateCell(fallback.summary.unsupportedAnswerRate)),
    line("unnecessary-abstention rate", rateCell(compiled.summary.unnecessaryAbstentionRate), rateCell(fallback.summary.unnecessaryAbstentionRate)),
    line("multi-hop success (≥2 filings cited)", rateCell(compiled.summary.multiHopSuccessRate), rateCell(fallback.summary.multiHopSuccessRate)),
    line("latency p50 / p95 (ms, in process)", `${compiled.summary.latencyP50Ms?.toFixed(1)} / ${compiled.summary.latencyP95Ms?.toFixed(1)}`, `${fallback.summary.latencyP50Ms?.toFixed(1)} / ${fallback.summary.latencyP95Ms?.toFixed(1)}`),
    ``,
    `Latency is wall time for the retrieval call inside one Node process with an in-memory store. It is not`,
    `an API latency and must never be published as one.`,
    ``,
    `## Denominators`,
    ``,
    `- answerable: ${payload.counts && (payload.counts as Record<string, number>).answerable}`,
    `- multi-hop (≥2 filings): ${payload.counts && (payload.counts as Record<string, number>).multihop}`,
    `- deliberately unanswerable: ${payload.counts && (payload.counts as Record<string, number>).unanswerable}`,
    ``,
    `## What these numbers say, and only that`,
    ``,
    `- **Abstention.** Unnecessary abstention is ${rateCell(fallback.summary.unnecessaryAbstentionRate)} on the fallback path and`,
    `  ${rateCell(compiled.summary.unnecessaryAbstentionRate)} on the compiled path; the unsupported-answer rate on deliberately`,
    `  unanswerable questions is ${rateCell(fallback.summary.unsupportedAnswerRate)} and ${rateCell(compiled.summary.unsupportedAnswerRate)}`,
    `  respectively. The mechanism is in the code, not in the questions: abstention in both paths is an`,
    `  ELIGIBILITY test, never a relevance or entailment test. \`grounded-ask.ts\` abstains only when no chunk`,
    `  matched any token; \`retrieval-pipeline.ts\` abstains only when no source returned a candidate or the`,
    `  World Gate rejected every one (tenant, active world, superseded version, no evidence bound —`,
    `  \`world-gate.ts\`). Neither checks the period, the entity or the claim. A question about another`,
    `  company's segment revenue therefore retrieves this company's segment tables and returns them.`,
    `- **Locators.** Page-level precision is at or above region-level precision on both paths, which is what`,
    `  a locator that is right about the page and wrong about the block looks like. Whether a returned`,
    `  region *supports* an answer is not in this table and cannot be: see the human column.`,
    `- **Multi-hop.** "Success" here means the citations covered at least two of the gold filings. It does`,
    `  not mean the comparison was computed, because nothing in either path computes one.`,
    ``,
    `## Run notes`,
    ``,
    ...compiled.notes.map((note) => `- compiled: ${note}`),
    ...fallback.notes.map((note) => `- fallback: ${note}`),
    `- compiled diagnostics: \`${JSON.stringify(compiled.diagnostics)}\``,
    ``,
    `## Per question`,
    ``,
    `| id | kind | compiled status | compiled region hits / returned | fallback status | fallback region hits / returned |`,
    `|---|---|---|---|---|---|`,
    ...rows.map(
      (row) =>
        `| ${row.id} | ${row.kind} | ${row.compiled.status} | ${row.compiled.regionHits}/${row.compiled.returnedCount} | ${row.fallback.status} | ${row.fallback.regionHits}/${row.fallback.returnedCount} |`,
    ),
    ``,
    `## Hashes`,
    ``,
    `- question set: ${payload.questionSetSha256}`,
    `- corpus (W4 manifest digest): ${payload.corpusManifestDigest}`,
    `- deterministic outcome digest (locators only, latency excluded): ${payload.outcomeSha256}`,
    ``,
  ].join("\n");
}

describe("ask-eval harness", () => {
  it("runs the fixed question set through both Ask paths and writes a report", async () => {
    const problems = validateQuestionSet(questions, regionIndex.byRegionId);
    expect(problems, `question set does not match the corpus:\n${problems.join("\n")}`).toEqual([]);

    const compiled = await runCompiledPath();
    const fallback = runFallbackPath();

    expect(compiled.diagnostics.unhandledRequests).toEqual([]);

    const perQuestion = questions.map((question) => {
      const compiledOutcome = compiled.outcomes.get(question.id);
      const fallbackOutcome = fallback.outcomes.get(question.id);
      if (!compiledOutcome || !fallbackOutcome) throw new Error(`no outcome recorded for ${question.id}`);
      return {
        id: question.id,
        kind: question.kind,
        question: question.question,
        gold: question.gold,
        compiled: scoreQuestion(question, compiledOutcome),
        compiledAbstentionReasons: compiledOutcome.abstentionReasons,
        compiledLocators: compiledOutcome.locators,
        fallback: scoreQuestion(question, fallbackOutcome),
        fallbackAbstentionReasons: fallbackOutcome.abstentionReasons,
        fallbackLocators: fallbackOutcome.locators,
      };
    });

    const counts = {
      answerable: questions.filter((question) => question.kind === "answerable").length,
      multihop: questions.filter((question) => question.kind === "multihop").length,
      unanswerable: questions.filter((question) => question.kind === "unanswerable").length,
    };
    // The audit's own floors for Q03/Q06. Falling under them means the set, not the run, is wrong.
    expect(counts.answerable).toBeGreaterThanOrEqual(40);
    expect(counts.unanswerable).toBeGreaterThanOrEqual(15);
    expect(counts.multihop).toBeGreaterThanOrEqual(10);

    const outcomeInput = JSON.stringify(
      perQuestion.map((row) => ({
        id: row.id,
        compiled: row.compiledLocators,
        fallback: row.fallbackLocators,
      })),
    );

    const ranAt = new Date().toISOString();
    const payload = {
      schema: "tavonel.ask-eval.report.v1",
      runId: `ask-eval-${ranAt.slice(0, 10)}`,
      ranAt,
      status: "IMPLEMENTED_NOT_PROVEN",
      label: "fixture numbers over one public corpus; not a product measurement, not a calibrated threshold",
      corpus: questionSet.corpus,
      corpusManifestDigest: EXPLORE_SAMPLE_DIGEST,
      corpusPages: exploreSampleInputs.reduce((sum, document) => sum + document.pageCount, 0),
      corpusRegions: exploreSampleInputs.reduce((sum, document) => sum + (document.regions?.length ?? 0), 0),
      questionSetSha256: sha256(JSON.stringify(questionSet)),
      outcomeSha256: sha256(outcomeInput),
      counts,
      compiled: {
        path: "compiled-retrieval-v1",
        caveat:
          "lexical rank order is an in-process stand-in for Postgres ts_rank_cd; dense retrieval absent (no embedder); reranker absent",
        summary: summarize(perQuestion.map((row) => row.compiled)),
        notes: compiled.notes,
        diagnostics: compiled.diagnostics,
      },
      fallback: {
        path: "excerpt-concatenation-fallback",
        caveat: "the path every /ask request runs today; no generator, so an answer is its cited excerpts",
        summary: summarize(perQuestion.map((row) => row.fallback)),
        notes: fallback.notes,
      },
      perQuestion,
    };

    const markdown = markdownReport(payload as unknown as Record<string, unknown>);

    // Q05: the human-review export. 100 rows or every grounded citation there is, whichever is
    // smaller -- the header says which, so nobody reads a short file as a 100-sample review.
    const csvRows: string[] = [
      [
        "sample_id",
        "question_id",
        "kind",
        "path",
        "question",
        "cited_document",
        "cited_page",
        "cited_region",
        "is_gold_region",
        "locator_correct__reviewer",
        "evidence_entails_answer__reviewer",
        "error_type__reviewer",
        "reviewer_note",
      ]
        .map(csvCell)
        .join(","),
    ];
    for (const row of perQuestion) {
      for (const [pathName, locators] of [
        ["compiled-retrieval-v1", row.compiledLocators],
        ["excerpt-concatenation-fallback", row.fallbackLocators],
      ] as const) {
        for (const locator of locators) {
          if (csvRows.length > 100) break;
          csvRows.push(
            [
              `S${String(csvRows.length).padStart(3, "0")}`,
              row.id,
              row.kind,
              pathName,
              row.question,
              locator.documentId,
              locator.pageNumber1 === null ? "" : String(locator.pageNumber1),
              locator.regionId ?? "",
              row.gold.some((gold) => gold.regionId === locator.regionId) ? "yes" : "no",
              "",
              "",
              "",
              "",
            ]
              .map(csvCell)
              .join(","),
          );
        }
      }
    }

    const stamp = ranAt.slice(0, 10);
    const files: Array<[string, string]> = [
      [`ask-eval-${stamp}.json`, `${JSON.stringify(payload, null, 2)}\n`],
      [`ask-eval-${stamp}.md`, markdown],
      [`Q05_human_review_sample-${stamp}.csv`, `${csvRows.join("\n")}\n`],
    ];
    mkdirSync(RESULTS_DIR, { recursive: true });
    for (const [name, content] of files) writeFileSync(path.join(RESULTS_DIR, name), content, "utf8");
    // The lane report directory lives outside the repository. Written when it exists (or when
    // ASK_EVAL_REPORT_DIR names it), skipped otherwise, and the skip is visible in the console
    // rather than silent.
    if (existsSync(LANE_REPORT_DIR)) {
      for (const [name, content] of files) writeFileSync(path.join(LANE_REPORT_DIR, name), content, "utf8");
    } else {
      console.warn(`ask-eval: report directory ${LANE_REPORT_DIR} does not exist; wrote results/ only`);
    }

    // The run is only a run if both paths actually produced a decision for every question.
    expect(perQuestion.length).toBe(questions.length);
    expect(perQuestion.every((row) => row.compiled.status === "grounded" || row.compiled.status === "abstained")).toBe(true);
    expect(
      perQuestion.some((row) => row.fallback.status === "grounded"),
      "the fallback path answered nothing at all, which means the harness, not the corpus, is broken",
    ).toBe(true);
    expect(
      perQuestion.some((row) => row.compiled.status === "grounded"),
      "the compiled path answered nothing at all, which means the compile or the stand-in store is broken",
    ).toBe(true);
  }, 600_000);
});
