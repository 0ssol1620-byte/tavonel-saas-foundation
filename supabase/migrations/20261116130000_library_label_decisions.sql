-- WO-D23-4 (V34 D23, S14): a person's decision on a Library label. Function only, no new table.
--
-- 20261107100000 made `document_labels` hold proposals and abstentions and reserved confirmed /
-- rejected for a person ("confirming or rejecting is a person's act and is not reachable from
-- here"). This is that act. It appends ONE row to the existing table with method 'person';
-- nothing is updated or deleted, no source row is touched, and the original proposal stays.
-- Undo is a later decision of the opposite kind: the reader takes the newest person decision per
-- label (nextjs/lib/library-shadow.ts).
--
-- Ordering: this file is the first of two migrations of the V34 product-UX cluster. The lead
-- assigns the final timestamp at merge so file order equals merge order.
--
-- No new table, so the founder-test-reset closure is unchanged: the rows live in document_labels,
-- which that closure already counts, fences and deletes.
--
-- Idempotency: the idempotency key is hashed into inputs_sha256, so a replay of the same key lands
-- on the same primary key. The same key with another label or decision is a conflict, never an
-- overwrite. A per-document advisory lock makes the check-then-insert race-free.
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
  v_row public.document_labels%rowtype;
  v_replayed boolean := false;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_document_id is null
    or p_source_version_id is null or p_source_version_id !~ '^[a-f0-9]{64}$'
    or p_label_kind is null or p_label_kind not in ('doc_type', 'topic')
    or p_label_key is null or pg_catalog.char_length(p_label_key) not between 1 and 64 or p_label_key ~ '[[:cntrl:]]'
    or p_decision is null or p_decision not in ('confirmed', 'rejected')
    or p_decided_by is null
    or p_idempotency_key is null or pg_catalog.char_length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key ~ '[[:cntrl:]]'
    or (p_label_kind = 'doc_type' and p_label_key not in ('contract', 'invoice', 'policy', 'report',
      'financial_filing', 'manual', 'presentation', 'datasheet', 'letter', 'form', 'other')) then
    raise exception 'library_decision_request_invalid';
  end if;

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

  select * into v_row from public.document_labels l
   where l.workspace_key = p_workspace_key and l.document_id = p_document_id and l.source_version_id = p_source_version_id
     and l.label_kind = p_label_kind and l.method_version = 'person:v1' and l.inputs_sha256 = v_inputs;
  if found then
    if v_row.label_key <> p_label_key or v_row.disposition <> p_decision then
      raise exception 'library_decision_conflict';
    end if;
    v_replayed := true;
  else
    -- The label set of the latest production row of this kind for this document; a person's own set otherwise.
    select l.label_set_version into v_set from public.document_labels l
     where l.workspace_key = p_workspace_key and l.document_id = p_document_id and l.label_kind = p_label_kind
       and l.method <> 'person'
     order by l.created_at desc limit 1;
    v_set := coalesce(v_set, case p_label_kind when 'doc_type' then 'doc-type:v0' else 'person:v1' end);
    insert into public.document_labels
      (workspace_key, document_id, source_version_id, label_kind, label_key, label_set_version, method, method_version,
       inputs_sha256, disposition, decided_by, decided_at)
    values (p_workspace_key, p_document_id, p_source_version_id, p_label_kind, p_label_key, v_set, 'person', 'person:v1',
            v_inputs, p_decision, p_decided_by, pg_catalog.clock_timestamp())
    returning * into v_row;
  end if;

  return pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.library_decision.v1', 'replayed', v_replayed,
    'documentId', v_row.document_id, 'sourceVersionId', v_row.source_version_id, 'labelKind', v_row.label_kind,
    'labelKey', v_row.label_key, 'decision', v_row.disposition, 'decidedAt', v_row.decided_at);
end;
$$;

revoke all on function public.decide_library_label(text, uuid, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_library_label(text, uuid, text, text, text, text, uuid, text) to service_role;

commit;
