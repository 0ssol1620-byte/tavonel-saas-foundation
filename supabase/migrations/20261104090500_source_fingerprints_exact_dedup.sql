-- B1 (PROGRAM-2026-11-04 §4.B): exact-duplicate detection, shadow first.
--
-- Two additive tables and one RPC. Nothing reads them on a customer path yet: the compile intake
-- writes a fingerprint per source version and gets back the exact-duplicate relations, and what
-- happens with that answer is TAVONEL_SOURCE_DEDUP_MODE's business (off | shadow | on, default off;
-- nextjs/lib/source-dedup.ts). With the flag off the app never calls the RPC.
--
--   * source_fingerprints: one row per (workspace, document, source version). The key is the
--     CDR's sanitized-output digest -- the bytes OCR actually read, so it is a digest the server
--     verified, not one a browser asserted -- plus the source digest recorded at upload confirm
--     (foundation_intake_admissions.source_sha256), which is null for a connector source or a
--     legacy confirm that carried none. A null source digest matches nothing.
--
--     The design sketch keys this table by (workspace_key, source_version_id). That cannot hold:
--     the version key IS the sanitized digest (versionKeyFromOutputSha256 in the CDR worker), so
--     the two documents this table exists to find share it. document_id is part of the key.
--
--     text_sha256, minhash and embedding_ref belong to B2a and arrive in B2a's own additive
--     migration, with the method that fills them.
--
--   * document_relations: what the matcher found. Rows are never deleted by the matcher (v4
--     §4.11): a person confirms or rejects. kind is the design's full enum so B2a adds rows, not
--     a type. internal_score / internal_threshold are internal-DTO only and stay null for an exact
--     match, which has neither. evidence is the only column a public DTO may carry.
--
-- Tenant boundary: every match is `workspace_key = p_workspace_key`. There is no cross-workspace
-- read path at all, so cross-workspace reuse cannot be switched on by accident (§4.B: forbidden).
--
-- Deletion: a document's fingerprint and every relation naming it go when its source deletion's
-- derived closure records `derived_purged` -- the same point, and so the same legal-hold rule, as
-- the retrieval rows. Before that, a tombstoned document is already invisible to the matcher.
--
-- Client access: none. RLS is on with an explicit deny-all policy for anon and authenticated,
-- and service_role holds no table privilege: it reaches the rows only through the RPC.
begin;

create table public.source_fingerprints (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,32}$'),
  document_id uuid not null,
  source_version_id text not null check (source_version_id ~ '^[a-f0-9]{64}$'),
  sanitized_sha256 text not null check (sanitized_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  fingerprint_version text not null check (fingerprint_version = 'exact:v1'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, document_id, source_version_id),
  -- The version key is derived from the sanitized digest; a row where they disagree is corrupt.
  constraint source_fingerprints_version_is_sanitized_digest
    check (sanitized_sha256 = 'sha256:' || source_version_id)
);

create index source_fingerprints_sanitized_idx
  on public.source_fingerprints (workspace_key, sanitized_sha256);
create index source_fingerprints_content_idx
  on public.source_fingerprints (workspace_key, content_sha256) where content_sha256 is not null;

create table public.document_relations (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,32}$'),
  document_id uuid not null,
  source_version_id text not null check (source_version_id ~ '^[a-f0-9]{64}$'),
  related_document_id uuid not null,
  related_source_version_id text not null check (related_source_version_id ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('exact_bytes', 'same_text', 'near_duplicate', 'revision_candidate')),
  method text not null check (method ~ '^[a-z0-9_]{1,64}$'),
  method_version text not null check (method_version ~ '^[a-z0-9_.:-]{1,64}$'),
  internal_score double precision,
  internal_threshold double precision,
  state text not null default 'proposed' check (state in ('proposed', 'confirmed', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 2048),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, document_id, source_version_id, related_document_id, related_source_version_id, kind),
  check (document_id <> related_document_id),
  check ((state = 'proposed') = (decided_at is null) and (decided_by is null or decided_at is not null)),
  -- An exact match is a fact about bytes, not a scored judgement: nothing to calibrate, nothing to leak.
  check (kind <> 'exact_bytes' or (internal_score is null and internal_threshold is null)),
  foreign key (workspace_key, document_id, source_version_id)
    references public.source_fingerprints (workspace_key, document_id, source_version_id) on delete cascade,
  foreign key (workspace_key, related_document_id, related_source_version_id)
    references public.source_fingerprints (workspace_key, document_id, source_version_id) on delete cascade
);

create index document_relations_related_idx
  on public.document_relations (workspace_key, related_document_id);

alter table public.source_fingerprints enable row level security;
alter table public.document_relations enable row level security;
revoke all on public.source_fingerprints from public, anon, authenticated, service_role;
revoke all on public.document_relations from public, anon, authenticated, service_role;
create policy source_fingerprints_no_client_access on public.source_fingerprints
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy document_relations_no_client_access on public.document_relations
  as restrictive for all to anon, authenticated using (false) with check (false);

/*
  record_source_fingerprints(workspace, [{documentId, sourceVersionId, sanitizedSha256}, ...])

  Idempotent under at-least-once delivery: a fingerprint is written once and a relation once, and
  a redelivered call returns the same answer. One workspace-scoped advisory lock serializes two
  compiles of the same workspace, so two copies of one document compiled concurrently still find
  each other. Items are processed in order, so two copies inside one call find each other too.

  Returns the exact relations held by the source versions of this call (not a document's earlier
  versions), live documents only, plus what this call added, so shadow telemetry counts a pair once
  and not once per re-compile:
    {"schemaVersion": "tavonel.source_fingerprints.v1", "fingerprints": n, "relations": [...],
     "newRelations": distinct unordered document pairs this call created for its own versions
       (a copy found here is one, whether one or both of its documents are in the call),
     "sourceDigestReuseCandidateDocumentIds": documents of this call that gained a SOURCE-digest
       match against a fingerprint recorded by an earlier call -- a candidate only: the CDR output is
       not byte-deterministic (random trailer /ID, second-level CreationDate), so the same source
       re-sanitized gets a different version key, and whether the earlier OCR read could be reused
       is not verified,
     "sanitizedDigestReuseDocumentIds": the same for a SANITIZED-digest match -- the bytes OCR read
       were identical. Structurally rare until the CDR is deterministic (a version-key change)}.
  "Earlier" is the clock after the workspace lock, so a concurrent compile of the same workspace
  is either wholly before or wholly after; two copies inside one call count as neither.
*/
create function public.record_source_fingerprints(p_workspace_key text, p_fingerprints jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_document_id uuid;
  v_version text;
  v_sanitized text;
  v_content text;
  v_existing public.source_fingerprints%rowtype;
  v_documents uuid[] := '{}';
  v_versions text[] := '{}';
  v_relations jsonb;
  v_started timestamptz;
  v_new integer;
  v_candidates jsonb;
  v_sanitized_reuse jsonb;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_fingerprints is null or pg_catalog.jsonb_typeof(p_fingerprints) <> 'array'
    or pg_catalog.jsonb_array_length(p_fingerprints) not between 1 and 128 then
    raise exception 'source_fingerprint_request_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_fingerprints.v1' || pg_catalog.chr(10) || p_workspace_key, 0));
  v_started := pg_catalog.clock_timestamp();

  for v_item in select value from pg_catalog.jsonb_array_elements(p_fingerprints) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
      or (v_item->>'documentId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (v_item->>'sourceVersionId') !~ '^[a-f0-9]{64}$'
      or (v_item->>'sanitizedSha256') is distinct from 'sha256:' || (v_item->>'sourceVersionId') then
      raise exception 'source_fingerprint_request_invalid';
    end if;
    v_document_id := (v_item->>'documentId')::uuid;
    v_version := v_item->>'sourceVersionId';
    v_sanitized := v_item->>'sanitizedSha256';

    -- The source digest is read here, never accepted from the caller.
    select a.source_sha256 into v_content
      from public.foundation_intake_admissions a
     where a.workspace_key = p_workspace_key and a.document_id = v_document_id;

    select * into v_existing from public.source_fingerprints f
     where f.workspace_key = p_workspace_key and f.document_id = v_document_id and f.source_version_id = v_version;
    if not found then
      insert into public.source_fingerprints
        (workspace_key, document_id, source_version_id, sanitized_sha256, content_sha256, fingerprint_version)
      values (p_workspace_key, v_document_id, v_version, v_sanitized, v_content, 'exact:v1');
    elsif v_existing.content_sha256 is null and v_content is not null then
      -- 0051 fills an absent confirm digest once and never overwrites it; follow it, once.
      update public.source_fingerprints f set content_sha256 = v_content
       where f.workspace_key = p_workspace_key and f.document_id = v_document_id and f.source_version_id = v_version;
    elsif v_existing.content_sha256 is distinct from v_content then
      -- A recorded digest that changed or vanished is an integrity fault, not a new fingerprint.
      raise exception 'source_fingerprint_conflict';
    end if;

    insert into public.document_relations
      (workspace_key, document_id, source_version_id, related_document_id, related_source_version_id,
       kind, method, method_version, evidence)
    select p_workspace_key, v_document_id, v_version, o.document_id, o.source_version_id,
           'exact_bytes', 'exact_digest', 'exact:v1',
           pg_catalog.jsonb_build_object('matchedOn', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
             case when o.sanitized_sha256 = v_sanitized then 'sanitized_sha256' end,
             case when o.content_sha256 = v_content then 'source_sha256' end], null)))
      from public.source_fingerprints o
     where o.workspace_key = p_workspace_key
       and o.document_id <> v_document_id
       and (o.sanitized_sha256 = v_sanitized or o.content_sha256 = v_content)
       and not public.source_fingerprint_document_tombstoned(p_workspace_key, o.document_id)
    on conflict do nothing;
    -- The reverse direction, so the earlier copy also names the later one.
    insert into public.document_relations
      (workspace_key, document_id, source_version_id, related_document_id, related_source_version_id,
       kind, method, method_version, evidence)
    select r.workspace_key, r.related_document_id, r.related_source_version_id, r.document_id, r.source_version_id,
           r.kind, r.method, r.method_version, r.evidence
      from public.document_relations r
     where r.workspace_key = p_workspace_key and r.document_id = v_document_id
       and r.source_version_id = v_version and r.kind = 'exact_bytes'
    on conflict do nothing;

    v_documents := v_documents || v_document_id;
    v_versions := v_versions || v_version;
  end loop;

  with x as (
    select r.document_id, r.related_document_id, r.related_source_version_id, r.evidence->'matchedOn' as matched_on,
           r.created_at, rf.created_at as related_recorded_at
      from public.document_relations r
      join rows from (pg_catalog.unnest(v_documents), pg_catalog.unnest(v_versions)) as c(document_id, source_version_id)
        on c.document_id = r.document_id and c.source_version_id = r.source_version_id
      join public.source_fingerprints rf
        on rf.workspace_key = r.workspace_key and rf.document_id = r.related_document_id
       and rf.source_version_id = r.related_source_version_id and rf.fingerprint_version = 'exact:v1'
     where r.workspace_key = p_workspace_key and r.kind = 'exact_bytes' and r.method_version = 'exact:v1'
       and not public.source_fingerprint_document_tombstoned(p_workspace_key, r.related_document_id))
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'documentId', x.document_id, 'relatedDocumentId', x.related_document_id,
           'kind', 'exact_bytes', 'matchedOn', x.matched_on)
           order by x.document_id, x.related_document_id, x.related_source_version_id), '[]'::jsonb),
         count(distinct (least(x.document_id, x.related_document_id), greatest(x.document_id, x.related_document_id)))
           filter (where x.created_at >= v_started),
         coalesce(pg_catalog.jsonb_agg(distinct x.document_id) filter (where x.created_at >= v_started
           and x.related_recorded_at < v_started and x.matched_on ? 'source_sha256'), '[]'::jsonb),
         coalesce(pg_catalog.jsonb_agg(distinct x.document_id) filter (where x.created_at >= v_started
           and x.related_recorded_at < v_started and x.matched_on ? 'sanitized_sha256'), '[]'::jsonb)
    into v_relations, v_new, v_candidates, v_sanitized_reuse
    from x;

  return pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.source_fingerprints.v1',
    'fingerprints', pg_catalog.cardinality(v_documents), 'relations', v_relations,
    'newRelations', v_new, 'sourceDigestReuseCandidateDocumentIds', v_candidates,
    'sanitizedDigestReuseDocumentIds', v_sanitized_reuse);
end;
$$;

-- A document whose deletion has been requested is no longer anyone's original.
-- ponytail: one scan of the workspace's tombstones per candidate; index if a workspace holds thousands.
create function public.source_fingerprint_document_tombstoned(p_workspace_key text, p_document_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.source_deletion_tombstones t
     where t.workspace_key = p_workspace_key
       and p_document_id = any(public.source_deletion_document_ids(t.deletion_id)));
$$;

-- The derived closure's receipt is the erase point for these rows, exactly as for retrieval units.
create function public.erase_source_fingerprints_on_derived_purge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action = 'derived_purged' then
    delete from public.source_fingerprints f
     where f.workspace_key = new.workspace_key
       and f.document_id = any(public.source_deletion_document_ids(new.deletion_id));
  end if;
  return new;
end;
$$;

create trigger source_deletion_receipts_erase_source_fingerprints
  after insert on public.source_deletion_receipts
  for each row execute function public.erase_source_fingerprints_on_derived_purge();

revoke all on function public.record_source_fingerprints(text, jsonb),
  public.source_fingerprint_document_tombstoned(text, uuid),
  public.erase_source_fingerprints_on_derived_purge()
  from public, anon, authenticated, service_role;
grant execute on function public.record_source_fingerprints(text, jsonb) to service_role;

commit;
