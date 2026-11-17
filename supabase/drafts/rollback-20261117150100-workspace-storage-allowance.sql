-- Rollback for migration 20261117150100_workspace_storage_allowance.
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117150100 was
-- applied. It undoes exactly that change and refuses to run over anything else.
--
-- Order: roll the application back FIRST. The current nextjs/lib/intake-admission.ts calls the
-- seven-argument signature; once it is dropped, PostgREST answers that call 404 and every upload
-- and connector import is refused INTAKE_ADMISSION_FAILED until the previous app is live.
--
--   1. Asserts both live wrappers are the ones 20261117150100 installed
--      (six-argument md5 bcb7c80519dc5070c528a776f6712e7c, seven-argument aecf70d008885818ee00929cb5084337).
--      Anything else stops here, nothing changed.
--   2. Drops the seven-argument wrapper and restores the six-argument one to its 20260927102000 body.
--   3. Asserts the restored wrapper is byte-for-byte the 20260927102000 one
--      (md5(pg_get_functiondef) = 7377f1a0a242763dba0a730c0298dcbc). `create or replace` keeps its
--      owner and grants. The inner _unchecked function was never touched and is not touched here.
--
-- No row is written by the migration, so nothing else is undone: admissions refused under the
-- allowance were never inserted. Recording it: this file does not edit
-- supabase_migrations.schema_migrations. After it commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117150100';
-- in the same session, and writes the version, the time, the md5s above and who ran it into the
-- campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare v_six text; v_seven text;
begin
  select md5(pg_get_functiondef('public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text)'::regprocedure))
    into v_six;
  select md5(pg_get_functiondef(p.oid)) into v_seven
    from pg_proc p where p.oid = to_regprocedure('public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)');
  if v_six is distinct from 'bcb7c80519dc5070c528a776f6712e7c' or v_seven is distinct from 'aecf70d008885818ee00929cb5084337' then
    raise exception 'rollback_20261117150100_refused: live wrappers % / % are not the 20261117150100 bodies', v_six, v_seven;
  end if;
end;
$guard$;

drop function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb);

create or replace function public.reserve_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid, p_object_key text,
  p_requested_bytes integer, p_declared_mime_type text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- The same lock the inner function takes first; re-entrant within this transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  return public.reserve_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_object_key, p_requested_bytes, p_declared_mime_type);
end;
$$;

do $verify$
declare v_md5 text;
begin
  select md5(pg_get_functiondef('public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text)'::regprocedure))
    into v_md5;
  if v_md5 is distinct from '7377f1a0a242763dba0a730c0298dcbc' then
    raise exception 'rollback_20261117150100_unverified: restored wrapper md5 % is not the 20260927102000 body', v_md5;
  end if;
end;
$verify$;

commit;
