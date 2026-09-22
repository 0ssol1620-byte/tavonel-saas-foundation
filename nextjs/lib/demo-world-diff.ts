import { createHash } from "node:crypto";
import {
  canonicalize,
  compileCollectionCandidate,
  validateCollectionOcrInput,
  type CollectionOcrInput,
} from "./collection-compiler";
import { buildWorldReadModel, type WorldReadModel } from "./world-read-model";
import { diffWorldVersions } from "./world-version-diff";
import { SIGNED_PRODUCT_DEMO_DISCLOSURE } from "./signed-product-demo";
import rawInputs from "./entity-extraction-eval.inputs.json";

/*
  Gap #12 (V-12). What the change on /demo did to the World, rather than a sentence about it.

  The page told the FP-200 story in prose and one struck-through figure: 1,500 becomes 2,000. A
  reader had to take on trust that the compile noticed. This reads the answer off two artifacts
  instead -- the World compiled from the corpus as it stood, and the World compiled once the
  change notice had been filed -- and reports `diffWorldVersions` over them.

  Both sides are complete compiles. This repository's compiler has no incremental path, which
  `lib/explore-change.ts` also says where it produces its numbers, and a page that prints
  "3 changed" beside "8 added" is exactly where a reader would otherwise infer a selective
  rebuild that did not happen. The component says so on the page.

  Two things this deliberately is not.

  It is not a document revised in place. The corpus holds the maintenance manual at revision C
  and a change notice that supersedes revision B; there is no reading of revision B in this
  repository, and inventing one -- text, pages, boxes -- to draw a prettier before-and-after is
  exactly the fabrication the constitution bars. So the arriving document is named as a filing
  that arrived, and the revision it supersedes is quoted from the claim the compiler actually
  emitted rather than asserted here.

  And it is not customer material. The FP-200 corpus is this repository's own synthetic fixture,
  which is why the disclosure travels inside the frame and not only at the top of the page.
*/

const CHANGE_NOTICE = "fp200-change-notice-cn-2026-03";

const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function readInputs(): CollectionOcrInput[] {
  const inputs = (rawInputs as unknown[]).map((value) => validateCollectionOcrInput(value));
  if (inputs.some((input) => input === null)) throw new Error("demo_world_diff_inputs_invalid");
  return inputs as CollectionOcrInput[];
}

/*
  One complete compile, carried to a read model the same way `lib/explore-sample.ts` carries one.

  The execution record is what `buildWorldReadModel` requires to accept an artifact at all; it
  describes this build, and `candidatePromotion` is false on both sides because neither World was
  ever activated -- this is a comparison of two candidates, not a history of a deployment.
*/
function compile(inputs: CollectionOcrInput[], label: string): WorldReadModel {
  const compiled = compileCollectionCandidate(inputs);
  if (compiled.validation.status !== "passed") {
    throw new Error(`demo_world_diff_candidate_invalid: ${label}`);
  }
  const artifact = {
    ...compiled,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-collection-compiler-ts-v1/demo-version-diff",
      worldStateId: null,
      receipt: {
        schemaVersion: "tavonel.compile_receipt.v1" as const,
        requestId: `demo-version-diff-${label}-${compiled.collectionId}`,
        inputSha256: sha256(canonicalize(inputs)),
        outputSha256: sha256(JSON.stringify(compiled)),
        manifestDigest: compiled.manifestDigest,
        collectionId: compiled.collectionId,
        candidatePromotion: false as const,
      },
    },
  };
  const world = buildWorldReadModel(artifact, artifact.collectionId, {
    origin: "deterministic_sample",
  });
  if (!world) throw new Error(`demo_world_diff_read_model_invalid: ${label}`);
  return world;
}

const after = readInputs();
const arriving = after.find((input) => input.documentId === CHANGE_NOTICE);
if (!arriving) throw new Error(`demo_world_diff_arrival_missing: ${CHANGE_NOTICE}`);
const before = after.filter((input) => input.documentId !== CHANGE_NOTICE);
if (before.length !== after.length - 1) throw new Error("demo_world_diff_arrival_not_unique");

const leftWorld = compile(before, "before");
const rightWorld = compile(after, "after");
const diff = diffWorldVersions(leftWorld, rightWorld);
if (diff.identical) throw new Error("demo_world_diff_found_no_change");

/** A diff row prints only the parts that moved; a row where nothing moved says one word. */
function moved(...parts: Array<[number, string]>) {
  const kept = parts
    .filter(([value]) => value !== 0)
    .map(([value, shape]) => shape.replace("{n}", value.toLocaleString("en-US")));
  return kept.length > 0 ? kept.join(" · ") : "unchanged";
}

export type DemoWorldDiffRow = { label: string; value: string };

export const demoWorldDiff = {
  /* The disclosure is the demo's own, so the page and the frame cannot come to disagree. */
  disclosure: SIGNED_PRODUCT_DEMO_DISCLOSURE,
  before: {
    label: `${before.length} sources, before the change notice was filed`,
    manifestDigest: leftWorld.world.manifestDigest,
    objects: leftWorld.objects.length,
  },
  after: {
    label: `${after.length} sources, after it was filed`,
    manifestDigest: rightWorld.world.manifestDigest,
    objects: rightWorld.objects.length,
  },
  arrival: {
    documentId: arriving.documentId,
    sha256: arriving.inputSha256,
    pageCount: arriving.pageCount,
  },
  rows: [
    { label: "Source revisions", value: moved([diff.sourceRevisions.added.length, "+{n}"], [diff.sourceRevisions.unchanged, "{n} unchanged"]) },
    { label: "Objects", value: moved([diff.objects.added.length, "+{n} new"], [diff.objects.changed.length, "{n} rebuilt"], [diff.objects.removed.length, "−{n} removed"]) },
    { label: "Relations", value: moved([diff.relations.added.length, "+{n} new"], [diff.relations.changed.length, "{n} changed"], [diff.relations.removed.length, "−{n} removed"]) },
    { label: "Evidence regions", value: moved([diff.evidence.added.length, "+{n} new"], [diff.evidence.changed.length, "{n} changed"], [diff.evidence.removed.length, "−{n} removed"]) },
    { label: "Package files", value: moved([diff.files.added.length, "+{n} new"], [diff.files.changed.length, "{n} rewritten"], [diff.files.removed.length, "−{n} removed"]) },
  ] satisfies DemoWorldDiffRow[],
  /*
    The claims the second compile added, in the compiler's own words.

    Not a selection: every Claim object in `objects.added`, in the order the diff reports them.
    The sentence a reader came for -- the interval moving, and revision B being superseded -- is
    there because the compiler wrote it, not because this module picked it out.
  */
  claims: diff.objects.added
    .filter((object) => object.type === "Claim")
    .map((object) => ({ id: object.id, label: object.label })),
  /* An object the second compile rebuilt, with the fields that moved on it. */
  rebuilt: diff.objects.changed.map((object) => ({
    id: object.id,
    label: object.label,
    type: object.type,
    changes: object.changes.map((change) => ({
      field: change.field,
      before: change.before,
      after: change.after,
    })),
  })),
} as const;

export type DemoWorldDiff = typeof demoWorldDiff;
