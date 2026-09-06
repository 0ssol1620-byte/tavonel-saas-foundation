import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHANGELOG } from "./changelog";
import { planCorpusBatches, summariseCorpus } from "./corpus-batching";
import { CORPUS_MAX_DOCUMENTS, COMPILE_MAX_DOCUMENTS } from "./compile-limits";

/*
  Two things a customer can be left believing that are not true, and the copy that stops them.

  The first is that a large run produces one World. It does not: 128 documents compile in parts
  of twelve, which is eleven Worlds, and they are not merged. Every screen calls them "parts",
  which is accurate and is also exactly the word that reads as "pieces of one thing".

  The second is that everything in a compiled World is held to the same standard. The Entity
  type is a capitalised-token regex measured at 0.20 precision on the sample corpus
  (`entity-extraction-quality.test.ts`), and a reader who is not told that will read "15
  entities" the way they read "10 claims".

  Both are copy, so both are checked as copy. Nothing here can tell whether a sentence is
  well-written; it can tell whether the sentence is still there.
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("a corpus is never described as one World", () => {
  it("produces more than one World at the documented ceiling", () => {
    // The arithmetic the copy has to match, taken from the limits rather than restated.
    const batches = planCorpusBatches(
      Array.from({ length: CORPUS_MAX_DOCUMENTS }, (_, i) => `doc-${String(i).padStart(3, "0")}`),
    );
    expect(batches.length).toBe(Math.ceil(CORPUS_MAX_DOCUMENTS / COMPILE_MAX_DOCUMENTS));
    expect(batches.length).toBeGreaterThan(1);
  });

  it("tells the customer how many Worlds a run produced, in the panel that follows it", () => {
    const panel = read("../components/compile-job-panel.tsx");
    expect(panel).toContain("separate Worlds, one per part");
    expect(panel).toContain("They are not merged");
  });

  it("says the same thing in the changelog and the documentation", () => {
    const entry = CHANGELOG.flatMap((item) => item.added ?? []).find((line) => line.includes("128"));
    expect(entry, "the corpus release note").toBeTruthy();
    expect(entry).toContain("not merged");

    const docs = read("./docs-content.ts");
    expect(docs).toContain("The parts are not merged");
  });

  it("never calls a finished corpus a single World", () => {
    /*
      The specific sentence to avoid. `summariseCorpus` reports `ready` when every part
      compiled, and "ready" must not acquire a "your World is ready" reading anywhere.
    */
    const progress = summariseCorpus("corpus-" + "a".repeat(32), [
      { jobId: "cjob-1", batchIndex: 0, state: "ready", collectionId: "c1", documentsTotal: 12, documentsReady: 12, errorCode: null },
      { jobId: "cjob-2", batchIndex: 1, state: "ready", collectionId: "c2", documentsTotal: 12, documentsReady: 12, errorCode: null },
    ]);
    expect(progress.state).toBe("ready");

    const panel = read("../components/compile-job-panel.tsx");
    for (const forbidden of ["one World", "a single World", "your World is ready", "the World is ready"]) {
      expect(panel.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

/*
  The qualifier moved; the assertions followed it.

  Blueprint §49 takes the Entity disclosure off the default Explore surface and puts it in the
  technical drawer, so the sentence now lives in `lib/explore-story.ts` and is rendered by
  `components/explore/technical-details.tsx`. What these tests are for is unchanged: the
  measured figure must still be beside the type it qualifies, and it must still match the
  evaluation it came from. A disclosure that is allowed to move is not allowed to evaporate,
  which is why the second test below reads the renderer and not only the string.
*/
describe("the entity type is qualified where it is shown", () => {
  it("carries the measured precision in the copy that ships", () => {
    const copy = read("./explore-story.ts");
    expect(copy).toContain("entityDisclaimer");
    // 3 of 15 until 2026-09-06, when gap-matrix row D7-01 removed the extractor's eight-entity
    // cap and a sixteenth candidate appeared. The number moved down; the test moved with it.
    expect(copy).toContain("3 of 16");
    expect(copy).toContain("Unreviewed");
    expect(copy).toContain("heuristic");
  });

  it("keeps the number in the copy and the number in the evaluation the same", () => {
    // A qualifier that drifts from its measurement is worse than none: it is a published
    // figure nobody re-derived.
    const evaluation = JSON.parse(read("./entity-extraction-eval.json")) as {
      baseline: { truePositives: number; candidates: number };
    };
    const copy = read("./explore-story.ts");
    expect(copy).toContain(`${evaluation.baseline.truePositives} of ${evaluation.baseline.candidates}`);
  });

  it("does not present the heuristic as a resolver anywhere it is described", () => {
    expect(read("./explore-story.ts")).toContain("not by a resolver");
  });

  it("still renders the qualifier where the Explore page keeps its machine detail", () => {
    const drawer = read("../components/explore/technical-details.tsx");
    expect(drawer).toContain("EXPLORE_COPY.entityDisclaimer");
  });
});
