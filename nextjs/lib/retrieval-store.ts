import { expandedTokens } from "./lexical-tokens";
import type { RetrievalUnit } from "./retrieval-units";
import type { RetrievalProfile } from "./retrieval-profile";
import type { DenseMetric } from "./dense-search";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { COLLECTION_ID_PATTERN } from "./immutable-keys";

// The persistence and execution seam for the Retrieval Compiler. Wave 1/2 produced pure,
// database-free modules (retrieval-units.ts compiles units, lexical-search.ts and
// dense-search.ts build SQL, rank-fusion.ts fuses ranks); every one of them was reachable
// only from its own tests because nothing wrote a unit to a table or ran a search. This
// module is that missing half, and it is deliberately the ONLY place in the retrieval path
// that talks to the database.
//
// Transport is PostgREST over HTTP (supabase-admin.ts), the same path world-store.ts and
// every other foundation store uses -- not a `pg` connection. The two searches that genuinely
// need raw SQL go through the narrow RPCs added in 0023_retrieval_search_rpc.sql, whose
// bodies mirror buildLexicalSearchQuery/buildDenseSearchQuery exactly. Those two builder
// modules remain the specification of the query shape and keep their tests; this module is
// the executor.
//
// Every function here fails closed with a code, never throws into a request handler, and
// never widens tenant scope: workspaceKey is an explicit argument on every call and is
// carried into the RPC arguments, matching the posture of applyWorldGate and the RPCs'
// own required p_workspace_key.

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^retrieval-run-[a-f0-9]{32}$/;
// Deliberately the schema's own workspace_key pattern (0020_retrieval_foundation.sql), not
// the looser WORKSPACE_ID_PATTERN used for R2 object keys: a value that would be rejected by
// the table's CHECK must be rejected before the request is made, not after PostgREST returns
// a 400 the caller has to interpret.
const WORKSPACE_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;

export type RetrievalStoreFailure =
  | "RETRIEVAL_STORE_NOT_CONFIGURED"
  | "RETRIEVAL_STORE_READ_FAILED"
  | "RETRIEVAL_STORE_WRITE_FAILED"
  | "RETRIEVAL_SCOPE_INVALID"
  | "RETRIEVAL_PROFILE_NOT_FOUND"
  | "RETRIEVAL_RUN_NOT_FOUND";

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: RetrievalStoreFailure };

function fail(code: RetrievalStoreFailure) {
  return { ok: false as const, code };
}

function validScope(workspaceKey: string, collectionId?: string) {
  return WORKSPACE_KEY.test(workspaceKey) && (collectionId === undefined || COLLECTION_ID_PATTERN.test(collectionId));
}

// PostgREST insert batching. Units are chunked rather than sent as one array because a
// collection's section+claim+entity views can run to thousands of rows, and a single
// oversized request body is the kind of thing that works in a pilot and fails at scale --
// exactly the class of problem the audit's §35 flags about in-memory whole-package handling.
const INSERT_BATCH = 200;

export type PersistUnitsInput = {
  workspaceKey: string;
  compileRunId: string;
  units: RetrievalUnit[];
};

// Writes compiled units with their FTS tokens. search_tokens is computed HERE, from the
// same expandedTokens() the query side uses, because 0022's search_vector is generated from
// search_tokens: if this used a different tokenizer than the query path, the two would score
// the same text differently and the lexical path would silently under-match -- the exact
// class of drift Wave 0 fixed between the compiler and grounded-ask.
export async function persistRetrievalUnits(input: PersistUnitsInput): Promise<StoreResult<number>> {
  if (!validScope(input.workspaceKey) || !RUN_ID.test(input.compileRunId)) return fail("RETRIEVAL_SCOPE_INVALID");
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");
  if (input.units.length === 0) return { ok: true as const, value: 0 };

  const rows = input.units.map((unit) => ({
    unit_id: unit.unitId,
    workspace_key: input.workspaceKey,
    compile_run_id: input.compileRunId,
    unit_type: unit.unitType,
    document_id: unit.documentId,
    document_version_key: unit.documentVersionKey,
    text: unit.text,
    page_number1: unit.pageNumber1,
    bbox1000: unit.bbox1000,
    claim_ids: unit.claimIds,
    entity_ids: unit.entityIds,
    evidence_ids: unit.evidenceIds,
    authority: unit.authority,
    authority_score: unit.authorityScore,
    content_digest: unit.contentDigest,
    search_tokens: expandedTokens(unit.text).slice(0, 5000),
  }));

  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH) {
    const batch = rows.slice(offset, offset + INSERT_BATCH);
    let response: Response;
    try {
      response = await supabaseAdminRequest(config, "/rest/v1/foundation_retrieval_units", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return fail("RETRIEVAL_STORE_WRITE_FAILED");
    }
    if (!response.ok) return fail("RETRIEVAL_STORE_WRITE_FAILED");
  }
  return { ok: true as const, value: rows.length };
}

export type PersistEmbeddingsInput = {
  workspaceKey: string;
  retrievalProfileId: string;
  dimension: number;
  vectors: Array<{ unitId: string; embedding: number[] }>;
};

// Embeddings are profile-scoped (see 0020's primary key) so two profiles' vector spaces can
// coexist for the same unit without ever mixing. Dimension is validated against the
// profile's own declared dimension before the write -- the schema's
// check (vector_dims(embedding) = dimension) would catch a mismatch anyway, but returning a
// clear failure beats a 400 from PostgREST that a caller has to reverse-engineer.
export async function persistRetrievalEmbeddings(input: PersistEmbeddingsInput): Promise<StoreResult<number>> {
  if (!validScope(input.workspaceKey)) return fail("RETRIEVAL_SCOPE_INVALID");
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");
  if (input.vectors.length === 0) return { ok: true as const, value: 0 };
  if (input.vectors.some((vector) => vector.embedding.length !== input.dimension)) {
    return fail("RETRIEVAL_SCOPE_INVALID");
  }

  const rows = input.vectors.map((vector) => ({
    workspace_key: input.workspaceKey,
    unit_id: vector.unitId,
    retrieval_profile_id: input.retrievalProfileId,
    dimension: input.dimension,
    // pgvector accepts its literal text form; PostgREST carries it as a JSON string.
    embedding: `[${vector.embedding.join(",")}]`,
  }));

  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH) {
    const batch = rows.slice(offset, offset + INSERT_BATCH);
    let response: Response;
    try {
      response = await supabaseAdminRequest(config, "/rest/v1/foundation_retrieval_embeddings", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return fail("RETRIEVAL_STORE_WRITE_FAILED");
    }
    if (!response.ok) return fail("RETRIEVAL_STORE_WRITE_FAILED");
  }
  return { ok: true as const, value: rows.length };
}

export type CompileRunRecord = {
  runId: string;
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  retrievalProfileId: string;
  status: "pending" | "running" | "completed" | "failed";
  unitCount: number | null;
  embeddingCount: number | null;
};

export async function createCompileRun(record: {
  runId: string;
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  retrievalProfileId: string;
}): Promise<StoreResult<string>> {
  if (
    !validScope(record.workspaceKey, record.collectionId) ||
    !RUN_ID.test(record.runId) ||
    !SHA256.test(record.worldManifestDigest)
  ) {
    return fail("RETRIEVAL_SCOPE_INVALID");
  }
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/foundation_retrieval_compile_runs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        run_id: record.runId,
        workspace_key: record.workspaceKey,
        collection_id: record.collectionId,
        world_manifest_digest: record.worldManifestDigest,
        retrieval_profile_id: record.retrievalProfileId,
        status: "running",
      }),
    });
  } catch {
    return fail("RETRIEVAL_STORE_WRITE_FAILED");
  }
  // A rejection here is frequently the 0021 trigger refusing a run against a superseded
  // world -- a correct refusal, surfaced as a write failure rather than swallowed.
  if (!response.ok) return fail("RETRIEVAL_STORE_WRITE_FAILED");
  return { ok: true as const, value: record.runId };
}

export async function finishCompileRun(
  workspaceKey: string,
  runId: string,
  outcome:
    | { status: "completed"; unitCount: number; embeddingCount: number }
    | { status: "failed"; errorReason: string },
): Promise<StoreResult<null>> {
  if (!validScope(workspaceKey) || !RUN_ID.test(runId)) return fail("RETRIEVAL_SCOPE_INVALID");
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");

  const patch =
    outcome.status === "completed"
      ? {
          status: "completed",
          unit_count: outcome.unitCount,
          embedding_count: outcome.embeddingCount,
          completed_at: new Date().toISOString(),
        }
      : {
          status: "failed",
          error_reason: outcome.errorReason.slice(0, 200),
          completed_at: new Date().toISOString(),
        };

  const query = new URLSearchParams({
    workspace_key: `eq.${workspaceKey}`,
    run_id: `eq.${runId}`,
  });
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_retrieval_compile_runs?${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
  } catch {
    return fail("RETRIEVAL_STORE_WRITE_FAILED");
  }
  if (!response.ok) return fail("RETRIEVAL_STORE_WRITE_FAILED");
  return { ok: true as const, value: null };
}

// Resolves the compile run a query should search: the most recent completed run for the
// (collection, active world manifest, profile) triple. Binding to the manifest digest -- not
// just the collection -- is what stops a query from silently reading units compiled against
// a world that has since been superseded or rolled back; those rows correctly remain in the
// table as history, and the World Gate would reject them anyway, but not selecting them in
// the first place keeps a rollback from degrading into an all-rejected empty answer.
export async function findLatestCompletedRun(params: {
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  retrievalProfileId: string;
}): Promise<StoreResult<CompileRunRecord>> {
  if (!validScope(params.workspaceKey, params.collectionId) || !SHA256.test(params.worldManifestDigest)) {
    return fail("RETRIEVAL_SCOPE_INVALID");
  }
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");

  const query = new URLSearchParams({
    select: "run_id,workspace_key,collection_id,world_manifest_digest,retrieval_profile_id,status,unit_count,embedding_count",
    workspace_key: `eq.${params.workspaceKey}`,
    collection_id: `eq.${params.collectionId}`,
    world_manifest_digest: `eq.${params.worldManifestDigest}`,
    retrieval_profile_id: `eq.${params.retrievalProfileId}`,
    status: "eq.completed",
    order: "started_at.desc",
    limit: "1",
  });

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_retrieval_compile_runs?${query}`);
  } catch {
    return fail("RETRIEVAL_STORE_READ_FAILED");
  }
  if (!response.ok) return fail("RETRIEVAL_STORE_READ_FAILED");
  const rows = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  const row = rows?.[0];
  if (!row) return fail("RETRIEVAL_RUN_NOT_FOUND");

  const runId = String(row.run_id ?? "");
  if (!RUN_ID.test(runId)) return fail("RETRIEVAL_RUN_NOT_FOUND");
  return {
    ok: true as const,
    value: {
      runId,
      workspaceKey: String(row.workspace_key ?? ""),
      collectionId: String(row.collection_id ?? ""),
      worldManifestDigest: String(row.world_manifest_digest ?? ""),
      retrievalProfileId: String(row.retrieval_profile_id ?? ""),
      status: "completed",
      unitCount: row.unit_count === null ? null : Number(row.unit_count),
      embeddingCount: row.embedding_count === null ? null : Number(row.embedding_count),
    },
  };
}

export type StoredUnitRow = {
  unitId: string;
  unitType: string;
  documentId: string;
  documentVersionKey: string;
  text: string;
  pageNumber1: number | null;
  bbox1000: [number, number, number, number] | null;
  claimIds: string[];
  entityIds: string[];
  evidenceIds: string[];
  authority: string | null;
};

function toStoredUnit(row: Record<string, unknown>): StoredUnitRow | null {
  const unitId = String(row.unit_id ?? "");
  if (unitId.length === 0) return null;
  const bbox = Array.isArray(row.bbox1000) && row.bbox1000.length === 4 ? row.bbox1000.map(Number) : null;
  return {
    unitId,
    unitType: String(row.unit_type ?? ""),
    documentId: String(row.document_id ?? ""),
    documentVersionKey: String(row.document_version_key ?? ""),
    text: String(row.text ?? ""),
    pageNumber1: row.page_number1 === null || row.page_number1 === undefined ? null : Number(row.page_number1),
    bbox1000: bbox as [number, number, number, number] | null,
    claimIds: Array.isArray(row.claim_ids) ? row.claim_ids.map(String) : [],
    entityIds: Array.isArray(row.entity_ids) ? row.entity_ids.map(String) : [],
    evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [],
    authority: row.authority === null || row.authority === undefined ? null : String(row.authority),
  };
}

// Hydrates the full unit rows for a set of IDs the ranking stages selected. Ranking works on
// IDs alone (that is the whole point of RRF over ranks), so text and provenance are fetched
// once, at the end, for only the units that survived -- not for every candidate every source
// returned.
export async function loadUnitsByIds(
  workspaceKey: string,
  compileRunId: string,
  unitIds: string[],
): Promise<StoreResult<StoredUnitRow[]>> {
  if (!validScope(workspaceKey) || !RUN_ID.test(compileRunId)) return fail("RETRIEVAL_SCOPE_INVALID");
  if (unitIds.length === 0) return { ok: true as const, value: [] };
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");

  const query = new URLSearchParams({
    select: "unit_id,unit_type,document_id,document_version_key,text,page_number1,bbox1000,claim_ids,entity_ids,evidence_ids,authority",
    workspace_key: `eq.${workspaceKey}`,
    compile_run_id: `eq.${compileRunId}`,
    unit_id: `in.(${[...new Set(unitIds)].join(",")})`,
  });

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_retrieval_units?${query}`);
  } catch {
    return fail("RETRIEVAL_STORE_READ_FAILED");
  }
  if (!response.ok) return fail("RETRIEVAL_STORE_READ_FAILED");
  const rows = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  if (!rows) return fail("RETRIEVAL_STORE_READ_FAILED");
  return { ok: true as const, value: rows.map(toStoredUnit).filter((unit): unit is StoredUnitRow => unit !== null) };
}

// Loads the claim/entity ids of the units a query already matched, to seed the structure
// path (structure-search.ts ranks by overlap against these). Kept separate from
// loadUnitsByIds because it runs BEFORE fusion, on a small seed set, and needs no text.
export async function loadStructureCandidates(
  workspaceKey: string,
  compileRunId: string,
  limit: number,
): Promise<StoreResult<Array<{ unitId: string; claimIds: string[]; entityIds: string[] }>>> {
  if (!validScope(workspaceKey) || !RUN_ID.test(compileRunId)) return fail("RETRIEVAL_SCOPE_INVALID");
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");

  const query = new URLSearchParams({
    select: "unit_id,claim_ids,entity_ids",
    workspace_key: `eq.${workspaceKey}`,
    compile_run_id: `eq.${compileRunId}`,
    limit: String(Math.min(Math.max(limit, 1), 2000)),
  });

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_retrieval_units?${query}`);
  } catch {
    return fail("RETRIEVAL_STORE_READ_FAILED");
  }
  if (!response.ok) return fail("RETRIEVAL_STORE_READ_FAILED");
  const rows = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  if (!rows) return fail("RETRIEVAL_STORE_READ_FAILED");
  return {
    ok: true as const,
    value: rows.map((row) => ({
      unitId: String(row.unit_id ?? ""),
      claimIds: Array.isArray(row.claim_ids) ? row.claim_ids.map(String) : [],
      entityIds: Array.isArray(row.entity_ids) ? row.entity_ids.map(String) : [],
    })),
  };
}

// ---- Search execution (the two 0023 RPCs) -------------------------------------------

async function callRpc(name: string, body: unknown): Promise<StoreResult<Array<Record<string, unknown>>>> {
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail("RETRIEVAL_STORE_READ_FAILED");
  }
  if (!response.ok) return fail("RETRIEVAL_STORE_READ_FAILED");
  const rows = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(rows)) return fail("RETRIEVAL_STORE_READ_FAILED");
  return { ok: true as const, value: rows };
}

// Executes the lexical search. Returns unit IDs already in best-first order, which is
// exactly what toRankedList (rank-fusion.ts) consumes -- the native ts_rank_cd score is
// deliberately dropped here, because only rank position may enter RRF.
export async function runLexicalSearch(params: {
  workspaceKey: string;
  compileRunId: string;
  queryTokens: string[];
  limit: number;
}): Promise<StoreResult<string[]>> {
  if (!validScope(params.workspaceKey) || !RUN_ID.test(params.compileRunId)) return fail("RETRIEVAL_SCOPE_INVALID");
  if (params.queryTokens.length === 0) return { ok: true as const, value: [] };
  const result = await callRpc("search_foundation_retrieval_units_lexical", {
    p_workspace_key: params.workspaceKey,
    p_compile_run_id: params.compileRunId,
    p_query_tokens: params.queryTokens,
    p_limit: params.limit,
  });
  if (!result.ok) return result;
  return { ok: true as const, value: result.value.map((row) => String(row.unit_id ?? "")).filter((id) => id.length > 0) };
}

// Executes the dense search. Same contract as runLexicalSearch: best-first IDs, distance
// dropped. A profile with no embeddings compiled yet returns [] (the RPC's documented
// empty-not-error case), so the caller degrades to lexical+structure instead of failing.
export async function runDenseSearch(params: {
  workspaceKey: string;
  compileRunId: string;
  retrievalProfileId: string;
  queryEmbedding: number[];
  metric: DenseMetric;
  limit: number;
}): Promise<StoreResult<string[]>> {
  if (!validScope(params.workspaceKey) || !RUN_ID.test(params.compileRunId)) return fail("RETRIEVAL_SCOPE_INVALID");
  if (params.queryEmbedding.length === 0) return { ok: true as const, value: [] };
  const result = await callRpc("search_foundation_retrieval_units_dense", {
    p_workspace_key: params.workspaceKey,
    p_compile_run_id: params.compileRunId,
    p_retrieval_profile_id: params.retrievalProfileId,
    p_query_embedding: params.queryEmbedding,
    p_metric: params.metric,
    p_limit: params.limit,
  });
  if (!result.ok) return result;
  return { ok: true as const, value: result.value.map((row) => String(row.unit_id ?? "")).filter((id) => id.length > 0) };
}

// ---- Profile persistence -------------------------------------------------------------

export async function ensureRetrievalProfile(
  profile: RetrievalProfile,
  createdByUserId: string,
): Promise<StoreResult<string>> {
  if (!validScope(profile.workspaceKey)) return fail("RETRIEVAL_SCOPE_INVALID");
  const config = readSupabaseAdminConfig();
  if (!config) return fail("RETRIEVAL_STORE_NOT_CONFIGURED");

  const row = {
    id: profile.id,
    workspace_key: profile.workspaceKey,
    views: profile.views,
    embedding: {
      provider: profile.embedding.provider,
      model: profile.embedding.model,
      revision: profile.embedding.revision,
      dimension: profile.embedding.dimension,
      normalize: profile.embedding.normalize,
    },
    lexical: profile.lexical,
    fusion: profile.fusion,
    reranker: profile.reranker,
    index_backend: profile.indexBackend,
    index_metric: profile.indexMetric,
    profile_digest: profile.profileDigest,
    created_by: createdByUserId,
  };

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/foundation_retrieval_profiles", {
      method: "POST",
      // A profile is content-addressed by its digest, so re-registering an identical profile
      // must be a no-op rather than a conflict; a DIFFERENT profile reusing an existing id is
      // a real error and still fails, because the digest column would have to change.
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([row]),
    });
  } catch {
    return fail("RETRIEVAL_STORE_WRITE_FAILED");
  }
  if (!response.ok) return fail("RETRIEVAL_STORE_WRITE_FAILED");
  return { ok: true as const, value: profile.id };
}
