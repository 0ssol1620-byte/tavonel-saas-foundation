-- 0040 — a corpus is a set of compile jobs, not a bigger compile job.
--
-- Intake takes a 128-file archive; one compile takes twelve documents. Closing that gap by
-- raising the compile ceiling would put a hundred documents' OCR output inside a single Core
-- request and a single function invocation, which is the shape the durable job in 0038 exists
-- to replace. So a large selection is partitioned into compile-sized parts, each part is an
-- ordinary row in foundation_compile_jobs, and the parts carry the corpus they belong to.
--
-- Three consequences worth stating, because each is a decision and not a detail:
--
--   * Nothing about the state machine changes. A part advances, blocks, resolves and settles
--     exactly as a single compile does, and the worker cannot tell the difference. Adding a
--     parallel corpus state machine would mean two implementations of terminal-is-terminal.
--   * The parts are not merged. Each finished part is the World it compiled, with its own
--     collection id and digest. Cross-part identity resolution -- deciding that an entity in
--     part 1 and an entity in part 7 are the same thing -- is Core work with its own evidence
--     requirements, and concatenating two ontologies without it would manufacture duplicates.
--   * corpus_id is derived from the document set, like idempotency_key. Enqueue is therefore
--     resumable: a submission interrupted after four of eleven parts re-enqueues into the same
--     corpus and gets the four that exist back unchanged.

alter table public.foundation_compile_jobs
  add column corpus_id text
    check (corpus_id is null or corpus_id ~ '^corpus-[a-f0-9]{32}$'),
  add column batch_index integer
    check (batch_index is null or batch_index >= 0),
  add column batch_count integer
    check (batch_count is null or batch_count between 1 and 64);

-- All three or none. A part that knows its corpus but not its position cannot be ordered, and
-- a row carrying a position with no corpus is a single compile pretending to be a part.
alter table public.foundation_compile_jobs
  add constraint foundation_compile_jobs_corpus_is_whole
    check (
      (corpus_id is null and batch_index is null and batch_count is null)
      or (corpus_id is not null and batch_index is not null and batch_count is not null
          and batch_index < batch_count)
    );

-- One row per position. Without this a retried enqueue that raced itself could write part 3
-- twice, and the corpus would report twelve parts of eleven.
create unique index foundation_compile_jobs_corpus_slot_idx
  on public.foundation_compile_jobs (workspace_key, corpus_id, batch_index)
  where corpus_id is not null;

create index foundation_compile_jobs_corpus_idx
  on public.foundation_compile_jobs (workspace_key, corpus_id, batch_index)
  where corpus_id is not null;

-- The enqueue function grows three arguments. Replacing it in place rather than adding an
-- overload: two functions of the same name differing only by defaulted arguments is an
-- ambiguity PostgREST resolves by guessing, and the guess is not always the same one.
drop function if exists public.enqueue_foundation_compile_job(text, text, uuid, text[], text);

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
returns table (job_id text, state public.foundation_compile_state, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.foundation_compile_jobs%rowtype;
begin
  select * into v_existing
    from public.foundation_compile_jobs
   where workspace_key = p_workspace_key
     and idempotency_key = p_idempotency_key;

  if found then
    return query select v_existing.job_id, v_existing.state, false;
    return;
  end if;

  insert into public.foundation_compile_jobs (
    job_id, workspace_key, created_by_user_id, document_ids, idempotency_key,
    state, documents_total, corpus_id, batch_index, batch_count
  ) values (
    p_job_id, p_workspace_key, p_created_by_user_id, p_document_ids, p_idempotency_key,
    'preflight', cardinality(p_document_ids), p_corpus_id, p_batch_index, p_batch_count
  );

  return query select p_job_id, 'preflight'::public.foundation_compile_state, true;
end;
$$;

revoke all on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer) from public;
grant execute on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer) to service_role;

comment on column public.foundation_compile_jobs.corpus_id is
  'Set when this job is one part of a corpus compile. Derived from the corpus document set, so a resumed enqueue lands in the same corpus.';
comment on column public.foundation_compile_jobs.batch_index is
  'Zero-based position of this part within its corpus.';
comment on column public.foundation_compile_jobs.batch_count is
  'How many parts the corpus was partitioned into. Every part of one corpus carries the same value.';
