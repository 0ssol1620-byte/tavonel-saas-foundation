-- DRAFT owning negative SQL tests. PostgreSQL/pgTAP syntax, privileges, FKs and concurrency
-- UNRUN. Disposable offline DB only after reviewed frozen schema + sibling reader draft.
-- No qualification/grant/receipt/reservation/customer rows are seeded. Gate remains CLOSED.
begin;
select no_plan();
select ok((select p.prosecdef from pg_catalog.pg_proc p where p.oid='public.read_foundation_native_purpose_candidate_v1(jsonb,uuid)'::regprocedure),
  'service reader uses confined definer');
select ok((select 'search_path=""'=any(p.proconfig) from pg_catalog.pg_proc p
  where p.oid='public.read_foundation_native_purpose_candidate_v1(jsonb,uuid)'::regprocedure),'empty fixed search path');
select ok((select 'lock_timeout=2s'=any(p.proconfig) from pg_catalog.pg_proc p
  where p.oid='public.read_foundation_native_purpose_candidate_v1(jsonb,uuid)'::regprocedure),'bounded lock wait');
select ok(not pg_catalog.has_function_privilege('anon','public.read_foundation_native_purpose_candidate_v1(jsonb,uuid)','EXECUTE'),'anonymous cannot read');
select ok(not pg_catalog.has_function_privilege('authenticated','public.read_foundation_native_purpose_candidate_v1(jsonb,uuid)','EXECUTE'),'user cannot read');
select ok(pg_catalog.has_function_privilege('service_role','public.read_foundation_native_purpose_candidate_v1(jsonb,uuid)','EXECUTE'),'service can invoke closed metadata RPC only');
select is(public.read_foundation_native_purpose_candidate_v1(null,null),null::jsonb,'default gate refuses missing context');
select is(public.read_foundation_native_purpose_candidate_v1('{"qualified":true}', '0c0c0c0c-0000-4000-8000-00000000000b'),null::jsonb,'client boolean cannot open gate');
select is(public.read_foundation_native_purpose_candidate_v1('{}', '0c0c0c0c-0000-4000-8000-00000000000b'),null::jsonb,'malformed context refuses');
select is(public.read_foundation_native_purpose_candidate_v1(pg_catalog.jsonb_build_object(
  'workspaceId','pilot-native','tenantId','pilot-native','principalUserId','0c0c0c0c-0000-4000-8000-00000000000e',
  'jobId','cjob-'||repeat('1',32),'authorizationRevision',3,'collectionId','collection-'||repeat('2',32),
  'replayBinding','native-work-'||repeat('3',32),'documentIds',pg_catalog.jsonb_build_array('0c0c0c0c-0000-4000-8000-00000000000a')),
  '0c0c0c0c-0000-4000-8000-00000000000b'),null::jsonb,'well-shaped context cannot open prerequisite gate');
select is((select count(*)::integer from public.foundation_native_qualification_profiles),0,'no qualification seeded');
select is((select count(*)::integer from public.foundation_native_purpose_grants),0,'no purpose permission seeded');
select is((select count(*)::integer from public.foundation_native_purpose_members),0,'no native output binding seeded');
select * from finish();
rollback;

-- REQUIRED AFTER EXACT AUTHORIZE RPC SOURCE/LOCK REVIEW AND A SEPARATE GATE PATCH, ALL UNRUN:
-- 1. Pending UNREVIEWED/PROPOSED/UNBOUND metadata may be read only under current source/job
--    authorization. It still has no permission, key material, scanner/CDR status or qualification.
-- 2. Wrong workspace/principal/job/revision/collection/replay, extra/missing/duplicate/full-set
--    approval members, foreign reservation/approval/file and original/expected-PDF mismatch refuse.
-- 3. Deletion, connector binding, unconfirmed intake, tombstoned source/version, wrong source
--    MIME/hash/bytes/key/parents and incomplete original->expected-PDF lineage refuse.
-- 4. Revoked/expired/not-yet-current profile/grant/member, missing job authorizer/revision,
--    cancelled job, Read Committed violation, >16 rows, >256 KiB and lock timeout refuse.
-- 5. Billing states reserved/settled/released/operator_review/expired remain opaque references;
--    no credit/hold/settlement change and no conversion into native approval occurs.
-- 6. Bound or fabricated partial output refuses in this SQL slice. A separate canonical-receipt
--    SQL review is required before bound snapshots; an adapter-only digest is not SQL evidence.
-- 7. Two-session races: hold each approval/deletion/source/version/job/grant/profile/member/
--    reservation lock; revoke/expire/cancel/delete/change full membership while reader waits.
--    Capture must reflect the newly committed state after waits, or refuse; never emit stale rows.
--    Noncompliant inserts after prelock scan must be counted in the same final captured set.
-- 8. Row/advisory locks remain held until transaction commit/rollback, not function return.
