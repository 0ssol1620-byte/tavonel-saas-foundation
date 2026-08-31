// Builds the parameterized pgvector query against foundation_retrieval_embeddings, joined
// to foundation_retrieval_units for compile-run scoping. This module only builds SQL and
// its bind parameters -- executing it and turning rows into a RankedList (via
// toRankedList in rank-fusion.ts) is the caller's job, mirroring lexical-search.ts. The
// query embedding must already have passed embedDocumentsForProfile's compatibility guard
// (embedder-adapter.ts) before it reaches here; expectedDimension is checked again anyway
// (auditor-sol Wave 2 finding #4) as defense in depth, the same posture applyWorldGate
// takes on tenant isolation -- a query embedding that reached this function without going
// through the embedder guard must still fail closed here rather than querying an
// incompatible embedding space.
export type DenseMetric = "cosine" | "l2" | "inner_product";

export type DenseSearchParams = {
  workspaceKey: string;
  compileRunId: string;
  retrievalProfileId: string;
  queryEmbedding: number[];
  expectedDimension: number;
  metric: DenseMetric;
  limit: number;
};

export type DenseSearchQuery = {
  sql: string;
  params: [workspaceKey: string, retrievalProfileId: string, compileRunId: string, embeddingLiteral: string, limit: number];
};

// pgvector distance operators. All three are ascending = best match first: <=> and <-> are
// literal distances (smaller is closer), and <#> returns the *negative* inner product, so
// ascending order surfaces the highest actual inner product first.
const DISTANCE_OPERATOR: Record<DenseMetric, string> = {
  cosine: "<=>",
  l2: "<->",
  inner_product: "<#>",
};

export function buildDenseSearchQuery(params: DenseSearchParams): DenseSearchQuery {
  if (!Number.isInteger(params.expectedDimension) || params.expectedDimension < 1 || params.expectedDimension > 8192) {
    throw new Error("buildDenseSearchQuery requires expectedDimension to be an integer between 1 and 8192");
  }
  if (params.queryEmbedding.length !== params.expectedDimension) {
    throw new Error(
      `buildDenseSearchQuery: query embedding is ${params.queryEmbedding.length}D but the profile expects ${params.expectedDimension}D`,
    );
  }
  if (!params.queryEmbedding.every((value) => Number.isFinite(value))) {
    throw new Error("buildDenseSearchQuery requires every embedding component to be a finite number");
  }
  if (!Number.isInteger(params.limit) || params.limit < 1) {
    throw new Error("buildDenseSearchQuery requires a positive integer limit");
  }

  const operator = DISTANCE_OPERATOR[params.metric];
  const embeddingLiteral = `[${params.queryEmbedding.join(",")}]`;

  const sql = `
    select fe.unit_id, (fe.embedding ${operator} $4::vector) as distance
    from public.foundation_retrieval_embeddings fe
    join public.foundation_retrieval_units fu
      on fu.workspace_key = fe.workspace_key and fu.unit_id = fe.unit_id
    where fe.workspace_key = $1
      and fe.retrieval_profile_id = $2
      and fu.compile_run_id = $3
    order by distance asc, fe.unit_id asc
    limit $5
  `.trim();

  return {
    sql,
    params: [params.workspaceKey, params.retrievalProfileId, params.compileRunId, embeddingLiteral, params.limit],
  };
}
