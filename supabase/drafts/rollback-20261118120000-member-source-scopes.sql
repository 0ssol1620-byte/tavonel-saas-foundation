-- Rollback for migration 20261118120000_member_source_scopes (WO-C-T3). The timestamp is
-- provisional, like the migration's: the lead renames both at merge.
--
-- Not a migration: run by hand, as one transaction, against the database where the migration was
-- applied, AFTER the site is reverted to a build that does not call documents_outside_member_scope
-- / member_readable_document_ids / get_member_source_scope / set_member_source_scope. Against this
-- rollback a build that still calls them finds no function and fails closed
-- (CONNECTOR_SOURCE_ACCESS_UNAVAILABLE / MEMBER_SOURCE_SCOPE_UNAVAILABLE); nothing is admitted.
--
-- It refuses, and changes nothing, when the membership history already holds a
-- 'member.source_scope_changed' event: that history is append-only (20260920110000) and the
-- restored action check could not hold over it. Deleting audit rows to make a rollback pass is not
-- this file's call; the operator decides, with the ledger.
--
-- Otherwise it drops the upload and the two tenure triggers, the nine functions and the scope table (its rows are the
-- feature's own state and go with it), and restores the membership events action check of
-- 20260920110000 verbatim. A missing object stops the rollback (no `if exists`).
--
-- Afterwards the catalog fingerprint (nextjs/scripts/db/catalog-fingerprints.sql) equals the one of
-- the chain ending before this migration.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator deletes the migration's version row in the same session and writes the
-- version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if exists (select 1 from public.foundation_workspace_membership_events where action = 'member.source_scope_changed') then
    raise exception 'rollback_refused_member_source_scope_events_exist';
  end if;
end;
$$;

drop trigger foundation_member_upload_scope on public.foundation_intake_admissions;
drop function public.foundation_member_upload_scope();
drop trigger foundation_member_scope_tenure_end on public.foundation_workspace_members;
drop function public.foundation_member_scope_tenure_end();
drop trigger foundation_member_scope_requires_active_member on public.foundation_workspace_member_source_scopes;
drop function public.foundation_member_scope_requires_active_member();
drop function public.set_member_source_scope(text, uuid, uuid, text, uuid[], text);
drop function public.get_member_source_scope(text, uuid, uuid);
drop function public.documents_outside_member_scope(text, uuid, text[]);
drop function public.member_readable_document_ids(text, uuid, text[]);
drop function public.foundation_member_source_scope_stored(text, uuid);
drop function public.foundation_member_source_scope_digest(text, uuid[]);
drop table public.foundation_workspace_member_source_scopes;

-- From 20260920110000_workspace_membership_control_plane.sql, verbatim.
alter table public.foundation_workspace_membership_events
  drop constraint foundation_workspace_membership_events_action_check;
alter table public.foundation_workspace_membership_events
  add constraint foundation_workspace_membership_events_action_check check (action in (
    'invite.created', 'invite.accepted', 'invite.revoked',
    'member.role_changed', 'member.revoked'
  ));

commit;
