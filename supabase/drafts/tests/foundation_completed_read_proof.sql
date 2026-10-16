-- DRAFT pgTAP fixture. DATABASE EXECUTION UNRUN here; root owns disposable CI.
-- Requires complete Foundation 83c1e06 plus the draft migration and pgTAP.
-- Synthetic only. Never run on production; all fixture rows/DDL/ledger mutations roll back.
begin;
select plan(66);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','88888888-8888-4888-8888-888888888888',
  'authenticated','authenticated','completed-read-fixture@example.invalid','$2a$10$fixture',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
select public.apply_foundation_billing_event_v4('evt_' || rpad('readproof',26,'a'),'transaction.completed',
  now(),'sha256:' || repeat('1',64),'allowance','pilot-readproof','88888888-8888-4888-8888-888888888888',
  'observer_access','txn_' || rpad('readproof',26,'a'),'ctm_' || rpad('readproof',26,'a'),null,null,2000,null);

create temporary table completed_read_fixture(doc uuid primary key, facts jsonb);
do $$
declare d uuid; v text; prefix text; binding text; i integer; original_id text; normalized_id text;
begin
  binding := 'sha256:' || encode(sha256(convert_to('["tavonel.qualified_reader_binding.v1",'
    || '"https://foundation-ocr.example/v1/ocr","sha256:' || repeat('a',64) || '","sha256:' || repeat('b',64) || '"]','UTF8')),'hex');
  insert into public.foundation_completed_read_qualifications(binding_sha256,endpoint,reader_revision,
    qualification_sha256,immutable_endpoint_verified,qualified_at)
  values(binding,'https://foundation-ocr.example/v1/ocr','sha256:' || repeat('a',64),'sha256:' || repeat('b',64),true,now());
  for i in 1..15 loop
    d := ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
    v := d::text || ':' || repeat('c',64);
    prefix := 'immutable/pilot-readproof/pilot-readproof/' || d::text || '/' || repeat('d',64);
    original_id := 'rep-' || substr(encode(sha256(convert_to(v || chr(10) || 'original' || chr(10)
      || 'quarantine/pilot-readproof/' || d::text || '/source','UTF8')),'hex'),1,32);
    normalized_id := 'rep-' || substr(encode(sha256(convert_to(v || chr(10) || 'normalized' || chr(10)
      || prefix || '/sanitized.pdf','UTF8')),'hex'),1,32);
    insert into public.foundation_intake_admissions(workspace_key,document_id,user_id,object_key,requested_bytes,
      declared_mime_type,expires_at,confirmed_at,source_sha256)
      values('pilot-readproof',d,'88888888-8888-4888-8888-888888888888',
        'quarantine/pilot-readproof/' || d::text || '/source',100,'application/pdf',now()+interval '10 minutes',now(),'sha256:' || repeat('c',64));
    insert into public.sources(source_id,tenant_id,workspace_id,origin_kind,source_family,created_at)
      values(d::text,'pilot-readproof','pilot-readproof','upload','document',now());
    insert into public.source_versions(source_version_id,source_id,immutable_object_key,content_sha256,byte_length,mime_type,observed_at)
      values(v,d::text,'quarantine/pilot-readproof/' || d::text || '/source','sha256:' || repeat('c',64),100,'application/pdf',now());
    insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,
      content_sha256,object_key,lossy,derived_from,created_at) values
      (original_id,v,'original','synthetic-upload','synthetic-original',
        'sha256:' || repeat('c',64),'quarantine/pilot-readproof/' || d::text || '/source',false,'{}',now()),
      (normalized_id,v,'normalized','synthetic-cdr','synthetic-cdr-qualified',
        'sha256:' || repeat('d',64),prefix || '/sanitized.pdf',true,array[original_id],now());
    insert into public.foundation_compute_reservations(workspace_key,document_id,user_id,reserved_credits,
      maximum_credits,billing_source,expires_at,created_at)
      values('pilot-readproof',d,'88888888-8888-4888-8888-888888888888',4,4,case i when 7 then 'owner' when 8 then 'trial' else 'paid' end,now()+interval '10 minutes',now());
    update public.foundation_billing_accounts set credit_balance=credit_balance-4 where workspace_key='pilot-readproof' and i not in (7,8);
    insert into completed_read_fixture values(d,jsonb_build_object('schemaVersion','tavonel.completed_read.v1',
      'workspaceKey','pilot-readproof','documentId',d,'originalKey','quarantine/pilot-readproof/' || d::text || '/source',
      'originalSha256','sha256:' || repeat('c',64),'sanitizedKey',prefix || '/sanitized.pdf',
      'sanitizedSha256','sha256:' || repeat('d',64),'ocrKey',prefix || '/ocr.json','ocrSha256','sha256:' || repeat('e',64),
      'observedPageCount',3,'readerRevision','sha256:' || repeat('a',64),'readerBindingSha256',binding));
  end loop;
end;
$$;



-- These fixtures exercise existing settlement ledger branches; they do not qualify owner/trial eligibility
-- or mint capabilities through the intake/reservation workflow. Pages remain separate observations.
create function pg_temp.fixture_facts(i integer) returns jsonb language sql as $$
  select facts from completed_read_fixture where doc = ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
$$;
create function pg_temp.reject_proof_fixture() returns trigger language plpgsql as $$
begin
  if current_setting('completed_read_fixture.fail',true) = 'true' then raise exception 'SYNTHETIC_PROOF_INSERT_FAILURE'; end if;
  return new;
end;
$$;
create trigger synthetic_proof_insert_failure before insert on public.foundation_completed_read_proofs
  for each row execute function pg_temp.reject_proof_fixture();
create temporary table fixture_balances(label text primary key, balance integer);
insert into fixture_balances select 'before',credit_balance from public.foundation_billing_accounts where workspace_key='pilot-readproof';
create function pg_temp.bind_approval(i integer, cancelled boolean default false) returns void language plpgsql as $$
declare d uuid := ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid; rid uuid;
begin
 select reservation_id into rid from public.foundation_compute_reservations where document_id=d;
 insert into public.foundation_intake_approvals(approval_id,workspace_key,user_id,attempt_key,client_manifest_digest,
   scope_digest,pricing_fingerprint,file_count,aggregate_maximum_pages,aggregate_reserved_credits,aggregate_maximum_credits,
   state,created_at,expires_at,cancelled_at,cancel_reason)
 values(d,'pilot-readproof','88888888-8888-4888-8888-888888888888','synthetic-approval-' || i,
   'sha256:' || repeat('1',64),'sha256:' || repeat('2',64),'sha256:' || repeat('3',64),1,3,4,4,
   case when cancelled then 'cancelled' else 'approved' end,now(),now()+interval '10 minutes',
   case when cancelled then now() end,case when cancelled then 'SYNTHETIC_CANCEL' end);
 insert into public.foundation_intake_approval_files(approval_id,file_key,document_id,content_sha256,byte_length,
   declared_mime_type,page_basis,approved_max_pages,approved_reserved_credits,approved_maximum_credits,state,
   reservation_id,reserved_at,confirmed_at,cancelled_at,cancel_reason,created_at)
 values(d,'synthetic-file-' || i,d,'sha256:' || repeat('c',64),100,'application/pdf','measured',3,4,4,
   case when cancelled then 'cancelled' else 'confirmed' end,rid,now(),case when not cancelled then now() end,
   case when cancelled then now() end,case when cancelled then 'SYNTHETIC_CANCEL' end,now());
end;
$$;

select ok(not has_table_privilege('service_role','public.foundation_completed_read_proofs','INSERT'), 'service cannot insert proof directly');

select ok(not has_table_privilege('service_role','public.foundation_completed_read_qualifications','INSERT'), 'service cannot self qualify');

select ok(not has_table_privilege('authenticated','public.foundation_completed_read_proofs','SELECT'), 'user cannot read proof table');

select ok(not has_function_privilege('anon','public.settle_foundation_completed_read_v1(jsonb)','EXECUTE'), 'anonymous cannot settle');

select ok(not has_function_privilege('authenticated','public.read_foundation_completed_read_v1(jsonb)','EXECUTE'), 'user cannot invoke internal reader');

select ok(not has_function_privilege('service_role','public.assert_foundation_completed_read_v1(jsonb)','EXECUTE'), 'service cannot invoke private assertion helper');

select ok(has_function_privilege('service_role','public.settle_foundation_completed_read_v1(jsonb)','EXECUTE')
  and has_function_privilege('service_role','public.read_foundation_completed_read_v1(jsonb)','EXECUTE'), 'service may use checked RPCs');

set local role anon;

select throws_ok('select public.settle_foundation_completed_read_v1(null)', '42501', 'permission denied for function settle_foundation_completed_read_v1', 'anonymous RPC execution denied');

reset role;

select throws_ok('select public.settle_foundation_completed_read_v1(null)', 'P0001', 'COMPLETED_READ_INVALID', 'SQL null rejected');

select throws_ok('select public.settle_foundation_completed_read_v1(''null''::jsonb)', 'P0001', 'COMPLETED_READ_INVALID', 'JSON null rejected');

select throws_ok('select public.settle_foundation_completed_read_v1(''[]''::jsonb)', 'P0001', 'COMPLETED_READ_INVALID', 'array rejected');

select throws_ok('select public.settle_foundation_completed_read_v1(''{}''::jsonb)', 'P0001', 'COMPLETED_READ_INVALID', 'missing fields rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('observedPageCount','bad')), 'P0001', 'COMPLETED_READ_INVALID', 'page string rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('observedPageCount',1.5)), 'P0001', 'COMPLETED_READ_INVALID', 'fractional page rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('observedPageCount',81)), 'P0001', 'COMPLETED_READ_INVALID', 'oversize pages rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('readerRevision',null)), 'P0001', 'COMPLETED_READ_INVALID', 'null revision rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('extra',true)), 'P0001', 'COMPLETED_READ_INVALID', 'extra field rejected');

select set_config('completed_read_fixture.fail','true',true);

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1)), 'P0001', 'SYNTHETIC_PROOF_INSERT_FAILURE', 'proof insertion failure aborts paid settlement');

select is((select credit_balance from public.foundation_billing_accounts where workspace_key='pilot-readproof'), (select balance from fixture_balances where label='before'), 'proof failure rolls back paid balance');

select is((select state::text from public.foundation_compute_reservations where document_id=('10000000-0000-4000-8000-' || lpad('1',12,'0'))::uuid), 'reserved', 'proof failure rolls back reservation');

select is((select count(*)::integer from public.foundation_completed_read_proofs), 0, 'proof failure leaves no proof');

select is((select count(*)::integer from public.source_representations where kind='ocr' and source_version_id like '10000000-%'), 0, 'proof failure rolls back OCR representation');

select set_config('completed_read_fixture.fail','false',true);
grant select on completed_read_fixture to service_role;
grant execute on function pg_temp.fixture_facts(integer) to service_role;
set local role service_role;

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(1))->>'status', 'processed', 'service fresh paid settlement succeeds');

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(1))->>'status', 'duplicate', 'service exact paid replay succeeds');

reset role;

select is((select credit_balance from public.foundation_billing_accounts where workspace_key='pilot-readproof'), (select balance+2 from fixture_balances where label='before'), 'paid settlement releases two once and replay adds no debit');

select is((select settled_credits from public.foundation_completed_read_proofs where document_id=('10000000-0000-4000-8000-' || lpad('1',12,'0'))::uuid), 2, 'immutable proof records fixed two ledger credits');

select is((select (facts->>'observedPageCount')::integer from public.foundation_completed_read_proofs where document_id=('10000000-0000-4000-8000-' || lpad('1',12,'0'))::uuid), 3, 'observed pages remain separate from credits');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('ocrSha256','sha256:' || repeat('f',64))), 'P0001', 'COMPLETED_READ_REPLAY_CONFLICT', 'conflicting replay rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('readerRevision','sha256:' || repeat('f',64))), 'P0001', 'COMPLETED_READ_READER_UNQUALIFIED', 'unknown revision rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('originalSha256','sha256:' || repeat('f',64))), 'P0001', 'COMPLETED_READ_ORIGINAL_UNBOUND', 'wrong original rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('workspaceKey','pilot-foreign')), 'P0001', 'COMPLETED_READ_SCOPE_MISMATCH', 'wrong workspace rejected');

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(1) || jsonb_build_object('documentId','20000000-0000-4000-8000-000000000001')), 'P0001', 'COMPLETED_READ_SCOPE_MISMATCH', 'wrong document rejected');

select throws_ok('update public.foundation_completed_read_proofs set facts=facts', 'P0001', 'COMPLETED_READ_IMMUTABLE', 'proof update forbidden');

select throws_ok('delete from public.foundation_completed_read_proofs', 'P0001', 'COMPLETED_READ_IMMUTABLE', 'proof deletion forbidden');

update public.foundation_compute_reservations set state='released',settled_credits=0 where document_id=('10000000-0000-4000-8000-' || lpad('2',12,'0'))::uuid;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(2)), 'P0001', 'COMPLETED_READ_RESERVATION_NOT_ACTIVE', 'released reservation cannot certify');

update public.foundation_compute_reservations set state='expired',settled_credits=0 where document_id=('10000000-0000-4000-8000-' || lpad('3',12,'0'))::uuid;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(3)), 'P0001', 'COMPLETED_READ_RESERVATION_NOT_ACTIVE', 'expired reservation cannot certify');

update public.foundation_compute_reservations set state='operator_review',settled_credits=0 where document_id=('10000000-0000-4000-8000-' || lpad('4',12,'0'))::uuid;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(4)), 'P0001', 'COMPLETED_READ_RESERVATION_NOT_ACTIVE', 'operator_review reservation cannot certify');

update public.foundation_compute_reservations set created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute' where document_id=('10000000-0000-4000-8000-' || lpad('5',12,'0'))::uuid;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(5)), 'P0001', 'COMPLETED_READ_RESERVATION_NOT_ACTIVE', 'elapsed reservation cannot certify');

select pg_temp.bind_approval(6,true);

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(6)), 'P0001', 'COMPLETED_READ_APPROVAL_NOT_ACTIVE', 'cancelled approval cannot certify');

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(7))->>'billingSource', 'owner', 'owner settlement preserves ledger source');

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(7))->>'status', 'duplicate', 'owner replay succeeds');

select is((select settled_credits from public.foundation_completed_read_proofs where document_id=('10000000-0000-4000-8000-' || lpad('7',12,'0'))::uuid), 2, 'owner proof records fixed ledger credits');

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(8))->>'billingSource', 'trial', 'trial settlement preserves ledger source');

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(8))->>'status', 'duplicate', 'trial replay succeeds');

select is((select settled_credits from public.foundation_completed_read_proofs where document_id=('10000000-0000-4000-8000-' || lpad('8',12,'0'))::uuid), 2, 'trial proof records fixed ledger credits');

select is((select credit_balance from public.foundation_billing_accounts where workspace_key='pilot-readproof'), (select balance+2 from fixture_balances where label='before'), 'owner and trial settlement/replay do not change paid balance');

select pg_temp.bind_approval(9);
insert into fixture_balances select 'approval',credit_balance from public.foundation_billing_accounts where workspace_key='pilot-readproof';
select set_config('completed_read_fixture.fail','true',true);

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(9)), 'P0001', 'SYNTHETIC_PROOF_INSERT_FAILURE', 'approval-aware proof failure aborts settlement');

select is((select credit_balance from public.foundation_billing_accounts where workspace_key='pilot-readproof'), (select balance from fixture_balances where label='approval'), 'approval rollback restores balance');

select is((select state::text from public.foundation_compute_reservations where document_id=('10000000-0000-4000-8000-' || lpad('9',12,'0'))::uuid), 'reserved', 'approval rollback restores reserved state');

select is((select count(*)::integer from public.foundation_completed_read_proofs where document_id=('10000000-0000-4000-8000-' || lpad('9',12,'0'))::uuid), 0, 'approval rollback leaves no proof');

select is((select count(*)::integer from public.source_representations where kind='ocr' and source_version_id like ('10000000-0000-4000-8000-' || lpad('9',12,'0'))::uuid::text || ':%'), 0, 'approval rollback leaves no OCR representation');

select set_config('completed_read_fixture.fail','false',true);

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(9))->>'approvalId', ('10000000-0000-4000-8000-' || lpad('9',12,'0'))::uuid::text, 'fresh proof uses approval-aware settlement');

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(9))->>'status', 'duplicate', 'approval-aware replay succeeds');

select is((select credit_balance from public.foundation_billing_accounts where workspace_key='pilot-readproof'), (select balance+2 from fixture_balances where label='approval'), 'approval replay releases hold exactly once');

-- A noncanonical matching normalized row is legal; canonical identity remains exact.
insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,content_sha256,object_key,lossy,derived_from,created_at)
 select 'rep-' || repeat('f',32),r.source_version_id,r.kind,r.provider_id,r.provider_revision,r.content_sha256,r.object_key,r.lossy,r.derived_from,now()
 from public.source_representations r where r.source_version_id=('10000000-0000-4000-8000-' || lpad('10',12,'0'))::uuid::text || ':' || repeat('c',64) and kind='normalized';

select is(public.settle_foundation_completed_read_v1(pg_temp.fixture_facts(10))->>'status', 'processed', 'legal noncanonical sibling does not make canonical lineage ambiguous');

select ok((select normalized_representation_id <> 'rep-' || repeat('f',32) from public.foundation_completed_read_proofs where document_id=('10000000-0000-4000-8000-' || lpad('10',12,'0'))::uuid), 'proof binds canonical normalized identity');

update public.sources set origin_kind='connector' where source_id=('10000000-0000-4000-8000-' || lpad('11',12,'0'))::uuid::text;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(11)), 'P0001', 'COMPLETED_READ_DIRECT_UPLOAD_REQUIRED', 'connector origin cannot certify');

update public.foundation_intake_admissions set confirmed_at=null where document_id=('10000000-0000-4000-8000-' || lpad('12',12,'0'))::uuid;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(12)), 'P0001', 'COMPLETED_READ_DIRECT_UPLOAD_REQUIRED', 'unconfirmed upload cannot certify');

update public.foundation_compute_reservations set state='settled',settled_credits=2,reason_code='OCR_COMPLETED' where document_id=('10000000-0000-4000-8000-' || lpad('13',12,'0'))::uuid;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(13)), 'P0001', 'COMPLETED_READ_RESERVATION_NOT_ACTIVE', 'legacy settlement without proof cannot certify retrospectively');

insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,content_sha256,object_key,lossy,derived_from,created_at)
 select 'rep-' || substr(encode(sha256(convert_to(r.source_version_id || chr(10) || 'ocr' || chr(10) || (pg_temp.fixture_facts(14)->>'ocrKey'),'UTF8')),'hex'),1,32),
 r.source_version_id,'ocr','qualified-ocr','sha256:' || repeat('f',64),'sha256:' || repeat('e',64),pg_temp.fixture_facts(14)->>'ocrKey',true,array[r.representation_id],now()
 from public.source_representations r where r.source_version_id=('10000000-0000-4000-8000-' || lpad('14',12,'0'))::uuid::text || ':' || repeat('c',64) and kind='normalized';

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(14)), 'P0001', 'COMPLETED_READ_OCR_LINEAGE_CONFLICT', 'conflicting canonical OCR winner rejected');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000','99999999-9999-4999-8999-999999999999','authenticated','authenticated',
 'completed-read-other@example.invalid','$2a$10$fixture',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
 update public.foundation_compute_reservations set user_id='99999999-9999-4999-8999-999999999999' where document_id=('10000000-0000-4000-8000-' || lpad('15',12,'0'))::uuid;

select throws_ok(format('select public.settle_foundation_completed_read_v1(%L::jsonb)', pg_temp.fixture_facts(15)), 'P0001', 'COMPLETED_READ_DIRECT_UPLOAD_REQUIRED', 'reservation cannot certify another upload principal');

select is(public.read_foundation_completed_read_v1(pg_temp.fixture_facts(1))->>'status', 'duplicate', 'internal reader validates available exact proof');

update public.source_representations set content_sha256='sha256:' || repeat('f',64)
 where representation_id=(select normalized_representation_id from public.foundation_completed_read_proofs where document_id=('10000000-0000-4000-8000-' || lpad('10',12,'0'))::uuid);

select throws_ok(format('select public.read_foundation_completed_read_v1(%L::jsonb)',pg_temp.fixture_facts(10)), 'P0001', 'COMPLETED_READ_SANITIZED_UNBOUND', 'changed canonical normalized facts block reuse');

update public.source_versions set tombstoned=true where source_version_id=('10000000-0000-4000-8000-' || lpad('7',12,'0'))::uuid::text || ':' || repeat('c',64);

select throws_ok(format('select public.read_foundation_completed_read_v1(%L::jsonb)',pg_temp.fixture_facts(7)), 'P0001', 'COMPLETED_READ_ORIGINAL_UNBOUND', 'tombstoned version blocks reuse');

update public.sources set tombstoned_at=now(),tombstone_reason='SYNTHETIC_DELETE' where source_id=('10000000-0000-4000-8000-' || lpad('1',12,'0'))::uuid::text;

select throws_ok(format('select public.read_foundation_completed_read_v1(%L::jsonb)',pg_temp.fixture_facts(1)), 'P0001', 'COMPLETED_READ_SOURCE_UNAVAILABLE', 'tombstoned upload proof cannot be reused');

update public.foundation_completed_read_qualifications set revoked_at=now();

select throws_ok(format('select public.read_foundation_completed_read_v1(%L::jsonb)',pg_temp.fixture_facts(9)), 'P0001', 'COMPLETED_READ_READER_UNQUALIFIED', 'revoked qualification blocks proof reuse');
select * from finish();
rollback;
