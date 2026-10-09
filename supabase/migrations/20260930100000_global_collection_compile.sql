-- Private bounded collection reduction. Deployment does not activate the application flags.
begin;
alter table public.foundation_compile_jobs add column compilation_mode text not null default 'document_batch'
  check (compilation_mode in ('document_batch', 'global_collection'));
alter table public.foundation_compile_jobs add constraint foundation_global_collection_shape
  check (compilation_mode <> 'global_collection' or (
    corpus_id is not null and batch_index is not null and batch_count is not null
    and batch_index = 0 and batch_count = 1
    and cardinality(document_ids) between 1 and 128));

create function public.enqueue_foundation_global_collection_job(
  p_job_id text, p_workspace_key text, p_created_by_user_id uuid,
  p_document_ids text[], p_idempotency_key text, p_corpus_id text,
  p_batch_index integer, p_batch_count integer
) returns table (
  job_id text, state public.foundation_compile_state, created boolean,
  corpus_id text, batch_index integer, idempotency_key text
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row record;
begin
  if p_corpus_id is null or p_batch_index is distinct from 0 or p_batch_count is distinct from 1
    or p_document_ids is null or cardinality(p_document_ids) not between 1 and 128
    or cardinality(p_document_ids) <> cardinality(public.foundation_canonical_document_ids(p_document_ids))
    or exists (select 1 from unnest(p_document_ids) as d where d is null or d !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'invalid global collection scope' using errcode = '22023';
  end if;
  select * into v_row from public.enqueue_foundation_compile_job(
    p_job_id, p_workspace_key, p_created_by_user_id, p_document_ids,
    p_idempotency_key, p_corpus_id, p_batch_index, p_batch_count);
  -- The wrapper and initial enqueue are one transaction; no worker can observe half a job.
  if not v_row.created and not exists (
    select 1 from public.foundation_compile_jobs j
    where j.job_id = v_row.job_id and j.workspace_key = p_workspace_key
      and j.compilation_mode = 'global_collection'
  ) then
    raise exception 'legacy batch cannot become a global collection' using errcode = '23505';
  end if;
  update public.foundation_compile_jobs j set compilation_mode = 'global_collection'
    where j.job_id = v_row.job_id and j.workspace_key = p_workspace_key;
  return query select v_row.job_id::text, v_row.state::public.foundation_compile_state,
    v_row.created::boolean, v_row.corpus_id::text, v_row.batch_index::integer,
    v_row.idempotency_key::text;
end;
$$;
revoke all on function public.enqueue_foundation_global_collection_job(text,text,uuid,text[],text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.enqueue_foundation_global_collection_job(text,text,uuid,text[],text,text,integer,integer) to service_role;
commit;
