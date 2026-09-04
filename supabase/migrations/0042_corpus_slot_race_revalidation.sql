-- 0041 closed the collision where a standalone compile could be adopted as a corpus part, and it
-- refuses a slot whose occupant covers a different document set. It refuses it in one place and
-- not the other.
--
-- The function looks the slot up, and if nothing is there, inserts with ON CONFLICT DO NOTHING.
-- When two calls for the same slot race, one insert lands and the other affects zero rows, so the
-- loser re-reads the slot to report the winner as an existing job. That second read went straight
-- to `return query` -- the identity check exists only on the first read.
--
-- So: two concurrent enqueues for corpus part 3, carrying different document sets. Both find the
-- slot empty. One inserts. The other's insert is swallowed by ON CONFLICT, it re-reads part 3,
-- finds the winner's row, and returns it with created = false. That is the success shape. The
-- caller is told its part is enqueued, and the job under that name compiles documents it never
-- submitted. The sequential path raises 23505 for exactly this and the concurrent path does not,
-- which is the wrong way round: the concurrent path is the one a caller cannot reason about.
--
-- Three changes:
--
--   * The identity check moves into a function both reads call, so the two paths cannot drift
--     apart again. A check written twice is a check that gets fixed once.
--   * It also compares document sets, canonically. The idempotency key is a hash, and the whole
--     argument is about not compiling the wrong sources, so the identity is worth asserting
--     directly rather than only through its digest.
--   * The result carries the idempotency key back, so a caller that gets created = false can
--     confirm the row it was handed is the one it asked for instead of trusting the answer. A
--     client talking to a database without this migration reads null and fails closed.
--
-- It also repairs something worse that only appeared once the function was run on a server.
-- 0041 declares OUT columns named corpus_id and batch_index, which become plpgsql variables, and
-- then its body says `where corpus_id is null` and `where corpus_id = p_corpus_id`. PostgreSQL
-- resolves neither:
--
--   ERROR:  column reference "corpus_id" is ambiguous
--   It could refer to either a PL/pgSQL variable or a table column.
--
-- A function body is not parsed until it is called, so 0041 applies cleanly and every call fails
-- -- on both branches, so no corpus compile could be enqueued at all. Nothing noticed because the
-- only tests over it asserted the migration's text and faked the RPC. The queries below alias the
-- table and qualify every column against the alias, which is what makes them unambiguous.
begin;

create or replace function public.foundation_canonical_document_ids(p_document_ids text[])
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
  select coalesce(
    array(select distinct d from unnest(coalesce(p_document_ids, '{}'::text[])) as d order by d),
    '{}'::text[]
  )
$fn$;

comment on function public.foundation_canonical_document_ids(text[]) is
  'Sorted, de-duplicated document id set. The order and multiplicity a caller sends are not part of what a compile job is over.';

-- Raises if an existing row is not the job this call is asking for. Returns void so it reads as
-- an assertion: any exit that is not an exception means the row matched.
create or replace function public.assert_foundation_compile_identity(
  p_existing public.foundation_compile_jobs,
  p_idempotency_key text,
  p_document_ids text[]
)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if p_existing.idempotency_key is distinct from p_idempotency_key then
    raise exception
      'compile slot % of % is held by a job with a different compile identity',
      coalesce(p_existing.batch_index::text, 'standalone'),
      coalesce(p_existing.corpus_id, '(standalone)')
      using errcode = '23505';
  end if;

  -- Defence in depth. Reaching here with different documents means two distinct sets hashed to
  -- one key, so the key cannot be the thing that decides it.
  if public.foundation_canonical_document_ids(p_existing.document_ids)
     is distinct from public.foundation_canonical_document_ids(p_document_ids) then
    raise exception
      'compile job % carries the same identity key over a different document set',
      p_existing.job_id
      using errcode = '23505';
  end if;
end;
$fn$;

revoke all on function public.assert_foundation_compile_identity(public.foundation_compile_jobs, text, text[]) from public;

drop function if exists public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer);

create function public.enqueue_foundation_compile_job(
  p_job_id text,
  p_workspace_key text,
  p_created_by_user_id uuid,
  p_document_ids text[],
  p_idempotency_key text,
  p_corpus_id text default null,
  p_batch_index integer default null,
  p_batch_count integer default null
)
returns table (
  job_id text,
  state public.foundation_compile_state,
  created boolean,
  corpus_id text,
  batch_index integer,
  idempotency_key text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.foundation_compile_jobs%rowtype;
  v_inserted integer;
begin
  if p_corpus_id is null then
    -- A standalone compile is its document set. Scoped to standalone rows: a part of a corpus is
    -- a different thing, and answering with one would hand back a World that belongs to a run
    -- the caller knows nothing about.
    select * into v_existing
      from public.foundation_compile_jobs j
     where j.workspace_key = p_workspace_key
       and j.corpus_id is null
       and j.idempotency_key = p_idempotency_key;
  else
    -- A corpus part is its slot. Looking it up by key would make a retry whose batching changed
    -- silently occupy someone else's position.
    select * into v_existing
      from public.foundation_compile_jobs j
     where j.workspace_key = p_workspace_key
       and j.corpus_id = p_corpus_id
       and j.batch_index = p_batch_index;
  end if;

  if found then
    perform public.assert_foundation_compile_identity(v_existing, p_idempotency_key, p_document_ids);
    return query select v_existing.job_id, v_existing.state, false,
                        v_existing.corpus_id, v_existing.batch_index, v_existing.idempotency_key;
    return;
  end if;

  insert into public.foundation_compile_jobs (
    job_id, workspace_key, created_by_user_id, document_ids, idempotency_key,
    state, documents_total, corpus_id, batch_index, batch_count
  ) values (
    p_job_id, p_workspace_key, p_created_by_user_id, p_document_ids, p_idempotency_key,
    'preflight', cardinality(p_document_ids), p_corpus_id, p_batch_index, p_batch_count
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    return query select p_job_id, 'preflight'::public.foundation_compile_state, true,
                        p_corpus_id, p_batch_index, p_idempotency_key;
    return;
  end if;

  -- Lost the race between the select and the insert. Whichever writer won is committed by the
  -- time ON CONFLICT saw it, so read it back by the same identity.
  if p_corpus_id is null then
    select * into v_existing
      from public.foundation_compile_jobs j
     where j.workspace_key = p_workspace_key
       and j.corpus_id is null
       and j.idempotency_key = p_idempotency_key;
  else
    select * into v_existing
      from public.foundation_compile_jobs j
     where j.workspace_key = p_workspace_key
       and j.corpus_id = p_corpus_id
       and j.batch_index = p_batch_index;
  end if;

  if not found then
    -- The insert was refused by a constraint that is not the identity this call looked up -- a
    -- duplicate job_id, or a slot key colliding with a standalone key, which 0041 is supposed to
    -- have made impossible. Fail rather than loop.
    raise exception 'compile job enqueue was refused and no matching row exists'
      using errcode = '23505';
  end if;

  -- The check the race path was missing. The row that won is not necessarily the row this call
  -- described, and returning it unexamined is how a caller ends up owning someone else's job.
  perform public.assert_foundation_compile_identity(v_existing, p_idempotency_key, p_document_ids);

  return query select v_existing.job_id, v_existing.state, false,
                      v_existing.corpus_id, v_existing.batch_index, v_existing.idempotency_key;
end;
$$;

revoke all on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer) from public;
grant execute on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer) to service_role;

commit;
