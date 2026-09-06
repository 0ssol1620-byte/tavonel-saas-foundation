import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPILE_MAX_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { MAX_FILES } from "./archive-expand";
import { corpusIdFor } from "./corpus-id";
import {
  CORPUS_ID_PATTERN,
  judgeCorpusSet,
  needsCorpusCompile,
  planCorpusBatches,
  summariseCorpus,
} from "./corpus-batching";

/*
  Compiling more than one compile can hold.

  The gap this closes was reported as a defect in its own right: intake accepted 128 files and
  the compiler took twelve, so a customer could drop an archive, wait through sanitation and
  reading on all of it, and be told at the end that the set was unqualified. The tempting fix
  is to write 128 where 12 is written. That would put a hundred documents' OCR output inside
  one Core request and one function invocation -- the shape the durable job replaced -- so the
  first test here is that nobody has done it.
*/

const ids = (count: number) => Array.from({ length: count }, (_, index) => `doc-${String(index).padStart(3, "0")}`);

describe("the two ceilings stay two ceilings", () => {
  it("does not raise the per-compile limit to the intake limit", () => {
    expect(COMPILE_MAX_DOCUMENTS).toBeLessThan(CORPUS_MAX_DOCUMENTS);
    expect(COMPILE_MAX_DOCUMENTS).toBe(12);
  });

  it("lets a customer submit as many sources as intake accepts", () => {
    // A 128-file archive that cannot be compiled is the defect. These two numbers are the same
    // customer action seen from two ends and have to agree.
    expect(CORPUS_MAX_DOCUMENTS).toBe(MAX_FILES);
    expect(judgeCorpusSet(MAX_FILES).ok).toBe(true);
  });

  it("refuses beyond the run ceiling, and says what to do instead", () => {
    const verdict = judgeCorpusSet(CORPUS_MAX_DOCUMENTS + 1);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("CORPUS_TOO_LARGE");
    expect(verdict.message).toContain(String(CORPUS_MAX_DOCUMENTS));
  });

  it("still refuses an empty selection", () => {
    expect(judgeCorpusSet(0).ok).toBe(false);
    expect(judgeCorpusSet(1).ok).toBe(true);
  });

  it("only calls it a corpus when one compile cannot hold it", () => {
    expect(needsCorpusCompile(COMPILE_MAX_DOCUMENTS)).toBe(false);
    expect(needsCorpusCompile(COMPILE_MAX_DOCUMENTS + 1)).toBe(true);
  });
});

describe("partitioning a selection", () => {
  it.each([13, 50, 100, 128])("splits %i sources into compile-sized parts", (count) => {
    const batches = planCorpusBatches(ids(count));
    expect(batches).toHaveLength(Math.ceil(count / COMPILE_MAX_DOCUMENTS));
    for (const batch of batches) {
      expect(batch.documentIds.length).toBeGreaterThan(0);
      expect(batch.documentIds.length).toBeLessThanOrEqual(COMPILE_MAX_DOCUMENTS);
      expect(batch.count).toBe(batches.length);
    }
    // Every document, exactly once. A partition that loses one is a World missing a source
    // nobody was told about.
    expect(batches.flatMap((batch) => batch.documentIds).sort()).toEqual(ids(count).sort());
  });

  it("fills every part but the last", () => {
    /*
      An even split reads better and is wrong. Adding one document to a 25-source selection
      would move every boundary, change every part's idempotency key, and turn a one-document
      addition into three fresh compiles instead of one.
    */
    const batches = planCorpusBatches(ids(25));
    expect(batches.map((batch) => batch.documentIds.length)).toEqual([12, 12, 1]);
  });

  it("is stable under reordering and duplication", () => {
    const forward = planCorpusBatches(ids(30));
    const shuffled = planCorpusBatches([...ids(30)].reverse().concat(ids(3)));
    expect(shuffled).toEqual(forward);
  });
});

describe("corpus identity", () => {
  it("is the document set, so a resubmission lands in the same run", () => {
    const a = corpusIdFor("pilot-alpha", ids(20));
    const b = corpusIdFor("pilot-alpha", [...ids(20)].reverse());
    expect(a).toBe(b);
    expect(CORPUS_ID_PATTERN.test(a)).toBe(true);
  });

  it("is scoped to the workspace", () => {
    expect(corpusIdFor("pilot-alpha", ids(20))).not.toBe(corpusIdFor("pilot-beta", ids(20)));
  });

  it("moves when the selection moves", () => {
    expect(corpusIdFor("pilot-alpha", ids(20))).not.toBe(corpusIdFor("pilot-alpha", ids(21)));
  });
});

describe("what a corpus reports while it runs", () => {
  const part = (index: number, state: string, ready = 12, batchCount: number | null = 2) => ({
    jobId: `cjob-${String(index).padStart(32, "0")}`,
    batchIndex: index,
    state,
    collectionId: state === "ready" ? `collection-${"a".repeat(32)}` : null,
    documentsTotal: 12,
    documentsReady: ready,
    errorCode: null,
    batchCount,
  });

  it("is running until every part has settled", () => {
    const summary = summariseCorpus(corpusIdFor("pilot-alpha", ids(24)), [part(0, "ready"), part(1, "reading", 4)]);
    expect(summary.state).toBe("running");
    expect(summary.documentsReady).toBe(16);
    expect(summary.documentsTotal).toBe(24);
  });

  it("is ready only when no part failed", () => {
    expect(summariseCorpus("corpus-" + "a".repeat(32), [part(0, "ready"), part(1, "ready")]).state).toBe("ready");
  });

  it("calls a run with some compiled parts partial, not ready and not failed", () => {
    /*
      The state that matters. Reporting this as ready hides sources behind a green tick;
      reporting it as failed throws away Worlds the customer can already open.
    */
    const summary = summariseCorpus("corpus-" + "a".repeat(32), [part(0, "ready"), part(1, "failed", 0)]);
    expect(summary.state).toBe("partial");
    expect(summary.partsReady).toBe(1);
    expect(summary.partsFailed).toBe(1);
  });

  it("calls a run where nothing compiled failed", () => {
    expect(summariseCorpus("corpus-" + "a".repeat(32), [part(0, "failed", 0), part(1, "cancelled", 0)]).state).toBe("failed");
  });

  /*
    The one fact a summary computed from the parts cannot derive from the parts present: how
    many parts there should have been. Every row declares it -- 0040's
    `foundation_compile_jobs_corpus_is_whole` makes `batch_count` mandatory on a part -- so
    counting the rows that answered the read and calling that the part count turns three
    missing parts into a green tick over thirty-six sources nobody was told about.
  */
  it("does not call a corpus ready when parts it declared are missing", () => {
    const parts = Array.from({ length: 8 }, (_, index) => part(index, "ready", 12, 11));
    const summary = summariseCorpus("corpus-" + "a".repeat(32), parts);
    expect(summary.state).toBe("incomplete");
    expect(summary.batchCount).toBe(11);
    expect(summary.partsPresent).toBe(8);
    expect(summary.missingBatchIndexes).toEqual([8, 9, 10]);
    expect(summary.incompleteCode).toBe("PARTS_MISSING");
  });

  it("is still incomplete when the missing part sits between the ones that are there", () => {
    const summary = summariseCorpus("corpus-" + "a".repeat(32), [
      part(0, "ready", 12, 3),
      part(2, "ready", 12, 3),
    ]);
    expect(summary.state).toBe("incomplete");
    expect(summary.missingBatchIndexes).toEqual([1]);
  });

  it("takes the largest declared count when the parts disagree", () => {
    // Adversarial: a row whose batch_count disagrees with its siblings. Believing the smaller
    // number would let a corpus argue itself back to whole.
    const summary = summariseCorpus("corpus-" + "a".repeat(32), [
      part(0, "ready", 12, 2),
      part(1, "ready", 12, 4),
    ]);
    expect(summary.batchCount).toBe(4);
    expect(summary.state).toBe("incomplete");
    expect(summary.missingBatchIndexes).toEqual([2, 3]);
  });

  it("fails closed when a part does not declare how many parts there are", () => {
    const summary = summariseCorpus("corpus-" + "a".repeat(32), [
      part(0, "ready", 12, null),
      part(1, "ready", 12, null),
    ]);
    expect(summary.state).toBe("incomplete");
    expect(summary.incompleteCode).toBe("BATCH_COUNT_UNDECLARED");
  });

  it("says nothing is missing when every declared part is present", () => {
    const summary = summariseCorpus("corpus-" + "a".repeat(32), [part(0, "ready"), part(1, "ready")]);
    expect(summary.missingBatchIndexes).toEqual([]);
    expect(summary.incompleteCode).toBeNull();
    expect(summary.partsPresent).toBe(2);
  });
});

describe("the schema behind it", () => {
  const migration = readFileSync(
    resolve(import.meta.dirname, "../../supabase/migrations/0040_foundation_corpus_compile.sql"),
    "utf8",
  );

  it("adds no second state machine", () => {
    // A part is an ordinary compile job. A parallel corpus lifecycle would mean two
    // implementations of terminal-is-terminal, and only one of them would get the next fix.
    expect(migration).not.toMatch(/create table.*corpus/i);
    expect(migration).not.toMatch(/create type.*corpus.*state/i);
    expect(migration).toContain("alter table public.foundation_compile_jobs");
  });

  it("keeps the corpus columns whole", () => {
    expect(migration).toContain("foundation_compile_jobs_corpus_is_whole");
    expect(migration).toContain("batch_index < batch_count");
  });

  it("gives a corpus one row per position", () => {
    expect(migration).toContain("create unique index foundation_compile_jobs_corpus_slot_idx");
    expect(migration).toContain("(workspace_key, corpus_id, batch_index)");
  });

  it("replaces the enqueue function rather than overloading it", () => {
    // Two functions of one name differing only in defaulted arguments is an ambiguity
    // PostgREST resolves by guessing.
    expect(migration).toContain("drop function if exists public.enqueue_foundation_compile_job(text, text, uuid, text[], text)");
    expect(migration).toContain("create function public.enqueue_foundation_compile_job(");
    expect(migration).toContain("p_batch_count integer default null");
  });

  it("writes no second created event, because the 0038 trigger already writes one", () => {
    expect(migration).not.toContain("insert into public.foundation_compile_job_events");
  });

  it("leaves the product's document limits to the application", () => {
    expect(migration).not.toMatch(/\b12\b/);
    expect(migration).not.toMatch(/batch_count.*between 1 and 128/);
  });
});

describe("where the corpus path is wired in", () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
  const route = read("app/api/compile-jobs/route.ts");
  const corpusRoute = read("app/api/compile-jobs/corpus/[corpusId]/route.ts");
  const workspace = read("app/workspace/page.tsx");

  it("judges a submission against the run ceiling, not the per-compile one", () => {
    expect(route).toContain("judgeCorpusSet(documentIds.length)");
    expect(route).not.toContain("judgeCompileSet(");
  });

  it("partitions on the server, so the browser cannot disagree about the boundary", () => {
    expect(route).toContain("needsCorpusCompile(documentIds.length)");
    expect(route).toContain("enqueueCorpusCompile");
    expect(route).toContain("COMPILE_CORPUS_ACCEPTED");
  });

  it("computes the corpus summary from its parts rather than storing one", () => {
    expect(corpusRoute).toContain("summariseCorpus");
    expect(corpusRoute).toContain("readCorpusParts");
  });

  it("hands the summary the part count each row declared", () => {
    // The summary can count the rows it was given. What it cannot derive is how many rows
    // there should have been, so the route has to carry that column through.
    expect(corpusRoute).toContain("batchCount: part.batchCount");
  });

  it("lets the workspace select more than one compile's worth", () => {
    /*
      The regression this guards. The Compile button was disabled above twelve, so the corpus
      path could exist on the server and be unreachable from the product -- which is how a
      128-file intake and a 12-file compile coexisted in the first place.
    */
    expect(workspace).toContain("disabled={busy || !judgeCorpusSet(selectedDocumentIds.length).ok}");
    expect(workspace).toContain("const stagedVerdict = judgeCorpusSet(");
    expect(workspace).toContain("if (judgeCorpusSet(ids.length).ok) await startDurableCompile(ids);");
  });

  it("follows a corpus by following one part at a time", () => {
    // Not a second progress implementation: the loop picks the unsettled part and hands it to
    // the same `followCompileJob` a single compile uses.
    expect(workspace).toContain("void followCompileJob(open.jobId);");
    expect(workspace).toContain("/api/compile-jobs/corpus/${corpusId}");
    expect(workspace).toContain('url.searchParams.set("corpus", json.corpusId);');
  });

  it("keeps the synchronous route on the per-compile limit", () => {
    // /api/collections/compile still runs inside one request. It is the primitive, and the
    // corpus path is not a reason to let a hundred documents into it.
    expect(read("app/api/collections/compile/route.ts")).toContain("judgeCompileSet");
  });
});
