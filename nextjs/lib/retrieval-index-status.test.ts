import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureRetrievalIndexForActiveWorld, readRetrievalIndexState } from "./retrieval-index-status";
import { buildProductionRetrievalProfile } from "./retrieval-runtime-config";

/*
  A retrieval compile refused before the compiler's own run row exists must still be readable.

  `retrieval-compile-wiring.test.ts` established the gap and asserts the half that cannot be
  closed: when the run INSERT itself is refused, nothing durable is written and a later read
  correctly answers `missing`. This file is the half that can -- every other refusal now writes
  a `failed` run row, so the promoter and the next reader agree.

  Only the network boundary is replaced: `retrieval-store.ts` runs for real against one
  in-memory PostgREST, so the row that is written is the row that is read back, columns and
  filters included. The compiler itself is mocked, because what is under test is what happens
  when it refuses.
*/

const { compile } = vi.hoisted(() => ({ compile: vi.fn() }));
vi.mock("./retrieval-compile", () => ({ compileRetrievalArtifacts: compile }));

const WORKSPACE = "pilot-idxstatus";
const COLLECTION = `collection-${"a".repeat(32)}`;
const DIGEST = `sha256:${"b".repeat(64)}`;
const USER = "11111111-1111-4111-8111-111111111111";
const SCOPE = { workspaceKey: WORKSPACE, collectionId: COLLECTION, worldManifestDigest: DIGEST };
const PROFILE = buildProductionRetrievalProfile(WORKSPACE);

/** A candidate artifact `indexableArtifact` accepts, so the digest check is what decides. */
function artifact(manifestDigest: string) {
  return {
    collectionId: COLLECTION,
    manifestDigest,
    ontology: { nodes: [], edges: [] },
    package: { files: [] },
  };
}

type Row = Record<string, unknown>;
let runs: Row[] = [];
let refuseRunInsert = false;

/*
  The subset of PostgREST these two modules use: an insert into the profile table, an insert
  into the run table, and the two reads `findLatestRun` makes (completed first, then newest of
  any status). Query parameters are honoured rather than ignored, because "the row came back"
  is only evidence if the filters that fetched it were the real ones.
*/
function postgrest() {
  const fetcher = vi.fn(async (href: string, init: RequestInit = {}) => {
    const [path, query = ""] = String(href).split("https://idx.supabase.co")[1]!.split("?");
    const parameters = new URLSearchParams(query);
    if (path === "/rest/v1/foundation_retrieval_profiles") return new Response(null, { status: 201 });
    if (path !== "/rest/v1/foundation_retrieval_compile_runs") throw new Error(`unexpected path ${path}`);
    if (init.method === "POST") {
      if (refuseRunInsert) return Response.json({ code: "P0001" }, { status: 400 });
      runs.push(JSON.parse(String(init.body)) as Row);
      return new Response(null, { status: 201 });
    }
    const wanted = parameters.get("status")?.replace("eq.", "") ?? null;
    const matching = runs.filter(
      (row) =>
        row.workspace_key === WORKSPACE &&
        row.collection_id === COLLECTION &&
        row.world_manifest_digest === DIGEST &&
        row.retrieval_profile_id === PROFILE.id &&
        (wanted === null || row.status === wanted),
    );
    return Response.json(matching.slice(-1));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  runs = [];
  refuseRunInsert = false;
  compile.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://idx.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a refused retrieval compile is readable later", () => {
  it("writes the artifact refusal as a failed run, and a later read reports it as failed", async () => {
    postgrest();

    // The promoted artifact does not describe the world that was activated. The compiler is
    // never reached, so before this there was nothing to record the refusal in.
    const state = await ensureRetrievalIndexForActiveWorld({
      ...SCOPE,
      artifact: artifact(`sha256:${"c".repeat(64)}`),
      actorUserId: USER,
    });
    expect(state).toMatchObject({ status: "failed", errorClass: "RETRIEVAL_COMPILE_ARTIFACT_UNREADABLE" });
    expect(state.runId).toMatch(/^retrieval-run-[a-f0-9]{32}$/);
    expect(compile).not.toHaveBeenCalled();

    // 0020's CHECK refuses a failed row without both of these, so the row must carry them.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "failed",
      error_reason: "RETRIEVAL_COMPILE_ARTIFACT_UNREADABLE",
      run_id: state.runId,
    });
    expect(typeof runs[0].completed_at).toBe("string");

    const later = await readRetrievalIndexState(SCOPE);
    expect(later).toMatchObject({
      status: "failed",
      errorClass: "RETRIEVAL_COMPILE_ARTIFACT_UNREADABLE",
      runId: state.runId,
    });
  });

  it("records a compiler refusal that never reached its own run row, under the compiler's class", async () => {
    postgrest();
    compile.mockResolvedValue({
      ok: false,
      code: "RETRIEVAL_COMPILE_NO_UNITS",
      runId: null,
      reason: "the artifact produced no retrieval units for the profile's views",
    });

    const state = await ensureRetrievalIndexForActiveWorld({
      ...SCOPE,
      artifact: artifact(DIGEST),
      actorUserId: USER,
    });
    expect(state).toMatchObject({ status: "failed", errorClass: "RETRIEVAL_COMPILE_NO_UNITS" });
    expect((await readRetrievalIndexState(SCOPE)).errorClass).toBe("RETRIEVAL_COMPILE_NO_UNITS");
  });

  it("does not write a second row for a refusal the compiler already recorded", async () => {
    postgrest();
    // A failure after the run row exists is finished by the compiler itself
    // (`finishCompileRun`), so recording it again would leave two rows describing one attempt.
    compile.mockResolvedValue({
      ok: false,
      code: "RETRIEVAL_COMPILE_UNIT_WRITE_FAILED",
      runId: `retrieval-run-${"d".repeat(32)}`,
      reason: "RETRIEVAL_STORE_WRITE_FAILED",
    });

    const state = await ensureRetrievalIndexForActiveWorld({
      ...SCOPE,
      artifact: artifact(DIGEST),
      actorUserId: USER,
    });
    expect(state).toMatchObject({
      status: "failed",
      errorClass: "RETRIEVAL_COMPILE_UNIT_WRITE_FAILED",
      runId: `retrieval-run-${"d".repeat(32)}`,
    });
    expect(runs).toHaveLength(0);
  });

  it("reports the refusal without a run id when the store refuses the row too", async () => {
    // The honest ceiling, unchanged: 0021's trigger on a superseded world, or a write outage.
    // There is nowhere to record it, and a run id nobody can look up would be a lie.
    postgrest();
    refuseRunInsert = true;

    const state = await ensureRetrievalIndexForActiveWorld({
      ...SCOPE,
      artifact: artifact(`sha256:${"c".repeat(64)}`),
      actorUserId: USER,
    });
    expect(state).toEqual({
      status: "failed",
      errorClass: "RETRIEVAL_COMPILE_ARTIFACT_UNREADABLE",
      runId: null,
      retrievalProfileId: PROFILE.id,
    });
    expect(await readRetrievalIndexState(SCOPE)).toMatchObject({ status: "missing", runId: null });
  });

  it("refuses without reaching the network when the store is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const fetcher = postgrest();

    expect(await ensureRetrievalIndexForActiveWorld({
      ...SCOPE,
      artifact: artifact(`sha256:${"c".repeat(64)}`),
      actorUserId: USER,
    })).toMatchObject({ status: "failed", errorClass: "RETRIEVAL_COMPILE_ARTIFACT_UNREADABLE", runId: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
