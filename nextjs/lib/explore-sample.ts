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

/*
  The /explore sample, compiled rather than written.

  `explore-sample.inputs.json` is produced by `scripts/build-explore-sample.mjs` from the three
  PDFs in `public/explore-sample/`: real files, real sha256 per file, real page geometry read
  back out of each one. This module runs the production compiler over them. Nothing on the
  Explore page is authored -- the objects, the claims, the relations, the page numbers and the
  bounding boxes are all what `compileCollectionCandidate` emitted.

  Two guarantees, both fail-closed, because a sample that quietly drifts is worse than no
  sample: every input is re-validated through the same `validateCollectionOcrInput` the API
  uses, and the compiled `manifestDigest` must equal the frozen constant below. Change the
  fixture text, the layout, the extractor or the compiler and this throws at import -- which
  fails the build, not a page view.

  Regenerating: run the script, run `vitest lib/explore-sample`, and paste the digest it
  reports into EXPLORE_SAMPLE_DIGEST. The digest moving is not a problem; it moving without
  anyone noticing is.
*/

/** The compiled World the Explore page shows. Recorded so that it cannot change unobserved. */
export const EXPLORE_SAMPLE_DIGEST = "sha256:d9e1f273a7639f53c4b9070c04926eba7c0f75cdbc9aca64cd447ed609101b16";

export const EXPLORE_SAMPLE_SOURCE_DIRECTORY = "public/explore-sample";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readInputs(): CollectionOcrInput[] {
  const inputs = (rawInputs as unknown[]).map((value) => validateCollectionOcrInput(value));
  if (inputs.some((input) => input === null)) {
    throw new Error("explore_sample_inputs_invalid");
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

function build() {
  const inputs = readInputs();
  const compiled = compileCollectionCandidate(inputs);
  const artifact = withExecutionRecord(compiled, inputs);
  const world = buildWorldReadModel(artifact, artifact.collectionId, { origin: "deterministic_sample" });
  if (!world) throw new Error("explore_sample_read_model_invalid");
  return { inputs, artifact, world };
}

const sample = build();

if (sample.artifact.manifestDigest !== EXPLORE_SAMPLE_DIGEST) {
  throw new Error(
    `explore_sample_digest_changed: expected ${EXPLORE_SAMPLE_DIGEST}, compiled ${sample.artifact.manifestDigest}`,
  );
}

export const exploreSampleInputs: readonly CollectionOcrInput[] = sample.inputs;
export const exploreSampleArtifact = sample.artifact;
export const exploreSampleWorld: WorldReadModel = sample.world;

/** The fixture files behind the World, in the order the compiler saw them. */
export const exploreSampleDocuments = sample.inputs.map((input) => ({
  documentId: input.documentId,
  filename: input.sanitizedKey.slice(input.sanitizedKey.lastIndexOf("/") + 1),
  href: `/${input.sanitizedKey.replace(/^public\//, "")}`,
  digest: input.inputSha256,
  pageCount: input.pageCount,
  regionCount: input.regions?.length ?? 0,
}));

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
