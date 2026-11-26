import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  cjob-157f2f23 (2026-11-05): the stream sent seq 158 `failed` and then seq 159 `structuring` from
  the same batch, and the workspace stayed on "Structuring what was read." It also ran compile
  turns in-process, so a 60 s stream took the Core lease and died with it. This route reads.
*/
const { authorize, readJob, readEvents, signer, listObjects } = vi.hoisted(() => ({
  authorize: vi.fn(),
  readJob: vi.fn(),
  readEvents: vi.fn(),
  signer: vi.fn(),
  listObjects: vi.fn(),
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: signer }));
vi.mock("@/lib/r2-objects", () => ({ listImmutableWorkspaceObjects: listObjects }));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/compile-job-store", () => ({
  isTerminalCompileState: (state: string) => ["ready", "failed", "cancelled"].includes(state),
  readCompileJob: readJob,
  readCompileJobEvents: readEvents,
}));
const turn = vi.fn();
vi.mock("@/lib/compile-job-worker", () => ({ runCompileJobTurn: turn, runCompileJobBatch: turn }));

import { GET } from "@/app/api/compile-jobs/[jobId]/events/route";

const JOB = "cjob-157f2f236a3efc6984585b399852c60d";
const event = (sequence: number, state: string) => ({
  sequence, jobId: JOB, eventType: state === "failed" ? "failed" : "state_changed", state,
  documentsTotal: 1, documentsReady: 1, errorCode: state === "failed" ? "JSON_TOO_LARGE" : null, detail: {},
  occurredAt: "2026-11-05T07:16:48.325Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({ ok: true, principal: { workspaceKey: "pilot", workspaceRole: "owner" } });
  readJob.mockResolvedValue({ ok: true, value: { jobId: JOB, state: "structuring" } });
  signer.mockReturnValue(null);
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

  describe("sources frame (stage per source, read-only)", () => {
    const VERSION = "a".repeat(32);
    const key = (doc: string, name: string) => `immutable/pilot/pilot/${doc}/${VERSION}/${name}`;
    const open = () => {
      readJob.mockResolvedValue({ ok: true, value: { jobId: JOB, state: "reading", documentIds: ["doc_a", "doc_b"], blocked: [] } });
      // First read: nothing new. Second: the job settles, so the stream ends and the test is not slow.
      readEvents.mockResolvedValueOnce({ ok: true, value: [] })
        .mockResolvedValue({ ok: true, value: [event(200, "failed")] });
    };
    const get = () => GET(new Request(`https://tavonel.test/api/compile-jobs/${JOB}/events?after=199`), { params: Promise.resolve({ jobId: JOB }) });

    it("sends the stage of each source without an id, so the replay cursor does not move", async () => {
      open();
      signer.mockReturnValue({ bucket: "tavonel-saas-foundation-quarantine" });
      listObjects.mockResolvedValue({ ok: true, objects: [
        { key: key("doc_a", "sanitized.pdf"), size: 10, lastModified: new Date().toISOString() },
        { key: key("doc_a", "cdr-receipt.json"), size: 10 },
      ] });
      const body = await (await get()).text();
      const frame = body.split("\n\n").find((part) => part.startsWith("event: sources"));
      expect(frame).toBeDefined();
      expect(frame).not.toContain("id:");
      const payload = JSON.parse(frame!.split("data: ")[1]);
      expect(payload.stages).toEqual([{ documentId: "doc_a", stage: "waking" }, { documentId: "doc_b", stage: "queued" }]);
      expect(body).toContain("id: 200\nevent: failed\n");
      expect(listObjects).toHaveBeenCalledWith({ bucket: "tavonel-saas-foundation-quarantine" }, "pilot");
      expect(turn).not.toHaveBeenCalled();
    });

    it("stays silent, and still streams the durable events, when the bucket cannot be read", async () => {
      open();
      signer.mockReturnValue({ bucket: "tavonel-saas-foundation-quarantine" });
      for (const failure of [() => ({ ok: false, code: "LIST_FAILED" }), () => { throw new Error("r2 down"); }]) {
        readEvents.mockReset();
        open();
        listObjects.mockReset();
        listObjects.mockImplementation(async () => failure());
        const response = await get();
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).not.toContain("event: sources");
        expect(body).toContain("id: 200\nevent: failed\n");
      }
    });

    it("is not held up by a bucket listing that never answers: the durable events and the heartbeat still go out", async () => {
      open();
      signer.mockReturnValue({ bucket: "tavonel-saas-foundation-quarantine" });
      listObjects.mockImplementation(() => new Promise(() => undefined));
      const started = Date.now();
      const response = await get();
      const body = await response.text();
      // The loop awaited the listing before; with it hung the stream could not reach the settled event at all.
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(body).toContain(": ping\n\n");
      expect(body).toContain("id: 200\nevent: failed\n");
      expect(body).toContain('event: done\ndata: {"settled":true,"cursor":200}');
      expect(body).not.toContain("event: sources");
      expect(listObjects).toHaveBeenCalledTimes(1);
      expect(turn).not.toHaveBeenCalled();
    });

    it("does not look at storage for a job that has already settled", async () => {
      readJob.mockResolvedValue({ ok: true, value: { jobId: JOB, state: "ready", documentIds: ["doc_a"], blocked: [] } });
      readEvents.mockResolvedValue({ ok: true, value: [event(300, "ready")] });
      signer.mockReturnValue({ bucket: "tavonel-saas-foundation-quarantine" });
      await (await get()).text();
      expect(listObjects).not.toHaveBeenCalled();
    });
  });
});
