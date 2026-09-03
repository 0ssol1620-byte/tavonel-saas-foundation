import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileIdempotencyKey, enqueueCompileJob, enqueueCorpusCompile } from "./compile-job-store";
import { corpusIdFor } from "./corpus-id";
import { planCorpusBatches } from "./corpus-batching";

/*
  Compiling twelve documents, then compiling a hundred and twenty-eight that begin with those
  same twelve.

  Both halves were individually right and together they were wrong. A job's identity was its
  document set, a corpus is partitioned deterministically into compile-sized parts, and the
  first part of the corpus is therefore exactly the twelve documents that already have a job.
  The corpus enqueue found that job, was told `created: false`, and recorded a standalone
  World -- belonging to no corpus, invisible to `readCorpusParts` -- as its part 0. Ten parts
  where the caller believed there were eleven, and nothing raised.

  The database is where this is finally settled, and `supabase/tests/foundation_corpus_slot_
  idempotency.sql` settles it there. What is checked here is the half that runs in this
  process: that the application no longer *asks* for the reuse, and that it refuses an answer
  that is not the slot it asked for. The fake below is a model of the RPC, not the RPC, so it
  is written with both lookup rules -- the one 0038 shipped and the one 0041 installs -- and
  the scenario is replayed against each. A model that only implements the fix would prove
  nothing about the bug.
*/

type Row = {
  jobId: string;
  workspaceKey: string;
  documentIds: string[];
  idempotencyKey: string;
  corpusId: string | null;
  batchIndex: number | null;
};

/** How the database decides whether an enqueue has already happened. */
type LookupRule = "legacy-document-set" | "key-only" | "slot-aware";

class FakeCompileJobs {
  readonly rows: Row[] = [];
  constructor(private readonly rule: LookupRule) {}

  private find(body: Record<string, unknown>) {
    const workspaceKey = body.p_workspace_key as string;
    const key = body.p_idempotency_key as string;
    const corpusId = (body.p_corpus_id ?? null) as string | null;
    const batchIndex = (body.p_batch_index ?? null) as number | null;

    if (this.rule === "legacy-document-set") {
      /*
        0038 and 0040 as they shipped. The stored key *was* the document set, so a lookup by
        key and a lookup by document set are the same lookup -- modelled here as the document
        set so the collision does not depend on this test also reproducing the old hash.
      */
      const canonical = (ids: readonly string[]) => [...new Set(ids)].sort().join("|");
      const wanted = canonical(body.p_document_ids as string[]);
      return this.rows.find(row =>
        row.workspaceKey === workspaceKey && canonical(row.documentIds) === wanted);
    }
    if (this.rule === "key-only") {
      // The stored key, whatever kind of job it belongs to. With v2 keys this no longer collides.
      return this.rows.find(row => row.workspaceKey === workspaceKey && row.idempotencyKey === key);
    }
    if (corpusId === null) {
      return this.rows.find(row =>
        row.workspaceKey === workspaceKey && row.corpusId === null && row.idempotencyKey === key);
    }
    return this.rows.find(row =>
      row.workspaceKey === workspaceKey && row.corpusId === corpusId && row.batchIndex === batchIndex);
  }

  handle(body: Record<string, unknown>): { status: number; rows: unknown[] } {
    const existing = this.find(body);
    if (existing) {
      if (this.rule === "slot-aware" && existing.idempotencyKey !== body.p_idempotency_key) {
        // Same slot, other documents. 23505 reaches the client as 409.
        return { status: 409, rows: [] };
      }
      return {
        status: 200,
        rows: [{
          job_id: existing.jobId,
          state: "preflight",
          created: false,
          corpus_id: existing.corpusId,
          batch_index: existing.batchIndex,
        }],
      };
    }
    const row: Row = {
      jobId: body.p_job_id as string,
      workspaceKey: body.p_workspace_key as string,
      documentIds: body.p_document_ids as string[],
      idempotencyKey: body.p_idempotency_key as string,
      corpusId: (body.p_corpus_id ?? null) as string | null,
      batchIndex: (body.p_batch_index ?? null) as number | null,
    };
    this.rows.push(row);
    return {
      status: 200,
      rows: [{
        job_id: row.jobId, state: "preflight", created: true,
        corpus_id: row.corpusId, batch_index: row.batchIndex,
      }],
    };
  }
}

const WORKSPACE = "pilot-slottest01";
const USER = "77777777-7777-4777-8777-777777777777";
const docs = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `doc-${String(from + i).padStart(3, "0")}`);

function install(rule: LookupRule) {
  const store = new FakeCompileJobs(rule);
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (!href.includes("/rpc/enqueue_foundation_compile_job")) {
      return new Response("null", { status: 404 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const { status, rows } = store.handle(body);
    return new Response(JSON.stringify(rows), { status, headers: { "content-type": "application/json" } });
  });
  return store;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the identity a compile is enqueued under", () => {
  it("separates a standalone compile from a corpus slot over the same documents", () => {
    const corpusId = corpusIdFor(WORKSPACE, docs(1, 128));
    expect(compileIdempotencyKey(WORKSPACE, docs(1, 12)))
      .not.toEqual(compileIdempotencyKey(WORKSPACE, docs(1, 12), { corpusId, batchIndex: 0 }));
  });

  it("separates two slots of one corpus that hold the same documents", () => {
    // Cannot arise from `planCorpusBatches`, which partitions. It is asserted because the slot
    // is part of the identity, not a label attached to one.
    const corpusId = corpusIdFor(WORKSPACE, docs(1, 128));
    expect(compileIdempotencyKey(WORKSPACE, docs(1, 12), { corpusId, batchIndex: 0 }))
      .not.toEqual(compileIdempotencyKey(WORKSPACE, docs(1, 12), { corpusId, batchIndex: 1 }));
  });

  it("separates the same slot of two different corpora", () => {
    const first = corpusIdFor(WORKSPACE, docs(1, 128));
    const second = corpusIdFor(WORKSPACE, docs(1, 64));
    expect(first).not.toEqual(second);
    expect(compileIdempotencyKey(WORKSPACE, docs(1, 12), { corpusId: first, batchIndex: 0 }))
      .not.toEqual(compileIdempotencyKey(WORKSPACE, docs(1, 12), { corpusId: second, batchIndex: 0 }));
  });

  it("still collapses a resubmission of the same standalone selection", () => {
    // The property the key exists for. A double-clicked Compile button is one charge.
    expect(compileIdempotencyKey(WORKSPACE, ["doc-002", "doc-001", "doc-002"]))
      .toEqual(compileIdempotencyKey(WORKSPACE, ["doc-001", "doc-002"]));
  });

  it("still collapses a resubmission of the same corpus slot", () => {
    // And the property a corpus retry depends on: re-enqueuing lands on the parts that exist.
    const corpusId = corpusIdFor(WORKSPACE, docs(1, 128));
    expect(compileIdempotencyKey(WORKSPACE, docs(1, 12), { corpusId, batchIndex: 3 }))
      .toEqual(compileIdempotencyKey(WORKSPACE, [...docs(1, 12)].reverse(), { corpusId, batchIndex: 3 }));
  });
});

describe("A, then B, then C -- the scenario that was broken", () => {
  it("does not let the standalone job become part 0 of the corpus", async () => {
    const store = install("slot-aware");

    // A. Twelve documents compiled on their own.
    const standalone = await enqueueCompileJob({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 12),
    });
    expect(standalone.ok && standalone.value.created).toBe(true);

    // B. The same twelve arrive as the first part of a 128-document corpus.
    const corpus = await enqueueCorpusCompile({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 128),
    });
    expect(corpus.ok).toBe(true);
    if (!corpus.ok) return;

    // C. Batch 0 is exactly [1..12] -- the collision -- and it is nonetheless its own job.
    const batches = planCorpusBatches(docs(1, 128));
    expect(batches[0].documentIds).toEqual(docs(1, 12));
    expect(corpus.value.batchCount).toBe(11);
    expect(corpus.value.parts).toHaveLength(11);
    expect(corpus.value.parts.every(part => part.created)).toBe(true);

    const part0 = corpus.value.parts[0];
    expect(part0.jobId, "part 0 must not be the standalone job")
      .not.toEqual(standalone.ok ? standalone.value.jobId : "");

    // Every part is visible as a part. This is the read the corpus could not satisfy before.
    const parts = store.rows.filter(row => row.corpusId === corpus.value.corpusId);
    expect(parts).toHaveLength(11);
    expect(parts.map(row => row.batchIndex)).toEqual([...Array(11).keys()]);
    expect(store.rows.filter(row => row.corpusId === null)).toHaveLength(1);
  });

  it("reproduces the collision when the database looks up by key alone", async () => {
    /*
      The mutation, and the reason the test above is worth anything.

      `legacy-document-set` is 0038 and 0040 exactly: a job is found by its workspace and its
      document set, with no notion of a slot. Replayed through the same application code, the
      corpus adopts the standalone job -- which is the defect, reproduced. If this ever stops
      reproducing it, the fake has stopped modelling the bug.
    */
    const store = install("legacy-document-set");

    const standalone = await enqueueCompileJob({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 12),
    });
    expect(standalone.ok && standalone.value.created).toBe(true);

    const answer = await enqueueCompileJob({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 12),
      corpus: { corpusId: corpusIdFor(WORKSPACE, docs(1, 128)), batchIndex: 0, batchCount: 11 },
    });

    // The database handed back the standalone job for a corpus slot. One row, corpus_id null,
    // and a caller who believes part 0 exists.
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].corpusId).toBeNull();

    /*
      What changed on this side: the old code returned that row and the corpus carried on a
      part short. The slot check now refuses it, so even against a database that has not run
      0041 -- a Preview caught mid-deploy, a rolled back migration -- the run stops with a
      conflict instead of silently losing twelve documents.
    */
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.code).toBe("COMPILE_JOB_SLOT_CONFLICT");
  });

  it("is closed by the namespaced key alone, before the database rule is considered", async () => {
    // Belt and braces, measured. With 0038's lookup rule but the v2 key, nothing collides:
    // the standalone key and the slot key are different strings, so the corpus part is a miss
    // and gets its own row. Either half of the fix closes this on its own.
    const store = install("key-only");

    await enqueueCompileJob({ workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 12) });
    const part = await enqueueCompileJob({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 12),
      corpus: { corpusId: corpusIdFor(WORKSPACE, docs(1, 128)), batchIndex: 0, batchCount: 11 },
    });

    expect(part.ok && part.value.created).toBe(true);
    expect(store.rows).toHaveLength(2);
    expect(store.rows.filter(row => row.corpusId !== null)).toHaveLength(1);
  });
});

describe("an answer that is not the slot that was asked for", () => {
  it("is refused rather than believed", async () => {
    const store = install("key-only");
    const corpusId = corpusIdFor(WORKSPACE, docs(1, 128));

    // A database that hands back some other job for this slot: the shape the old key produced.
    store.rows.push({
      jobId: "cjob-someone-else", workspaceKey: WORKSPACE, documentIds: docs(1, 12),
      idempotencyKey: compileIdempotencyKey(WORKSPACE, docs(1, 12), { corpusId, batchIndex: 0 }),
      corpusId: null, batchIndex: null,
    });

    const result = await enqueueCompileJob({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 12),
      corpus: { corpusId, batchIndex: 0, batchCount: 11 },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("COMPILE_JOB_SLOT_CONFLICT");
  });

  it("reports a slot conflict from the database as a conflict, not a write failure", async () => {
    const store = install("slot-aware");
    const corpusId = corpusIdFor(WORKSPACE, docs(1, 128));

    store.rows.push({
      jobId: "cjob-other-documents", workspaceKey: WORKSPACE, documentIds: docs(25, 36),
      idempotencyKey: compileIdempotencyKey(WORKSPACE, docs(25, 36), { corpusId, batchIndex: 0 }),
      corpusId, batchIndex: 0,
    });

    const result = await enqueueCompileJob({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 12),
      corpus: { corpusId, batchIndex: 0, batchCount: 11 },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("COMPILE_JOB_SLOT_CONFLICT");
  });

  it("accepts a repeated corpus enqueue that lands on the same slot", async () => {
    // Resume. The parts that exist come back unchanged and no second row is written.
    install("slot-aware");
    const first = await enqueueCorpusCompile({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 128),
    });
    const second = await enqueueCorpusCompile({
      workspaceKey: WORKSPACE, createdByUserId: USER, documentIds: docs(1, 128),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.corpusId).toEqual(first.value.corpusId);
    expect(second.value.parts.map(part => part.jobId)).toEqual(first.value.parts.map(part => part.jobId));
    expect(second.value.parts.every(part => part.created)).toBe(false);
  });
});
