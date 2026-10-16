-- DRAFT SQL acceptance contract. PostgreSQL/pgTAP execution UNRUN.
-- Disposable offline Foundation DB only, AFTER reviewed canonical prerequisites and the
-- sibling candidate schema. No native grant, qualification or paid customer is seeded.
begin;
select no_plan();
select is((select count(*)::integer from public.foundation_native_qualification_profiles),0,'no profiles seeded');
select is((select count(*)::integer from public.foundation_native_purpose_grants),0,'no native permissions seeded');
select is((select count(*)::integer from public.foundation_native_purpose_members),0,'no receipts/bindings seeded');
select ok(c.relrowsecurity,'RLS enabled: ' || c.relname)
from pg_catalog.pg_class c where c.oid in ('public.foundation_native_qualification_profiles'::regclass,
  'public.foundation_native_purpose_grants'::regclass,'public.foundation_native_purpose_members'::regclass);
select ok(not pg_catalog.has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE'),role_name || ' has no table access: ' || table_name)
from (values('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values('public.foundation_native_qualification_profiles'),('public.foundation_native_purpose_grants'),
  ('public.foundation_native_purpose_members')) tables(table_name);
insert into public.foundation_native_qualification_profiles(qualification_id,producer_id,producer_key_id,producer_key_reference,
  producer_revision,caller_id,reader_revision,input_mime_type,cir_schema_version,native_parser_version)
values('synthetic-unreviewed-profile','synthetic-producer','synthetic-key-id','keyref:synthetic-never-loaded',
  'sha256:' || repeat('a',64),'synthetic-caller','sha256:' || repeat('b',64),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','cir-1.0.0','1.2.0');
select is((select state from public.foundation_native_qualification_profiles where qualification_id='synthetic-unreviewed-profile'),
  'unreviewed','a profile record is unreviewed by default');
select ok((select reviewed_at is null and independent_qualifier_id is null and review_attestation_sha256 is null
  from public.foundation_native_qualification_profiles where qualification_id='synthetic-unreviewed-profile'),'no review proof is invented');
select throws_ok('update public.foundation_native_qualification_profiles set state=''reviewed'' where qualification_id=''synthetic-unreviewed-profile''',
  '23514',null,'a state string cannot supply missing review evidence');
-- Revoking a never-reviewed candidate must not invent an independent qualification.
update public.foundation_native_qualification_profiles set state='revoked',revoked_at=clock_timestamp()
where qualification_id='synthetic-unreviewed-profile';
select ok((select reviewed_at is null and state='revoked' from public.foundation_native_qualification_profiles
  where qualification_id='synthetic-unreviewed-profile'),'unreviewed revocation retains absence of qualification');
select * from finish();
rollback;

-- FUTURE ACCEPTANCE / ISSUANCE / CONCURRENCY TESTS, ALL PENDING, NOT IMPLEMENTED BY THIS SCHEMA:
-- - No profile/unreviewed/revoked/expired profile; producer/reader/key/schema/parser revision drift.
-- - Reviewer alias/identity independence and valid review attestation under a reviewed trust root.
-- - No explicit native permission; foreign/missing issuer; wrong authorization policy/evidence;
--   existing OCR/CDR/qualification-stage/approved intake/client true MUST NOT grant native purpose.
-- - Exact whole intake-approved set, no dropped/additional/duplicate members; reject >16 and
--   preserve the existing 8MiB aggregate CIR cap rather than expanding it.
-- - Same approval principal/workspace/scope, approved file/document/original hash/bytes/MIME;
--   exact existing reservation/document/workspace/principal association and user-approved
--   reference policy. Never relabel billing state, create a second hold, settle or charge.
-- - Current job/principal authorization/revision/cancellation, upload/source/version tombstones,
--   connector exclusion, complete bounded same-version original/expected-PDF lineage.
-- - Security object digest/signature/input/output binding/revocation under a trusted independently
--   qualified verifier; receipt ID/key or PDF CDR routing hash alone is never adequate.
-- - Native byte/key/hash equality; CIR byte/object/canonical digest and full signed receipt binds
--   exact grant/job/profile/source/member/replay identities; no output claim before processing.
-- - Immutable approved identities and output binding; monotonic irreversible revocation;
--   replacement uses a new record/ID, not in-place review/revision/replay rebinding.
-- - Existing approval advisory lock -> sorted upload-deletion locks -> current job authorization
--   protocol -> sorted source/version/representation -> grant/profile/member locks, compatible
--   with existing revocation/writer order. Determine exact ordering from verified job RPC source
--   before implementing any transaction; do not hold grants then acquire earlier advisory locks.
-- - Capture/revalidate after waits, expiry sampled at actual acceptance, qualification/grant/
--   security revocation and deletion/cancellation races, blocked inserts/updates, lock timeout,
--   transaction-end lock semantics and source-set/parent/UTF8 overflow refusal.
-- - Output binding must not publish artifacts, bind shared replay, create an active World,
--   imply customer billing behavior or install a live NativeAuthorityRepository.
