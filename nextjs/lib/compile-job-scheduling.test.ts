import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESTING_COMPILE_STATES,
  SCHEDULER_EXCLUDED_STATES,
  TERMINAL_COMPILE_STATES,
  WORKSPACE_RUNNABLE_COMPILE_LIMIT,
  compileIdempotencyKey,
  countCompileJobDeferrals,
  enqueueCompileJob,
  isRestingCompileState,
  readOpenCompileJobs,
  recordCompileJobDeferral,
  type CompileState,
} from "./compile-job-store";

/*
  Which jobs a worker asks for, and why "unfinished" was the wrong question.

  `review_required` is not terminal -- the compile genuinely has not finished, and the customer
  is right to see it in their list -- but no worker turn moves it: the package is waiting for a
  person. The scheduler asked for "not settled" and got those rows too, ordered oldest-first by
  an `updated_at` that a resting job never bumps. Five parked reviews therefore occupied every
  slot of the open-job window permanently, across every workspace in the deployment, and every
  other compile stopped: accepted, credited, showing `reading`, and never looked at again.

  The fake below is a model of PostgREST's `not.in` filter rather than a string comparison, so
  the assertion is about the rows the scheduler receives and not about how the query is spelled.
*/

type Row = Record<string, unknown> & { state: string; updated_at: string };

const WORKSPACE = "pilot-schedtest1";

function row(state: CompileState, updatedAt: string, jobId: string): Row {
  return {
    job_id: jobId,
    workspace_key: WORKSPACE,
    document_ids: ["doc-a"],
    state,
    collection_id: null,
    error_code: null,
    blocked: [],
    blocked_resolution: null,
    documents_total: 1,
    documents_ready: 0,
    corpus_id: null,
    batch_index: null,
    batch_count: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    settled_at: null,
  };
}

/** Enough of PostgREST to answer the one query the scheduler makes. */
function install(rows: Row[]) {
  const seen: URLSearchParams[] = [];
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const parsed = new URL(typeof url === "string" ? url : url.toString());
    if (!parsed.pathname.endsWith("/foundation_compile_jobs")) {
      return new Response("[]", { status: 404 });
    }
    seen.push(parsed.searchParams);

    const filter = parsed.searchParams.get("state") ?? "";
    const excluded = /^not\.in\.\(([^)]*)\)$/.exec(filter);
    if (!excluded) throw new Error(`unsupported state filter: ${filter}`);
    const denied = excluded[1].split(",").map((value) => value.trim());

    const order = parsed.searchParams.get("order") ?? "updated_at.asc";
    if (order !== "updated_at.asc") throw new Error(`unsupported order: ${order}`);
    const limit = Number(parsed.searchParams.get("limit") ?? "20");

    const matched = rows
      .filter((entry) => !denied.includes(entry.state))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .slice(0, limit);
    return new Response(JSON.stringify(matched), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return seen;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the scheduler's open-job window", () => {
  it("never hands a worker a job that is resting on a person", async () => {
    install([row("review_required", "2026-09-01T00:00:00Z", "cjob-" + "1".repeat(32))]);
    const open = await readOpenCompileJobs(5);
    expect(open.ok).toBe(true);
    expect(open.ok && open.value).toEqual([]);
  });

  it("still reaches a fresh job behind a window full of parked reviews", async () => {
    /*
      The failure exactly as it happens in production: the batch limit is five, five review
      packages are the five oldest rows, and the sixth job is the one a customer is waiting on.
    */
    const parked = Array.from({ length: 5 }, (_, index) =>
      row("review_required", `2026-09-01T00:0${index}:00Z`, `cjob-${String(index).repeat(32)}`));
    const fresh = row("reading", "2026-09-02T00:00:00Z", "cjob-" + "f".repeat(32));
    install([...parked, fresh]);

    const open = await readOpenCompileJobs(5);
    expect(open.ok).toBe(true);
    expect(open.ok && open.value.map((job) => job.jobId)).toEqual([fresh.job_id]);
  });

  it("keeps working on everything a worker can actually move", async () => {
    const rows = (["preflight", "uploading", "reading", "structuring", "building_world"] as const)
      .map((state, index) => row(state, `2026-09-01T00:0${index}:00Z`, `cjob-${String(index).repeat(32)}`));
    install([...rows, row("ready", "2026-09-01T00:00:00Z", "cjob-" + "9".repeat(32))]);
    const open = await readOpenCompileJobs(10);
    expect(open.ok && open.value.map((job) => job.state))
      .toEqual(["preflight", "uploading", "reading", "structuring", "building_world"]);
  });
});

/*
  The other half of a job that could not finish: a deferral nobody could see.

  The ledger is written by a trigger on the job row, and the trigger writes nothing for an update
  that changes no column it watches. A deferral changes none of them, so the loop it belongs to
  left no history at all -- and a history with nothing in it is also a history nothing can count.
*/
describe("a deferral on the event ledger", () => {
  const JOB = "cjob-" + "a".repeat(32);

  function ledger() {
    const posted: Array<Record<string, unknown>> = [];
    const queries: URLSearchParams[] = [];
    const rows: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(typeof url === "string" ? url : url.toString());
      if (!parsed.pathname.endsWith("/foundation_compile_job_events")) {
        return new Response("[]", { status: 404 });
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        posted.push(body);
        rows.push(body);
        return new Response("", { status: 201 });
      }
      queries.push(parsed.searchParams);
      // `detail=cs.{...}` is jsonb containment; modelled here as a subset check on the object.
      const contained = JSON.parse(
        String(parsed.searchParams.get("detail") ?? "cs.{}").slice(3),
      ) as Record<string, unknown>;
      const limit = Number(parsed.searchParams.get("limit") ?? "32");
      const matched = rows
        .filter((entry) => {
          const detail = (entry.detail ?? {}) as Record<string, unknown>;
          return Object.entries(contained).every(([key, value]) => detail[key] === value);
        })
        .slice(0, limit)
        .map((_row, index) => ({ event_sequence: index + 1 }));
      return new Response(JSON.stringify(matched), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    return { posted, queries };
  }

  const deferral = (attempt: number) => ({
    job: {
      jobId: JOB,
      workspaceKey: WORKSPACE,
      documentIds: ["doc-a", "doc-b"],
      state: "structuring" as CompileState,
      collectionId: null,
      errorCode: null,
      blocked: [],
      blockedResolution: null,
      documentsTotal: 2,
      documentsReady: 2,
      corpusId: null,
      batchIndex: null,
      batchCount: null,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      settledAt: null,
    },
    state: "structuring" as CompileState,
    documentsReady: 2,
    blocked: [],
    reason: "READING_LISTING_DISAGREEMENT",
    attempt,
  });

  it("writes a row the table's own check constraint allows", async () => {
    /*
      No invented vocabulary. The eight event types are fixed by migration 0038 until a migration
      widens them, and this lane writes none, so the row read here is the constraint itself.
    */
    const migration = readFileSync(
      new URL("../../supabase/migrations/0038_foundation_compile_jobs.sql", import.meta.url),
      "utf8",
    );
    const allowed = /event_type text not null check \(event_type in \(([^)]*)\)\)/
      .exec(migration)?.[1]
      .split(",")
      .map((value) => value.trim().replace(/'/g, ""));
    expect(allowed).toBeTruthy();

    const { posted } = ledger();
    const written = await recordCompileJobDeferral(deferral(3));

    expect(written.ok).toBe(true);
    expect(posted).toHaveLength(1);
    expect(allowed).toContain(posted[0].event_type);
    expect(posted[0].state).toBe("structuring");
    /*
      The trigger's own `detail` keys, plus the two this row exists to carry. The workspace
      rebuilds its panel from every frame, so a deferral that dropped `blocked` would blank the
      list of documents the customer has already been shown.
    */
    expect(posted[0].detail).toEqual({
      collectionId: null,
      blocked: [],
      blockedResolution: null,
      reason: "READING_LISTING_DISAGREEMENT",
      attempt: 3,
    });
    /*
      And no `error_code`: that field is copied onto the panel too, so a code here would report a
      failure on a compile that is still running. A deferral is a turn that did nothing.
    */
    expect(posted[0].error_code).toBeUndefined();
  });

  it("counts back what it wrote, and stops counting at the bound it was asked about", async () => {
    ledger();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await recordCompileJobDeferral(deferral(attempt));
    }
    const all = await countCompileJobDeferrals(WORKSPACE, JOB, "READING_LISTING_DISAGREEMENT");
    expect(all.ok && all.value).toBe(4);

    const capped = await countCompileJobDeferrals(WORKSPACE, JOB, "READING_LISTING_DISAGREEMENT", 3);
    expect(capped.ok && capped.value).toBe(3);

    const other = await countCompileJobDeferrals(WORKSPACE, JOB, "SOMETHING_ELSE");
    expect(other.ok && other.value).toBe(0);
  });

  it("refuses to put anything but a machine code in the ledger", async () => {
    const { posted } = ledger();
    const written = await recordCompileJobDeferral({ ...deferral(1), reason: "waiting on reading" });
    expect(written).toEqual({ ok: false, code: "COMPILE_JOB_SCOPE_INVALID" });
    expect(posted).toHaveLength(0);
  });
});

describe("resting and terminal are two different lists that must stay in step", () => {
  it("excludes every resting state, not only the one that was found", () => {
    for (const state of RESTING_COMPILE_STATES) {
      expect(SCHEDULER_EXCLUDED_STATES).toContain(state);
      expect(isRestingCompileState(state)).toBe(true);
    }
  });

  it("excludes every terminal state", () => {
    for (const state of TERMINAL_COMPILE_STATES) {
      expect(SCHEDULER_EXCLUDED_STATES).toContain(state);
    }
  });

  it("keeps a resting state out of the terminal list, because the compile is not finished", () => {
    // A resting job still appears in the customer's own list; conflating the two would settle it.
    for (const state of RESTING_COMPILE_STATES) {
      expect(TERMINAL_COMPILE_STATES).not.toContain(state);
    }
    expect(SCHEDULER_EXCLUDED_STATES).toHaveLength(
      TERMINAL_COMPILE_STATES.length + RESTING_COMPILE_STATES.length,
    );
  });
});

/*
  Blueprint 2026-09-08 §32, S-20: a paid workspace's share of the worker pool.

  The trial cap has been in `lib/self-service-trial.ts` since self-service shipped, and it is
  applied only when `accessSource === "trial"` (app/api/compile-jobs/route.ts). A paid workspace
  therefore had no concurrency limit of any kind: a credential in a retry loop, or a corpus split
  into more parts than the pool has workers, could occupy every worker in the deployment.

  The three things worth getting wrong here, each with a test:

    * counting the wrong set -- a job resting on a person occupies no worker, and counting it
      would let five parked reviews lock a paying customer out of compiling,
    * refusing a retry -- at-least-once delivery means the same enqueue arrives twice, and the
      second one must find its own row rather than a 429,
    * failing open -- a read that does not come back is not evidence that there is room.
*/
describe("the paid workspace's runnable-compile cap", () => {
  const WORKSPACE = "pilot-captest1";
  const USER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  function capacityFake(open: Array<{ state: CompileState; idempotency_key?: string }>) {
    const enqueued: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(typeof url === "string" ? url : url.toString());
      if (parsed.pathname.endsWith("/rpc/enqueue_foundation_compile_job")) {
        enqueued.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify([{ job_id: `cjob-${"7".repeat(32)}`, state: "draft", created: true }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (!parsed.pathname.endsWith("/foundation_compile_jobs")) return new Response("[]", { status: 404 });
      expect(parsed.searchParams.get("workspace_key")).toBe(`eq.${WORKSPACE}`);
      const filter = parsed.searchParams.get("state") ?? "";
      const excluded = /^not\.in\.\(([^)]*)\)$/.exec(filter);
      if (!excluded) throw new Error(`unsupported state filter: ${filter}`);
      const denied = excluded[1]!.split(",").map((value) => value.trim());
      const matched = open
        .filter((entry) => !denied.includes(entry.state))
        .slice(0, Number(parsed.searchParams.get("limit") ?? "20"));
      return new Response(JSON.stringify(matched), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    return enqueued;
  }

  function enqueue(documentIds = ["11111111-1111-4111-8111-111111111111"]) {
    return enqueueCompileJob({ workspaceKey: WORKSPACE, createdByUserId: USER, documentIds });
  }

  it("enqueues while the workspace is under its limit", async () => {
    const enqueued = capacityFake(Array.from({ length: WORKSPACE_RUNNABLE_COMPILE_LIMIT - 1 },
      () => ({ state: "reading" as CompileState })));
    const result = await enqueue();
    expect(result.ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("refuses the enqueue at the limit rather than accepting work it cannot run", async () => {
    const enqueued = capacityFake(Array.from({ length: WORKSPACE_RUNNABLE_COMPILE_LIMIT },
      () => ({ state: "reading" as CompileState })));
    const result = await enqueue();
    expect(result).toEqual({ ok: false, code: "COMPILE_JOB_WORKSPACE_LIMIT_REACHED" });
    // Refused before the write, not after it: no row was created and then rejected.
    expect(enqueued).toHaveLength(0);
  });

  it("does not count a job that is resting on a person or already settled", async () => {
    const enqueued = capacityFake([
      ...Array.from({ length: WORKSPACE_RUNNABLE_COMPILE_LIMIT }, () => ({ state: "review_required" as CompileState })),
      ...Array.from({ length: WORKSPACE_RUNNABLE_COMPILE_LIMIT }, () => ({ state: "ready" as CompileState })),
      ...Array.from({ length: WORKSPACE_RUNNABLE_COMPILE_LIMIT }, () => ({ state: "cancelled" as CompileState })),
    ]);
    expect((await enqueue()).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("lets a retry of an already-enqueued compile through at the limit", async () => {
    const documentIds = ["22222222-2222-4222-8222-222222222222"];
    const key = compileIdempotencyKey(WORKSPACE, documentIds);
    const enqueued = capacityFake([
      { state: "reading", idempotency_key: key },
      ...Array.from({ length: WORKSPACE_RUNNABLE_COMPILE_LIMIT - 1 }, () => ({ state: "reading" as CompileState })),
    ]);
    expect((await enqueue(documentIds)).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("fails closed when the count cannot be read, rather than admitting one more compile", async () => {
    const enqueued: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const parsed = new URL(typeof url === "string" ? url : url.toString());
      if (parsed.pathname.endsWith("/foundation_compile_jobs")) return new Response("nope", { status: 500 });
      enqueued.push(parsed.pathname);
      return new Response("[]", { status: 200 });
    });
    expect(await enqueue()).toEqual({ ok: false, code: "COMPILE_JOB_STORE_READ_FAILED" });
    expect(enqueued).toHaveLength(0);
  });

  it("fails closed when the count comes back as something other than rows", async () => {
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const parsed = new URL(typeof url === "string" ? url : url.toString());
      if (parsed.pathname.endsWith("/foundation_compile_jobs")) {
        return new Response(JSON.stringify({ message: "not an array" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("[]", { status: 200 });
    });
    expect(await enqueue()).toEqual({ ok: false, code: "COMPILE_JOB_STORE_READ_FAILED" });
  });
});
