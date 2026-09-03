import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  The property this branch was asked to establish: a compile does not need the tab.

  It is a source-shaped test because the thing being asserted is architectural. There is no
  runtime assertion that can distinguish "the browser polled until everything was read and
  then called the compiler" from "the browser started a job and watched" -- both produce a
  World. The difference only shows up when the tab closes, which is exactly the case no unit
  test observes and every customer eventually does.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const workspace = read("app/workspace/page.tsx");

describe("compile orchestration lives on the server", () => {
  it("no longer keeps the old poll-then-compile loop", () => {
    expect(workspace).not.toContain("waitForOcrAndCompile");
    // The specific shape of the old loop: a fifteen minute browser deadline.
    expect(workspace).not.toContain("15 * 60 * 1000");
  });

  it("starts an upload's compile as a durable job", () => {
    expect(workspace).toContain("await startDurableCompile(ids)");
    expect(workspace).toContain('fetch("/api/compile-jobs"');
  });

  it("compiles a hand-picked selection through the same durable path", () => {
    const selection = workspace.slice(
      workspace.indexOf("const compileSelectedDocuments"),
      workspace.indexOf("const downloadCollection"),
    );
    expect(selection).toContain("startDurableCompile(documentIds)");
    expect(selection).not.toContain("/api/collections/compile");
  });

  /*
    One exception, and it is deliberate.

    `recompileWithCore` re-runs a compile that already happened, against whatever Core is
    current. The durable path deduplicates on the document set, which is right for a customer
    pressing Compile twice and wrong for this -- so it calls the primitive directly.
  */
  it("keeps the deliberate re-run on the synchronous primitive", () => {
    const recompile = workspace.slice(
      workspace.indexOf("const recompileWithCore"),
      workspace.indexOf("const compileSelectedDocuments"),
    );
    expect(recompile).toContain("/api/collections/compile");
  });

  it("resumes a run the tab did not start", () => {
    // Two handles: the URL for a reload, and the server's own list for a tab that was closed
    // or a different machine entirely. The second is the one that needed durable state.
    expect(workspace).toContain('params.get("job")');
    expect(workspace).toContain("json.jobs?.find");
  });
});

describe("the compile job API", () => {
  const create = read("app/api/compile-jobs/route.ts");
  const events = read("app/api/compile-jobs/[jobId]/events/route.ts");
  const cancel = read("app/api/compile-jobs/[jobId]/cancel/route.ts");
  const blockers = read("app/api/compile-jobs/[jobId]/blockers/route.ts");

  it("accepts rather than completes", () => {
    expect(create).toContain("status: 202");
    expect(create).toContain("COMPILE_JOB_ACCEPTED");
  });

  it("enforces the same document limit as the compiler", () => {
    expect(create).toContain("judgeCompileSet(documentIds.length)");
  });

  it("replays from Last-Event-ID", () => {
    expect(events).toContain('request.headers.get("last-event-id")');
    expect(events).toContain("text/event-stream");
    // Frames carry the persisted sequence, which is what makes the replay exact.
    expect(events).toContain("frame(event.sequence");
  });

  it("offers all four answers to a partial failure", () => {
    expect(blockers).toContain("BLOCKER_RESOLUTIONS");
    // The refusal is the database's word, forwarded rather than re-derived here -- the rule
    // about security blockers is enforced where every writer can be seen, not in a route.
    expect(blockers).toContain("resolved.value.refusal");
    expect(cancel).toContain('state: "cancelled"');
  });

  it("says something a person can act on when a safety check stops a file", () => {
    expect(workspace).toContain("SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL");
    const panel = read("components/compile-job-panel.tsx");
    expect(panel).toContain("Continue with {clean}");
    expect(panel).toContain("Remove the {job.blocked.length} blocked");
    expect(panel).toContain("Retry what can be retried");
    // The one-click continue is unavailable while a security blocker is present.
    expect(panel).toContain("disabled={busy || security.length > 0}");
  });

  it("will not destroy a World to honour a late cancel", () => {
    expect(cancel).toContain("COMPILE_JOB_ALREADY_SETTLED");
  });
});

describe("something other than a browser turns the crank", () => {
  it("advances compiles from the scheduled worker", () => {
    const worker = read("app/api/internal/jobs/run/route.ts");
    expect(worker).toContain("runCompileJobBatch()");
    expect(worker).toContain("authorized(request)");
  });

  it("is actually scheduled", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons?: Array<{ path: string }> };
    expect(vercel.crons?.some((cron) => cron.path === "/api/internal/jobs/run")).toBe(true);
  });

  it("does not require the viewer's nudge to make progress", () => {
    const events = read("app/api/compile-jobs/[jobId]/events/route.ts");
    // The nudge exists for latency only, and the comment saying so is load-bearing: someone
    // reading this later must not conclude the stream is part of the pipeline.
    expect(events).toContain("Remove it and the compile still finishes");
  });
});
