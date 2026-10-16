-- DRAFT ONLY. Not in migrations/, not applied, no native route/authority/writer is installed.
-- Exact Foundation baseline: 8956734a6675ae79d5081e77f551e0cb49cf8a39.
-- Internal service metadata reader. Workspace/document/hash parameters are NOT ACL evidence.
-- The server adapter must independently authorize the current source/job and verify a native
-- grant before and after this RPC. Intake approval/CDR/OCR facts never qualify native processing.
-- Security-definer guidance: https://supabase.com/docs/guides/database/functions
-- Snapshot semantics: https://www.postgresql.org/docs/current/transaction-iso.html
-- Requires READ COMMITTED: each PL/pgSQL SQL command obtains a fresh command snapshot. All
-- lock waits finish BEFORE the single capture statement. REPEATABLE READ/SERIALIZABLE refuse.
-- Locks live until RPC transaction commit/rollback, not function return. The returned set is
-- point-in-time metadata; it is not frozen after that transaction. A future writer must recheck.
begin;

create function public.read_foundation_source_ledger_snapshot_v1(
  p_workspace_key text, p_document_id uuid, p_original_sha256 text, p_expected_pdf_key text
) returns jsonb language plpgsql volatile security definer
set search_path = '' set lock_timeout = '2s' as $$
declare
  doc text := p_document_id::text;
  original_key text;
  version_id text;
  original_id text;
  locked record;
  captured jsonb;
  ledger jsonb;
  reps jsonb;
  r jsonb;
  parent text;
  rooted text[];
  next_rooted text[];
  row_count integer;
  original_count integer := 0;
  pdf_count integer := 0;
  refusal constant text := 'SOURCE_LEDGER_SNAPSHOT_REFUSED';
  -- Match JavaScript String.trim() for the required provider fields without rewriting them.
  provider_trim_chars constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed'
    or p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_id is null or p_original_sha256 is null or p_original_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_expected_pdf_key is null then raise exception '%', refusal; end if;
  original_key := 'quarantine/' || p_workspace_key || '/' || doc || '/source';
  version_id := doc || ':' || pg_catalog.substr(p_original_sha256, 8);
  original_id := 'rep-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    version_id || pg_catalog.chr(10) || 'original' || pg_catalog.chr(10) || original_key, 'UTF8')), 'hex'), 1, 32);
  if p_expected_pdf_key !~ ('^immutable/' || p_workspace_key || '/' || p_workspace_key || '/' || doc || '/[a-f0-9]{64}/sanitized[.]pdf$')
    then raise exception '%', refusal; end if;

  -- Join existing advisory protocol BEFORE any row locks, in the existing order.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake-approval:' || p_workspace_key, 0));
  perform public.lock_upload_source_deletion(p_workspace_key, p_document_id);
  perform 1 from public.sources where source_id = doc order by source_id for share;
  perform 1 from public.source_versions where source_version_id = version_id order by source_version_id for share;
  -- Bounded pre-capture locking pass. Do not use pre-wait row contents as the returned snapshot.
  row_count := 0;
  for locked in select representation_id, pg_catalog.cardinality(derived_from) as parents
    from public.source_representations where source_version_id = version_id
    order by representation_id limit 129 for share
  loop
    row_count := row_count + 1;
    if row_count > 128 or locked.parents > 32 then raise exception '%', refusal; end if;
  end loop;

  -- ONE fresh, non-locking statement after ALL waits captures scope/admission/tombstones and
  -- the complete bounded representation set. A non-compliant concurrent insert/reparent may
  -- enter this command snapshot after the lock pass: it is included and validated here, never
  -- assumed absent or immutable. No membership/content requery follows this capture.
  with s as materialized (select * from public.sources where source_id = doc),
       v as materialized (select * from public.source_versions where source_version_id = version_id),
       a as materialized (select * from public.foundation_intake_admissions
         where workspace_key = p_workspace_key and document_id = p_document_id),
       bounded as materialized (select * from public.source_representations where source_version_id = version_id
         order by representation_id limit 129),
       representation_set as materialized (
         select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'representationId', representation_id, 'sourceVersionId', source_version_id, 'kind', kind,
           'providerId', provider_id, 'providerRevision', provider_revision, 'contentSha256', content_sha256,
           'objectKey', object_key, 'lossy', lossy,
           -- Do not materialize an unbounded parent array even for a new, unlocked row.
           'derivedFrom', case when pg_catalog.cardinality(derived_from) <= 32 then pg_catalog.to_jsonb(derived_from) else 'null'::jsonb end,
           'createdAt', pg_catalog.to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
         ) order by representation_id), '[]'::jsonb) as rows,
         coalesce(pg_catalog.bool_and(pg_catalog.isfinite(created_at) and created_at >= '0001-01-01 00:00:00+00'::timestamptz
           and created_at < '10000-01-01 00:00:00+00'::timestamptz), true) as times_valid from bounded
       )
  select pg_catalog.jsonb_build_object(
    'available', exists(select 1 from a where confirmed_at is not null
      and state::text not in ('rejected','expired') and object_key = original_key and source_sha256 = p_original_sha256
      and requested_bytes = (select byte_length from v) and declared_mime_type = (select mime_type from v)),
    'approvedMetadata', not exists(select 1 from public.foundation_intake_approval_files f
      left join public.foundation_intake_approvals approval on approval.approval_id = f.approval_id
      where f.document_id = p_document_id and (approval.workspace_key is distinct from p_workspace_key
        or approval.state is distinct from 'approved' or f.state <> 'confirmed'
        or f.content_sha256 <> p_original_sha256 or f.byte_length <> (select byte_length from v)
        or f.declared_mime_type <> (select mime_type from v) or approval.user_id is distinct from (select user_id from a))),
    'directUpload', not exists(select 1 from public.connector_document_bindings where document_id = p_document_id),
    'notDeleted', not exists(select 1 from public.source_deletion_tombstones
      where workspace_key = p_workspace_key and document_id = p_document_id),
    'timesValid', (select times_valid from representation_set) and
      (select pg_catalog.isfinite(created_at) and created_at >= '0001-01-01 00:00:00+00'::timestamptz
        and created_at < '10000-01-01 00:00:00+00'::timestamptz from s) and
      (select pg_catalog.isfinite(observed_at) and observed_at >= '0001-01-01 00:00:00+00'::timestamptz
        and observed_at < '10000-01-01 00:00:00+00'::timestamptz and (source_modified_at is null or
          (pg_catalog.isfinite(source_modified_at) and source_modified_at >= '0001-01-01 00:00:00+00'::timestamptz
            and source_modified_at < '10000-01-01 00:00:00+00'::timestamptz)) from v),
    'ledger', pg_catalog.jsonb_build_object(
      'source', (select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'sourceId', source_id, 'tenantId', tenant_id, 'workspaceId', workspace_id, 'originKind', origin_kind,
        'originProvider', origin_provider, 'canonicalUri', canonical_uri, 'sourceFamily', source_family,
        'createdAt', pg_catalog.to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        -- A tombstone refuses. Do not serialize unbounded tombstone_reason audit text.
        'tombstonedAt', case when tombstoned_at is not null then 'blocked' else null end)) from s),
      'version', (select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'sourceVersionId', source_version_id, 'sourceId', source_id, 'immutableObjectKey', immutable_object_key,
        'contentSha256', content_sha256, 'byteLength', byte_length, 'mimeType', mime_type,
        'sourceModifiedAt', case when source_modified_at is not null then pg_catalog.to_char(source_modified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') else null end,
        'observedAt', pg_catalog.to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'parentVersionId', parent_version_id, 'tombstoned', tombstoned, 'securityClassification', security_classification)) from v),
      'representations', (select rows from representation_set)
    )) into captured;

  if captured->>'available' is distinct from 'true' or captured->>'approvedMetadata' is distinct from 'true'
    or captured->>'directUpload' is distinct from 'true' or captured->>'notDeleted' is distinct from 'true'
    or captured->>'timesValid' is distinct from 'true' then raise exception '%', refusal; end if;
  ledger := captured->'ledger';
  if ledger->'source'->>'sourceId' is distinct from doc or ledger->'source'->>'tenantId' is distinct from p_workspace_key
    or ledger->'source'->>'workspaceId' is distinct from p_workspace_key or ledger->'source'->>'originKind' is distinct from 'upload'
    or ledger->'source'->>'sourceFamily' is distinct from 'spreadsheet' or ledger->'source' ? 'tombstonedAt'
    or ledger->'version'->>'sourceId' is distinct from doc or ledger->'version'->>'sourceVersionId' is distinct from version_id
    or ledger->'version'->>'immutableObjectKey' is distinct from original_key
    or ledger->'version'->>'contentSha256' is distinct from p_original_sha256
    or ledger->'version'->>'tombstoned' is distinct from 'false' or ledger->'version' ? 'parentVersionId'
    or ledger->'version'->>'mimeType' is distinct from 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    then raise exception '%', refusal; end if;
  reps := ledger->'representations';
  row_count := pg_catalog.jsonb_array_length(reps);
  if row_count < 2 or row_count > 128 then raise exception '%', refusal; end if;
  for r in select value from pg_catalog.jsonb_array_elements(reps) loop
    if r->>'sourceVersionId' <> version_id or r->>'contentSha256' !~ '^sha256:[a-f0-9]{64}$'
      or pg_catalog.btrim(r->>'providerId', provider_trim_chars) = '' or pg_catalog.btrim(r->>'providerRevision', provider_trim_chars) = ''
      or r->>'kind' not in ('original','native','rendered','ocr','visual','normalized','canonical_ir')
      or r->>'objectKey' ~ '[[:cntrl:]\\]' or r->>'objectKey' ~ '(^|/)([.]|[.][.])(/|$)' or r->>'objectKey' ~ '//|/$'
      or (r->>'objectKey' <> original_key and pg_catalog.left(r->>'objectKey', pg_catalog.length('immutable/' || p_workspace_key || '/' || p_workspace_key || '/' || doc || '/'))
        <> 'immutable/' || p_workspace_key || '/' || p_workspace_key || '/' || doc || '/')
      or r->>'representationId' <> 'rep-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        version_id || pg_catalog.chr(10) || (r->>'kind') || pg_catalog.chr(10) || (r->>'objectKey'), 'UTF8')), 'hex'), 1, 32)
      or pg_catalog.jsonb_typeof(r->'derivedFrom') <> 'array' then raise exception '%', refusal; end if;
    if pg_catalog.jsonb_array_length(r->'derivedFrom') > 32 or
      (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements(r->'derivedFrom')) <> pg_catalog.jsonb_array_length(r->'derivedFrom')
      then raise exception '%', refusal; end if;
    if r->>'kind' = 'original' then
      original_count := original_count + 1;
      if r->>'representationId' <> original_id or r->>'objectKey' <> original_key or r->>'contentSha256' <> p_original_sha256
        or r->>'lossy' <> 'false' or r->'derivedFrom' <> '[]'::jsonb then raise exception '%', refusal; end if;
    elsif pg_catalog.jsonb_array_length(r->'derivedFrom') = 0 then raise exception '%', refusal; end if;
    for parent in select value from pg_catalog.jsonb_array_elements_text(r->'derivedFrom') loop
      if parent is null or parent !~ '^rep-[a-f0-9]{32}$' or parent = r->>'representationId'
        or not exists(select 1 from pg_catalog.jsonb_array_elements(reps) p where p->>'representationId' = parent)
        then raise exception '%', refusal; end if;
    end loop;
    if r->>'kind' = 'normalized' and r->>'objectKey' = p_expected_pdf_key then
      pdf_count := pdf_count + 1;
      if r->>'contentSha256' <> 'sha256:' || pg_catalog.split_part(p_expected_pdf_key, '/', 5)
        or r->>'lossy' <> 'true' or r->'derivedFrom' <> pg_catalog.jsonb_build_array(original_id)
        then raise exception '%', refusal; end if;
    end if;
  end loop;
  if original_count <> 1 or pdf_count <> 1 or
    (select pg_catalog.count(distinct value->>'representationId') from pg_catalog.jsonb_array_elements(reps)) <> row_count
    then raise exception '%', refusal; end if;
  -- Bounded graph reduction, all parents must reach the single explicit original. No recursive
  -- path explosion; cycles/missing/cross-version parents refuse from this captured array only.
  rooted := array[original_id];
  loop
    select pg_catalog.array_agg(value->>'representationId' order by value->>'representationId') into next_rooted
    from pg_catalog.jsonb_array_elements(reps)
    where value->>'representationId' = any(rooted) or not exists(
      select 1 from pg_catalog.jsonb_array_elements_text(value->'derivedFrom') p where not (p = any(rooted)));
    exit when pg_catalog.cardinality(next_rooted) = pg_catalog.cardinality(rooted);
    rooted := next_rooted;
  end loop;
  if pg_catalog.cardinality(rooted) <> row_count or pg_catalog.octet_length(ledger::text) > 262144
    then raise exception '%', refusal; end if;
  return ledger; -- Only SourceLedger fields; no approval, credential, ACL or qualification data.
end;
$$;
revoke all on function public.read_foundation_source_ledger_snapshot_v1(text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.read_foundation_source_ledger_snapshot_v1(text, uuid, text, text) to service_role;
commit;
