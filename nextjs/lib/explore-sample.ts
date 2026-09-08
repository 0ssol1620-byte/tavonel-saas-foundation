import { createHash } from "node:crypto";
import {
  canonicalize,
  compileCollectionCandidate,
  validateCollectionOcrInput,
  type CollectionCandidateArtifact,
  type CollectionOcrInput,
} from "./collection-compiler";
import { answerGroundedQuestion, type GroundedAnswer } from "./grounded-ask";
import { buildWorldReadModel, type WorldReadModel } from "./world-read-model";
import rawBaselineInputs from "./explore-sample.w0.inputs.json";
import rawInputs from "./explore-sample.w4.inputs.json";
import rawSources from "./explore-sample.sources.json";

/*
  The /explore sample, compiled rather than written.

  The two `*.inputs.json` files are produced by `scripts/build-explore-sample.mjs` from the
  committed bytes in `public/explore-sample/`: real files, real sha256 per file, real page
  geometry read back out of each one. This module runs the production compiler over them.
  Nothing on the Explore page is authored -- the objects, the claims, the relations, the page
  numbers and the bounding boxes are all what `compileCollectionCandidate` emitted.

  Two World snapshots, and what separates them is time rather than an edit (§25.2):

    W0  Apple's 2025 Form 10-K alone -- the annual World, before the year happened.
    W4  the same 10-K plus the four 2026 filings that arrived after it: the Q1 10-Q, the
        DEF 14A proxy statement, the Q2 10-Q and the Q3 10-Q.

  W4 is the World the page shows. `lib/explore-change.ts` derives the comparison; it does not
  compile, and it does not restate a single number that is not in one of these two artifacts.

  Source and representation are not conflated. The 2025 10-K is an official PDF, so the bytes
  the compiler read are the source. The 2026 filings are SEC EDGAR HTML primary documents, and
  what the compiler read is a deterministic reference render of each one -- a representation,
  never "the original SEC PDF". `explore-sample.sources.json` carries both digests, the render
  profile and the acquisition record per filing, and is what `documentsOf` publishes to the UI.

  Two guarantees, both fail-closed, because a sample that quietly drifts is worse than no
  sample: every input is re-validated through the same `validateCollectionOcrInput` the API
  uses, and each compiled `manifestDigest` must equal the frozen constant below. Change the
  fixture text, the layout, the extractor or the compiler and this throws at import -- which
  fails the build, not a page view.

  Regenerating: run the script, run `vitest lib/explore-sample`, and paste the digests it
  reports into the two constants below. A digest moving is not a problem; it moving without
  anyone noticing is.
*/

/*
  Re-derived 2026-09-08, when the corpus stopped being a three-page slice of each
  filing and became four filings compiled end to end plus one declared page slice (§57, §86 #1).

  Both digests moved, and this is the review §25.4 asks for before freezing them:

  - W0 moved because its input moved. The baseline is the same 2025 Form 10-K, but all 80 pages of
    it rather than pages 4, 25 and 32 -- 502 regions instead of 26. A World compiled from more of
    the same document is a different World, and the digest saying so is the system working.
  - W4 moved for the same reason across five documents: 1,169 regions instead of 97, from 233 of
    the corpus's 290 pages.
  - Neither moved because of a compiler change. `lib/collection-compiler.ts` is untouched.
  - Both artifacts are still `lifecycle: candidate` with `candidatesConsidered` equal to what was
    emitted, which is the measurable form of "nothing was dropped to fit". The whole 290-page
    corpus is 6,457 candidates against a 5,000 budget and would compile `review_required`
    instead; `scripts/build-explore-sample.mjs` records that measurement and why the proxy is the
    document that carries the slice.

  Previous values, kept so the moves are traceable rather than merely different:
    2026-09-06  current world (2025 10-K)     sha256:b2aaebd8dd73b8d161d7fc23e4cf649f6c009bce87ee107bab8311a28a268978
    2026-09-06  revision B (2024 10-K)        sha256:2682d467ac1fd98d7570ace2053b7e9e9231d0b9f9c0715f81a011a8089c31bc
    2026-09-06  revision C (mixed fixture)    sha256:dff62fcee5954bf5df236ac0e6927d1978e2441eeb7fbdf8608934cefbeabc52
    2026-09-06  revision B (mixed fixture)    sha256:85a2932b18ea0e418d15adbfcff39c5f29804377ae82da2ab97641db795cfb4d
    2026-09-08  W0, three-page 10-K slice     sha256:b2aaebd8dd73b8d161d7fc23e4cf649f6c009bce87ee107bab8311a28a268978
    2026-09-08  W4, three pages per filing    sha256:50b61e20484c1a06cbf7b2a9ce7aa4c8926bc5819a59f60d8fec1f8096aba7e8
*/

/** W4: the compiled World the Explore page shows. Recorded so that it cannot change unobserved. */
export const EXPLORE_SAMPLE_DIGEST = "sha256:277df1a439a8806ebb290b77f31ffdaf0a61b59e5efca3641d9cb7596aca9d20";

/** W0: the same annual filing alone, before the four 2026 filings arrived. */
export const EXPLORE_SAMPLE_BASELINE_DIGEST = "sha256:1db0e4c5ef2f89655e57d478a3761ce36c871ea9f1dfcd1a801aa8e1719b3597";

export const EXPLORE_SAMPLE_SOURCE_DIRECTORY = "public/explore-sample";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readInputs(raw: unknown, label: string): CollectionOcrInput[] {
  const inputs = (raw as unknown[]).map((value) => validateCollectionOcrInput(value));
  if (inputs.some((input) => input === null)) {
    throw new Error(`explore_sample_inputs_invalid: ${label}`);
  }
  return inputs as CollectionOcrInput[];
}

/*
  The execution record names what actually ran.

  Production compiles are dispatched to the Core runtime and the receipt is the Core's. This one
  is not: it is this repository's TypeScript compiler, executing at build time over a committed
  fixture. Labelling it `tavonel-foundation-core-deterministic-v1` would make the sample claim a
  Core execution that never happened, so it says what it is. The hashes are computed the same
  way the Core computes them, over this artifact.
*/
function withExecutionRecord(artifact: CollectionCandidateArtifact, inputs: CollectionOcrInput[]) {
  return {
    ...artifact,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-collection-compiler-ts-v1/explore-sample",
      worldStateId: null,
      receipt: {
        schemaVersion: "tavonel.compile_receipt.v1" as const,
        requestId: `explore-sample-${artifact.collectionId}`,
        inputSha256: `sha256:${sha256(canonicalize(inputs))}`,
        outputSha256: `sha256:${sha256(JSON.stringify(artifact))}`,
        manifestDigest: artifact.manifestDigest,
        collectionId: artifact.collectionId,
        candidatePromotion: false as const,
      },
    },
  };
}

function build(raw: unknown, label: string, frozenDigest: string) {
  const inputs = readInputs(raw, label);
  const compiled = compileCollectionCandidate(inputs);
  const artifact = withExecutionRecord(compiled, inputs);
  const world = buildWorldReadModel(artifact, artifact.collectionId, { origin: "deterministic_sample" });
  if (!world) throw new Error(`explore_sample_read_model_invalid: ${label}`);
  if (artifact.manifestDigest !== frozenDigest) {
    throw new Error(
      `explore_sample_digest_changed: ${label} expected ${frozenDigest}, compiled ${artifact.manifestDigest}`,
    );
  }
  return { inputs, artifact, world };
}

/**
 * The acquisition record of one filing, as `scripts/build-explore-sample.mjs` wrote it.
 *
 * Generated, never hand-edited: the §25.1 fields come from `sec-corpus-manifest.json` for the
 * 2026 filings and from the committed PDF for the 2025 10-K, and both digests are re-hashed
 * from the files on disk at generation time.
 */
export type ExploreSampleSource = {
  documentId: string;
  form: string;
  filingDate: string;
  reportDate: string;
  accession: string;
  cik: string;
  primaryDocument: string;
  authority: string;
  sourceUrl: string;
  sourceFilename: string;
  sourceMediaType: string;
  originalSha256: string;
  representationFilename: string;
  representationMediaType: string;
  representationKind: "original" | "reference_render";
  representationSha256: string;
  renderProfile: string | null;
  acquiredFrom: string;
  pageCount: number;
  /** The declared page set, or `null` when every page of the document is compiled. */
  declaredPages: number[] | null;
  /** The pages a region was actually read out of; never larger than the declared set. */
  compiledPages: number[];
  sliceRationale: string;
  regionCount: number;
  sourceLabel: string;
  officialUrl: string | null;
  secUrl: string;
};

export const exploreSampleSources = rawSources as ExploreSampleSource[];

/**
 * The committed files behind a World, in the order the compiler saw them.
 *
 * Two hrefs, because a 2026 filing has two files and calling either one "the source" alone
 * would be the misstatement §11.3 exists to prevent: `href` opens the bytes the regions were
 * read from, `sourceHref` opens the acquired original beside it.
 */
function documentsOf(inputs: readonly CollectionOcrInput[]) {
  return inputs.map((input) => {
    const source = exploreSampleSources.find((entry) => entry.documentId === input.documentId);
    if (!source) throw new Error(`explore_sample_source_record_missing: ${input.documentId}`);
    if (source.representationSha256 !== input.inputSha256) {
      throw new Error(`explore_sample_source_digest_disagrees: ${input.documentId}`);
    }
    return {
      documentId: input.documentId,
      filename: source.representationFilename,
      href: `/${input.sanitizedKey.replace(/^public\//, "")}`,
      digest: input.inputSha256,
      pageCount: input.pageCount,
      regionCount: input.regions?.length ?? 0,
      sourceLabel: source.sourceLabel,
      accession: source.accession,
      officialHref: source.officialUrl ?? undefined,
      secHref: source.secUrl,
      /*
        Two numbers, never one (§57). `compiledPageCount` is how much of this filing the World
        actually holds; `pageCount` is how long the filing is. A UI that shows only the second
        would let a 49-page slice of a 103-page proxy read as the whole proxy.
      */
      compiledPageCount: source.compiledPages.length,
      declaredPages: source.declaredPages ?? undefined,
      form: source.form,
      filingDate: source.filingDate,
      reportDate: source.reportDate,
      authority: source.authority,
      representationKind: source.representationKind,
      sourceFilename: source.sourceFilename,
      sourceHref: `/explore-sample/${source.sourceFilename}`,
      originalSha256: source.originalSha256,
      renderProfile: source.renderProfile ?? undefined,
      sliceRationale: source.sliceRationale,
    };
  });
}

const sample = build(rawInputs, "W4 · 2025 10-K + four 2026 filings", EXPLORE_SAMPLE_DIGEST);
const baseline = build(rawBaselineInputs, "W0 · 2025 Form 10-K", EXPLORE_SAMPLE_BASELINE_DIGEST);

export const exploreSampleInputs: readonly CollectionOcrInput[] = sample.inputs;
export const exploreSampleArtifact = sample.artifact;
export const exploreSampleWorld: WorldReadModel = sample.world;
export const exploreSampleDocuments = documentsOf(sample.inputs);

export const exploreSampleBaselineInputs: readonly CollectionOcrInput[] = baseline.inputs;
export const exploreSampleBaselineArtifact = baseline.artifact;
export const exploreSampleBaselineWorld: WorldReadModel = baseline.world;
export const exploreSampleBaselineDocuments = documentsOf(baseline.inputs);

/*
  Four questions the page can put to the World, answered by the retriever the workspace uses.

  Not a scripted answer with a citation drawn on afterwards: `answerGroundedQuestion` reads
  `rag/chunks.jsonl` out of this artifact and returns the regions it scored, and the page shows
  whichever region came first along with the score that put it there. Picking the questions is a
  demo choice; the answers are not a choice.

  The four reach three different filings -- a quarterly income statement, the annual segment
  table, and the proxy's account of what the Audit Committee reviews -- which is the point of a
  multi-filing corpus and the reason they are asked in the corpus's own words rather than in
  words that would flatter it.

  One question §11.8 offers is deliberately absent. "What changed since the annual filing?" is
  answerable by the Change act and not by this contract: the retriever scores region text
  lexically, so a question whose answer is a *comparison between two compiles* retrieves a
  region that merely contains the words. Asking it here would put a confident citation under an
  answer nothing computed. It stays out until Ask can reach the diff.

  Fail-closed: if the retriever abstains on any of them -- which is what it should do when the
  corpus stops supporting the question -- the build stops rather than the page rendering an
  empty panel.
*/
export const EXPLORE_SAMPLE_QUESTIONS = [
  "What were Products and Services net sales in the quarter?",
  "What were net sales by reportable segment?",
  "What were operating expenses for research and development?",
  "How does the Board oversee privacy and data security?",
] as const;

export type ExploreSampleAnswer = {
  question: string;
  status: GroundedAnswer["status"];
  citations: GroundedAnswer["citations"];
};

export const exploreSampleAnswers: ExploreSampleAnswer[] = EXPLORE_SAMPLE_QUESTIONS.map((question) => {
  const answer = answerGroundedQuestion(sample.artifact, question);
  if (!answer || answer.status !== "grounded" || answer.citations.length === 0) {
    throw new Error(`explore_sample_answer_not_grounded: ${question}`);
  }
  return { question, status: answer.status, citations: answer.citations };
});
