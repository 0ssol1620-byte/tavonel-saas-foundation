-- WO-D23-4 (V34 D23, S14): a person's decision on a Library label. Function only, no new table.
--
-- 20261107100000 made `document_labels` hold proposals and abstentions and reserved confirmed /
-- rejected for a person ("confirming or rejecting is a person's act and is not reachable from
-- here"). This is that act. It appends ONE row to the existing table with method 'person';
-- nothing is updated or deleted, no source row is touched, and the original proposal stays.
--
-- Two kinds of person row:
--   * a decision (method_version 'person:v1', disposition confirmed or rejected). The newest
--     decision on a label that nobody withdrew wins, whatever it follows: a rejection after a
--     confirmation is a rejection (nextjs/lib/library-shadow.ts, standingDecisions).
--   * an Undo (p_decision 'undo_confirmed' / 'undo_rejected', method_version 'person-undo:v1'). It
--     withdraws the newest decision standing on that label, and names it: its disposition is the
--     withdrawn decision's and evidence_ids[1] is that row's inputs_sha256. Withdrawing the newest
--     standing decision leaves exactly what stood before it. The store chooses the row under the
--     lock; when it is not the decision the caller undoes (someone decided since, or nothing
--     stands), the Undo is refused as 'library_decision_stale' and nothing is written.
--
-- Ordering: this file is the first of two migrations of the V34 product-UX cluster. The lead
-- assigns the final timestamp at merge so file order equals merge order.
--
-- No new table, so the founder-test-reset closure is unchanged: the rows live in document_labels,
-- which that closure already counts, fences and deletes.
--
-- Idempotency: the idempotency key is hashed into inputs_sha256, so a replay of the same key lands
-- on the same row. The same key with another label or decision is a conflict, never an overwrite.
-- A per-document advisory lock makes every check-then-insert race-free.
--
-- Client access: service_role only. The browser reaches it through the session-only route.
begin;

create function public.decide_library_label(
  p_workspace_key text, p_document_id uuid, p_source_version_id text, p_label_kind text,
  p_label_key text, p_decision text, p_decided_by uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_inputs text;
  v_set text;
  v_undo boolean;
  v_method_version text;
  v_disposition text;
  v_evidence text[] := '{}';
  v_standing public.document_labels%rowtype;
  v_row public.document_labels%rowtype;
  v_replayed boolean := false;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_document_id is null
    or p_source_version_id is null or p_source_version_id !~ '^[a-f0-9]{64}$'
    or p_label_kind is null or p_label_kind not in ('doc_type', 'topic')
    or p_label_key is null or pg_catalog.char_length(p_label_key) not between 1 and 64 or p_label_key ~ '[[:cntrl:]]'
    or p_decision is null or p_decision not in ('confirmed', 'rejected', 'undo_confirmed', 'undo_rejected')
    or p_decided_by is null
    or p_idempotency_key is null or pg_catalog.char_length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key ~ '[[:cntrl:]]'
    or (p_label_kind = 'doc_type' and p_label_key not in ('contract', 'invoice', 'policy', 'report',
      'financial_filing', 'manual', 'presentation', 'datasheet', 'letter', 'form', 'other')) then
    raise exception 'library_decision_request_invalid';
  end if;
  v_undo := p_decision in ('undo_confirmed', 'undo_rejected');
  v_method_version := case when v_undo then 'person-undo:v1' else 'person:v1' end;
  v_disposition := case when v_undo then pg_catalog.substr(p_decision, 6) else p_decision end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.library_decision.v1' || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || p_document_id::text, 0));

  -- The decision targets a recorded, live source version of THIS workspace; the FK would refuse the
  -- insert too, but a decision on a deleted document must not look like an invalid request.
  if not exists (select 1 from public.source_fingerprints f
      where f.workspace_key = p_workspace_key and f.document_id = p_document_id and f.source_version_id = p_source_version_id)
    or public.source_fingerprint_document_tombstoned(p_workspace_key, p_document_id) then
    raise exception 'library_decision_target_missing';
  end if;

  v_inputs := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_idempotency_key, 'UTF8')), 'hex');

  -- A key names one person row, decision or Undo, wherever it landed.
  select * into v_row from public.document_labels l
   where l.workspace_key = p_workspace_key and l.document_id = p_document_id and l.source_version_id = p_source_version_id
     and l.label_kind = p_label_kind and l.method_version in ('person:v1', 'person-undo:v1') and l.inputs_sha256 = v_inputs;
  if found then
    if v_row.label_key <> p_label_key or v_row.disposition <> v_disposition or v_row.method_version <> v_method_version then
      raise exception 'library_decision_conflict';
    end if;
    v_replayed := true;
  else
    if v_undo then
      -- The decision standing on this label: the newest decision row no Undo row names.
      select * into v_standing from public.document_labels l
       where l.workspace_key = p_workspace_key and l.document_id = p_document_id and l.label_kind = p_label_kind
         and l.label_key = p_label_key and l.disposition in ('confirmed', 'rejected') and l.method_version <> 'person-undo:v1'
         and not exists (select 1 from public.document_labels u
           where u.workspace_key = l.workspace_key and u.document_id = l.document_id and u.label_kind = l.label_kind
             and u.label_key = l.label_key and u.method_version = 'person-undo:v1' and u.evidence_ids[1] = l.inputs_sha256)
       order by l.created_at desc limit 1;
      if not found or v_standing.disposition <> v_disposition then
        raise exception 'library_decision_stale';
      end if;
      v_evidence := array[v_standing.inputs_sha256];
    end if;
    -- The label set of the latest production row of this kind for this document; a person's own set otherwise.
    select l.label_set_version into v_set from public.document_labels l
     where l.workspace_key = p_workspace_key and l.document_id = p_document_id and l.label_kind = p_label_kind
       and l.method <> 'person'
     order by l.created_at desc limit 1;
    v_set := coalesce(v_set, case p_label_kind when 'doc_type' then 'doc-type:v0' else 'person:v1' end);
    insert into public.document_labels
      (workspace_key, document_id, source_version_id, label_kind, label_key, label_set_version, method, method_version,
       inputs_sha256, disposition, evidence_ids, decided_by, decided_at)
    values (p_workspace_key, p_document_id, p_source_version_id, p_label_kind, p_label_key, v_set, 'person', v_method_version,
            v_inputs, v_disposition, v_evidence, p_decided_by, pg_catalog.clock_timestamp())
    returning * into v_row;
  end if;

  return pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.library_decision.v1', 'replayed', v_replayed,
    'documentId', v_row.document_id, 'sourceVersionId', v_row.source_version_id, 'labelKind', v_row.label_kind,
    'labelKey', v_row.label_key, 'decision', p_decision, 'decidedAt', v_row.decided_at);
end;
$$;

revoke all on function public.decide_library_label(text, uuid, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_library_label(text, uuid, text, text, text, text, uuid, text) to service_role;

commit;
