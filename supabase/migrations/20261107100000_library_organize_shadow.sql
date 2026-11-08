-- B2a/B2b/B2c (PROGRAM-2026-11-04 §4.B): near-duplicate, document-type and topic-tag proposals,
-- shadow first. Additive on top of B1 (20261104090500).
--
-- Nothing reads these rows on a customer path while TAVONEL_LIBRARY_ORGANIZE_MODE is off (the
-- default) or shadow: the compile intake records proposals, and only `on` inside the processing
-- cohort lets the server build the Library DTO from them (nextjs/lib/library-shadow.ts). With the
-- flag off the app never calls either RPC.
--
--   * source_fingerprints gains the B2a text fingerprint B1's header reserved for it: the digest
--     of the normalized OCR text (same text, different bytes) and a 128-value MinHash over word
--     5-shingles. Both are computed by the server from the OCR result it already verified; one
--     version has one ocr.json, so a different text fingerprint for a recorded version is an
--     integrity fault, never an update. embedding_ref is not added: no embedding arm runs yet
--     (it needs a billable endpoint and the orchestrator's go), and the column arrives with it.
--
--   * document_relations gains inputs_sha256, so every scored proposal names what it was computed
--     from. same_text / near_duplicate / revision_candidate rows are written here; exact_bytes stays
--     B1's. internal_score / internal_threshold are internal-DTO only. The thresholds below (0.85
--     near, 0.50 revision) are UNCALIBRATED shadow defaults recorded on every row; the §4.B B2a
--     benchmark sets them against a named corpus, and they are never called calibrated here.
--
--   * document_labels holds doc_type (B2b) and topic (B2c) proposals in one table. Every row names
--     its method and method version (a rules id, a clustering id, or a model id + revision +
--     prompt digest for an Arena arm), the digest of its inputs and its internal score, so the
--     knowledge Arena can judge any arm from the rows alone. An abstention is a row with a reason,
--     never a silent "other". This RPC writes proposals and abstentions only; confirming or
--     rejecting is a person's act and is not reachable from here.
--
-- Tenant boundary: every read and write is `workspace_key = p_workspace_key`; FKs carry the
-- workspace key. Deletion: labels cascade from their fingerprint, which B1's derived-purge trigger
-- erases; relations already cascade. A tombstoned document is invisible to matching and reading.
--
-- Client access: none. RLS on with an explicit deny-all policy for anon and authenticated, and no
-- table privilege for any role; service_role reaches the rows only through the two RPCs.
begin;

alter table public.source_fingerprints
  add column text_sha256 text check (text_sha256 is null or text_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  add column minhash bigint[],
  add column text_fingerprint_version text,
  add constraint source_fingerprints_text_fingerprint_whole check (
    (text_sha256 is null and minhash is null and text_fingerprint_version is null)
    or (text_sha256 is not null and text_fingerprint_version = 'text-minhash:v1'
        and minhash is not null and pg_catalog.array_ndims(minhash) = 1 and pg_catalog.cardinality(minhash) = 128
        and pg_catalog.array_position(minhash, null) is null
        and 0 <= all (minhash) and 4294967295 >= all (minhash)));

create index source_fingerprints_text_idx
  on public.source_fingerprints (workspace_key, text_sha256) where text_sha256 is not null;

alter table public.document_relations
  add column inputs_sha256 text check (inputs_sha256 is null or inputs_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  -- A text match is a fact like an exact match: no score. A similarity match always carries its
  -- score, the threshold it crossed and its inputs, or it is not evidence the Arena can judge.
  add constraint document_relations_text_kinds_are_traceable check (
    case kind
      when 'same_text' then internal_score is null and internal_threshold is null and inputs_sha256 is not null
      when 'near_duplicate' then internal_score is not null and internal_threshold is not null and inputs_sha256 is not null
      when 'revision_candidate' then internal_score is not null and internal_threshold is not null and inputs_sha256 is not null
      else true
    end);

create table public.document_labels (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,32}$'),
  document_id uuid not null,
  source_version_id text not null check (source_version_id ~ '^[a-f0-9]{64}$'),
  label_kind text not null check (label_kind in ('doc_type', 'topic')),
  label_key text not null check (pg_catalog.char_length(label_key) <= 64 and label_key !~ '[[:cntrl:]]'),
  label_set_version text not null check (label_set_version ~ '^[a-z0-9_.:-]{1,64}$'),
  method text not null check (method ~ '^[A-Za-z0-9_./:-]{1,128}$'),
  method_version text not null check (method_version ~ '^[A-Za-z0-9_./:-]{1,128}$'),
  inputs_sha256 text not null check (inputs_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  disposition text not null default 'proposed' check (disposition in ('proposed', 'abstained', 'confirmed', 'rejected')),
  abstain_reason text check (abstain_reason is null or abstain_reason ~ '^[a-z_]{1,64}$'),
  internal_score double precision check (internal_score is null or (internal_score >= 0 and internal_score <= 1)),
  evidence_ids text[] not null default '{}' check (pg_catalog.cardinality(evidence_ids) <= 16),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, document_id, source_version_id, label_kind, method_version, inputs_sha256, label_key),
  -- An abstention has no label and says why; a label never hides an abstention reason.
  check ((disposition = 'abstained') = (label_key = '')),
  check ((disposition = 'abstained') = (abstain_reason is not null)),
  check (disposition <> 'abstained' or internal_score is null),
  -- Label set v0 (§4.B B2b). A certified schema (C) arrives as another label_set_version.
  check (label_set_version <> 'doc-type:v0' or label_key in ('', 'contract', 'invoice', 'policy', 'report',
    'financial_filing', 'manual', 'presentation', 'datasheet', 'letter', 'form', 'other')),
  check ((disposition in ('proposed', 'abstained')) = (decided_at is null)
    and (decided_by is null or decided_at is not null)),
  foreign key (workspace_key, document_id, source_version_id)
    references public.source_fingerprints (workspace_key, document_id, source_version_id) on delete cascade
);

alter table public.document_labels enable row level security;
revoke all on public.document_labels from public, anon, authenticated, service_role;
create policy document_labels_no_client_access on public.document_labels
  as restrictive for all to anon, authenticated using (false) with check (false);

-- Share of equal MinHash positions: an unbiased estimate of the Jaccard similarity of the shingle sets.
create function public.library_minhash_similarity(p_a bigint[], p_b bigint[])
returns double precision language sql immutable set search_path = '' as $$
  select count(*)::double precision / 128 from pg_catalog.generate_series(1, 128) i where p_a[i] = p_b[i];
$$;

/*
  record_library_organize(workspace, [{documentId, sourceVersionId, sanitizedSha256,
    textFingerprint: null | {textSha256, minhash: [128 x u32]}, labels: [...0..32]}, ...1..128])

  Idempotent under at-least-once delivery: a fingerprint, a relation and a label row are each
  written once; a redelivered call writes nothing and reports nothing new. It takes B1's workspace
  lock, so it serializes with B1's recorder and with itself.

  The fingerprint row is created when B1 has not (B1's flag may be off): the same exact columns B1
  would write, the source digest read here and never accepted from the caller. An existing row's
  exact columns are B1's business and are not touched.

  Returns {"schemaVersion": "tavonel.library_organize.v1", "documents": n,
           "newPairs": {"same_text": n, "near_duplicate": n, "revision_candidate": n},
           "labelsRecorded": n}  -- counts of what THIS call added, so shadow telemetry is not
  inflated by re-compiles.
*/
create function public.record_library_organize(p_workspace_key text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_label jsonb;
  v_document_id uuid;
  v_version text;
  v_text text;
  v_minhash bigint[];
  v_existing public.source_fingerprints%rowtype;
  v_documents uuid[] := '{}';
  v_versions text[] := '{}';
  v_started timestamptz;
  v_labels integer := 0;
  v_inserted integer;
  v_pairs jsonb;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
    or pg_catalog.jsonb_array_length(p_items) not between 1 and 128 then
    raise exception 'library_organize_request_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_fingerprints.v1' || pg_catalog.chr(10) || p_workspace_key, 0));
  v_started := pg_catalog.clock_timestamp();

  for v_item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
      or (v_item->>'documentId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (v_item->>'sourceVersionId') !~ '^[a-f0-9]{64}$'
      or (v_item->>'sanitizedSha256') is distinct from 'sha256:' || (v_item->>'sourceVersionId')
      or pg_catalog.jsonb_typeof(v_item->'textFingerprint') not in ('null', 'object')
      or pg_catalog.jsonb_typeof(v_item->'labels') is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_item->'labels') > 32 then
      raise exception 'library_organize_request_invalid';
    end if;
    v_document_id := (v_item->>'documentId')::uuid;
    v_version := v_item->>'sourceVersionId';
    v_text := null;
    v_minhash := null;
    if pg_catalog.jsonb_typeof(v_item->'textFingerprint') = 'object' then
      if pg_catalog.jsonb_typeof(v_item->'textFingerprint'->'minhash') is distinct from 'array'
        or pg_catalog.jsonb_array_length(v_item->'textFingerprint'->'minhash') <> 128 then
        raise exception 'library_organize_request_invalid';
      end if;
      v_text := v_item->'textFingerprint'->>'textSha256';
      v_minhash := array(select x::bigint from pg_catalog.jsonb_array_elements_text(v_item->'textFingerprint'->'minhash') x);
    end if;

    insert into public.source_fingerprints
      (workspace_key, document_id, source_version_id, sanitized_sha256, content_sha256, fingerprint_version)
    select p_workspace_key, v_document_id, v_version, v_item->>'sanitizedSha256',
           (select a.source_sha256 from public.foundation_intake_admissions a
             where a.workspace_key = p_workspace_key and a.document_id = v_document_id), 'exact:v1'
    on conflict do nothing;

    if v_text is not null then
      select * into v_existing from public.source_fingerprints f
       where f.workspace_key = p_workspace_key and f.document_id = v_document_id and f.source_version_id = v_version;
      if v_existing.text_sha256 is null then
        update public.source_fingerprints f
           set text_sha256 = v_text, minhash = v_minhash, text_fingerprint_version = 'text-minhash:v1'
         where f.workspace_key = p_workspace_key and f.document_id = v_document_id and f.source_version_id = v_version;
      elsif v_existing.text_sha256 <> v_text or v_existing.minhash <> v_minhash then
        -- One version has one OCR result; a different reading of it is an integrity fault.
        raise exception 'library_text_fingerprint_conflict';
      end if;

      insert into public.document_relations
        (workspace_key, document_id, source_version_id, related_document_id, related_source_version_id,
         kind, method, method_version, internal_score, internal_threshold, inputs_sha256, evidence)
      select p_workspace_key, v_document_id, v_version, m.document_id, m.source_version_id, m.kind,
             case m.kind when 'same_text' then 'normalized_text_digest' else 'minhash_w5_128' end,
             case m.kind when 'same_text' then 'text:v1' else 'minhash:v1' end,
             case m.kind when 'same_text' then null else m.score end,
             case m.kind when 'same_text' then null when 'near_duplicate' then 0.85 else 0.50 end,
             'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
               m.kind || pg_catalog.chr(10) || least(v_text, m.text_sha256) || pg_catalog.chr(10) || greatest(v_text, m.text_sha256),
               'UTF8'), 'sha256'), 'hex'),
             pg_catalog.jsonb_build_object('matchedOn', pg_catalog.jsonb_build_array(
               case m.kind when 'same_text' then 'normalized_text' else 'text_minhash' end))
        from (
          select o.document_id, o.source_version_id, o.text_sha256, s.score,
                 case when o.text_sha256 = v_text then 'same_text'
                      when s.score >= 0.85 then 'near_duplicate'
                      when s.score >= 0.50 then 'revision_candidate' end as kind
            from public.source_fingerprints o
            cross join lateral (select public.library_minhash_similarity(v_minhash, o.minhash) as score) s
           where o.workspace_key = p_workspace_key
             and o.document_id <> v_document_id
             and o.text_sha256 is not null
             and not public.source_fingerprint_document_tombstoned(p_workspace_key, o.document_id)
        ) m
       where m.kind is not null
      on conflict do nothing;
      -- The reverse direction, so the earlier document also names the later one.
      insert into public.document_relations
        (workspace_key, document_id, source_version_id, related_document_id, related_source_version_id,
         kind, method, method_version, internal_score, internal_threshold, inputs_sha256, evidence)
      select r.workspace_key, r.related_document_id, r.related_source_version_id, r.document_id, r.source_version_id,
             r.kind, r.method, r.method_version, r.internal_score, r.internal_threshold, r.inputs_sha256, r.evidence
        from public.document_relations r
       where r.workspace_key = p_workspace_key and r.document_id = v_document_id and r.source_version_id = v_version
         and r.kind in ('same_text', 'near_duplicate', 'revision_candidate')
      on conflict do nothing;
    end if;

    for v_label in select value from pg_catalog.jsonb_array_elements(v_item->'labels') loop
      -- A writer proposes or abstains. Confirming or rejecting is a person's act, not this RPC's.
      if pg_catalog.jsonb_typeof(v_label) <> 'object'
        or (v_label->>'disposition') not in ('proposed', 'abstained')
        or pg_catalog.jsonb_typeof(v_label->'evidenceIds') is distinct from 'array'
        or pg_catalog.jsonb_typeof(v_label->'internalScore') not in ('null', 'number') then
        raise exception 'library_organize_request_invalid';
      end if;
      insert into public.document_labels
        (workspace_key, document_id, source_version_id, label_kind, label_key, label_set_version, method,
         method_version, inputs_sha256, disposition, abstain_reason, internal_score, evidence_ids)
      values (p_workspace_key, v_document_id, v_version, v_label->>'labelKind', v_label->>'labelKey',
              v_label->>'labelSetVersion', v_label->>'method', v_label->>'methodVersion', v_label->>'inputsSha256',
              v_label->>'disposition', v_label->>'abstainReason', (v_label->>'internalScore')::double precision,
              array(select x from pg_catalog.jsonb_array_elements_text(v_label->'evidenceIds') x))
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_labels := v_labels + v_inserted;
    end loop;

    v_documents := v_documents || v_document_id;
    v_versions := v_versions || v_version;
  end loop;

  select pg_catalog.jsonb_build_object(
           'same_text', count(distinct (least(r.document_id, r.related_document_id), greatest(r.document_id, r.related_document_id)))
             filter (where r.kind = 'same_text'),
           'near_duplicate', count(distinct (least(r.document_id, r.related_document_id), greatest(r.document_id, r.related_document_id)))
             filter (where r.kind = 'near_duplicate'),
           'revision_candidate', count(distinct (least(r.document_id, r.related_document_id), greatest(r.document_id, r.related_document_id)))
             filter (where r.kind = 'revision_candidate'))
    into v_pairs
    from public.document_relations r
    join rows from (pg_catalog.unnest(v_documents), pg_catalog.unnest(v_versions)) as c(document_id, source_version_id)
      on c.document_id = r.document_id and c.source_version_id = r.source_version_id
   where r.workspace_key = p_workspace_key and r.created_at >= v_started
     and r.kind in ('same_text', 'near_duplicate', 'revision_candidate');

  return pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.library_organize.v1',
    'documents', pg_catalog.cardinality(v_documents), 'newPairs', v_pairs, 'labelsRecorded', v_labels);
end;
$$;

/*
  read_library_organize(workspace, [documentId, ...1..128]) -> the INTERNAL rows for those
  documents: every label row and every relation (all four kinds) whose two documents are live.
  Scores, thresholds, methods and input digests are here because this is the internal shape; the
  server maps it to a separate public type that has none of them (nextjs/lib/library-shadow.ts).
*/
create function public.read_library_organize(p_workspace_key text, p_document_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_document_ids is null or pg_catalog.cardinality(p_document_ids) not between 1 and 128
    or pg_catalog.array_position(p_document_ids, null) is not null then
    raise exception 'library_organize_request_invalid';
  end if;
  return pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.library_organize_read.v1',
    'labels', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'documentId', l.document_id, 'sourceVersionId', l.source_version_id, 'labelKind', l.label_kind,
        'labelKey', l.label_key, 'labelSetVersion', l.label_set_version, 'method', l.method,
        'methodVersion', l.method_version, 'inputsSha256', l.inputs_sha256, 'disposition', l.disposition,
        'abstainReason', l.abstain_reason, 'internalScore', l.internal_score, 'evidenceIds', pg_catalog.to_jsonb(l.evidence_ids),
        'createdAt', l.created_at)
        order by l.document_id, l.label_kind, l.created_at, l.label_key)
      from public.document_labels l
     where l.workspace_key = p_workspace_key and l.document_id = any(p_document_ids)
       and not public.source_fingerprint_document_tombstoned(p_workspace_key, l.document_id)), '[]'::jsonb),
    'relations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'documentId', r.document_id, 'relatedDocumentId', r.related_document_id, 'kind', r.kind, 'state', r.state,
        'method', r.method, 'methodVersion', r.method_version, 'internalScore', r.internal_score,
        'internalThreshold', r.internal_threshold, 'inputsSha256', r.inputs_sha256, 'evidence', r.evidence)
        order by r.document_id, r.related_document_id, r.kind)
      from (select distinct on (x.document_id, x.related_document_id, x.kind) x.*
              from public.document_relations x
             where x.workspace_key = p_workspace_key and x.document_id = any(p_document_ids)
             order by x.document_id, x.related_document_id, x.kind, x.created_at desc) r
     where not public.source_fingerprint_document_tombstoned(p_workspace_key, r.document_id)
       and not public.source_fingerprint_document_tombstoned(p_workspace_key, r.related_document_id)), '[]'::jsonb));
end;
$$;

revoke all on function public.library_minhash_similarity(bigint[], bigint[]),
  public.record_library_organize(text, jsonb),
  public.read_library_organize(text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.record_library_organize(text, jsonb) to service_role;
grant execute on function public.read_library_organize(text, uuid[]) to service_role;

commit;
