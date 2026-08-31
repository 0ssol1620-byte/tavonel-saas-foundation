// Builds the parameterized Postgres FTS query against foundation_retrieval_units
// (search_vector, added in 0022_retrieval_lexical_search.sql). Query tokens are expected
// to already be the output of expandedTokens() (lexical-tokens.ts) -- the same
// Korean-particle-aware, synonym-expanding tokenizer that produced each unit's
// search_tokens at compile time. This module only builds SQL; executing it and turning the
// rows into a RankedList (via toRankedList in rank-fusion.ts) is the caller's job, so this
// stays testable without a database connection.
export type LexicalSearchParams = {
  workspaceKey: string;
  compileRunId: string;
  queryTokens: string[];
  limit: number;
};

export type LexicalSearchQuery = {
  sql: string;
  params: [workspaceKey: string, compileRunId: string, tsquery: string, limit: number];
};

// Our tokenizer's own regex (\p{L}\p{N}{2,}) already guarantees every token is
// letters/digits only, but this function does not trust that guarantee blindly -- a token
// containing tsquery syntax (quotes, |, &, !, parens, whitespace) is rejected outright
// rather than passed through, since it is going to be concatenated into a single tsquery
// string bound as one parameter (not interpolated into the SQL text itself).
const SAFE_TOKEN = /^[\p{L}\p{N}]+$/u;

export function buildLexicalSearchQuery(params: LexicalSearchParams): LexicalSearchQuery {
  const safeTokens = [...new Set(params.queryTokens)].filter((token) => SAFE_TOKEN.test(token));
  if (safeTokens.length === 0) {
    throw new Error("buildLexicalSearchQuery requires at least one safe query token");
  }
  if (!Number.isInteger(params.limit) || params.limit < 1) {
    throw new Error("buildLexicalSearchQuery requires a positive integer limit");
  }

  // OR across every (synonym-expanded) token: any one of them appearing is a candidate
  // match, and ts_rank_cd then orders by how many/how well they matched.
  const tsquery = safeTokens.map((token) => `'${token}'`).join(" | ");

  const sql = `
    select unit_id, ts_rank_cd(search_vector, to_tsquery('simple', $3)) as rank
    from public.foundation_retrieval_units
    where workspace_key = $1
      and compile_run_id = $2
      and search_vector @@ to_tsquery('simple', $3)
    order by rank desc, unit_id asc
    limit $4
  `.trim();

  return { sql, params: [params.workspaceKey, params.compileRunId, tsquery, params.limit] };
}
