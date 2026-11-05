import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  cjob-157f2f23 (2026-11-05): the stream sent seq 158 `failed` and then seq 159 `structuring` from
  the same batch, and the workspace stayed on "Structuring what was read." It also ran compile
  turns in-process, so a 60 s stream took the Core lease and died with it. This route reads.
*/
const { authorize, readJob, readEvents } = vi.hoisted(() => ({
  authorize: vi.fn(),
  readJob: vi.fn(),
  readEvents: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/compile-job-store", () => ({
  isTerminalCompileState: (state: string) => ["ready", "failed", "cancelled"].includes(state),
  readCompileJob: readJob,
  readCompileJobEvents: readEvents,
}));
const turn = vi.fn();
vi.mock("@/lib/compile-job-worker", () => ({ runCompileJobTurn: turn, runCompileJobBatch: turn }));

import { GET } from "./route";

const JOB = "cjob-157f2f236a3efc6984585b399852c60d";
const event = (sequence: number, state: string) => ({
  sequence, jobId: JOB, eventType: state === "failed" ? "failed" : "state_changed", state,
  documentsTotal: 1, documentsReady: 1, errorCode: state === "failed" ? "JSON_TOO_LARGE" : null, detail: {},
  occurredAt: "2026-11-05T07:16:48.325Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({ ok: true, principal: { workspaceKey: "pilot" } });
  readJob.mockResolvedValue({ ok: true, value: { jobId: JOB, state: "structuring" } });
});

describe("GET /api/compile-jobs/{jobId}/events", () => {
  it("stops at the first terminal frame and never runs a compile turn", async () => {
    readEvents.mockResolvedValue({ ok: true, value: [event(157, "structuring"), event(158, "failed"), event(159, "structuring")] });

    const response = await GET(new Request(`https://tavonel.test/api/compile-jobs/${JOB}/events?after=156`),
      { params: Promise.resolve({ jobId: JOB }) });
    const body = await response.text();

    expect(body).toContain("id: 157\n");
    expect(body).toContain("id: 158\nevent: failed\n");
    expect(body).not.toContain("id: 159");
    expect(body).toContain('event: done\ndata: {"settled":true,"cursor":158}');
    expect(readEvents).toHaveBeenCalledOnce();
    expect(turn).not.toHaveBeenCalled();
  });
});
