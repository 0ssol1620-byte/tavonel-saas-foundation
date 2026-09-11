import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeBacklog, readSyncBacklog } from "@/components/connection-sync-status";
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
      .toBe("3 imports not finished · 2 waiting for a worker · 1 being read now");
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

  it("says nothing when the backlog is genuinely empty", () => {
    expect(describeBacklog({ queued: 0, leased: 0 })).toBeNull();
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
