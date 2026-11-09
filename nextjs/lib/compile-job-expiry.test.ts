import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_DECISION_EXPIRY_MS, expireBlockedCompileJobs } from "./compile-job-worker";
import { failureSentence } from "./workspace-failure-copy";

/*
  F2 (COMPILE-RELIABILITY-20261109 R2). A job waiting on the customer's blocker decision had no
  end: the scheduler does not hand it out and nothing else reads it, so five owner-test jobs sat in
  `reading` for weeks. The cron now settles one whose row has not moved for seven days.

  The fake below models the PostgREST filters the store sends (not.in, neq, is.null, lt, and the
  compare-and-set PATCH), so the assertions are about which rows change, not how a query is spelled.
*/

type Row = {
  job_id: string; workspace_key: string; document_ids: string[]; state: string; collection_id: null;
  error_code: string | null; blocked: unknown[]; blocked_resolution: string | null; documents_total: number;
  documents_ready: number; corpus_id: null; batch_index: null; batch_count: null; created_at: string;
  updated_at: string; settled_at: string | null;
};

const NOW = Date.parse("2026-11-20T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;
const BLOCKER = { documentId: "doc-a", kind: "input", reason: "READING_NEEDS_OPERATOR_REVIEW" };

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    job_id: `cjob-${id.padStart(32, "0")}`, workspace_key: "pilot-alpha", document_ids: ["doc-a"], state: "reading",
    collection_id: null, error_code: null, blocked: [BLOCKER], blocked_resolution: null, documents_total: 1,
    documents_ready: 0, corpus_id: null, batch_index: null, batch_count: null,
    created_at: new Date(NOW - 30 * DAY).toISOString(), updated_at: new Date(NOW - 8 * DAY).toISOString(),
    settled_at: null, ...overrides,
  };
}

let rows: Row[] = [];
const patches: Array<{ query: URLSearchParams; body: Record<string, unknown> }> = [];
const elsewhere: string[] = [];
let refuseReads = false;

function matches(item: Row, query: URLSearchParams) {
  for (const [key, condition] of query) {
    if (["select", "order", "limit"].includes(key)) continue;
    const value = (item as Record<string, unknown>)[key];
    if (condition.startsWith("not.in.(")) {
      if (condition.slice(8, -1).split(",").includes(String(value))) return false;
    } else if (condition === "neq.[]") {
      if (Array.isArray(value) && value.length === 0) return false;
    } else if (condition === "is.null") {
      if (value !== null) return false;
    } else if (condition.startsWith("lt.")) {
      if (!(Date.parse(String(value)) < Date.parse(condition.slice(3)))) return false;
    } else if (condition.startsWith("eq.")) {
      if (String(value) !== condition.slice(3)) return false;
    } else {
      throw new Error(`unmodelled filter ${key}=${condition}`);
    }
  }
  return true;
}

async function fakeStore(input: string | URL, init?: RequestInit) {
  const url = new URL(String(input));
  if (!url.pathname.endsWith("/foundation_compile_jobs")) {
    elsewhere.push(url.toString());
    return new Response("unexpected", { status: 599 });
  }
  const query = url.searchParams;
  if (init?.method === "PATCH") {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    patches.push({ query, body });
    const hit = rows.filter((item) => matches(item, query));
    for (const item of hit) Object.assign(item, body, { updated_at: new Date(NOW).toISOString() });
    return Response.json(hit.map((item) => ({ job_id: item.job_id })));
  }
  if (refuseReads) return new Response("{}", { status: 500 });
  return Response.json(rows.filter((item) => matches(item, query)).sort((a, b) => a.updated_at.localeCompare(b.updated_at)));
}

beforeEach(() => {
  rows = [];
  patches.length = 0;
  elsewhere.length = 0;
  refuseReads = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fakeStore);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a blocker decision nobody made", () => {
  it("settles a job blocked for eight days and leaves one blocked for one day alone", async () => {
    rows = [row("1"), row("2", { updated_at: new Date(NOW - 1 * DAY).toISOString() })];
    expect(await expireBlockedCompileJobs(NOW)).toEqual({ expired: 1, failed: 0 });
    expect(rows[0]).toMatchObject({ state: "failed", error_code: "BLOCKED_DECISION_EXPIRED", settled_at: new Date(NOW).toISOString() });
    expect(rows[1]).toMatchObject({ state: "reading", error_code: null, settled_at: null });
  });

  it("is idempotent: a second tick over the same rows changes nothing", async () => {
    rows = [row("1")];
    await expireBlockedCompileJobs(NOW);
    const after = structuredClone(rows);
    expect(await expireBlockedCompileJobs(NOW + 60_000)).toEqual({ expired: 0, failed: 0 });
    expect(rows).toEqual(after);
    expect(patches).toHaveLength(1);
  });

  it("is idempotent against a stale read too: the compare-and-set matches nothing the second time", async () => {
    rows = [row("1")];
    const stale = structuredClone(rows[0]!);
    await expireBlockedCompileJobs(NOW);
    // A second runner that read the row before the first one wrote it.
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) =>
      init?.method === "PATCH" ? fakeStore(input, init) : Response.json([stale]));
    expect(await expireBlockedCompileJobs(NOW)).toEqual({ expired: 0, failed: 0 });
    expect(rows[0]).toMatchObject({ state: "failed", error_code: "BLOCKED_DECISION_EXPIRED" });
  });

  it("loses to a customer who answered after the row was read", async () => {
    rows = [row("1")];
    const stale = structuredClone(rows[0]!);
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      if (init?.method !== "PATCH") return Response.json([stale]);
      // The customer chose "continue" between the cron's read and its write.
      Object.assign(rows[0]!, { blocked_resolution: "continue", updated_at: new Date(NOW - 1_000).toISOString() });
      return fakeStore(input, init);
    });
    expect(await expireBlockedCompileJobs(NOW)).toEqual({ expired: 0, failed: 0 });
    expect(rows[0]).toMatchObject({ state: "reading", blocked_resolution: "continue" });
  });

  it("does not touch a resolved job, a job without blockers, a review package or a settled job", async () => {
    rows = [
      row("1", { blocked_resolution: "continue" }),
      row("2", { blocked: [] }),
      row("3", { state: "review_required" }),
      row("4", { state: "cancelled", settled_at: new Date(NOW - 9 * DAY).toISOString() }),
    ];
    const before = structuredClone(rows);
    expect(await expireBlockedCompileJobs(NOW)).toEqual({ expired: 0, failed: 0 });
    expect(rows).toEqual(before);
  });

  it("scopes every write to the row's own workspace and job, and writes nothing but the job's state", async () => {
    rows = [row("1", { workspace_key: "pilot-beta" }), row("2")];
    await expireBlockedCompileJobs(NOW);
    expect(patches.map(({ query }) => [query.get("workspace_key"), query.get("job_id")])).toEqual([
      ["eq.pilot-beta", `eq.${rows[0]!.job_id}`],
      ["eq.pilot-alpha", `eq.${rows[1]!.job_id}`],
    ]);
    // No reservation, ledger or billing write happens here: a compile job holds no reservation.
    for (const { body } of patches) expect(Object.keys(body).sort()).toEqual(["error_code", "settled_at", "state"]);
    expect(elsewhere).toEqual([]);
  });

  it("settles the five stuck owner-test jobs quietly: one count line, no page per job", async () => {
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", "https://hooks.example.test/T/B/X");
    rows = ["1", "2", "3", "4", "5"].map((id) => row(id));
    expect(await expireBlockedCompileJobs(NOW)).toEqual({ expired: 5, failed: 0 });
    expect(elsewhere).toEqual([]);
    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0])))
      .toEqual({ event: "compile_blocked_expired", due: 5, expired: 5, failed: 0 });
  });

  it("settles nothing when the queue cannot be read, and says so", async () => {
    rows = [row("1")];
    refuseReads = true;
    expect(await expireBlockedCompileJobs(NOW)).toEqual({ expired: 0, failed: 0 });
    expect(rows[0]!.state).toBe("reading");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("compile_blocked_expiry_read_failed"));
  });

  it("counts a refused write as failed, not expired", async () => {
    rows = [row("1")];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) =>
      init?.method === "PATCH" ? new Response("{}", { status: 500 }) : fakeStore(input, init));
    expect(await expireBlockedCompileJobs(NOW)).toEqual({ expired: 0, failed: 1 });
    expect(rows[0]!.state).toBe("reading");
  });

  it("keeps the customer's sentence and the window in step", () => {
    expect(BLOCKED_DECISION_EXPIRY_MS).toBe(7 * DAY);
    expect(failureSentence("BLOCKED_DECISION_EXPIRED", 500)).toContain("7 days");
    expect(failureSentence("BLOCKED_DECISION_EXPIRED", 500)).not.toMatch(/;/);
  });
});
