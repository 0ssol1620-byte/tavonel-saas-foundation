-- 0041 — a standalone compile is not a corpus part, even over the same documents.
--
-- 0038 made a job's identity its document set, and 0040 added corpus parts without changing
-- that. So this happened:
--
--   1. Compile documents [1..12]. A row is written with idempotency_key = H(workspace, docs)
--      and corpus_id null.
--   2. Later, compile [1..128] as a corpus. Partitioning is deterministic and sorted, so
--      batch 0 is exactly [1..12], and its key is the same H(workspace, docs).
--   3. enqueue_foundation_compile_job looked the key up on (workspace_key, idempotency_key)
--      alone, found the standalone row, and returned it as part 0 with created = false.
--
-- The corpus then had ten parts where it believed it had eleven. The adopted row still carried
-- corpus_id null, so readCorpusParts never returned it, the run could not settle, and the
-- customer's twelve documents appeared in a World that belonged to no corpus. Nothing errored.
--
-- The fix is that a corpus part is identified by its slot -- which corpus, which position --
-- and a standalone compile is identified by its document set among standalone rows only.
-- Those are different questions and this function now asks whichever one applies.
--
-- Three things change together, because any one of them alone still leaves the hole open:
--
--   * The application namespaces the key (compile-identity/2, standalone vs corpus-part) so a
--     standalone key and a slot key cannot be equal. Backfilled below.
--   * This function looks up by slot for a corpus part, and refuses a slot whose occupant
--     covers a different document set rather than returning it.
--   * The insert races through ON CONFLICT DO NOTHING and re-reads, so two concurrent enqueues
--     of the same slot produce one row and one of them learns it did not create it. The old
--     select-then-insert let both callers past the select, and the loser got a unique violation
--     as an unhandled error.

-- ---------------------------------------------------------------------------------------
-- Backfill: rewrite every stored key into the namespaced form.
--
-- Stored keys are compared, never recomputed from a row, so leaving old-format keys in place
-- would mean a resubmission of an existing job computing a v2 key, matching nothing, and
-- enqueuing a second job over documents that are already compiling -- which is the double
-- charge the idempotency key exists to prevent. The version prefix is what makes this
-- rewrite safe to reason about: a key that does not start with it has not been rewritten.
-- ---------------------------------------------------------------------------------------
-- Recomputed from workspace_key, document_ids, corpus_id and batch_index rather than derived
-- from the old key, so running it twice produces the same value as running it once.
update public.foundation_compile_jobs as job
   set idempotency_key = encode(
         sha256(convert_to(
           'compile-identity/2' || E'\n' ||
           case
             when job.corpus_id is null then
               'standalone' || E'\n' || job.workspace_key
             else
               'corpus-part' || E'\n' || job.workspace_key || E'\n' ||
               job.corpus_id || E'\n' || job.batch_index::text
           end || E'\n' ||
           (select string_agg(document_id, E'\n' order by document_id)
              from (select distinct unnest(job.document_ids) as document_id) as ids),
           'UTF8')),
         'hex')
 where cardinality(job.document_ids) > 0;

-- ---------------------------------------------------------------------------------------
-- The enqueue function, slot-aware and race-safe.
--
-- Returns corpus_id and batch_index as well, so the caller can check that the row it was
-- given is the slot it asked for instead of trusting the answer. A client talking to a
-- database that has not run this migration gets a result with those columns absent, reads
-- them as null, and fails closed.
-- ---------------------------------------------------------------------------------------
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
  batch_index integer
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
    -- A standalone compile is its document set. Scoped to standalone rows: a part of a corpus
    -- is a different thing and answering with one would hand back a World that belongs to a
    -- run the caller knows nothing about.
    select * into v_existing
      from public.foundation_compile_jobs
     where workspace_key = p_workspace_key
       and corpus_id is null
       and idempotency_key = p_idempotency_key;
  else
    -- A corpus part is its slot. Looking it up by key would make a retry whose batching
    -- changed silently occupy someone else's position.
    select * into v_existing
      from public.foundation_compile_jobs
     where workspace_key = p_workspace_key
       and corpus_id = p_corpus_id
       and batch_index = p_batch_index;
  end if;

  if found then
    if v_existing.idempotency_key is distinct from p_idempotency_key then
      -- Same slot, different documents. There is no correct answer that is not a decision:
      -- returning the occupant compiles the wrong sources under this part's name, and
      -- replacing it discards a run already in flight. 23505 so the caller sees a conflict.
      raise exception
        'corpus slot % of % is held by a job over a different document set',
        p_batch_index, p_corpus_id
        using errcode = '23505';
    end if;
    return query select v_existing.job_id, v_existing.state, false, v_existing.corpus_id, v_existing.batch_index;
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
    return query select p_job_id, 'preflight'::public.foundation_compile_state, true, p_corpus_id, p_batch_index;
    return;
  end if;

  -- Lost the race between the select and the insert. Whichever writer won is committed by the
  -- time ON CONFLICT saw it, so read it back by the same identity and report it as existing.
  if p_corpus_id is null then
    select * into v_existing
      from public.foundation_compile_jobs
     where workspace_key = p_workspace_key
       and corpus_id is null
       and idempotency_key = p_idempotency_key;
  else
    select * into v_existing
      from public.foundation_compile_jobs
     where workspace_key = p_workspace_key
       and corpus_id = p_corpus_id
       and batch_index = p_batch_index;
  end if;

  if not found then
    -- The insert was refused by a constraint that is not the identity this call looked up --
    -- a duplicate job_id, or a slot key colliding with a standalone key, which 0041 is
    -- supposed to have made impossible. Fail rather than loop.
    raise exception 'compile job enqueue was refused and no matching row exists'
      using errcode = '23505';
  end if;

  return query select v_existing.job_id, v_existing.state, false, v_existing.corpus_id, v_existing.batch_index;
end;
$$;

revoke all on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer) from public;
grant execute on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer) to service_role;

comment on column public.foundation_compile_jobs.idempotency_key is
  'Namespaced compile identity (compile-identity/2). Standalone jobs hash the workspace and document set; corpus parts hash the workspace, corpus id, batch index and document set, so a standalone compile can never satisfy a corpus slot.';
