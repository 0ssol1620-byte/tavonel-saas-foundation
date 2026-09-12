import { randomBytes } from "node:crypto";
import type { CollectionCandidateArtifact } from "./collection-compiler";
import { compileRetrievalArtifacts } from "./retrieval-compile";
import type { RetrievalProfile } from "./retrieval-profile";
import { buildProductionRetrievalProfile, createProductionEmbedderAdapter, readRetrievalRuntimeEnv } from "./retrieval-runtime-config";
import { createCompileRun, ensureRetrievalProfile, findLatestRun } from "./retrieval-store";

/*
  The retrieval index's observable state, and the one place that puts it there.

  Until this module existed, `compileRetrievalArtifacts` -- the entire write side of the
  Retrieval Compiler -- had no production caller. Every active World therefore had no compiled
  index, every /ask fell through to the excerpt-concatenation fallback, and every /search
  answered 409 SEARCH_INDEX_MISSING. Not for some worlds: for all of them, permanently (audit
  R4-01). The gap was invisible because nothing reported it.

  Two decisions shape this file.

  Promotion never fails because of retrieval. A World becoming active is a human decision about
  knowledge; a derived index is a cache of one projection of it. Refusing the promotion because
  an embedder was unreachable would block the decision on the least authoritative component in
  the system. So promotion succeeds, and the index state is recorded and reported instead --
  on the World read model, in /ask's `retrievalNotice`, in /search's response and in the
  freshness block. Reported, never silent: "promotion succeeded and the index did not compile"
  is a state an operator has to be able to see.

  A state we cannot verify is never reported as compiled. If the run table itself cannot be
  read, the status is `failed` carrying the read failure's own class, because claiming a
  queryable index that no query can reach is the one answer with no recovery path.
*/

export type RetrievalIndexStatus = "missing" | "compiled" | "failed";

export type RetrievalIndexState = {
  status: RetrievalIndexStatus;
  /**
   * The machine class that explains a non-`compiled` status, or null when a compiled index
   * exists. Never a sentence, never a provider payload: these are the
   * RETRIEVAL_COMPILE_* / RETRIEVAL_STORE_* codes the store and the compiler already emit.
   */
  errorClass: string | null;
  runId: string | null;
  retrievalProfileId: string;
};

/** An index that exists but is not queryable yet is `missing`, and says which. */
const RUN_INCOMPLETE = "RETRIEVAL_COMPILE_RUN_INCOMPLETE";

/** The artifact read back from storage was not one this compiler can index. */
const ARTIFACT_UNREADABLE = "RETRIEVAL_COMPILE_ARTIFACT_UNREADABLE";

type IndexScope = {
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
};

export async function readRetrievalIndexState(scope: IndexScope): Promise<RetrievalIndexState> {
  const profile = buildProductionRetrievalProfile(scope.workspaceKey);
  const base = { runId: null, retrievalProfileId: profile.id };
  const latest = await findLatestRun({
    workspaceKey: scope.workspaceKey,
    collectionId: scope.collectionId,
    worldManifestDigest: scope.worldManifestDigest,
    retrievalProfileId: profile.id,
  });
  if (!latest.ok) {
    // No run and no profile are both honestly "no index exists yet". Anything else is a read
    // we could not complete, and a state we could not read is not a state we may call good.
    const missing = latest.code === "RETRIEVAL_RUN_NOT_FOUND" || latest.code === "RETRIEVAL_PROFILE_NOT_FOUND";
    return { ...base, status: missing ? "missing" : "failed", errorClass: latest.code };
  }
  const run = latest.value;
  if (run.status === "completed") {
    return { ...base, status: "compiled", errorClass: null, runId: run.runId };
  }
  if (run.status === "failed") {
    return { ...base, status: "failed", errorClass: run.errorReason ?? "RETRIEVAL_COMPILE_FAILED", runId: run.runId };
  }
  return { ...base, status: "missing", errorClass: RUN_INCOMPLETE, runId: run.runId };
}

/*
  Write a refusal that never reached the compiler's own run row, so a later reader sees it.

  Every refusal below `createCompileRun` used to leave nothing durable behind: the promotion
  response was the only place it appeared, and the next /ask read an empty run table and
  answered `missing` -- a world nobody has compiled and a world whose compile was refused
  looked identical. The runs table already models exactly this (`failed` plus a machine
  `error_reason`, and service_role may already insert), so the refusal is written there rather
  than into a new column: nothing here needs a schema change.

  Two honest limits. The row's foreign key needs the retrieval profile, which does not exist
  on a workspace's first promotion, so the profile is registered first -- lazily, only on the
  refusal path, never on the path that is about to compile anyway. And if the store itself
  refuses the insert (0021's trigger on a superseded world, a write outage), there is nowhere
  to write and the state stays `runId: null`, reported to the promoter and to nobody later.
  That case is asserted, unchanged, in retrieval-compile-wiring.test.ts.
*/
async function recordRefusal(
  scope: IndexScope,
  profile: RetrievalProfile,
  actorUserId: string,
  errorClass: string,
): Promise<RetrievalIndexState> {
  const state = { status: "failed" as const, errorClass, retrievalProfileId: profile.id };
  const registered = await ensureRetrievalProfile(profile, actorUserId);
  if (!registered.ok) return { ...state, runId: null };
  const runId = `retrieval-run-${randomBytes(16).toString("hex")}`;
  const written = await createCompileRun({
    ...scope,
    runId,
    retrievalProfileId: profile.id,
    refusedReason: errorClass,
  });
  return { ...state, runId: written.ok ? runId : null };
}

export type EnsureRetrievalIndexInput = IndexScope & {
  /**
   * The promoted candidate artifact as it was read back from object storage. Typed `unknown`
   * because the promote route's own validator does not check the fields the unit compiler
   * reads (`ontology`), so this module verifies them itself rather than trusting a cast.
   */
  artifact: unknown;
  actorUserId: string;
};

function indexableArtifact(value: unknown): CollectionCandidateArtifact | null {
  if (!value || typeof value !== "object") return null;
  const artifact = value as Record<string, unknown>;
  const ontology = artifact.ontology as Record<string, unknown> | undefined;
  const bundle = artifact.package as { files?: unknown } | undefined;
  if (
    typeof artifact.collectionId !== "string" ||
    typeof artifact.manifestDigest !== "string" ||
    !ontology ||
    !Array.isArray(ontology.nodes) ||
    !Array.isArray(ontology.edges) ||
    !Array.isArray(bundle?.files)
  ) {
    return null;
  }
  return value as CollectionCandidateArtifact;
}

/**
 * Compile the retrieval index for a World that is already active, or report why not.
 *
 * Idempotent per world version: a completed run for this (workspace, collection, manifest,
 * profile) is returned as-is without recompiling, so a retried promotion, a double-clicked
 * button and an at-least-once delivery all converge on one index rather than three.
 *
 * The embedder is optional by the same rule `compileRetrievalArtifacts` already applies: with
 * no embedder configured the run completes with units and zero vectors, queries degrade to
 * lexical + structure, and the degradation is named in the response rather than hidden. No
 * reranker is needed here -- reranking happens at query time.
 */
export async function ensureRetrievalIndexForActiveWorld(
  input: EnsureRetrievalIndexInput,
): Promise<RetrievalIndexState> {
  const existing = await readRetrievalIndexState(input);
  if (existing.status === "compiled") return existing;

  const profile = buildProductionRetrievalProfile(input.workspaceKey);
  const base = { runId: null as string | null, retrievalProfileId: profile.id };
  const artifact = indexableArtifact(input.artifact);
  if (!artifact || artifact.manifestDigest !== input.worldManifestDigest) {
    return recordRefusal(input, profile, input.actorUserId, ARTIFACT_UNREADABLE);
  }

  const runtimeEnv = readRetrievalRuntimeEnv();
  let result: Awaited<ReturnType<typeof compileRetrievalArtifacts>>;
  try {
    result = await compileRetrievalArtifacts({
      workspaceKey: input.workspaceKey,
      collectionId: input.collectionId,
      worldManifestDigest: input.worldManifestDigest,
      artifact,
      profile,
      actorUserId: input.actorUserId,
      embedder: runtimeEnv ? createProductionEmbedderAdapter(runtimeEnv) : null,
    });
  } catch {
    // A throw here is a malformed artifact reaching a pure compiler, or a transport that did
    // not fail the way the store expects. Either way the promotion already happened, so the
    // only correct move is to record the failure class and let the request succeed.
    return recordRefusal(input, profile, input.actorUserId, ARTIFACT_UNREADABLE);
  }
  if (!result.ok) {
    // A refusal the compiler took before its own run row exists carries `runId: null`; that is
    // the one that would otherwise vanish, so it is written as a failed run instead.
    return result.runId === null
      ? recordRefusal(input, profile, input.actorUserId, result.code)
      : { ...base, status: "failed", errorClass: result.code, runId: result.runId };
  }
  return { ...base, status: "compiled", errorClass: null, runId: result.runId };
}

/**
 * The sentence /ask and /search put in front of a human when the index is not queryable.
 *
 * One wording, one place. Two surfaces phrasing the same state differently is how a support
 * conversation ends up about which page is lying.
 */
export function retrievalIndexNotice(state: RetrievalIndexState): string | null {
  if (state.status === "compiled") return null;
  if (state.status === "failed") {
    return `the compiled retrieval index for this active world failed to build (${state.errorClass ?? "unknown"}); answers come from the excerpt-concatenation fallback until it is rebuilt`;
  }
  return state.errorClass === RUN_INCOMPLETE
    ? "a retrieval compile run for this active world has not finished; an incomplete index is not queryable and answers come from the excerpt-concatenation fallback"
    : "no compiled retrieval index exists for this active world yet";
}
