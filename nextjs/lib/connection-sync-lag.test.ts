import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeBacklog, describeImportScope, readSyncBacklog } from "@/components/connection-sync-status";
import { describeSyncLag, oauthConnectionAttention } from "@/components/connections-panel";

vi.mock("@/lib/developer-auth", () => ({
  requireFoundationSession: vi.fn(async () => ({
    ok: true,
    principal: { kind: "session", workspaceKey: "pilot-1234567890abcdef", userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1", scopes: [] },
  })),
}));

import { GET as readConnectionSync } from "../app/api/v1/oauth-connectors/connections/[id]/sync/route";

/*
  Audit I06: a connection is not up to date because its newest job succeeded.

  Three separate facts, each with its own way of being absent: the backlog behind the newest
  job, the lag since the last durable sync, and a withdrawn grant. Every one of them answers
  "nothing was reported" differently from "nothing is wrong", and that is what these hold.
*/

const CONNECTION = "22222222-2222-4222-8222-222222222222";

function syncRequest() {
  return new Request(`https://tavonel.com/api/v1/oauth-connectors/connections/${CONNECTION}/sync`);
}

function job(state: string, jobId: string) {
  return {
    job_id: jobId, job_type: "source_import", state, attempt: 1, items_seen: 8, items_done: 5,
    error_code: null, created_at: "2026-09-11T00:00:00.000Z", completed_at: null,
  };
}

describe("backlog reported by the sync route", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("counts every unfinished job, not only the newest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([
      job("succeeded", "a".repeat(8)),
      job("queued", "b".repeat(8)),
      job("queued", "c".repeat(8)),
      job("leased", "d".repeat(8)),
    ])));
    const response = await readConnectionSync(syncRequest(), { params: Promise.resolve({ id: CONNECTION }) });
    const body = await response.json() as { backlog: { queued: number; leased: number }; jobs: unknown[] };
    expect(response.status).toBe(200);
    expect(body.backlog).toMatchObject({ queued: 2, leased: 1 });
    expect(body.jobs).toHaveLength(4);
    expect(describeBacklog(readSyncBacklog(body.backlog)))
      .toBe("At least 3 imports not finished · 2 waiting for a worker · 1 being read now. 4 recent imports read, up to 50 requested; older or other imports were not confirmed.");
  });

  it("fails closed with the store's code rather than reporting an empty backlog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const response = await readConnectionSync(syncRequest(), { params: Promise.resolve({ id: CONNECTION }) });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "JOB_STORE_READ_FAILED" });
  });

  it("rejects a connection id that is not a uuid", async () => {
    const response = await readConnectionSync(syncRequest(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "OAUTH_CONNECTION_ID_INVALID" });
  });
});

/*
  Coverage of the backlog read (UX11/K23). The route asks for at most fifty jobs. Neither a full
  read nor a short one proves there is nothing else still waiting: a short read is only what the
  store returned, and nothing verifies the store has no lower row cap. Every row below is an
  offline test fixture answered by a stubbed fetch: no provider is called and no import is posted.
*/
describe("how much of the backlog the sync route read", () => {
  type Body = { backlog: Record<string, unknown>; jobs: Array<{ state: string }> };
  let store: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function read(rows: ReturnType<typeof job>[]) {
    store = vi.fn(async () => Response.json(rows));
    vi.stubGlobal("fetch", store);
    const response = await readConnectionSync(syncRequest(), { params: Promise.resolve({ id: CONNECTION }) });
    expect(response.status).toBe(200);
    // The window is still the store's fifty: coverage is reported, not bought with a bigger page.
    expect(String(store.mock.calls[0][0])).toContain("limit=50");
    const body = await response.json() as Body;
    return { body, lines: describeImportScope(body.jobs[0].state, readSyncBacklog(body.backlog)) };
  }

  function fixtureRows(count: number, unfinished: Record<number, string> = {}) {
    return Array.from({ length: count }, (_, index) =>
      job(unfinished[index] ?? (index % 2 ? "failed" : "succeeded"), `offline-fixture-${index}`));
  }

  it("offline fixture: a short read with work waiting is still a lower bound over the rows returned", async () => {
    const { body, lines } = await read([job("succeeded", "offline-a"), job("queued", "offline-b"), job("leased", "offline-c")]);
    expect(body.backlog).toEqual({ queued: 1, leased: 1, window: 50, rowsRead: 3, coverage: "recent_window" });
    expect(lines).toEqual([
      "At least 2 imports not finished · 1 waiting for a worker · 1 being read now. 3 recent imports read, up to 50 requested; older or other imports were not confirmed.",
    ]);
    // Three rows came back; the copy must not say fifty were read.
    expect(lines.join(" ")).not.toContain("50 recent imports read");
  });

  it("offline fixture: a short read with nothing waiting does not say the connection is finished", async () => {
    const { body, lines } = await read(fixtureRows(7));
    expect(body.backlog).toEqual({ queued: 0, leased: 0, window: 50, rowsRead: 7, coverage: "recent_window" });
    expect(lines).toEqual([
      "No import is waiting or being read among the 7 recent imports read (up to 50 requested). Older or other imports were not confirmed, so this does not show that every import is finished.",
      "The latest import finished. Check the workspace for processing and review results.",
    ]);
    expect(lines.join(" ")).not.toContain("Import is finished");
  });

  it("offline fixture: fifty finished jobs say nothing about older ones", async () => {
    const { body, lines } = await read(fixtureRows(50));
    expect(body.backlog).toEqual({ queued: 0, leased: 0, window: 50, rowsRead: 50, coverage: "recent_window" });
    expect(body.jobs).toHaveLength(10);
    expect(lines).toEqual([
      "No import is waiting or being read among the 50 recent imports read (up to 50 requested). Older or other imports were not confirmed, so this does not show that every import is finished.",
      "The latest import finished. Check the workspace for processing and review results.",
    ]);
    expect(lines.join(" ")).not.toContain("Import is finished");
  });

  it("offline fixture: unfinished jobs in a full window are a lower bound", async () => {
    const { body, lines } = await read(fixtureRows(50, { 12: "queued", 30: "queued", 49: "leased" }));
    expect(body.backlog).toEqual({ queued: 2, leased: 1, window: 50, rowsRead: 50, coverage: "recent_window" });
    // The newest job succeeded, but three imports are known to be unfinished, so no "finished" line.
    expect(lines).toEqual([
      "At least 3 imports not finished · 2 waiting for a worker · 1 being read now. 50 recent imports read, up to 50 requested; older or other imports were not confirmed.",
    ]);
  });

  it("offline fixture: the same body without its coverage, or with an earlier route's \"complete\", is unknown scope", async () => {
    const { body } = await read(fixtureRows(3));
    const unconfirmed = [
      "No unfinished import among the imports read. How many imports were read could not be confirmed. This does not show that every import is finished.",
      "The latest import finished. Check the workspace for processing and review results.",
    ];
    const countsOnly = { queued: body.backlog.queued, leased: body.backlog.leased, window: body.backlog.window };
    expect(describeImportScope(body.jobs[0].state, readSyncBacklog(countsOnly))).toEqual(unconfirmed);
    expect(describeImportScope(body.jobs[0].state, readSyncBacklog({ ...body.backlog, coverage: "complete" }))).toEqual(unconfirmed);
  });
});

describe("reading a backlog the client did not get", () => {
  it.each([
    ["absent", undefined],
    ["null", null],
    ["a number", 3],
    ["missing leased", { queued: 2 }],
    ["a float", { queued: 1.5, leased: 0 }],
    ["negative", { queued: -1, leased: 0 }],
  ])("refuses %s instead of showing zero waiting", (_label, value) => {
    expect(readSyncBacklog(value)).toBeNull();
    expect(describeBacklog(readSyncBacklog(value))).toBeNull();
  });

  it("does not stay silent about an empty count it cannot prove covers every import", () => {
    expect(describeBacklog(readSyncBacklog({ queued: 0, leased: 0, window: 50, rowsRead: 3, coverage: "complete" })))
      .toBe("No unfinished import among the imports read. How many imports were read could not be confirmed. This does not show that every import is finished.");
  });

  it("says the other imports were not counted when no backlog arrived", () => {
    expect(describeImportScope("succeeded", null)).toEqual([
      "Other imports for this connection could not be counted, so this does not show whether any are still waiting.",
      "The latest import finished. Check the workspace for processing and review results.",
    ]);
  });

  it.each([
    ["no coverage", { queued: 0, leased: 0, window: 50, rowsRead: 3 }],
    ["an unknown coverage", { queued: 0, leased: 0, window: 50, rowsRead: 3, coverage: "all" }],
    ["complete with a full window", { queued: 0, leased: 0, window: 50, rowsRead: 50, coverage: "complete" }],
    ["complete without rowsRead", { queued: 0, leased: 0, window: 50, coverage: "complete" }],
    ["complete without a window", { queued: 0, leased: 0, rowsRead: 3, coverage: "complete" }],
    ["recent without a window", { queued: 0, leased: 0, rowsRead: 50, coverage: "recent_window" }],
    ["complete over a short read (an earlier route's unproven marker)", { queued: 0, leased: 0, window: 50, rowsRead: 3, coverage: "complete" }],
    ["recent without rowsRead", { queued: 0, leased: 0, window: 50, coverage: "recent_window" }],
    ["recent with more rows read than the window", { queued: 0, leased: 0, window: 50, rowsRead: 51, coverage: "recent_window" }],
    ["recent with no rows read", { queued: 0, leased: 0, window: 50, rowsRead: 0, coverage: "recent_window" }],
  ])("keeps %s as unknown coverage instead of a finished connection", (_label, value) => {
    const backlog = readSyncBacklog(value);
    expect(backlog?.coverage).toBe("unknown");
    expect(describeImportScope("succeeded", backlog)).toEqual([
      "No unfinished import among the imports read. How many imports were read could not be confirmed. This does not show that every import is finished.",
      "The latest import finished. Check the workspace for processing and review results.",
    ]);
  });

  it("keeps known counts from an unconfirmed read as a lower bound", () => {
    expect(describeBacklog(readSyncBacklog({ queued: 2, leased: 0 })))
      .toBe("At least 2 imports not finished · 2 waiting for a worker · 0 being read now. How many imports were read could not be confirmed.");
  });
});

describe("lag since the last durable sync", () => {
  const now = Date.parse("2026-09-11T12:00:00.000Z");

  it("prints the timestamp and how long ago it was", () => {
    expect(describeSyncLag("2026-09-11T09:00:00.000Z", now))
      .toBe("Last durable sync 11 Sept 2026, 09:00 UTC · 3 h 0 min ago");
    expect(describeSyncLag("2026-09-08T12:00:00.000Z", now))
      .toBe("Last durable sync 08 Sept 2026, 12:00 UTC · 3 d 0 h ago");
  });

  it("says no sync has completed rather than implying one just did", () => {
    expect(describeSyncLag(null, now)).toBe("No durable sync has completed yet");
  });

  it("refuses an unparseable timestamp instead of rendering an invalid date", () => {
    expect(describeSyncLag("whenever", now)).toBe("Last durable sync time could not be read");
  });
});

describe("a withdrawn grant", () => {
  it("is the one status that gets its own state and a resolving action", () => {
    const attention = oauthConnectionAttention("reauthorization_required");
    expect(attention).not.toBeNull();
    expect(attention?.label).toBe("access withdrawn");
    expect(attention?.importDisabled).toBe(true);
    // The action has to be the one the code can actually complete: re-authorizing the same
    // account while the row exists is refused by unique (workspace, provider, account).
    expect(attention?.notice).toContain("Disconnect this connection, then connect the same account again");
    expect(attention?.action).toContain("Disconnect");
  });

  it.each(["active", "paused", "error", "revoked"] as const)("leaves %s to the per-job recovery advice", (status) => {
    expect(oauthConnectionAttention(status)).toBeNull();
  });
});
