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
import rawW1Inputs from "./explore-sample.w1.inputs.json";
import rawW2Inputs from "./explore-sample.w2.inputs.json";
import rawW3Inputs from "./explore-sample.w3.inputs.json";
import rawInputs from "./explore-sample.w4.inputs.json";
import rawSources from "./explore-sample.sources.json";

/*
  The /explore sample, compiled rather than written.

  The two `*.inputs.json` files are produced by `scripts/build-explore-sample.mjs` from the
  committed bytes in `public/explore-sample/`: real files, real sha256 per file, real page
  geometry read back out of each one. This module runs the production compiler over them.
  Nothing on the Explore page is authored -- the objects, the claims, the relations, the page
  numbers and the bounding boxes are all what `compileCollectionCandidate` emitted.

  Five World snapshots, and what separates each from the last is time rather than an edit
  (§25.2, and §24's five steps):

    W0  Apple's 2025 Form 10-K alone -- the annual World, before the year happened.
    W1  W0 after the 2026 Q1 10-Q arrived.
    W2  W1 after the 2026 DEF 14A proxy statement arrived.
    W3  W2 after the 2026 Q2 10-Q arrived.
    W4  W3 after the 2026 Q3 10-Q arrived -- the whole 290-page corpus.

  W4 is the World the page shows. `lib/explore-change.ts` derives the comparisons -- W0 against
  W4, and each consecutive step -- it does not compile, and it does not restate a single number
  that is not in one of these five artifacts.

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
  reports into the five constants below. A digest moving is not a problem; it moving without
  anyone noticing is.
*/

/*
  Re-derived 2026-09-08 (second time that day), when the corpus stopped carrying a declared page
  slice and became all five filings compiled end to end, and when the three intermediate Worlds
  were compiled for the first time (program §24, blueprint §25.2).

  W4 moved and W0 did not, and this is the review §25.4 asks for before freezing:

  - W0 did not move. Its input is unchanged -- the same 2025 Form 10-K, all 80 pages, 502 regions
    -- so its digest is the same string it was this morning. That matters more than it looks:
    `EXTRACTION_CANDIDATE_BUDGET` moved from 5,000 to 7,000 in the same change, and W0 compiles
    2,310 objects, well under either number. An unchanged W0 is the evidence that raising the
    budget did not change how anything below it is compiled.
  - W4 moved because its input grew: the DEF 14A's declared slice of pages 1-48 and 51 is gone
    and all 103 of its pages are compiled, so W4 is 1,281 regions from 287 pages instead of 1,169
    regions from 233. It also stopped being truncated -- at the old budget this corpus emitted
    5,000 of its objects and compiled `review_required`. Both causes are corpus and budget, not
    a change to the extractors, which are untouched.
  - W1, W2 and W3 are new. They were declared data with `file: null` until now; nothing about
    them moved, they did not exist.
  - All five artifacts are `lifecycle: candidate` with `candidatesConsidered` equal to what was
    emitted, which is the measurable form of "nothing was dropped to fit". W4 is 6,300 objects;
    the 6,457 recorded for this corpus previously was `candidatesConsidered` read under the old
    cap, which is not a measurement of the corpus.

  2026-09-11: all five moved, and the cause is one package file rather than the compiler.

  Audit U05 added a per-document `documents` list and a `documentsNotCompiled` note to
  `validation/report.json`, so someone auditing a downloaded package can see which document put
  it in review instead of only that the package is in review. That file is inside the manifest
  digest by design -- it is part of what a signed export signs -- so every digest a fallback
  compile produces moves with it. Nothing about extraction, identity, the ontology or the counts
  changed: `counts`, `checks` and `reviewReasons` hold the values they held, and
  `collection-compiler.test.ts` asserts the new list agrees with them rather than restating them.

  Re-derived from a new measurement for a deliberate content change, which is a different act
  from moving a recorded number to make a build pass. The values they replace are below.

  Previous values, kept so the moves are traceable rather than merely different:
    2026-09-06  current world (2025 10-K)     sha256:b2aaebd8dd73b8d161d7fc23e4cf649f6c009bce87ee107bab8311a28a268978
    2026-09-06  revision B (2024 10-K)        sha256:2682d467ac1fd98d7570ace2053b7e9e9231d0b9f9c0715f81a011a8089c31bc
    2026-09-06  revision C (mixed fixture)    sha256:dff62fcee5954bf5df236ac0e6927d1978e2441eeb7fbdf8608934cefbeabc52
    2026-09-06  revision B (mixed fixture)    sha256:85a2932b18ea0e418d15adbfcff39c5f29804377ae82da2ab97641db795cfb4d
    2026-09-08  W0, three-page 10-K slice     sha256:b2aaebd8dd73b8d161d7fc23e4cf649f6c009bce87ee107bab8311a28a268978
    2026-09-08  W4, three pages per filing    sha256:50b61e20484c1a06cbf7b2a9ce7aa4c8926bc5819a59f60d8fec1f8096aba7e8
    2026-09-08  W4, 233 of 290 pages          sha256:277df1a439a8806ebb290b77f31ffdaf0a61b59e5efca3641d9cb7596aca9d20
    2026-09-08  W0, before the U05 list       sha256:1db0e4c5ef2f89655e57d478a3761ce36c871ea9f1dfcd1a801aa8e1719b3597
    2026-09-08  W1, before the U05 list       sha256:aec94176876a0db8d2c2284ffb633b86672080ba0041e0d18a0c2a3ce55f4187
    2026-09-08  W2, before the U05 list       sha256:364b38dbfd36d4ce524bf7702117817d17a4dba84ef7249cbd5de98ceeb9c5af
    2026-09-08  W3, before the U05 list       sha256:05adb2a5f5f3401ac6293040162b73b21966625834efa5a74f602f1a89bdfbeb
    2026-09-08  W4, before the U05 list       sha256:328d3ef3a6ee0153b14e9a782cdb4e9f499a6443b1f5dbf2898ace1cb4915b7f
*/

/** W4: the compiled World the Explore page shows. Recorded so that it cannot change unobserved. */
export const EXPLORE_SAMPLE_DIGEST = "sha256:aff67d5c6d0e3e119433446ed003545a942ad5638de8e7b51c93c6ca1a847091";

/** W0: the same annual filing alone, before the four 2026 filings arrived. */
export const EXPLORE_SAMPLE_BASELINE_DIGEST = "sha256:b553f3e4b90b991f6555eae8047064cf5930143878a111f134d2d4426186f1ef";

/* The three intermediate Worlds, one per arriving filing. Frozen on the same terms as the ends. */
export const EXPLORE_SAMPLE_W1_DIGEST = "sha256:c1714be053752138e59a1a80599b89852f308bac8ae67ad6a2fdc793baa1200e";
export const EXPLORE_SAMPLE_W2_DIGEST = "sha256:a902ada378c9f6c1d91cd6de0e9323e5d344f415d41c3ab202f7a91cc9fa2d06";
export const EXPLORE_SAMPLE_W3_DIGEST = "sha256:76eda2ed020039cef776c89b5d2e4f391e062bb361224b1fc77573dedc9cf6fc";

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
      // §11.3 asks for the acquisition source beside the digests. It was already in the record
      // and stopped here; a drawer that prints a digest without saying where the bytes were
      // acquired from is an audit trail with its first line missing.
      acquiredFrom: source.acquiredFrom,
      sliceRationale: source.sliceRationale,
    };
  });
}

const sample = build(rawInputs, "W4 · 2025 10-K + four 2026 filings", EXPLORE_SAMPLE_DIGEST);
const baseline = build(rawBaselineInputs, "W0 · 2025 Form 10-K", EXPLORE_SAMPLE_BASELINE_DIGEST);
const w1 = build(rawW1Inputs, "W1 · + 2026 Q1 10-Q", EXPLORE_SAMPLE_W1_DIGEST);
const w2 = build(rawW2Inputs, "W2 · + 2026 DEF 14A", EXPLORE_SAMPLE_W2_DIGEST);
const w3 = build(rawW3Inputs, "W3 · + 2026 Q2 10-Q", EXPLORE_SAMPLE_W3_DIGEST);

export const exploreSampleInputs: readonly CollectionOcrInput[] = sample.inputs;
export const exploreSampleArtifact = sample.artifact;
export const exploreSampleWorld: WorldReadModel = sample.world;
export const exploreSampleDocuments = documentsOf(sample.inputs);

export const exploreSampleBaselineInputs: readonly CollectionOcrInput[] = baseline.inputs;
export const exploreSampleBaselineArtifact = baseline.artifact;
export const exploreSampleBaselineWorld: WorldReadModel = baseline.world;
export const exploreSampleBaselineDocuments = documentsOf(baseline.inputs);

export type ExploreSampleSnapshot = {
  /** The snapshot id `scripts/build-explore-sample.mjs` emitted the inputs under. */
  id: "w0" | "w1" | "w2" | "w3" | "w4";
  /** How the corpus grew at this step, in the words the build script uses. */
  label: string;
  inputs: readonly CollectionOcrInput[];
  world: WorldReadModel;
};

/*
  The five compiled Worlds in arrival order (§24, §25.2).

  Ordered, so a consecutive-step comparison is `snapshots[n-1]` against `snapshots[n]` rather
  than a lookup that could silently pair the wrong two. Every entry is a *complete* compile of
  its corpus -- this repository's compiler has no incremental path -- so nothing derived from
  this list may be described as a selective rebuild.
*/
export const exploreSampleSnapshots: readonly ExploreSampleSnapshot[] = [
  { id: "w0", label: "2025 Form 10-K", inputs: baseline.inputs, world: baseline.world },
  { id: "w1", label: "+ 2026 Q1 10-Q", inputs: w1.inputs, world: w1.world },
  { id: "w2", label: "+ 2026 DEF 14A", inputs: w2.inputs, world: w2.world },
  { id: "w3", label: "+ 2026 Q2 10-Q", inputs: w3.inputs, world: w3.world },
  { id: "w4", label: "2025 Form 10-K + four 2026 filings", inputs: sample.inputs, world: sample.world },
];

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
