-- DRAFT acceptance fixture. PostgreSQL execution and all concurrent-session scenarios UNRUN
-- in the authoring environment. Node/unit tests do not establish SQL/MVCC/locking behavior.
-- For a DISPOSABLE OFFLINE database only: exact Foundation 8956734a migrations, existing pgTAP,
-- then ../native-source-ledger-snapshot.sql. No CLI/schema/provider call is part of this patch.
-- Synthetic rows and temporary helpers below roll back. No billing/qualification rows needed.
begin;
set local transaction isolation level read committed;
select no_plan();
select ok((select prosecdef and proconfig @> array['search_path=""','lock_timeout=2s']
  from pg_catalog.pg_proc where oid = 'public.read_foundation_source_ledger_snapshot_v1(text,uuid,text,text)'::regprocedure),
  'definer reader has fixed empty path and lock timeout');
select ok(not pg_catalog.has_function_privilege('anon','public.read_foundation_source_ledger_snapshot_v1(text,uuid,text,text)','execute'), 'anon denied');
select ok(not pg_catalog.has_function_privilege('authenticated','public.read_foundation_source_ledger_snapshot_v1(text,uuid,text,text)','execute'), 'authenticated denied');
select ok(pg_catalog.has_function_privilege('service_role','public.read_foundation_source_ledger_snapshot_v1(text,uuid,text,text)','execute'), 'service role allowed metadata only');
select ok(not exists(select 1 from pg_catalog.pg_proc p, lateral pg_catalog.aclexplode(p.proacl) a
  where p.oid = 'public.read_foundation_source_ledger_snapshot_v1(text,uuid,text,text)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC execution revoked');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','88888888-8888-4888-8888-888888888889',
  'authenticated','authenticated','native-ledger-fixture@example.invalid','$2a$10$fixture',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());

create function pg_temp.ledger_doc(i integer) returns uuid language sql immutable as $$
  select ('20000000-0000-4000-8000-' || pg_catalog.lpad(i::text,12,'0'))::uuid;
$$;
create function pg_temp.ledger_rep(v text, kind text, key text) returns text language sql immutable as $$
  select 'rep-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    v || pg_catalog.chr(10) || kind || pg_catalog.chr(10) || key,'UTF8')),'hex'),1,32);
$$;
create function pg_temp.read_ledger(i integer, pdf_hash text default pg_catalog.repeat('d',64)) returns jsonb language sql as $$
  select public.read_foundation_source_ledger_snapshot_v1('pilot-ledger',pg_temp.ledger_doc(i),'sha256:' || pg_catalog.repeat('c',64),
    'immutable/pilot-ledger/pilot-ledger/' || pg_temp.ledger_doc(i)::text || '/' || pdf_hash || '/sanitized.pdf');
$$;
create function pg_temp.seed_ledger(i integer, mode text default 'valid') returns void language plpgsql as $$
declare
  d uuid := pg_temp.ledger_doc(i); v text; original_key text; pdf_key text; original_id text; pdf_id text;
  ts timestamptz := '2026-10-05T00:00:00.123456Z'; parents text[];
begin
  v := d::text || ':' || repeat('c',64);
  original_key := 'quarantine/pilot-ledger/' || d::text || '/source';
  pdf_key := 'immutable/pilot-ledger/pilot-ledger/' || d::text || '/' || repeat('d',64) || '/sanitized.pdf';
  original_id := pg_temp.ledger_rep(v,'original',original_key);
  pdf_id := pg_temp.ledger_rep(v,'normalized',pdf_key);
  insert into public.foundation_intake_admissions(workspace_key,document_id,user_id,object_key,requested_bytes,
    declared_mime_type,expires_at,confirmed_at,source_sha256,state)
  values('pilot-ledger',d,'88888888-8888-4888-8888-888888888889',original_key,100,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',now()+interval '10 minutes',
    case when mode <> 'unconfirmed' then now() end,'sha256:' || repeat('c',64),
    case when mode = 'rejected' then 'rejected'::public.foundation_intake_state else 'quarantined'::public.foundation_intake_state end);
  insert into public.sources(source_id,tenant_id,workspace_id,origin_kind,source_family,created_at,tombstoned_at,origin_provider,canonical_uri)
  values(d::text,case when mode = 'foreign_tenant' then 'pilot-other' else 'pilot-ledger' end,
    case when mode = 'foreign_workspace' then 'pilot-other' else 'pilot-ledger' end,
    case when mode = 'connector' then 'connector' else 'upload' end,'spreadsheet',
    case when mode = 'infinite_time' then 'infinity'::timestamptz else ts end,
    case when mode = 'source_tombstone' then now() end,'기존 공급자','urn:synthetic:원본');
  insert into public.source_versions(source_version_id,source_id,immutable_object_key,content_sha256,byte_length,mime_type,observed_at,tombstoned)
  values(v,d::text,original_key,'sha256:' || repeat(case when mode = 'wrong_hash' then 'b' else 'c' end,64),
    case when mode = 'wrong_bytes' then 101 else 100 end,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ts,mode = 'version_tombstone');
  if mode <> 'missing_original' then
    insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,
      content_sha256,object_key,lossy,derived_from,created_at)
    values(original_id,v,'original','original-intake','révision-原本','sha256:' || repeat('c',64),original_key,false,'{}',ts);
  end if;
  -- Canonical BEFORE INSERT lineage checks require parents to exist. A missing-original
  -- snapshot therefore stores neither original nor derived PDF; it is a legal incomplete set.
  parents := case mode when 'duplicate_parent' then array[original_id,original_id]
    when 'parent_overflow' then array_fill(original_id,array[33]) else array[original_id] end;
  if mode not in ('missing_pdf','missing_original') then
    insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,
      content_sha256,object_key,lossy,derived_from,created_at)
    values(pdf_id,v,'normalized',case when mode = 'blank_provider' then '   ' else '기존 CDR' end,'révision-原本',
      'sha256:' || repeat(case when mode = 'wrong_pdf_hash' then 'b' else 'd' end,64),pdf_key,mode <> 'lossless_pdf',parents,ts);
  end if;
end;
$$;

select pg_temp.seed_ledger(1);
select is(pg_temp.read_ledger(1)->'source'->>'createdAt','2026-10-05T00:00:00.123456Z','microseconds preserved');
select is(pg_temp.read_ledger(1)->'source'->>'originProvider','기존 공급자','original metadata preserved');
select is(pg_catalog.jsonb_array_length(pg_temp.read_ledger(1)->'representations'),2,'complete original and PDF set');
select is((select count(*)::integer from pg_catalog.jsonb_object_keys(pg_temp.read_ledger(1))),3,'only SourceLedger fields returned');
-- A second legitimate normalized representation is retained; exact grant PDF still resolves.
insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,
  content_sha256,object_key,lossy,derived_from,created_at)
select pg_temp.ledger_rep(v,'normalized',k),v,'normalized','second-cdr','second-v1','sha256:' || repeat('e',64),k,true,
  array[pg_temp.ledger_rep(v,'original','quarantine/pilot-ledger/' || d || '/source')],'2026-10-05T00:00:00.654321Z'::timestamptz
from (select pg_temp.ledger_doc(1)::text d, pg_temp.ledger_doc(1)::text || ':' || repeat('c',64) v,
  'immutable/pilot-ledger/pilot-ledger/' || pg_temp.ledger_doc(1)::text || '/' || repeat('e',64) || '/sanitized.pdf' k) x;
select is(pg_catalog.jsonb_array_length(pg_temp.read_ledger(1)->'representations'),3,'multiple normalized rows retained');
select lives_ok('select pg_temp.read_ledger(1,repeat(''e'',64))','exact alternative PDF, not latest heuristic');
select throws_ok('select pg_temp.read_ledger(1,repeat(''f'',64))','P0001','SOURCE_LEDGER_SNAPSHOT_REFUSED','unknown expected PDF refused');

-- Test impossible-to-insert states at their real refusal layer. pgTAP catches each trigger
-- exception in its own subtransaction, so no invalid stored fixture aborts the reader tests.
create function pg_temp.insert_rejected_parent(mode text) returns void language plpgsql as $$
declare
  v text := pg_temp.ledger_doc(1)::text || ':' || repeat('c',64);
  k text := 'immutable/pilot-ledger/pilot-ledger/' || pg_temp.ledger_doc(1)::text || '/rejected-' || mode || '.json';
  id text;
begin
  id := pg_temp.ledger_rep(v,'ocr',k);
  insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,
    content_sha256,object_key,lossy,derived_from,created_at)
  values(id,v,'ocr','synthetic-ocr','v1','sha256:' || repeat('f',64),k,false,
    case mode when 'missing_parent' then array['rep-' || repeat('f',32)] when 'self_cycle' then array[id] end,now());
end;
$$;
select throws_ok('select pg_temp.insert_rejected_parent(''missing_parent'')','P0001','representation_lineage_broken','canonical trigger refuses missing parent');
select throws_ok('select pg_temp.insert_rejected_parent(''self_cycle'')','P0001','representation_lineage_broken','canonical trigger refuses self parent');
select is(pg_catalog.jsonb_array_length(pg_temp.read_ledger(1)->'representations'),3,'trigger refusals leave stored ledger unchanged');

do $$ declare mode text; i integer := 2; begin
  foreach mode in array array['unconfirmed','rejected','foreign_tenant','foreign_workspace','connector','source_tombstone',
    'infinite_time','wrong_hash','wrong_bytes','version_tombstone','missing_original','missing_pdf',
    'duplicate_parent','parent_overflow','blank_provider','wrong_pdf_hash','lossless_pdf'] loop
    perform pg_temp.seed_ledger(i,mode); i := i+1;
  end loop;
end; $$;
select throws_ok(pg_catalog.format('select pg_temp.read_ledger(%s)',i),'P0001','SOURCE_LEDGER_SNAPSHOT_REFUSED','malformed/unavailable fixture ' || i)
from pg_catalog.generate_series(2,18) i;

-- Genuine row bound: add distinct lawful OCR representations until exactly 128, then 129.
insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,
  content_sha256,object_key,lossy,derived_from,created_at)
select pg_temp.ledger_rep(v,'ocr',k),v,'ocr','synthetic-ocr','v1','sha256:' || repeat('f',64),k,false,
  array[pg_temp.ledger_rep(v,'original','quarantine/pilot-ledger/' || d || '/source')],now()
from (select pg_temp.ledger_doc(1)::text d, pg_temp.ledger_doc(1)::text || ':' || repeat('c',64) v,
  'immutable/pilot-ledger/pilot-ledger/' || pg_temp.ledger_doc(1)::text || '/ocr-' || i || '.json' k
  from pg_catalog.generate_series(1,125) i) x;
select is(pg_catalog.jsonb_array_length(pg_temp.read_ledger(1)->'representations'),128,'exact row bound accepted');
insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,
  content_sha256,object_key,lossy,derived_from,created_at)
select pg_temp.ledger_rep(v,'ocr',k),v,'ocr','synthetic-ocr','v1','sha256:' || repeat('f',64),k,false,
  array[pg_temp.ledger_rep(v,'original','quarantine/pilot-ledger/' || d || '/source')],now()
from (select pg_temp.ledger_doc(1)::text d, pg_temp.ledger_doc(1)::text || ':' || repeat('c',64) v,
  'immutable/pilot-ledger/pilot-ledger/' || pg_temp.ledger_doc(1)::text || '/overflow.json' k) x;
select throws_ok('select pg_temp.read_ledger(1)','P0001','SOURCE_LEDGER_SNAPSHOT_REFUSED','overflow refused, never truncated');
select throws_ok('select public.read_foundation_source_ledger_snapshot_v1(null,null,null,null)','P0001','SOURCE_LEDGER_SNAPSHOT_REFUSED','null request refused');
select * from finish();
rollback;

-- REQUIRED INDEPENDENT POSTGRESQL ACCEPTANCE / CONCURRENCY MATRIX (ALL UNRUN HERE):
-- Use the fixture helpers above in a disposable committed setup, then two/three SQL sessions.
-- Never run against production. Cleanup must drop only explicitly named synthetic fixture rows.
-- 1. Deletion wins: A begins, takes approval workspace advisory lock then
--    lock_upload_source_deletion('pilot-ledger',doc); records real upload tombstone; B calls reader.
--    A commits: B must refuse and return no ledger from a pre-wait snapshot. Reverse order:
--    reader's RPC transaction holds locks, deletion waits until COMMIT/ROLLBACK, not RETURN.
-- 2. Cancellation wins: bind real synthetic approval/files via existing approval fixture pattern;
--    A takes approval advisory lock and cancels; B waits. After A commits B must refuse. Reverse
--    order cancellation waits until reader transaction finishes. Expired historical intake alone
--    must neither qualify native nor mint an authority response; live native grant stays separate.
-- 3. Compliant insert: A reader transaction holds deletion protocol; B invokes existing source
--    recording wrapper for a new derived row. B waits until A transaction ends. A's returned set
--    includes all rows visible at capture, with identical validation/count/serialization set.
-- 4. Derived update: A locks source/version; B holds an UPDATE on an existing representation.
--    A then blocks in deterministic representation locking. B rebinds key/parents and commits;
--    A must capture after that wait and refuse broken identity/lineage. Locks acquired before
--    capture prevent existing locked-row updates until A transaction ends.
-- 5. Unseen-row reparenting: B moves a row from another version into this version after A's
--    initial representation scan but before final capture (controlled debugger/test barrier).
--    A includes the row if visible at capture and validates all parents; malformed/overflow
--    refuses. If B commits after capture, A may return the earlier valid point-in-time set.
--    No post-capture immutability/predicate-lock guarantee is claimed for such writers.
-- 6. Lock timeout: A holds approval/deletion/row locks beyond 2s; B must error (55P03), no partial
--    JSON; adapter returns null. Retry must use new authorization/native grant rechecks.
-- 7. Isolation: REPEATABLE READ and SERIALIZABLE transactions must refuse before advisory locks.
-- 8. Add actual connector binding for otherwise valid upload; cross-version and multi-row cycle,
--    valid/invalid parentVersionId, upload-only tombstone without Source update, cancelled or
--    foreign approval, nonfinite modification/representation timestamps, conflicting IDs,
--    32/33 unique parents, UTF8 262144/262145 response bytes must be exercised in real PostgreSQL.
--    Existing database constraints may refuse some corrupt rows before the RPC; record that layer.
