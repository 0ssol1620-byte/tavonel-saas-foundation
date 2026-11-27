-- WO-PROJ-K2-E2: retrieval scoped to a member's admitted documents, ranked inside the database.
--
-- Why. Under the member projection (nextjs/lib/member-projection.ts, flag ENFORCE), the app asked
-- the unscoped 0023/0052 RPCs for a 500-unit window, then mapped every returned unit to its
-- document in sequential 100-id PostgREST reads, then dropped the hidden ones. Both the window and
-- the number of reads grew with how many HIDDEN units matched the query: a member could time a
-- query and learn whether a term occurs in sources they may not read (review r1, E2). These three
-- functions take the admitted document ids and never rank, return or read a unit outside them, so
-- the app makes one request per source with limit = candidateLimit, whatever the hidden documents
-- hold.
--
-- What is new. Three NEW RPCs, one private helper and two expression indexes. Nothing existing is redefined, so
-- the unprojected path (0023 lexical, 0052 dense, the REST structure read) is byte-identical, and
-- the MIG-GUARD (nextjs/scripts/db/migration-redefinition-guard.mjs) has no predecessor to name.
--
-- The document list is the projection's allowedDocumentIds (product document ids, the form
-- foundation_retrieval_units.document_id stores). It is never request input; the app derives it
-- from the member's scope. Bounds, each a typed refusal:
--   null list, a null or out-of-length element, a duplicate, more than 2000 entries
--     -> retrieval_scoped_search_documents_invalid
--   a compile run id outside the 0020 pattern -> retrieval_scoped_search_run_invalid
--   an EMPTY list -> retrieval_scoped_search_documents_empty (review r1 N-e: a loud refusal, not an
--     empty answer that looks valid; the app answers MEMBER_SOURCE_SCOPE_DENIED before it calls).
-- Limits are 0023's (1..500) for lexical and dense, and the app's existing 2000 for structure.
--
-- Rows examined, independent of hidden documents. The planner, not the query text, decides which
-- rows a scan visits, and on these tables it was measured choosing plans that do visit hidden rows:
-- run_idx (workspace, run) with the document as a filter, the primary key for ORDER BY unit_id, the
-- profile index with unit_id as a filter for the embedding lookup (local PG17, rows-examined test).
-- So the admitted units are found through a key no other index can serve:
--   scope key = length(workspace_key) || ':' || workspace_key || compile_run_id || document_id
-- an expression index on it, and a predicate written on that expression alone. The length prefix
-- and the fixed-length run id (0020 check, re-checked here) make the key injective, so key equality
-- is exactly (workspace, run, document) equality. With enable_seqscan and enable_bitmapscan pinned
-- off for each function (no sequential scan, no GIN bitmap over every matching unit), the only index
-- path with a usable condition is the scope-key index. Each admitted unit's embedding is then read
-- through a second scope-key index on the embeddings (workspace, unit, profile).
-- supabase/tests/foundation_retrieval_search_rpc_scoped.sql measures it: the tuples a call reads
-- (heap tuples fetched or scanned, index entries returned) are the same before and after forty
-- matching hidden units are added, while the unscoped RPC's count grows. What that counter cannot
-- see: index entries a btree visits and rejects inside one scan (it counts entries returned). A
-- scope-key lookup is an equality probe, so it visits only matching entries plus a boundary.
-- ponytail: planner GUCs plus expressions only one index serves; a future planner could still pick
-- a full index scan. The rows-examined test is the tripwire. Cost ceiling: work is proportional to
-- the ADMITTED units of the run (each is tested against the tsquery, not only matching ones). Not
-- measured on a real corpus.
--
-- Security posture as 0023: security definer, empty search_path, every object schema-qualified,
-- workspace_key and compile_run_id required, execute for service_role only. The helper is
-- executable by nobody but its owner.
--
-- Expand-only and re-runnable: create or replace, create index if not exists, revoke/grant restated.
-- The indexes are built without CONCURRENTLY (migrations run in a transaction): each holds a SHARE
-- lock on its table for the build, so retrieval-index writes wait for it.
-- Apply conditions (review PROJ-K2-E2 r1, C1-C4). The lead applies this file only when all four hold:
--   C1. The hosted db-rehearsal is green at the exact head being applied: the first pgTAP pass
--       (including supabase/tests/foundation_retrieval_search_rpc_scoped.sql against real pgvector),
--       the stage-rollback rehearsal and the rollback pairing.
--   C2. Read the table sizes first, read-only:
--         select relname, reltuples, pg_size_pretty(pg_total_relation_size(oid)) from pg_class
--          where relname in ('foundation_retrieval_units', 'foundation_retrieval_embeddings');
--         select max(char_length(document_id)) from public.foundation_retrieval_units;
--       Each CREATE INDEX below takes a SHARE lock that blocks every INSERT/DELETE on its table (compile
--       writes, source-deletion and test-reset cascades) until COMMIT; reads keep working. The units
--       lock is held through the embeddings build too.
--   C3. Bound the wait: apply with `set local lock_timeout = '5s'` at the top of the transaction, so a
--       build queued behind a compile batch fails and is retried instead of stalling ingestion. If C2
--       shows large tables, first build both indexes with CREATE INDEX CONCURRENTLY outside any
--       transaction, confirm pg_index.indisvalid for both, and only then apply this file. `if not
--       exists` silently skips an INVALID index left by a failed concurrent build, and with no valid
--       scope-key index every function falls back to a sequential scan: correct results, but the
--       hidden-volume side channel returns with no visible failure. Check indisvalid before any call.
--   C4. After applying, run read-only EXPLAIN once per function body against production statistics:
--       lexical, dense and structure must show Index Scan using foundation_retrieval_*_scope_key_idx
--       and no Seq Scan. Record indisvalid, the build time and the applied version (a connector
--       apply_migration records its own version string unless one is supplied) in the campaign ledger.
-- Rollback: supabase/drafts/rollback-20261127040000-scoped-retrieval-search-rpc.sql.
begin;

create index if not exists foundation_retrieval_units_scope_key_idx
  on public.foundation_retrieval_units ((length(workspace_key)::text || ':' || workspace_key || compile_run_id || document_id));
create index if not exists foundation_retrieval_embeddings_scope_key_idx
  on public.foundation_retrieval_embeddings ((length(workspace_key)::text || ':' || workspace_key || unit_id || retrieval_profile_id));

-- Validates the scope and returns the scope keys to look up. Raises; never returns a partial list.
create or replace function public.foundation_retrieval_scope_keys(
  p_workspace_key text,
  p_compile_run_id text,
  p_document_ids text[]
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_compile_run_id !~ '^retrieval-run-[a-f0-9]{32}$' then
    raise exception 'retrieval_scoped_search_run_invalid';
  end if;
  if p_document_ids is not null and cardinality(p_document_ids) = 0 then
    raise exception 'retrieval_scoped_search_documents_empty';
  end if;
  if p_document_ids is null
    or cardinality(p_document_ids) > 2000
    or exists (select 1 from unnest(p_document_ids) as d(id) where d.id is null or char_length(d.id) not between 1 and 256)
    or (select count(distinct d.id) from unnest(p_document_ids) as d(id)) <> cardinality(p_document_ids)
  then
    raise exception 'retrieval_scoped_search_documents_invalid';
  end if;
  return array(
    select length(p_workspace_key)::text || ':' || p_workspace_key || p_compile_run_id || d.id
    from unnest(p_document_ids) as d(id)
  );
end;
$$;

-- Lexical. The 0023 body; the admitted units are found by scope key.
create or replace function public.search_foundation_retrieval_units_lexical_scoped(
  p_workspace_key text,
  p_compile_run_id text,
  p_query_tokens text[],
  p_document_ids text[],
  p_limit integer
)
returns table (unit_id text, rank real)
language plpgsql
security definer
set search_path = ''
set enable_seqscan = off
set enable_bitmapscan = off
as $$
declare
  v_keys text[];
  v_tsquery text;
  v_safe_tokens text[];
begin
  if p_workspace_key is null or p_compile_run_id is null then
    raise exception 'retrieval_lexical_search_requires_scope';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'retrieval_lexical_search_limit_out_of_bounds';
  end if;
  v_keys := public.foundation_retrieval_scope_keys(p_workspace_key, p_compile_run_id, p_document_ids);

  select array_agg(distinct token)
    into v_safe_tokens
  from unnest(coalesce(p_query_tokens, array[]::text[])) as token
  where token ~ '^[[:alnum:]]+$' or token ~ '^\w+$';

  if v_safe_tokens is null or cardinality(v_safe_tokens) = 0 then
    raise exception 'retrieval_lexical_search_requires_safe_token';
  end if;

  select string_agg(quote_literal(token), ' | ')
    into v_tsquery
  from unnest(v_safe_tokens) as token;

  return query
  select u.unit_id,
         ts_rank_cd(u.search_vector, to_tsquery('simple', v_tsquery)) as rank
  from public.foundation_retrieval_units u
  where (length(u.workspace_key)::text || ':' || u.workspace_key || u.compile_run_id || u.document_id) = any(v_keys)
    and u.search_vector @@ to_tsquery('simple', v_tsquery)
  order by rank desc, u.unit_id asc
  limit p_limit;
end;
$$;

-- Dense. 0052's checks and qualified operators, driven from the admitted units. Exact distances,
-- as on 0052's path (no ANN index exists on either).
create or replace function public.search_foundation_retrieval_units_dense_scoped(
  p_workspace_key text,
  p_compile_run_id text,
  p_retrieval_profile_id text,
  p_query_embedding double precision[],
  p_metric text,
  p_document_ids text[],
  p_limit integer
)
returns table (unit_id text, distance double precision)
language plpgsql
security definer
set search_path = ''
set enable_seqscan = off
set enable_bitmapscan = off
as $$
declare
  v_keys text[];
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
  v_keys := public.foundation_retrieval_scope_keys(p_workspace_key, p_compile_run_id, p_document_ids);

  v_dimension := cardinality(p_query_embedding);
  if v_dimension < 1 or v_dimension > 8192 then
    raise exception 'retrieval_dense_search_dimension_out_of_bounds';
  end if;

  -- One row of the profile (any document, `limit 1`): the stored space, as 0052 reads it.
  select e.dimension into v_stored_dimension
  from public.foundation_retrieval_embeddings e
  where e.workspace_key = p_workspace_key
    and e.retrieval_profile_id = p_retrieval_profile_id
  limit 1;

  if v_stored_dimension is null then
    return;
  end if;

  if v_stored_dimension <> v_dimension then
    raise exception 'retrieval_dense_search_dimension_mismatch: stored % vs query %',
      v_stored_dimension, v_dimension;
  end if;

  v_query := p_query_embedding::public.vector;

  -- Each admitted unit's distance is a scalar subquery, never a join: a join lets the planner drive
  -- from the profile's embeddings, hidden units included. Inside it the embedding is found by its
  -- own scope key (workspace, unit, profile; unit ids are fixed-length by the 0020 check, so the key
  -- is injective), which only foundation_retrieval_embeddings_scope_key_idx serves: on the primary
  -- key the planner was measured choosing the profile index with unit_id as a filter instead.
  -- `offset 0` keeps the subquery from being flattened, so each distance is computed once. A unit
  -- with no embedding for the profile has a null distance and is dropped, as 0052's join drops it.
  return query
  select c.unit_id, c.distance
  from (
    select u.unit_id,
           (select case p_metric
                     when 'cosine' then (fe.embedding operator(public.<=>) v_query)::double precision
                     when 'l2' then (fe.embedding operator(public.<->) v_query)::double precision
                     else (fe.embedding operator(public.<#>) v_query)::double precision
                   end
              from public.foundation_retrieval_embeddings fe
             where (length(fe.workspace_key)::text || ':' || fe.workspace_key || fe.unit_id || fe.retrieval_profile_id)
                 = (length(u.workspace_key)::text || ':' || u.workspace_key || u.unit_id || p_retrieval_profile_id)) as distance
    from public.foundation_retrieval_units u
    where (length(u.workspace_key)::text || ':' || u.workspace_key || u.compile_run_id || u.document_id) = any(v_keys)
    offset 0
  ) as c
  where c.distance is not null
  order by c.distance asc, c.unit_id asc
  limit p_limit;
end;
$$;

-- Structure pool. Admitted units only, ordered by unit_id (the REST read it replaces had no order,
-- so its contents varied with hidden rows: review r1 N1), capped at 2000 as that read was. The
-- materialized CTE keeps ORDER BY unit_id from steering the scan onto the primary key.
create or replace function public.foundation_retrieval_structure_candidates_scoped(
  p_workspace_key text,
  p_compile_run_id text,
  p_document_ids text[],
  p_limit integer
)
returns table (unit_id text, claim_ids text[], entity_ids text[])
language plpgsql
security definer
set search_path = ''
set enable_seqscan = off
set enable_bitmapscan = off
as $$
declare
  v_keys text[];
begin
  if p_workspace_key is null or p_compile_run_id is null then
    raise exception 'retrieval_structure_candidates_requires_scope';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception 'retrieval_structure_candidates_limit_out_of_bounds';
  end if;
  v_keys := public.foundation_retrieval_scope_keys(p_workspace_key, p_compile_run_id, p_document_ids);

  return query
  with admitted as materialized (
    select u.unit_id, u.claim_ids, u.entity_ids
    from public.foundation_retrieval_units u
    where (length(u.workspace_key)::text || ':' || u.workspace_key || u.compile_run_id || u.document_id) = any(v_keys)
  )
  select a.unit_id, a.claim_ids, a.entity_ids
  from admitted a
  order by a.unit_id asc
  limit p_limit;
end;
$$;

revoke all on function public.foundation_retrieval_scope_keys(text, text, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.search_foundation_retrieval_units_lexical_scoped(text, text, text[], text[], integer)
  from public, anon, authenticated;
revoke all on function public.search_foundation_retrieval_units_dense_scoped(text, text, text, double precision[], text, text[], integer)
  from public, anon, authenticated;
revoke all on function public.foundation_retrieval_structure_candidates_scoped(text, text, text[], integer)
  from public, anon, authenticated;

grant execute on function public.search_foundation_retrieval_units_lexical_scoped(text, text, text[], text[], integer)
  to service_role;
grant execute on function public.search_foundation_retrieval_units_dense_scoped(text, text, text, double precision[], text, text[], integer)
  to service_role;
grant execute on function public.foundation_retrieval_structure_candidates_scoped(text, text, text[], integer)
  to service_role;

commit;
