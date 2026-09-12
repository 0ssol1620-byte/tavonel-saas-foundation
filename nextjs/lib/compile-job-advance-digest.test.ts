import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceCompileJob } from "./compile-job-store";

/*
  The two halves of the deploy-order fallback that live in the store rather than in the worker.

  `lib/compile-job-worker.test.ts` holds the behaviour -- retry once, log the stable message,
  keep the queue moving -- against a mocked `advanceCompileJob`. It cannot see the request body,
  and the body is where this actually succeeds or fails: a retry that names the ninth argument
  with a `null` is the same call PostgREST could not resolve the first time, so the retry has to
  omit the argument, and the first failure has to be distinguishable from any other 404.

  Release order for the 2026-09-11 migrations is apply-then-deploy
  (`docs/runbooks/RELEASE_ORDER.md`). This is what keeps the reverse survivable.
*/

const JOB = "cjob-" + "a".repeat(32);
const WORKSPACE = "pilot-alpha";
const DIGEST = `sha256:${"b".repeat(64)}`;

let bodies: Array<Record<string, unknown>>;

function respond(status: number, payload: unknown) {
  bodies = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return Response.json(payload, { status });
  }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("advanceCompileJob and the ninth argument", () => {
  it("names the digest when it has one", async () => {
    respond(200, [{ job_id: JOB, state: "building_world", changed: true }]);
    const result = await advanceCompileJob({
      workspaceKey: WORKSPACE, jobId: JOB, state: "building_world", candidateManifestDigest: DIGEST,
    });
    expect(result).toEqual({ ok: true, value: { state: "building_world", changed: true } });
    expect(bodies[0].p_candidate_manifest_digest).toBe(DIGEST);
  });

  it("omits the argument entirely when the caller passes none", async () => {
    respond(200, [{ job_id: JOB, state: "ready", changed: true }]);
    await advanceCompileJob({ workspaceKey: WORKSPACE, jobId: JOB, state: "ready" });
    // `in`, not a value check: a `null` here would still ask for the nine-parameter function and
    // would still answer PGRST202 on a database that has not applied 20260911120200.
    expect("p_candidate_manifest_digest" in bodies[0]).toBe(false);
    // The eight arguments the deployed function does have are all still sent.
    expect(Object.keys(bodies[0])).toEqual([
      "p_job_id", "p_workspace_key", "p_state", "p_documents_ready",
      "p_collection_id", "p_error_code", "p_blocked", "p_queue_job_id",
    ]);
  });

  it("reports PGRST202 as its own code, not as a write failure", async () => {
    respond(404, { code: "PGRST202", message: "Could not find the function" });
    const result = await advanceCompileJob({
      workspaceKey: WORKSPACE, jobId: JOB, state: "building_world", candidateManifestDigest: DIGEST,
    });
    expect(result).toEqual({ ok: false, code: "COMPILE_JOB_RPC_UNDEFINED" });
  });

  it("keeps every other 404 a write failure", async () => {
    respond(404, { code: "PGRST116", message: "no rows" });
    const result = await advanceCompileJob({ workspaceKey: WORKSPACE, jobId: JOB, state: "ready" });
    expect(result).toEqual({ ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
  });
});
