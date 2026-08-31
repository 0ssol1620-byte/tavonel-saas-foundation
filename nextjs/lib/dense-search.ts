// Builds the parameterized pgvector query against foundation_retrieval_embeddings, joined
// to foundation_retrieval_units for compile-run scoping. This module only builds SQL and
// its bind parameters -- executing it and turning rows into a RankedList (via
// toRankedList in rank-fusion.ts) is the caller's job, mirroring lexical-search.ts. The
// query embedding must already have passed embedDocumentsForProfile's compatibility guard
// (embedder-adapter.ts) before it reaches here; this module does not re-check compatibility,
// only that the vector it was given is well-formed.
export type DenseMetric = "cosine" | "l2" | "inner_product";

export type DenseSearchParams = {
  workspaceKey: string;
  compileRunId: string;
  retrievalProfileId: string;
  queryEmbedding: number[];
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
  if (params.queryEmbedding.length < 1 || params.queryEmbedding.length > 8192) {
    throw new Error("buildDenseSearchQuery requires a 1-8192 dimensional embedding");
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
