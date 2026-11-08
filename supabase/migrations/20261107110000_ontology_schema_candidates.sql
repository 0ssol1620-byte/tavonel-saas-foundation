-- C1 (PROGRAM-2026-11-04 §4.C): schema derivation runs, schema candidates, certification decisions.
--
-- Derive -> certify -> use. This migration holds the first two and nothing reads a certified
-- candidate yet: typed extraction (C2, W3) is the first consumer. A certified candidate is stored,
-- not used.
--
--   * ontology_derivation_runs: one row per derivation of one World revision (collection_id +
--     manifest_digest) by one deriver. Every run carries its Arena receipt pins as columns, so a
--     candidate can always be traced to the exact deriver that proposed it: model_id and
--     model_revision (for the deterministic baseline, the deriver's own id and code version),
--     prompt_sha256 (required for a model deriver, null for the baseline, which has no prompt),
--     schema_sha256 (the output contract), price_snapshot and inputs_sha256 (the canonical digest
--     of the evidence units the deriver read). A capability without these pins does not exist.
--     The same inputs through the same deriver version are the same run: a redelivered derive
--     returns the stored run and writes nothing (at-least-once delivery).
--
--   * ontology_schema_candidates: a proposed class or property. It cannot exist without evidence
--     (1-3 items, each naming a document of its run, a page, a box and a verbatim quote the app
--     checked against the World excerpt before writing). It is always written `proposed`: the
--     writer takes no state from its caller, so nothing is certified by derivation. Only
--     decide_ontology_schema_candidate moves it, and only with a named person and a reason.
--     internal_support (how many mentions backed it) is internal-DTO only.
--
--   * ontology_certification_decisions: append-only. Who, when, which candidate, which verdict,
--     why, and for an edit the before/after label and description. An UPDATE always raises; a row
--     leaves only with its run (source-deletion derived purge, founder test reset).
--
-- Tenant boundary: every function takes the workspace key from the server session and matches it
-- on every row. There is no cross-workspace path: a candidate id from another workspace is "not
-- found". Client access: none. RLS is on with an explicit deny-all policy for anon and
-- authenticated; service_role holds no table privilege and reaches the rows only through the RPCs.
--
-- Deletion: a run (and so its candidates, their evidence quotes and their decisions) goes when the
-- derived closure of a source deletion naming one of its documents records `derived_purged` -- the
-- same erase point as the retrieval rows and B1's fingerprints. Before that, a run naming a
-- tombstoned document is not listed and cannot be decided.
--
-- Nothing calls this until TAVONEL_ONTOLOGY_INDUCTION_ENABLED=true (nextjs/lib/ontology-schema.ts).
-- Additive; no existing object changes.
begin;

create table public.ontology_derivation_runs (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,32}$'),
  run_id uuid not null default gen_random_uuid(),
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  manifest_digest text not null check (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  deriver text not null check (deriver in ('baseline', 'model')),
  deriver_version text not null check (deriver_version ~ '^[a-z0-9_.:-]{1,64}$'),
  document_ids uuid[] not null check (cardinality(document_ids) between 1 and 2000),
  inputs_sha256 text not null check (inputs_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  schema_sha256 text not null check (schema_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  model_id text not null check (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  model_revision text not null check (model_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  prompt_sha256 text check (prompt_sha256 is null or prompt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  price_snapshot jsonb not null check (jsonb_typeof(price_snapshot) = 'object' and octet_length(price_snapshot::text) <= 1024),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object' and octet_length(receipt::text) <= 8192),
  receipt_sha256 text not null check (receipt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  candidate_count integer not null check (candidate_count between 0 and 65),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, run_id),
  unique (workspace_key, collection_id, manifest_digest, deriver, deriver_version, inputs_sha256),
  -- A model arm without a pinned prompt is a capability nobody can reproduce; the baseline has none.
  check ((deriver = 'model') = (prompt_sha256 is not null))
);

create table public.ontology_schema_candidates (
  workspace_key text not null,
  candidate_id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  kind text not null check (kind in ('class', 'property')),
  candidate_key text not null check (candidate_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text not null check (length(label) between 1 and 120),
  description text not null check (length(description) <= 600),
  domain_key text check (domain_key is null or domain_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  range_key text check (range_key is null or range_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) between 1 and 3
    and octet_length(evidence::text) <= 4096),
  internal_support integer not null check (internal_support >= 1),
  edited_label text check (edited_label is null or length(edited_label) between 1 and 120),
  edited_description text check (edited_description is null or length(edited_description) <= 600),
  state text not null default 'proposed' check (state in ('proposed', 'certified', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, candidate_id),
  unique (workspace_key, run_id, kind, candidate_key),
  foreign key (workspace_key, run_id) references public.ontology_derivation_runs (workspace_key, run_id) on delete cascade,
  check ((state = 'proposed') = (decided_at is null) and (decided_at is null) = (decided_by is null)),
  check ((kind = 'property') = (domain_key is not null and range_key is not null)),
  check (kind = 'property' or (domain_key is null and range_key is null))
);

create table public.ontology_certification_decisions (
  workspace_key text not null,
  decision_id uuid not null default gen_random_uuid(),
  candidate_id uuid not null,
  verdict text not null check (verdict in ('certify', 'reject', 'edit')),
  reason text not null check (length(btrim(reason)) between 8 and 1000),
  before jsonb check (before is null or (jsonb_typeof(before) = 'object' and octet_length(before::text) <= 2048)),
  after jsonb check (after is null or (jsonb_typeof(after) = 'object' and octet_length(after::text) <= 2048)),
  decided_by uuid not null,
  decided_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, decision_id),
  foreign key (workspace_key, candidate_id) references public.ontology_schema_candidates (workspace_key, candidate_id) on delete cascade,
  check ((verdict = 'edit') = (before is not null and after is not null))
);

create index ontology_derivation_runs_collection_idx
  on public.ontology_derivation_runs (workspace_key, collection_id, created_at desc);
create index ontology_derivation_runs_documents_idx
  on public.ontology_derivation_runs using gin (document_ids);
create index ontology_certification_decisions_candidate_idx
  on public.ontology_certification_decisions (workspace_key, candidate_id, decided_at);

alter table public.ontology_derivation_runs enable row level security;
alter table public.ontology_schema_candidates enable row level security;
alter table public.ontology_certification_decisions enable row level security;
revoke all on public.ontology_derivation_runs from public, anon, authenticated, service_role;
revoke all on public.ontology_schema_candidates from public, anon, authenticated, service_role;
revoke all on public.ontology_certification_decisions from public, anon, authenticated, service_role;
create policy ontology_derivation_runs_no_client_access on public.ontology_derivation_runs
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy ontology_schema_candidates_no_client_access on public.ontology_schema_candidates
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy ontology_certification_decisions_no_client_access on public.ontology_certification_decisions
  as restrictive for all to anon, authenticated using (false) with check (false);

create function public.ontology_decisions_append_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'ontology_decision_append_only';
end;
$$;
create trigger ontology_certification_decisions_append_only before update on public.ontology_certification_decisions
  for each row execute function public.ontology_decisions_append_only();

-- A run whose document has a deletion requested is no one's evidence any more.
create function public.ontology_run_tombstoned(p_workspace_key text, p_document_ids uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.source_deletion_tombstones t
     where t.workspace_key = p_workspace_key
       and public.source_deletion_document_ids(t.deletion_id) && p_document_ids);
$$;

/*
  record_ontology_derivation_run(workspace, run, candidates)

  run: {collectionId, manifestDigest, deriver, deriverVersion, documentIds[], inputsSha256,
        schemaSha256, modelId, modelRevision, promptSha256|null, priceSnapshot{}, receipt{},
        receiptSha256, createdBy}
  candidates: [{kind, key, label, description, domainKey?, rangeKey?, support,
                evidence: [{evidenceId, documentId, page, bbox:[4], quote}]}]

  Every candidate is written `proposed`, whatever the caller sends. Returns
  {"schemaVersion": "tavonel.ontology_derivation_run.v1", "runId", "created": bool, "candidates": n}.
*/
create function public.record_ontology_derivation_run(p_workspace_key text, p_run jsonb, p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_documents uuid[];
  v_run_id uuid;
  v_existing uuid;
  v_item jsonb;
  v_evidence jsonb;
  v_kind text;
  v_classes integer := 0;
  v_properties integer := 0;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_run is null or jsonb_typeof(p_run) <> 'object'
    or p_candidates is null or jsonb_typeof(p_candidates) <> 'array'
    or jsonb_typeof(p_run->'documentIds') is distinct from 'array'
    or (p_run->>'createdBy') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'ontology_run_invalid';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_run->'documentIds') d
             where d !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    raise exception 'ontology_run_invalid';
  end if;
  select array_agg(distinct d::uuid order by d::uuid) into v_documents from jsonb_array_elements_text(p_run->'documentIds') d;
  if v_documents is null then raise exception 'ontology_run_invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended('tavonel.ontology_derivation.v1' || chr(10) || p_workspace_key, 0));
  if public.ontology_run_tombstoned(p_workspace_key, v_documents) then
    raise exception 'ontology_source_deleted';
  end if;

  select r.run_id into v_existing from public.ontology_derivation_runs r
   where r.workspace_key = p_workspace_key and r.collection_id = p_run->>'collectionId'
     and r.manifest_digest = p_run->>'manifestDigest' and r.deriver = p_run->>'deriver'
     and r.deriver_version = p_run->>'deriverVersion' and r.inputs_sha256 = p_run->>'inputsSha256';
  if found then
    return jsonb_build_object('schemaVersion', 'tavonel.ontology_derivation_run.v1', 'runId', v_existing,
      'created', false, 'candidates', (select count(*) from public.ontology_schema_candidates c
        where c.workspace_key = p_workspace_key and c.run_id = v_existing));
  end if;

  insert into public.ontology_derivation_runs (workspace_key, collection_id, manifest_digest, deriver, deriver_version,
    document_ids, inputs_sha256, schema_sha256, model_id, model_revision, prompt_sha256, price_snapshot, receipt,
    receipt_sha256, candidate_count, created_by)
  values (p_workspace_key, p_run->>'collectionId', p_run->>'manifestDigest', p_run->>'deriver', p_run->>'deriverVersion',
    v_documents, p_run->>'inputsSha256', p_run->>'schemaSha256', p_run->>'modelId', p_run->>'modelRevision',
    p_run->>'promptSha256', p_run->'priceSnapshot', p_run->'receipt', p_run->>'receiptSha256',
    jsonb_array_length(p_candidates), (p_run->>'createdBy')::uuid)
  returning run_id into v_run_id;

  for v_item in select value from jsonb_array_elements(p_candidates) loop
    v_kind := v_item->>'kind';
    if v_kind = 'class' then v_classes := v_classes + 1; elsif v_kind = 'property' then v_properties := v_properties + 1; end if;
    -- No evidence, no candidate: a proposal nobody can check is not written.
    if jsonb_typeof(v_item->'evidence') is distinct from 'array' or jsonb_array_length(v_item->'evidence') = 0 then
      raise exception 'ontology_candidate_evidence_required';
    end if;
    for v_evidence in select value from jsonb_array_elements(v_item->'evidence') loop
      if jsonb_typeof(v_evidence) <> 'object'
        or (v_evidence->>'evidenceId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
        or (v_evidence->>'documentId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or not ((v_evidence->>'documentId')::uuid = any(v_documents))
        or jsonb_typeof(v_evidence->'page') <> 'number' or (v_evidence->>'page') !~ '^[1-9][0-9]{0,4}$'
        or jsonb_typeof(v_evidence->'bbox') is distinct from 'array' or jsonb_array_length(v_evidence->'bbox') <> 4
        or exists (select 1 from jsonb_array_elements(v_evidence->'bbox') b
                   where jsonb_typeof(b) <> 'number' or b::text !~ '^[0-9]{1,4}$' or b::text::integer > 1000)
        or jsonb_typeof(v_evidence->'quote') <> 'string' or length(v_evidence->>'quote') not between 1 and 300 then
        raise exception 'ontology_candidate_evidence_invalid';
      end if;
    end loop;
    insert into public.ontology_schema_candidates (workspace_key, run_id, kind, candidate_key, label, description,
      domain_key, range_key, evidence, internal_support)
    values (p_workspace_key, v_run_id, v_kind, v_item->>'key', v_item->>'label', coalesce(v_item->>'description', ''),
      v_item->>'domainKey', v_item->>'rangeKey',
      (select jsonb_agg(jsonb_build_object('evidenceId', e->>'evidenceId', 'documentId', e->>'documentId',
         'page', (e->>'page')::integer, 'bbox', e->'bbox', 'quote', e->>'quote')) from jsonb_array_elements(v_item->'evidence') e),
      (v_item->>'support')::integer);
  end loop;
  -- §4.C risk note: an over-long proposal moves the certification burden to the customer.
  if v_classes > 25 or v_properties > 40 then raise exception 'ontology_candidate_limit_exceeded'; end if;

  return jsonb_build_object('schemaVersion', 'tavonel.ontology_derivation_run.v1', 'runId', v_run_id,
    'created', true, 'candidates', jsonb_array_length(p_candidates));
end;
$$;

/*
  list_ontology_schema_candidates(workspace, collection)

  The latest run of this collection in this workspace that names no tombstoned document, with its
  candidates and their decisions. Internal shape: the route maps it to the public DTO and drops
  internal_support and the receipt pins.
*/
create function public.list_ontology_schema_candidates(p_workspace_key text, p_collection_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_run public.ontology_derivation_runs%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_collection_id is null or p_collection_id !~ '^collection-[a-f0-9]{32}$' then
    raise exception 'ontology_run_invalid';
  end if;
  select * into v_run from public.ontology_derivation_runs r
   where r.workspace_key = p_workspace_key and r.collection_id = p_collection_id
     and not public.ontology_run_tombstoned(p_workspace_key, r.document_ids)
   order by r.created_at desc, r.run_id limit 1;
  if not found then
    return jsonb_build_object('schemaVersion', 'tavonel.ontology_candidates.v1', 'run', null, 'candidates', '[]'::jsonb);
  end if;
  return jsonb_build_object('schemaVersion', 'tavonel.ontology_candidates.v1',
    'run', jsonb_build_object('runId', v_run.run_id, 'collectionId', v_run.collection_id,
      'manifestDigest', v_run.manifest_digest, 'deriver', v_run.deriver, 'deriverVersion', v_run.deriver_version,
      'documentIds', to_jsonb(v_run.document_ids), 'modelId', v_run.model_id, 'modelRevision', v_run.model_revision,
      'promptSha256', v_run.prompt_sha256, 'schemaSha256', v_run.schema_sha256, 'inputsSha256', v_run.inputs_sha256,
      'priceSnapshot', v_run.price_snapshot, 'receiptSha256', v_run.receipt_sha256, 'createdAt', v_run.created_at),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object(
        'candidateId', c.candidate_id, 'kind', c.kind, 'key', c.candidate_key, 'label', c.label,
        'description', c.description, 'editedLabel', c.edited_label, 'editedDescription', c.edited_description,
        'domainKey', c.domain_key, 'rangeKey', c.range_key, 'evidence', c.evidence, 'support', c.internal_support,
        'state', c.state, 'decidedBy', c.decided_by, 'decidedAt', c.decided_at,
        'decisions', coalesce((select jsonb_agg(jsonb_build_object('verdict', d.verdict, 'decidedBy', d.decided_by,
            'decidedAt', d.decided_at) order by d.decided_at, d.decision_id)
          from public.ontology_certification_decisions d
          where d.workspace_key = c.workspace_key and d.candidate_id = c.candidate_id), '[]'::jsonb))
        order by c.kind, c.internal_support desc, c.candidate_key)
      from public.ontology_schema_candidates c where c.workspace_key = p_workspace_key and c.run_id = v_run.run_id), '[]'::jsonb));
end;
$$;

/*
  decide_ontology_schema_candidate(workspace, candidate, verdict, actor, reason, edit)

  certify | reject close a proposed candidate for good; edit changes its label/description and
  keeps it proposed. Every call appends one decision row. A candidate of another workspace is not
  found, a decided one is not decided again, and a run naming a deleted document is closed.
*/
create function public.decide_ontology_schema_candidate(
  p_workspace_key text, p_candidate_id uuid, p_verdict text, p_actor uuid, p_reason text, p_edit jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_candidate public.ontology_schema_candidates%rowtype;
  v_documents uuid[];
  v_label text;
  v_description text;
  v_decision uuid;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$' or p_candidate_id is null
    or p_actor is null or p_verdict is null or p_verdict not in ('certify', 'reject', 'edit') then
    raise exception 'ontology_decision_invalid';
  end if;
  -- The reason is the reviewer's evidence for the verdict; a verdict without one is not recorded.
  if p_reason is null or length(btrim(p_reason)) not between 8 and 1000 then
    raise exception 'ontology_decision_reason_required';
  end if;
  select * into v_candidate from public.ontology_schema_candidates c
   where c.workspace_key = p_workspace_key and c.candidate_id = p_candidate_id for update;
  if not found then raise exception 'ontology_candidate_not_found'; end if;
  if v_candidate.state <> 'proposed' then raise exception 'ontology_candidate_already_decided'; end if;
  select r.document_ids into v_documents from public.ontology_derivation_runs r
   where r.workspace_key = p_workspace_key and r.run_id = v_candidate.run_id;
  if public.ontology_run_tombstoned(p_workspace_key, v_documents) then raise exception 'ontology_source_deleted'; end if;
  -- Defence in depth: the table check already forbids a candidate without evidence.
  if jsonb_array_length(v_candidate.evidence) = 0 then raise exception 'ontology_candidate_evidence_required'; end if;

  if p_verdict = 'edit' then
    v_label := btrim(coalesce(p_edit->>'label', ''));
    v_description := btrim(coalesce(p_edit->>'description', ''));
    if p_edit is null or jsonb_typeof(p_edit) <> 'object' or length(v_label) not between 1 and 120
      or length(v_description) > 600 then
      raise exception 'ontology_decision_invalid';
    end if;
    insert into public.ontology_certification_decisions (workspace_key, candidate_id, verdict, reason, before, after, decided_by)
    values (p_workspace_key, p_candidate_id, 'edit', btrim(p_reason),
      jsonb_build_object('label', coalesce(v_candidate.edited_label, v_candidate.label),
        'description', coalesce(v_candidate.edited_description, v_candidate.description)),
      jsonb_build_object('label', v_label, 'description', v_description), p_actor)
    returning decision_id into v_decision;
    update public.ontology_schema_candidates c set edited_label = v_label, edited_description = v_description
     where c.workspace_key = p_workspace_key and c.candidate_id = p_candidate_id;
  else
    insert into public.ontology_certification_decisions (workspace_key, candidate_id, verdict, reason, decided_by)
    values (p_workspace_key, p_candidate_id, p_verdict, btrim(p_reason), p_actor)
    returning decision_id into v_decision;
    update public.ontology_schema_candidates c
       set state = case p_verdict when 'certify' then 'certified' else 'rejected' end,
           decided_by = p_actor, decided_at = clock_timestamp()
     where c.workspace_key = p_workspace_key and c.candidate_id = p_candidate_id;
  end if;
  return jsonb_build_object('schemaVersion', 'tavonel.ontology_decision.v1', 'decisionId', v_decision,
    'candidateId', p_candidate_id, 'verdict', p_verdict,
    'state', (select c.state from public.ontology_schema_candidates c
               where c.workspace_key = p_workspace_key and c.candidate_id = p_candidate_id));
end;
$$;

-- The derived closure's receipt is the erase point, exactly as for retrieval units and B1's fingerprints.
create function public.erase_ontology_runs_on_derived_purge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action = 'derived_purged' then
    delete from public.ontology_derivation_runs r
     where r.workspace_key = new.workspace_key
       and r.document_ids && public.source_deletion_document_ids(new.deletion_id);
  end if;
  return new;
end;
$$;

create trigger source_deletion_receipts_erase_ontology_runs
  after insert on public.source_deletion_receipts
  for each row execute function public.erase_ontology_runs_on_derived_purge();

revoke all on function public.record_ontology_derivation_run(text, jsonb, jsonb),
  public.list_ontology_schema_candidates(text, text),
  public.decide_ontology_schema_candidate(text, uuid, text, uuid, text, jsonb),
  public.ontology_run_tombstoned(text, uuid[]),
  public.ontology_decisions_append_only(),
  public.erase_ontology_runs_on_derived_purge()
  from public, anon, authenticated, service_role;
grant execute on function public.record_ontology_derivation_run(text, jsonb, jsonb),
  public.list_ontology_schema_candidates(text, text),
  public.decide_ontology_schema_candidate(text, uuid, text, uuid, text, jsonb)
  to service_role;

commit;
