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
import rawInputs from "./explore-sample.inputs.json";
import rawRevisionBInputs from "./explore-sample.revision-b.inputs.json";

/*
  The /explore sample, compiled rather than written.

  `explore-sample.inputs.json` is produced by `scripts/build-explore-sample.mjs` from the PDFs
  in `public/explore-sample/`: real files, real sha256 per file, real page geometry read back
  out of each one. This module runs the production compiler over them. Nothing on the Explore
  page is authored -- the objects, the claims, the relations, the page numbers and the bounding
  boxes are all what `compileCollectionCandidate` emitted.

  Two worlds, not one. The corpus exists at two revisions of the maintenance manual, and both
  are compiled here: revision C is the World the page shows, revision B is the World it is
  compared against. `lib/explore-change.ts` derives the comparison; it does not compile, and it
  does not restate a single number that is not in one of these two artifacts.

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
  Re-derived 2026-09-06 for gap-matrix rows D7-01, D7-02 and D7-04, deliberately and with the
  measurement that moved them.

  The compiler no longer caps extraction at 3 topics, 8 entities and 4 claims per document, no
  longer slices document text at 50,000 characters, and computes its four validation booleans
  rather than asserting them. On this corpus the caps were binding: the manual's ninth entity
  ("MPa") and two of its claims were being dropped in silence, and revision B lost one claim.
  Both worlds still compile to `passed` with all four checks true, so what moved is coverage, not
  correctness. `lib/entity-extraction-eval.json` was re-measured in the same commit.

  Previous values, kept so the move is traceable rather than merely different:
    revision C  sha256:dff62fcee5954bf5df236ac0e6927d1978e2441eeb7fbdf8608934cefbeabc52
    revision B  sha256:85a2932b18ea0e418d15adbfcff39c5f29804377ae82da2ab97641db795cfb4d
*/

/** The compiled World the Explore page shows. Recorded so that it cannot change unobserved. */
export const EXPLORE_SAMPLE_DIGEST = "sha256:3b41edaecc2cf20fcf1062c07983f1f3bf16369b68d544ea6abfa0bf1d882ada";

/** The same corpus one revision earlier: the manual at revision B, the other two files identical. */
export const EXPLORE_SAMPLE_REVISION_B_DIGEST = "sha256:9ce95781c1954c0916c7e3e690d7082966621ba7aa5dba8a46b4c87e47f2227c";

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

/** The fixture files behind a World, in the order the compiler saw them. */
function documentsOf(inputs: readonly CollectionOcrInput[]) {
  return inputs.map((input) => ({
    documentId: input.documentId,
    filename: input.sanitizedKey.slice(input.sanitizedKey.lastIndexOf("/") + 1),
    href: `/${input.sanitizedKey.replace(/^public\//, "")}`,
    digest: input.inputSha256,
    pageCount: input.pageCount,
    regionCount: input.regions?.length ?? 0,
  }));
}

const sample = build(rawInputs, "revision C", EXPLORE_SAMPLE_DIGEST);
const revisionB = build(rawRevisionBInputs, "revision B", EXPLORE_SAMPLE_REVISION_B_DIGEST);

export const exploreSampleInputs: readonly CollectionOcrInput[] = sample.inputs;
export const exploreSampleArtifact = sample.artifact;
export const exploreSampleWorld: WorldReadModel = sample.world;
export const exploreSampleDocuments = documentsOf(sample.inputs);

export const exploreSampleRevisionBInputs: readonly CollectionOcrInput[] = revisionB.inputs;
export const exploreSampleRevisionBArtifact = revisionB.artifact;
export const exploreSampleRevisionBWorld: WorldReadModel = revisionB.world;
export const exploreSampleRevisionBDocuments = documentsOf(revisionB.inputs);

/*
  Three questions the page can put to the World, answered by the retriever the workspace uses.

  Not a scripted answer with a citation drawn on afterwards: `answerGroundedQuestion` reads
  `rag/chunks.jsonl` out of this artifact and returns the regions it scored, and the page shows
  whichever region came first along with the score that put it there. Picking the questions is a
  demo choice; the answers are not a choice.

  Fail-closed: if the retriever abstains on any of them -- which is what it should do when the
  corpus stops supporting the question -- the build stops rather than the page rendering an
  empty panel.
*/
export const EXPLORE_SAMPLE_QUESTIONS = [
  "How many operating hours between full services?",
  "Which revision superseded the 1,500 hour interval?",
  "What must happen before replacing the mechanical seal?",
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
