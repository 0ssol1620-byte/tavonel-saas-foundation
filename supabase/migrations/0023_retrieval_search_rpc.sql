-- Wave 3 execution path. Wave 2 built lexical-search.ts and dense-search.ts, which produce
-- parameterized raw SQL against foundation_retrieval_units / foundation_retrieval_embeddings.
-- Nothing in this application can execute raw SQL: every database access goes through
-- PostgREST over HTTP (nextjs/lib/supabase-admin.ts), and there is no `pg` driver in
-- nextjs/package.json. Those two modules were therefore string builders with no runtime
-- capable of running their output -- the retrieval pipeline could not actually retrieve.
--
-- Adding a Postgres client to a Next.js serverless deployment to fix this would introduce a
-- second, connection-pooled database path alongside the existing PostgREST one, for the sole
-- benefit of two queries. Instead these two RPCs expose exactly those queries -- and nothing
-- else -- over the transport the app already has. The SQL bodies below are the exact
-- semantics of buildLexicalSearchQuery and buildDenseSearchQuery: same tables, same
-- ordering, same tie-breaks. lexical-search.ts/dense-search.ts remain the single source of
-- truth for how a caller *shapes* a search (token safety, dimension guard, metric choice);
-- these functions are only the executor. Tests in
-- supabase/tests/foundation_retrieval_search_rpc.sql assert the two stay in agreement.
--
-- Security posture, matching enforce_foundation_retrieval_compile_run_active_world (0021):
-- security definer + empty search_path (schema-qualify everything), granted to service_role
-- only. workspace_key is a required argument, never inferred, so a caller cannot omit it and
-- read across tenants; the calling application resolves it from the authenticated principal
-- (developer-auth.ts) exactly as every other foundation read does.
begin;

-- Lexical (Postgres FTS) retrieval. Mirrors buildLexicalSearchQuery.
--
-- p_query_tokens is an ARRAY of already-tokenized terms, not a tsquery string: the tsquery
-- is assembled here with to_tsquery over quote_literal-escaped tokens so a token can never
-- carry tsquery operator syntax into the parser, regardless of what the caller sends. This
-- is stricter than the TypeScript side's SAFE_TOKEN filter, deliberately -- the database
-- must not depend on the application having sanitized its input.
create or replace function public.search_foundation_retrieval_units_lexical(
  p_workspace_key text,
  p_compile_run_id text,
  p_query_tokens text[],
  p_limit integer
)
returns table (unit_id text, rank real)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tsquery text;
  v_safe_tokens text[];
begin
  if p_workspace_key is null or p_compile_run_id is null then
    raise exception 'retrieval_lexical_search_requires_scope';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'retrieval_lexical_search_limit_out_of_bounds';
  end if;

  -- Keep only letters/digits, deduplicate, drop empties. Mirrors SAFE_TOKEN in
  -- lexical-search.ts; enforced again here because the database is the trust boundary.
  select array_agg(distinct token)
    into v_safe_tokens
  from unnest(coalesce(p_query_tokens, array[]::text[])) as token
  where token ~ '^[[:alnum:]]+$' or token ~ '^\w+$';

  if v_safe_tokens is null or cardinality(v_safe_tokens) = 0 then
    raise exception 'retrieval_lexical_search_requires_safe_token';
  end if;

  -- OR across every (synonym-expanded) token, exactly as buildLexicalSearchQuery does:
  -- any one term matching makes a candidate, and ts_rank_cd orders by match quality.
  select string_agg(quote_literal(token), ' | ')
    into v_tsquery
  from unnest(v_safe_tokens) as token;

  return query
  select u.unit_id,
         ts_rank_cd(u.search_vector, to_tsquery('simple', v_tsquery)) as rank
  from public.foundation_retrieval_units u
  where u.workspace_key = p_workspace_key
    and u.compile_run_id = p_compile_run_id
    and u.search_vector @@ to_tsquery('simple', v_tsquery)
  order by rank desc, u.unit_id asc
  limit p_limit;
end;
$$;

-- Dense (pgvector) retrieval. Mirrors buildDenseSearchQuery.
--
-- The query vector arrives as float8[] rather than a pgvector literal string so PostgREST
-- can carry it as ordinary JSON without the application hand-building a `[1,2,3]` literal
-- for a text parameter. Dimension is checked against the stored rows' own declared
-- dimension before any distance is computed: comparing across embedding spaces must fail
-- closed here too, not only in embedder-adapter.ts's guard (defense in depth, the same
-- posture applyWorldGate takes on tenant isolation).
--
-- All three operators are ascending = best first: <=> and <-> are distances, and <#>
-- returns the negative inner product.
create or replace function public.search_foundation_retrieval_units_dense(
  p_workspace_key text,
  p_compile_run_id text,
  p_retrieval_profile_id text,
  p_query_embedding double precision[],
  p_metric text,
  p_limit integer
)
returns table (unit_id text, distance double precision)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_query public.vector;
  v_dimension integer;
  v_stored_dimension integer;
begin
  if p_workspace_key is null or p_compile_run_id is null or p_retrieval_profile_id is null then
    raise exception 'retrieval_dense_search_requires_scope';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'retrieval_dense_search_limit_out_of_bounds';
  end if;
  if p_metric is null or p_metric not in ('cosine', 'l2', 'inner_product') then
    raise exception 'retrieval_dense_search_unknown_metric';
  end if;
  if p_query_embedding is null then
    raise exception 'retrieval_dense_search_requires_embedding';
  end if;

  v_dimension := cardinality(p_query_embedding);
  if v_dimension < 1 or v_dimension > 8192 then
    raise exception 'retrieval_dense_search_dimension_out_of_bounds';
  end if;

  -- The embedding space this profile actually stored. If the caller's vector does not
  -- match it, the two are not comparable and no distance should be computed at all.
  select e.dimension into v_stored_dimension
  from public.foundation_retrieval_embeddings e
  where e.workspace_key = p_workspace_key
    and e.retrieval_profile_id = p_retrieval_profile_id
  limit 1;

  if v_stored_dimension is null then
    -- No embeddings compiled for this profile yet: an empty result, not an error. The
    -- caller degrades to lexical/structure rather than failing the tenant's request.
    return;
  end if;

  if v_stored_dimension <> v_dimension then
    raise exception 'retrieval_dense_search_dimension_mismatch: stored % vs query %',
      v_stored_dimension, v_dimension;
  end if;

  v_query := p_query_embedding::public.vector;

  if p_metric = 'cosine' then
    return query
    select fe.unit_id, (fe.embedding <=> v_query)::double precision as distance
    from public.foundation_retrieval_embeddings fe
    join public.foundation_retrieval_units fu
      on fu.workspace_key = fe.workspace_key and fu.unit_id = fe.unit_id
    where fe.workspace_key = p_workspace_key
      and fe.retrieval_profile_id = p_retrieval_profile_id
      and fu.compile_run_id = p_compile_run_id
    order by distance asc, fe.unit_id asc
    limit p_limit;
  elsif p_metric = 'l2' then
    return query
    select fe.unit_id, (fe.embedding <-> v_query)::double precision as distance
    from public.foundation_retrieval_embeddings fe
    join public.foundation_retrieval_units fu
      on fu.workspace_key = fe.workspace_key and fu.unit_id = fe.unit_id
    where fe.workspace_key = p_workspace_key
      and fe.retrieval_profile_id = p_retrieval_profile_id
      and fu.compile_run_id = p_compile_run_id
    order by distance asc, fe.unit_id asc
    limit p_limit;
  else
    return query
    select fe.unit_id, (fe.embedding <#> v_query)::double precision as distance
    from public.foundation_retrieval_embeddings fe
    join public.foundation_retrieval_units fu
      on fu.workspace_key = fe.workspace_key and fu.unit_id = fe.unit_id
    where fe.workspace_key = p_workspace_key
      and fe.retrieval_profile_id = p_retrieval_profile_id
      and fu.compile_run_id = p_compile_run_id
    order by distance asc, fe.unit_id asc
    limit p_limit;
  end if;
end;
$$;

revoke all on function public.search_foundation_retrieval_units_lexical(text, text, text[], integer)
  from public, anon, authenticated;
revoke all on function public.search_foundation_retrieval_units_dense(text, text, text, double precision[], text, integer)
  from public, anon, authenticated;

grant execute on function public.search_foundation_retrieval_units_lexical(text, text, text[], integer)
  to service_role;
grant execute on function public.search_foundation_retrieval_units_dense(text, text, text, double precision[], text, integer)
  to service_role;

commit;
