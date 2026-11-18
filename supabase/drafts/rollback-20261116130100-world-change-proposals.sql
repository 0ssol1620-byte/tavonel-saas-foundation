-- Rollback for migration 20261116130100_world_change_proposals (WO-D30-1).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261116130100 was
-- applied, AFTER the site is reverted to a build with no proposal routes (origin/main dbf52077 has
-- none: nextjs/lib/change-proposals.ts does not exist there). Rehearsed by WO-REL-3 on throwaway
-- PostgreSQL 17.2 clusters: apply, refusals, rollback, schema fingerprint back to origin/main's.
--
-- DATA LOSS ON ROLLBACK: public.world_change_proposals. Dropping the table destroys every proposal
-- row written after the migration: who proposed what (principal_kind, principal_id, input,
-- input_sha256, evidence_ids), the World digest it was made against, who confirmed or rejected it and
-- when (decided_by, decided_at), and the execution and undo receipts (receipt). Nothing else in the
-- schema keeps that record; the label rows an executed proposal wrote stay in document_labels, but the
-- link from them back to the proposal and its decision is lost. This file therefore REFUSES while the
-- table holds any row, and never deletes one to make the rollback pass. Emptying the table is a
-- destructive action: it needs an export first (for example
--   \copy (select * from public.world_change_proposals order by created_at, proposal_id) to 'world_change_proposals-<UTC date>.csv' csv header
-- with its sha256 in the ledger) and a lead decision recorded in the ledger. With rows present and no
-- such decision, the reversible choice is to leave 20261116130000-20261116130200 applied: the table is
-- deny-all to clients and the origin/main build never touches it.
--
-- Order (dependencies on later migrations of the 16):
--   * 20261117130000_agent_proposals alters this table (columns agent_grant_id and binding_kind,
--     nullable collection_id, five replaced constraints, three indexes) and replaces
--     create_world_change_proposal and decide_world_change_proposal. Its rollback
--     (supabase/drafts/rollback-20261117130000-agent-proposals.sql) restores the 20261116130100 bodies
--     and constraints and must run first; 20261117130100, 20261117130200 and 20261117130300 update this
--     table from their functions, and their rollbacks run before that one (8, 7, 6, 5).
--   * 20261116130200 adds this table to the founder test reset and fences it with a trigger. Its
--     rollback (rollback-20261116130200-founder-test-reset-change-proposals.sql) must run first, or the
--     reset functions would name a table that no longer exists.
--   * 20261116130000's rollback runs after this one (the library_label executor calls it).
--   So: 8, 7, 6, 5, (4, unrelated), 3, then this file, then 1. The guard below refuses any other order.
--
--   1. Refuses, changing nothing, unless: 20261117130000 is rolled back (no foundation_agent_grants,
--      no agent_grant_id / binding_kind column, no 16-argument create function, no
--      get_world_change_proposal / list_world_change_proposals_page); 20261116130200 is rolled back
--      (no founder_reset_fence trigger on this table, no reset function body naming it); the four
--      functions are the definitions 20261116130100 installed (md5(pg_get_functiondef), read from a
--      local apply of the migration; the md5 of their prosrc alone is e5bd069f..., f6ce4b2b...,
--      6077e3cf..., 4c096822...); and the table is empty. Anything else, a missing object included,
--      stops here, nothing changed.
--   2. Drops, in reverse order of the migration: the four functions (their revoke/grant ACL entries go
--      with them), the policy, the index and the table (its RLS flag and its revoked grants go with it).
--   3. Asserts none of these objects exists, which is the origin/main state (no migration on origin/main
--      mentions world_change_proposals: `git grep world_change_proposal origin/main -- supabase/` is empty).
--
-- Statements in the migration: 17 (create table, create index, enable row level security, revoke on
-- the table, create policy, four create function, four revoke and four grant on functions).
-- Reversed here: 17.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261116130100';
-- in the same session, and writes the version, the time, the md5 values below and who ran it into the
-- campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare
  v_create text;
  v_decide text;
  v_record text;
  v_list text;
begin
  if to_regclass('public.foundation_agent_grants') is not null
    or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'world_change_proposals'
                  and column_name in ('agent_grant_id', 'binding_kind'))
    or to_regprocedure('public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz, text, uuid, integer, integer)') is not null
    or to_regprocedure('public.get_world_change_proposal(text, uuid)') is not null
    or to_regprocedure('public.list_world_change_proposals_page(text, uuid, timestamptz, uuid, integer)') is not null then
    raise exception 'rollback_20261116130100_refused: 20261117130000 is still applied; run its rollback (after 8, 7, 6) first';
  end if;

  if exists (select 1 from pg_catalog.pg_trigger
              where tgname = 'founder_reset_fence' and tgrelid = to_regclass('public.world_change_proposals'))
    or exists (select 1 from pg_catalog.pg_proc
                where pronamespace = 'public'::regnamespace
                  and proname in ('founder_test_reset_rows_fingerprint', 'founder_test_reset_table_counts', 'finalize_founder_test_reset')
                  and position('world_change_proposals' in prosrc) > 0) then
    raise exception 'rollback_20261116130100_refused: 20261116130200 is still applied; run its rollback first';
  end if;

  select md5(pg_get_functiondef('public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz)'::regprocedure))
    into v_create;
  select md5(pg_get_functiondef('public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz)'::regprocedure))
    into v_decide;
  select md5(pg_get_functiondef('public.record_world_change_proposal_outcome(text, uuid, text, jsonb)'::regprocedure))
    into v_record;
  select md5(pg_get_functiondef('public.list_world_change_proposals(text, text, integer)'::regprocedure))
    into v_list;
  if v_create is distinct from '98b81fe1ea8ff0c37f6fc50687b094ef'
    or v_decide is distinct from '7f16228bdd565550c51433a9f8b5bd1d'
    or v_record is distinct from 'df60848a9237d712dad92968e4a8efa0'
    or v_list is distinct from 'a6ddc3380a2f1169788a6f49fe585030' then
    raise exception 'rollback_20261116130100_refused: live definitions % / % / % / % are not the 20261116130100 definitions',
      v_create, v_decide, v_record, v_list;
  end if;

  if to_regclass('public.world_change_proposals') is null then
    raise exception 'rollback_20261116130100_refused: public.world_change_proposals does not exist';
  end if;
  if exists (select 1 from public.world_change_proposals) then
    raise exception 'rollback_20261116130100_refused: world_change_proposals holds rows; dropping it loses them (see DATA LOSS ON ROLLBACK)';
  end if;
end;
$guard$;

-- Reverses `revoke all ... / grant execute ... to service_role` on each function and the four
-- `create function` statements, last created first.
drop function public.list_world_change_proposals(text, text, integer);
drop function public.record_world_change_proposal_outcome(text, uuid, text, jsonb);
drop function public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz);
drop function public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz);

-- Reverses `create policy world_change_proposals_no_client_access`.
drop policy world_change_proposals_no_client_access on public.world_change_proposals;

-- `revoke all on public.world_change_proposals from public, anon, authenticated, service_role` and
-- `alter table ... enable row level security` are properties of the table and are reversed by the
-- drop table below; restoring default grants or disabling RLS on a table about to be dropped would
-- only open it for the length of this transaction.

-- Reverses `create index world_change_proposals_collection_idx`.
drop index public.world_change_proposals_collection_idx;

-- Reverses `create table public.world_change_proposals` (its primary key, unique and check
-- constraints go with it). No foreign key points at it, so nothing cascades.
drop table public.world_change_proposals;

do $verify$
begin
  if to_regclass('public.world_change_proposals') is not null
    or to_regclass('public.world_change_proposals_collection_idx') is not null
    or exists (select 1 from pg_catalog.pg_proc
                where pronamespace = 'public'::regnamespace
                  and proname in ('create_world_change_proposal', 'decide_world_change_proposal',
                                  'record_world_change_proposal_outcome', 'list_world_change_proposals'))
    or exists (select 1 from pg_catalog.pg_policies where policyname = 'world_change_proposals_no_client_access') then
    raise exception 'rollback_20261116130100_mismatch: an object of 20261116130100 still exists';
  end if;
end;
$verify$;

commit;
