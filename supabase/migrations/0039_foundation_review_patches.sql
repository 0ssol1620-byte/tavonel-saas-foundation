-- What an "edit" decision actually changed.
--
-- 0037 recorded that a reviewer disagreed: an action, a reason, and the evidence it was bound
-- to. That is a record of an opinion. Masterplan 10 asks for the other half -- the correction
-- itself -- and a correction nobody can inspect afterwards is not auditable, it is just a
-- different World with no explanation.
--
-- These columns are the audit trail the masterplan names: actor and timestamp were already
-- here, and before, after, the object corrected and the version that resulted were not. They
-- are nullable because every existing row and every accept/reject predates them and legitimately
-- has no patch; the constraint below is what makes them non-optional where they apply.
begin;

alter table public.foundation_review_decisions
  add column if not exists patch_object_id text
    check (patch_object_id is null or patch_object_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  add column if not exists patch_before text
    check (patch_before is null or char_length(patch_before) between 1 and 500),
  add column if not exists patch_after text
    check (patch_after is null or char_length(patch_after) between 1 and 500),
  -- The candidate this correction produced. A new artifact under a new key: the reviewed one
  -- is never overwritten, so both remain readable and each remains what its digest says.
  add column if not exists resulting_manifest_digest text
    check (resulting_manifest_digest is null or resulting_manifest_digest ~ '^sha256:[a-f0-9]{64}$');

/*
  A patch is all-or-nothing, and only an edit carries one.

  Without this, a row could claim a resulting version with no before and no after, or an
  'accept' could carry a correction nobody performed. Both would be worse than no audit trail,
  because they would look like one.
*/
alter table public.foundation_review_decisions
  add constraint foundation_review_decisions_patch_is_whole
    check (
      (patch_object_id is null and patch_before is null and patch_after is null and resulting_manifest_digest is null)
      or (
        action = 'edit'
        and patch_object_id is not null
        and patch_before is not null
        and patch_after is not null
        and resulting_manifest_digest is not null
        and patch_before is distinct from patch_after
      )
    );

-- Reading a corrected object's history: every patch against one compiled node, newest first.
create index if not exists foundation_review_decisions_patch_object_idx
  on public.foundation_review_decisions (workspace_key, collection_id, patch_object_id, created_at desc)
  where patch_object_id is not null;

commit;
