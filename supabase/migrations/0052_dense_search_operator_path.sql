-- 0052 — the dense retrieval RPC could not execute on any database built from these files.
--
-- Finding R-1 (USKC_DB_QUALIFICATION_CONTRACT_2026-09-06, Layer A results; reproduced in CI run
-- 34018684241, fixture foundation_retrieval_search_rpc.sql):
--
--   ERROR:  operator does not exist: public.vector <=> public.vector
--   CONTEXT: PL/pgSQL function public.search_foundation_retrieval_units_dense(...) line 47
--
-- 0020_retrieval_foundation.sql:9 runs `create extension if not exists vector` with no schema, so
-- the type and its operator class land in `public`. 0023_retrieval_search_rpc.sql:104 declares this
-- function `security definer set search_path = ''` -- correct for a definer function -- and then
-- writes bare `<=>`, `<->`, `<#>` at :153/:164/:175. An empty search path resolves operators
-- nowhere, so the first call raised 42883, the transaction aborted, and the six assertions after
-- it never ran. Dense retrieval was dead on every database built from the chain, and the
-- tenant-isolation assertion for dense search had never executed.
--
-- Repair: keep the empty search path (removing it would trade a resolution bug for a
-- search-path-injection surface on a SECURITY DEFINER function the server calls) and qualify the
-- three operators the same way the rest of the body already qualifies its tables and its type.
--
-- Only one function in the chain has this shape: `grep -n '<=>\|<->\|<#>' supabase/migrations/*.sql`
-- returns 0023 alone, and `search_foundation_retrieval_units_lexical` uses no extension operator.
-- No sibling needed the same repair.
--
-- Sequencing note: addendum L-7 wants `vector` moved out of `public` by expand/contract. That move
-- must re-qualify these three operators in the same change; it is not this migration's to make,
-- and doing it without touching this function breaks the same call from the other side.
--
-- Signature, volatility, SECURITY DEFINER, search path and grants are unchanged. `create or
-- replace` preserves the function's ACL; the revoke/grant below are restated so the file is
-- re-runnable and states the whole contract rather than half of it.

begin;

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

  -- All three operators are ascending = best first: <=> and <-> are distances, and <#>
  -- returns the negative inner product. Each is written `operator(public.<op>)` because
  -- `set search_path = ''` above resolves an unqualified operator nowhere.
  if p_metric = 'cosine' then
    return query
    select fe.unit_id, (fe.embedding operator(public.<=>) v_query)::double precision as distance
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
    select fe.unit_id, (fe.embedding operator(public.<->) v_query)::double precision as distance
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
    select fe.unit_id, (fe.embedding operator(public.<#>) v_query)::double precision as distance
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

revoke all on function public.search_foundation_retrieval_units_dense(text, text, text, double precision[], text, integer)
  from public, anon, authenticated;
grant execute on function public.search_foundation_retrieval_units_dense(text, text, text, double precision[], text, integer)
  to service_role;

commit;
