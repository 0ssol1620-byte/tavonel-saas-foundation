-- Intake approval contract, phase A of a held stack: the database invariants only.
--
-- HELD. NOT DEPLOYABLE ALONE. Nothing calls these functions until the server-boundary and
-- browser phases in IMPLEMENTATION_NOTES.md land on top of this one; the stack ships whole or
-- not at all.
--
-- What this adds, and nothing else:
--   * foundation_intake_approvals: one row per complete selected-file set, keyed by the
--     server-authenticated workspace and principal plus the client attempt key. It records the
--     immutable pricing fingerprint, a scope digest the database computes itself over the whole
--     manifest, the approved aggregate maximum, and a 10-minute expiry.
--   * foundation_intake_approval_files: one row per member -- stable file key, the client's
--     content claims, one server-minted document id, and the approved per-file maxima. A format
--     whose page count cannot be read is approved at the full 80-page processing ceiling or not
--     at all.
--   * create / reserve / confirm / cancel / read RPCs and an approval-aware settlement wrapper.
--     Every one takes the same advisory lock and then the approval row, so confirm and cancel
--     for a member are one serial decision rather than a check-then-act race.
--   * a guard trigger on foundation_compute_reservations that acts only on rows whose document
--     belongs to an approval: the reservation must equal the approved maxima, may not be taken
--     under an expired or cancelled approval, and may never have its maximum rewritten. That
--     last rule is what stops settle_foundation_compute_v3 raising an owner or trial maximum to
--     fit observed work. Rows that are not approval-bound -- every row that exists today -- are
--     untouched, so 0036, 0045 and 20260911120000 behave exactly as audited for them.
--
-- Not changed: prices, credit constants, plans, the reservation lifetime (reserve_v3 still sets
-- 10 minutes), the expiry sweep, any existing function body, and the source-agent replay path.
-- Credit amounts arrive already quoted by the server (quoteCompilePages); this file stores and
-- enforces them, it does not price anything.
--
-- Executed evidence: supabase/tests/foundation_intake_approval.sql. Real concurrent sessions:
-- supabase/rehearsal/foundation_intake_approval_concurrency.sql.
begin;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.foundation_intake_approvals (
  approval_id uuid primary key,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  user_id uuid not null references auth.users(id) on delete restrict,
  attempt_key text not null check (attempt_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  client_manifest_digest text not null check (client_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  scope_digest text not null check (scope_digest ~ '^sha256:[a-f0-9]{64}$'),
  pricing_fingerprint text not null check (pricing_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  file_count integer not null check (file_count between 1 and 20),
  aggregate_maximum_pages integer not null check (aggregate_maximum_pages between 1 and 1600),
  aggregate_reserved_credits integer not null check (aggregate_reserved_credits >= 1),
  aggregate_maximum_credits integer not null,
  state text not null default 'approved' check (state in ('approved', 'cancelled')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or cancel_reason ~ '^[A-Z0-9_]{3,80}$'),
  constraint foundation_intake_approvals_attempt_unique unique (workspace_key, attempt_key),
  constraint foundation_intake_approvals_aggregate_check
    check (aggregate_maximum_credits >= aggregate_reserved_credits),
  -- Same lifetime bound the admission and reservation tables carry: 10 minutes is what the
  -- function writes, 15 is the most the schema will ever hold.
  constraint foundation_intake_approvals_lifetime_check
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint foundation_intake_approvals_cancel_check
    check ((state = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);

create table public.foundation_intake_approval_files (
  approval_id uuid not null references public.foundation_intake_approvals(approval_id) on delete restrict,
  file_key text not null check (file_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  document_id uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  byte_length integer not null check (byte_length between 1 and 5242880),
  declared_mime_type text not null check (char_length(declared_mime_type) between 3 and 160),
  page_basis text not null check (page_basis in ('measured', 'declared', 'unknown')),
  approved_max_pages integer not null check (approved_max_pages between 1 and 80),
  approved_reserved_credits integer not null check (approved_reserved_credits between 1 and 60000),
  approved_maximum_credits integer not null,
  -- The explicit state_check below also couples each state to its required lifecycle fields.
  -- Do not add an inline state CHECK here: PostgreSQL would generate the same constraint name.
  state text not null default 'approved',
  reservation_id uuid,
  reserved_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or cancel_reason ~ '^[A-Z0-9_]{3,80}$'),
  created_at timestamptz not null,
  primary key (approval_id, file_key),
  constraint foundation_intake_approval_files_document_unique unique (document_id),
  constraint foundation_intake_approval_files_reservation_unique unique (reservation_id),
  constraint foundation_intake_approval_files_maximum_check
    check (approved_maximum_credits between approved_reserved_credits and 60000),
  -- PROCESSING_CEILING.maxSourcePages. A member whose pages cannot be counted is approved at the
  -- whole ceiling, so the customer never approves less than the run is allowed to cost.
  constraint foundation_intake_approval_files_unknown_ceiling
    check (page_basis <> 'unknown' or approved_max_pages = 80),
  constraint foundation_intake_approval_files_state_check check (
    (state = 'approved' and reservation_id is null)
    or (state = 'reserved' and reservation_id is not null and reserved_at is not null)
    or (state = 'confirmed' and reservation_id is not null and confirmed_at is not null)
    or (state = 'cancelled' and cancelled_at is not null and cancel_reason is not null)
  )
);

alter table public.foundation_intake_approvals enable row level security;
alter table public.foundation_intake_approval_files enable row level security;
revoke all on public.foundation_intake_approvals, public.foundation_intake_approval_files
  from public, anon, authenticated;
-- Read-only even for the service role: every write goes through the functions below.
grant select on public.foundation_intake_approvals, public.foundation_intake_approval_files
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- Immutability. What the customer approved is never edited after the fact -- not by a later
-- function, not by a hand-written UPDATE, and not by a DELETE.
-- ---------------------------------------------------------------------------------------------

create function public.foundation_intake_approval_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'foundation_intake_approval_immutable';
  end if;
  if row(new.approval_id, new.workspace_key, new.user_id, new.attempt_key,
         new.client_manifest_digest, new.scope_digest, new.pricing_fingerprint, new.file_count,
         new.aggregate_maximum_pages, new.aggregate_reserved_credits,
         new.aggregate_maximum_credits, new.created_at, new.expires_at)
     is distinct from
     row(old.approval_id, old.workspace_key, old.user_id, old.attempt_key,
         old.client_manifest_digest, old.scope_digest, old.pricing_fingerprint, old.file_count,
         old.aggregate_maximum_pages, old.aggregate_reserved_credits,
         old.aggregate_maximum_credits, old.created_at, old.expires_at) then
    raise exception 'foundation_intake_approval_immutable';
  end if;
  if new.state = old.state then
    if row(new.cancelled_at, new.cancel_reason) is distinct from row(old.cancelled_at, old.cancel_reason) then
      raise exception 'foundation_intake_approval_immutable';
    end if;
  elsif not (old.state = 'approved' and new.state = 'cancelled') then
    raise exception 'foundation_intake_approval_immutable';
  end if;
  return new;
end;
$$;

create trigger foundation_intake_approval_immutable_trigger
before update or delete on public.foundation_intake_approvals
for each row execute function public.foundation_intake_approval_guard();

create function public.foundation_intake_approval_file_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'foundation_intake_approval_immutable';
  end if;
  if row(new.approval_id, new.file_key, new.document_id, new.content_sha256, new.byte_length,
         new.declared_mime_type, new.page_basis, new.approved_max_pages,
         new.approved_reserved_credits, new.approved_maximum_credits, new.created_at)
     is distinct from
     row(old.approval_id, old.file_key, old.document_id, old.content_sha256, old.byte_length,
         old.declared_mime_type, old.page_basis, old.approved_max_pages,
         old.approved_reserved_credits, old.approved_maximum_credits, old.created_at) then
    raise exception 'foundation_intake_approval_immutable';
  end if;
  -- Lifecycle columns are written once each and never rewritten.
  if (old.reservation_id is not null and new.reservation_id is distinct from old.reservation_id)
    or (old.reserved_at is not null and new.reserved_at is distinct from old.reserved_at)
    or (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at)
    or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at)
    or (old.cancel_reason is not null and new.cancel_reason is distinct from old.cancel_reason) then
    raise exception 'foundation_intake_approval_immutable';
  end if;
  if new.state <> old.state and (old.state, new.state) not in (
      ('approved', 'reserved'), ('approved', 'cancelled'),
      ('reserved', 'confirmed'), ('reserved', 'cancelled'), ('confirmed', 'cancelled')) then
    raise exception 'foundation_intake_approval_immutable';
  end if;
  return new;
end;
$$;

create trigger foundation_intake_approval_file_immutable_trigger
before update or delete on public.foundation_intake_approval_files
for each row execute function public.foundation_intake_approval_file_guard();

-- ---------------------------------------------------------------------------------------------
-- The reservation backstop. Acts only on reservations whose document an approval minted; for
-- every other row it returns at the first lookup and changes nothing.
--
-- INSERT: the hold must be exactly the approved per-file amounts, for the approving workspace
-- and principal, under a live, uncancelled approval. A direct reserve_foundation_compute_v3 call
-- cannot widen a member or revive an expired approval.
-- UPDATE: reserved and maximum amounts are frozen and the settled amount can never pass the
-- approved maximum. The owner/trial branch of settle_foundation_compute_v3 raises
-- maximum_credits to the observed amount before it settles (0045, kept in 20260911120000); for
-- an approval-bound reservation that write is refused here and the whole settlement rolls back,
-- for paid, trial and owner alike.
-- ---------------------------------------------------------------------------------------------

create function public.foundation_intake_approval_reservation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file public.foundation_intake_approval_files%rowtype;
  v_approval public.foundation_intake_approvals%rowtype;
begin
  if tg_op = 'UPDATE' and new.document_id is distinct from old.document_id then
    if exists (
      select 1 from public.foundation_intake_approval_files
       where document_id in (old.document_id, new.document_id)
    ) then
      raise exception 'foundation_intake_approval_maximum_immutable';
    end if;
    return new;
  end if;

  select * into v_file from public.foundation_intake_approval_files
   where document_id = new.document_id;
  if not found then
    return new;
  end if;
  select * into v_approval from public.foundation_intake_approvals
   where approval_id = v_file.approval_id;

  if tg_op = 'INSERT' then
    if new.workspace_key <> v_approval.workspace_key
      or new.user_id <> v_approval.user_id
      or new.reserved_credits <> v_file.approved_reserved_credits
      or new.maximum_credits <> v_file.approved_maximum_credits then
      raise exception 'foundation_intake_approval_reservation_out_of_scope';
    end if;
    if v_approval.state <> 'approved' or v_file.state <> 'approved' then
      raise exception 'foundation_intake_approval_cancelled';
    end if;
    if v_approval.expires_at <= clock_timestamp() then
      raise exception 'foundation_intake_approval_expired';
    end if;
    return new;
  end if;

  if new.maximum_credits <> old.maximum_credits
    or new.reserved_credits <> old.reserved_credits
    or new.workspace_key <> old.workspace_key
    or new.user_id <> old.user_id
    or new.billing_source <> old.billing_source then
    raise exception 'foundation_intake_approval_maximum_immutable';
  end if;
  if new.settled_credits > v_file.approved_maximum_credits then
    raise exception 'foundation_intake_approval_maximum_exceeded';
  end if;
  return new;
end;
$$;

create trigger foundation_intake_approval_reservation_guard_trigger
before insert or update on public.foundation_compute_reservations
for each row execute function public.foundation_intake_approval_reservation_guard();

-- ---------------------------------------------------------------------------------------------
-- Read models. Internal: no role is granted these directly.
-- ---------------------------------------------------------------------------------------------

create function public.foundation_intake_approval_file_payload(
  p_approval_id uuid,
  p_file_key text,
  p_replay boolean
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'approvalId', f.approval_id,
    'fileKey', f.file_key,
    'documentId', f.document_id,
    'fileState', f.state,
    'contentSha256', f.content_sha256,
    'byteLength', f.byte_length,
    'mimeType', f.declared_mime_type,
    'pageBasis', f.page_basis,
    'approvedMaxPages', f.approved_max_pages,
    'approvedReservedCredits', f.approved_reserved_credits,
    'approvedMaximumCredits', f.approved_maximum_credits,
    'reservationId', r.reservation_id,
    'reservationState', r.state,
    'reservationExpiresAt', r.expires_at,
    'billingSource', r.billing_source,
    'idempotentReplay', p_replay
  )
  from public.foundation_intake_approval_files f
  left join public.foundation_compute_reservations r on r.document_id = f.document_id
  where f.approval_id = p_approval_id and f.file_key = p_file_key;
$$;

-- `compilable` is the only answer the compile step may act on: the approval is live, every
-- member is confirmed, and every member still holds (or has settled) its reservation. One
-- failed, cancelled, unconfirmed or lapsed member makes the whole set non-compilable -- there is
-- no successful-subset reading of this row.
create function public.foundation_intake_approval_payload(
  p_approval_id uuid,
  p_replay boolean
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'approvalId', a.approval_id,
    'workspaceKey', a.workspace_key,
    'attemptKey', a.attempt_key,
    'clientManifestDigest', a.client_manifest_digest,
    'scopeDigest', a.scope_digest,
    'pricingFingerprint', a.pricing_fingerprint,
    'state', a.state,
    'createdAt', a.created_at,
    'expiresAt', a.expires_at,
    'expired', a.expires_at <= clock_timestamp(),
    'fileCount', a.file_count,
    'aggregateMaximumPages', a.aggregate_maximum_pages,
    'aggregateReservedCredits', a.aggregate_reserved_credits,
    'aggregateMaximumCredits', a.aggregate_maximum_credits,
    'compilable', a.state = 'approved' and not exists (
      select 1
        from public.foundation_intake_approval_files f
        left join public.foundation_compute_reservations r on r.document_id = f.document_id
       where f.approval_id = a.approval_id
         and (f.state <> 'confirmed' or r.reservation_id is null
              or r.state::text not in ('reserved', 'settled') or (r.state::text = 'reserved' and r.expires_at <= clock_timestamp()))
    ),
    'idempotentReplay', p_replay,
    'files', (
      select jsonb_agg(jsonb_build_object(
          'fileKey', f.file_key,
          'documentId', f.document_id,
          'fileState', f.state,
          'contentSha256', f.content_sha256,
          'byteLength', f.byte_length,
          'mimeType', f.declared_mime_type,
          'pageBasis', f.page_basis,
          'approvedMaxPages', f.approved_max_pages,
          'approvedReservedCredits', f.approved_reserved_credits,
          'approvedMaximumCredits', f.approved_maximum_credits,
          'reservationId', r.reservation_id,
          'reservationState', r.state,
          'reservationExpiresAt', r.expires_at
        ) order by f.file_key collate "C")
        from public.foundation_intake_approval_files f
        left join public.foundation_compute_reservations r on r.document_id = f.document_id
       where f.approval_id = a.approval_id
    )
  )
  from public.foundation_intake_approvals a
  where a.approval_id = p_approval_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Create (or replay) one approval for a complete manifest.
--
-- p_files is the whole selection, every member quoted by the server:
--   [{ "fileKey", "contentSha256", "byteLength", "mimeType",
--      "pageBasis": "measured" | "declared" | "unknown",
--      "approvedMaxPages", "reservedCredits", "maximumCredits" }, ...]
-- The scope digest is computed here, over the members sorted by file key, so a reordered retry
-- is the same approval and any changed byte of scope is a different one. The same attempt key
-- with a different scope, pricing fingerprint, client digest or principal is a conflict, never
-- an update; an expired or cancelled approval cannot be replayed into a live one.
-- ---------------------------------------------------------------------------------------------

create function public.create_foundation_intake_approval(
  p_workspace_key text,
  p_user_id uuid,
  p_attempt_key text,
  p_client_manifest_digest text,
  p_pricing_fingerprint text,
  p_aggregate_maximum_credits integer,
  p_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.foundation_intake_approvals%rowtype;
  v_entry jsonb;
  v_count integer;
  v_distinct integer;
  v_pages integer;
  v_reserved integer;
  v_maximum integer;
  v_lines text;
  v_scope_digest text;
  v_approval_id uuid;
  v_now timestamptz;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_user_id is null
    or p_attempt_key is null or p_attempt_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_client_manifest_digest is null or p_client_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_pricing_fingerprint is null or p_pricing_fingerprint !~ '^sha256:[a-f0-9]{64}$'
    or p_aggregate_maximum_credits is null
    or p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'foundation_intake_approval_invalid';
  end if;
  v_count := jsonb_array_length(p_files);
  if v_count < 1 or v_count > 20 then
    raise exception 'foundation_intake_approval_invalid';
  end if;

  for v_entry in select value from jsonb_array_elements(p_files) loop
    if jsonb_typeof(v_entry) <> 'object'
      or coalesce(v_entry->>'fileKey', '') !~ '^[A-Za-z0-9_-]{8,128}$'
      or coalesce(v_entry->>'contentSha256', '') !~ '^sha256:[a-f0-9]{64}$'
      or coalesce(v_entry->>'mimeType', '')
           !~ '^[A-Za-z0-9][A-Za-z0-9!#&^_.+-]{0,78}/[A-Za-z0-9][A-Za-z0-9!#&^_.+-]{0,78}$'
      or coalesce(v_entry->>'pageBasis', '') not in ('measured', 'declared', 'unknown')
      or coalesce(jsonb_typeof(v_entry->'byteLength'), '') <> 'number'
      or coalesce(jsonb_typeof(v_entry->'approvedMaxPages'), '') <> 'number'
      or coalesce(jsonb_typeof(v_entry->'reservedCredits'), '') <> 'number'
      or coalesce(jsonb_typeof(v_entry->'maximumCredits'), '') <> 'number'
      or coalesce(v_entry->>'byteLength', '') !~ '^[0-9]{1,7}$'
      or coalesce(v_entry->>'approvedMaxPages', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_entry->>'reservedCredits', '') !~ '^[0-9]{1,5}$'
      or coalesce(v_entry->>'maximumCredits', '') !~ '^[0-9]{1,5}$' then
      raise exception 'foundation_intake_approval_invalid';
    end if;
    if (v_entry->>'byteLength')::integer not between 1 and 5242880
      or (v_entry->>'approvedMaxPages')::integer not between 1 and 80
      or (v_entry->>'reservedCredits')::integer not between 1 and 60000
      or (v_entry->>'maximumCredits')::integer
           not between (v_entry->>'reservedCredits')::integer and 60000 then
      raise exception 'foundation_intake_approval_invalid';
    end if;
    if v_entry->>'pageBasis' = 'unknown' and (v_entry->>'approvedMaxPages')::integer <> 80 then
      raise exception 'foundation_intake_approval_unknown_ceiling_required';
    end if;
  end loop;

  select count(distinct value->>'fileKey') into v_distinct from jsonb_array_elements(p_files);
  if v_distinct <> v_count then
    raise exception 'foundation_intake_approval_invalid';
  end if;

  select sum((value->>'approvedMaxPages')::integer),
         sum((value->>'reservedCredits')::integer),
         sum((value->>'maximumCredits')::integer),
         string_agg(concat_ws('|',
             value->>'fileKey', value->>'contentSha256', (value->>'byteLength')::integer,
             value->>'mimeType', value->>'pageBasis', (value->>'approvedMaxPages')::integer,
             (value->>'reservedCredits')::integer, (value->>'maximumCredits')::integer),
           E'\n' order by value->>'fileKey' collate "C")
    into v_pages, v_reserved, v_maximum, v_lines
    from jsonb_array_elements(p_files);

  -- The aggregate the customer sees is the sum of every member's maximum, unknown formats at
  -- their full ceiling included. A claim either side of that sum is refused, not corrected.
  if v_maximum <> p_aggregate_maximum_credits then
    raise exception 'foundation_intake_approval_aggregate_mismatch';
  end if;

  v_scope_digest := 'sha256:' || encode(sha256(convert_to(concat_ws(E'\n',
    'tavonel-intake-approval-v1', p_workspace_key, p_user_id::text, p_pricing_fingerprint,
    v_count, v_pages, v_reserved, v_maximum, v_lines), 'UTF8')), 'hex');

  -- The principal must already be bound to the workspace by something the server established:
  -- a billing account, a self-service evaluation, or an active owner grant.
  if not exists (select 1 from public.foundation_billing_accounts
                  where workspace_key = p_workspace_key and user_id = p_user_id)
    and not exists (select 1 from public.foundation_self_service_trials
                     where workspace_key = p_workspace_key and user_id = p_user_id)
    and not exists (select 1 from public.foundation_account_access_grants
                     where user_id = p_user_id and active = true) then
    raise exception 'foundation_intake_approval_principal_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:' || p_workspace_key, 0));

  select * into v_existing from public.foundation_intake_approvals
   where workspace_key = p_workspace_key and attempt_key = p_attempt_key
   for update;
  if found then
    if v_existing.user_id <> p_user_id
      or v_existing.scope_digest <> v_scope_digest
      or v_existing.pricing_fingerprint <> p_pricing_fingerprint
      or v_existing.client_manifest_digest <> p_client_manifest_digest then
      raise exception 'foundation_intake_approval_conflict';
    end if;
    if v_existing.state = 'cancelled' then
      raise exception 'foundation_intake_approval_cancelled';
    end if;
    if v_existing.expires_at <= clock_timestamp() then
      raise exception 'foundation_intake_approval_expired';
    end if;
    return public.foundation_intake_approval_payload(v_existing.approval_id, true);
  end if;

  v_now := clock_timestamp();
  v_approval_id := gen_random_uuid();
  insert into public.foundation_intake_approvals (
    approval_id, workspace_key, user_id, attempt_key, client_manifest_digest, scope_digest,
    pricing_fingerprint, file_count, aggregate_maximum_pages, aggregate_reserved_credits,
    aggregate_maximum_credits, created_at, expires_at
  ) values (
    v_approval_id, p_workspace_key, p_user_id, p_attempt_key, p_client_manifest_digest,
    v_scope_digest, p_pricing_fingerprint, v_count, v_pages, v_reserved, v_maximum,
    v_now, v_now + interval '10 minutes'
  );
  insert into public.foundation_intake_approval_files (
    approval_id, file_key, document_id, content_sha256, byte_length, declared_mime_type,
    page_basis, approved_max_pages, approved_reserved_credits, approved_maximum_credits,
    created_at
  )
  select v_approval_id, value->>'fileKey', gen_random_uuid(), value->>'contentSha256',
         (value->>'byteLength')::integer, value->>'mimeType', value->>'pageBasis',
         (value->>'approvedMaxPages')::integer, (value->>'reservedCredits')::integer,
         (value->>'maximumCredits')::integer, v_now
    from jsonb_array_elements(p_files);

  return public.foundation_intake_approval_payload(v_approval_id, false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reserve one member. The amounts come from the approved row, never from the caller, and go
-- through reserve_foundation_compute_v3 unchanged, so the paid/trial/owner reservation and
-- expiry-sweep semantics are the audited ones. A member that already holds a reservation
-- answers with that same reservation: a retried or lost capability response is a lookup, not a
-- second hold.
-- ---------------------------------------------------------------------------------------------

create function public.reserve_foundation_intake_approved_file(
  p_workspace_key text,
  p_user_id uuid,
  p_attempt_key text,
  p_scope_digest text,
  p_pricing_fingerprint text,
  p_file_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval public.foundation_intake_approvals%rowtype;
  v_file public.foundation_intake_approval_files%rowtype;
  v_result jsonb;
  v_total bigint;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_user_id is null
    or p_attempt_key is null or p_attempt_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_scope_digest is null or p_scope_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_pricing_fingerprint is null or p_pricing_fingerprint !~ '^sha256:[a-f0-9]{64}$'
    or p_file_key is null or p_file_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'foundation_intake_approval_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:' || p_workspace_key, 0));

  select * into v_approval from public.foundation_intake_approvals
   where workspace_key = p_workspace_key and attempt_key = p_attempt_key
   for update;
  if not found or v_approval.user_id <> p_user_id then
    raise exception 'foundation_intake_approval_not_found';
  end if;
  if v_approval.scope_digest <> p_scope_digest
    or v_approval.pricing_fingerprint <> p_pricing_fingerprint then
    raise exception 'foundation_intake_approval_conflict';
  end if;
  select * into v_file from public.foundation_intake_approval_files
   where approval_id = v_approval.approval_id and file_key = p_file_key
   for update;
  if not found then
    raise exception 'foundation_intake_approval_file_out_of_scope';
  end if;

  if v_file.reservation_id is not null then
    return public.foundation_intake_approval_file_payload(v_approval.approval_id, v_file.file_key, true);
  end if;
  if v_approval.state <> 'approved' or v_file.state <> 'approved' then
    raise exception 'foundation_intake_approval_cancelled';
  end if;
  if v_approval.expires_at <= clock_timestamp() then
    raise exception 'foundation_intake_approval_expired';
  end if;

  v_result := public.reserve_foundation_compute_v3(
    p_workspace_key, v_file.document_id, p_user_id,
    v_file.approved_reserved_credits, v_file.approved_maximum_credits
  );
  if (v_result->>'reservedCredits')::integer <> v_file.approved_reserved_credits
    or (v_result->>'maximumCredits')::integer <> v_file.approved_maximum_credits then
    raise exception 'foundation_intake_approval_reservation_out_of_scope';
  end if;

  select coalesce(sum(r.maximum_credits), 0) into v_total
    from public.foundation_compute_reservations r
    join public.foundation_intake_approval_files f on f.document_id = r.document_id
   where f.approval_id = v_approval.approval_id;
  if v_total > v_approval.aggregate_maximum_credits then
    raise exception 'foundation_intake_approval_aggregate_exceeded';
  end if;

  update public.foundation_intake_approval_files
     set state = 'reserved',
         reservation_id = (v_result->>'reservationId')::uuid,
         reserved_at = clock_timestamp()
   where approval_id = v_approval.approval_id and file_key = v_file.file_key;

  return public.foundation_intake_approval_file_payload(
    v_approval.approval_id, v_file.file_key,
    coalesce((v_result->>'idempotentReplay')::boolean, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Confirm and cancel. Both take the workspace advisory lock, then the approval row, then the
-- member row, in that order, before they read anything -- so whichever commits first decides,
-- and the other sees the decision. Confirm requires a live reservation and an intake admission
-- the stored object was confirmed against with the approved digest, length and type.
-- ---------------------------------------------------------------------------------------------

create function public.confirm_foundation_intake_approved_file(
  p_workspace_key text,
  p_user_id uuid,
  p_attempt_key text,
  p_scope_digest text,
  p_file_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval public.foundation_intake_approvals%rowtype;
  v_file public.foundation_intake_approval_files%rowtype;
  v_reservation public.foundation_compute_reservations%rowtype;
  v_admission public.foundation_intake_admissions%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_user_id is null
    or p_attempt_key is null or p_attempt_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_scope_digest is null or p_scope_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_file_key is null or p_file_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'foundation_intake_approval_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:' || p_workspace_key, 0));

  select * into v_approval from public.foundation_intake_approvals
   where workspace_key = p_workspace_key and attempt_key = p_attempt_key
   for update;
  if not found or v_approval.user_id <> p_user_id then
    raise exception 'foundation_intake_approval_not_found';
  end if;
  if v_approval.scope_digest <> p_scope_digest then
    raise exception 'foundation_intake_approval_conflict';
  end if;
  select * into v_file from public.foundation_intake_approval_files
   where approval_id = v_approval.approval_id and file_key = p_file_key
   for update;
  if not found then
    raise exception 'foundation_intake_approval_file_out_of_scope';
  end if;

  if v_file.state = 'confirmed' then
    return public.foundation_intake_approval_file_payload(v_approval.approval_id, v_file.file_key, true);
  end if;
  if v_file.state = 'cancelled' or v_approval.state = 'cancelled' then
    raise exception 'foundation_intake_approval_file_cancelled';
  end if;
  if v_file.state <> 'reserved' then
    raise exception 'foundation_intake_approval_file_not_reserved';
  end if;

  select * into v_reservation from public.foundation_compute_reservations
   where document_id = v_file.document_id;
  if not found or v_reservation.state::text <> 'reserved'
    or v_reservation.expires_at <= clock_timestamp() then
    raise exception 'foundation_intake_approval_reservation_expired';
  end if;

  select * into v_admission from public.foundation_intake_admissions
   where workspace_key = p_workspace_key and document_id = v_file.document_id;
  if not found or v_admission.user_id <> p_user_id or v_admission.confirmed_at is null
    or v_admission.state::text in ('rejected', 'expired') then
    raise exception 'foundation_intake_approval_source_unconfirmed';
  end if;
  if v_admission.source_sha256 is distinct from v_file.content_sha256
    or v_admission.requested_bytes <> v_file.byte_length
    or v_admission.declared_mime_type <> v_file.declared_mime_type then
    raise exception 'foundation_intake_approval_source_mismatch';
  end if;

  update public.foundation_intake_approval_files
     set state = 'confirmed', confirmed_at = clock_timestamp()
   where approval_id = v_approval.approval_id and file_key = v_file.file_key;

  return public.foundation_intake_approval_file_payload(v_approval.approval_id, v_file.file_key, false);
end;
$$;

-- Cancel one member and, with it, the approval: a set with a cancelled member can never compile,
-- and no further member may be reserved under it. Any member may be named, a confirmed one
-- included -- a confirmed sibling is no reason to keep a set whose other member failed. Each
-- member is then decided by its own reservation, under the same lock:
--   * reserved -> released through settle_foundation_compute_v3 exactly as any release is, and
--     the member cancelled;
--   * released, expired, or no reservation -> the member cancelled; a hold that already went
--     back is not touched again, so the balance moves at most once per hold;
--   * settled -> known, reconciled accounting: the reservation, its settled credits and the
--     member are left exactly as they are;
--   * operator_review, or any other state, or a reservation that does not match the member ->
--     not this function's to decide. Reservation and member are left intact so the read payload
--     still shows them, the rest of the set is cancelled anyway, and the answer carries
--     reconciliationRequired = true with a status of its own.
-- A repeat runs the same pass, finds nothing left to move, and answers as a duplicate carrying
-- the same reconciliation requirement.
create or replace function public.cancel_foundation_intake_approved_file(
 p_workspace_key text,p_user_id uuid,p_attempt_key text,p_file_key text,p_reason_code text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.foundation_intake_approvals%rowtype; f public.foundation_intake_approval_files%rowtype;
 r public.foundation_compute_reservations%rowtype; member public.foundation_intake_approval_files%rowtype;
 hold text; replay boolean; reconcile boolean:=false;
begin
 if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_user_id is null
 or p_attempt_key is null or p_attempt_key !~ '^[A-Za-z0-9_-]{16,128}$'
 or p_file_key is null or p_file_key !~ '^[A-Za-z0-9_-]{8,128}$'
 or p_reason_code is null or p_reason_code !~ '^[A-Z0-9_]{3,80}$' then
 raise exception 'foundation_intake_approval_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:'||p_workspace_key,0));
 select * into a from public.foundation_intake_approvals where workspace_key=p_workspace_key and attempt_key=p_attempt_key for update;
 if not found or a.user_id<>p_user_id then raise exception 'foundation_intake_approval_not_found'; end if;
 -- Match settlement's lock order: approval, then workspace compute, then reservation rows.
 -- That lets an in-flight settlement and cancellation serialize without holding a reservation
 -- row while waiting on the compute lock.
 perform pg_advisory_xact_lock(hashtextextended('foundation-compute:'||p_workspace_key,0));
 select * into f from public.foundation_intake_approval_files where approval_id=a.approval_id and file_key=p_file_key for update;
 if not found then raise exception 'foundation_intake_approval_file_out_of_scope'; end if;
 replay:=a.state='cancelled';
 for member in select * from public.foundation_intake_approval_files where approval_id=a.approval_id order by file_key for update loop
  select * into r from public.foundation_compute_reservations where document_id=member.document_id for update;
  if not found then
   hold:=case when member.reservation_id is null then 'none' else 'unmatched' end;
  elsif member.reservation_id is distinct from r.reservation_id then
   hold:='unmatched';
  else
   hold:=coalesce(r.state::text,'unmatched');
  end if;
  if hold='reserved' then
   perform public.settle_foundation_compute_v3(p_workspace_key,member.document_id,'released',0,p_reason_code);
   select state::text into hold from public.foundation_compute_reservations where document_id=member.document_id;
   hold:=coalesce(hold,'unmatched');
  end if;
  if hold in ('none','released','expired') then
   update public.foundation_intake_approval_files set state='cancelled',cancelled_at=clock_timestamp(),cancel_reason=p_reason_code
    where approval_id=a.approval_id and file_key=member.file_key and state<>'cancelled';
  elsif hold='settled' then
   if member.state<>'confirmed' then reconcile:=true; end if;
  else
   reconcile:=true;
  end if;
 end loop;
 update public.foundation_intake_approvals set state='cancelled',cancelled_at=clock_timestamp(),cancel_reason=p_reason_code
  where approval_id=a.approval_id and state='approved';
 return public.foundation_intake_approval_file_payload(a.approval_id,f.file_key,replay)||jsonb_build_object(
  'status',case when replay and reconcile then 'duplicate_reconciliation_required' when replay then 'duplicate'
                when reconcile then 'cancelled_reconciliation_required' else 'cancelled' end,
  'reconciliationRequired',reconcile);
end; $$;

create function public.confirm_foundation_intake_approved_upload(
 p_workspace_key text,p_user_id uuid,p_attempt_key text,p_scope_digest text,p_file_key text,p_document_id uuid,
 p_source_sha256 text,p_observed_bytes bigint,p_observed_mime text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.foundation_intake_approvals%rowtype; f public.foundation_intake_approval_files%rowtype;
 admission jsonb; approved jsonb;
begin
 if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_user_id is null
 or p_attempt_key is null or p_attempt_key !~ '^[A-Za-z0-9_-]{16,128}$'
 or p_scope_digest is null or p_scope_digest !~ '^sha256:[a-f0-9]{64}$'
 or p_file_key is null or p_file_key !~ '^[A-Za-z0-9_-]{8,128}$' or p_document_id is null
 or p_source_sha256 is null or p_source_sha256 !~ '^sha256:[a-f0-9]{64}$'
 or p_observed_bytes is null or p_observed_bytes<1 or p_observed_mime is null then
 raise exception 'foundation_intake_approval_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:'||p_workspace_key,0));
 select * into a from public.foundation_intake_approvals where workspace_key=p_workspace_key and attempt_key=p_attempt_key for update;
 if not found or a.user_id<>p_user_id or a.scope_digest<>p_scope_digest or a.state<>'approved' then
 raise exception 'foundation_intake_approval_not_found'; end if;
 select * into f from public.foundation_intake_approval_files where approval_id=a.approval_id and file_key=p_file_key for update;
 if not found or f.document_id<>p_document_id then raise exception 'foundation_intake_approval_file_out_of_scope'; end if;
 if f.state='cancelled' then raise exception 'foundation_intake_approval_file_cancelled'; end if;
 admission:=public.confirm_foundation_intake_admission(p_workspace_key,f.document_id,p_user_id,p_source_sha256,p_observed_bytes,p_observed_mime);
 approved:=public.confirm_foundation_intake_approved_file(p_workspace_key,p_user_id,p_attempt_key,p_scope_digest,p_file_key);
 return jsonb_build_object('admission',admission,'approvedFile',approved);
end; $$;

-- ---------------------------------------------------------------------------------------------
-- Settlement of an approval-bound document. The approved per-file maximum and the approval
-- aggregate are checked here, under the approval lock, for every billing source, before
-- settle_foundation_compute_v3 runs; the reservation guard above refuses the same thing again
-- if settle_foundation_compute_v3 is called directly. Within the approved maximum the paid,
-- trial and owner accounting is settle_foundation_compute_v3's own, unchanged.
-- ---------------------------------------------------------------------------------------------

create function public.settle_foundation_intake_approved_compute(
  p_workspace_key text,
  p_document_id uuid,
  p_outcome text,
  p_actual_credits integer,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval public.foundation_intake_approvals%rowtype;
  v_file public.foundation_intake_approval_files%rowtype;
  v_other bigint;
  v_result jsonb;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_id is null
    or p_outcome is null or p_outcome not in ('settled', 'operator_review', 'released')
    or p_actual_credits is null or p_actual_credits < 0 or p_actual_credits > 60000
    or p_reason_code is null or p_reason_code !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'foundation_intake_approval_settlement_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:' || p_workspace_key, 0));

  select a.* into v_approval
    from public.foundation_intake_approvals a
    join public.foundation_intake_approval_files f on f.approval_id = a.approval_id
   where f.document_id = p_document_id and a.workspace_key = p_workspace_key
   for update of a;
  if not found then
    raise exception 'foundation_intake_approval_file_out_of_scope';
  end if;
  select * into v_file from public.foundation_intake_approval_files
   where document_id = p_document_id
   for update;

  if p_actual_credits > v_file.approved_maximum_credits then
    raise exception 'foundation_intake_approval_maximum_exceeded';
  end if;
  if p_outcome <> 'released' and v_file.state <> 'confirmed' then
    raise exception 'foundation_intake_approval_file_not_confirmed';
  end if;

  select coalesce(sum(r.settled_credits), 0) into v_other
    from public.foundation_compute_reservations r
    join public.foundation_intake_approval_files f on f.document_id = r.document_id
   where f.approval_id = v_approval.approval_id
     and f.document_id <> p_document_id
     and r.state::text in ('settled', 'operator_review');
  if v_other + p_actual_credits > v_approval.aggregate_maximum_credits then
    raise exception 'foundation_intake_approval_aggregate_exceeded';
  end if;

  v_result := public.settle_foundation_compute_v3(
    p_workspace_key, p_document_id, p_outcome, p_actual_credits, p_reason_code);
  return v_result || jsonb_build_object(
    'approvalId', v_approval.approval_id,
    'fileKey', v_file.file_key,
    'approvedMaximumCredits', v_file.approved_maximum_credits
  );
end;
$$;

-- Authoritative lookup for a lost or ambiguous response: the committed approval, every member,
-- and every member's reservation state, for the authenticated principal only.
create function public.read_foundation_intake_approval(
  p_workspace_key text,
  p_user_id uuid,
  p_attempt_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval_id uuid;
begin
  select approval_id into v_approval_id from public.foundation_intake_approvals
   where workspace_key = p_workspace_key and attempt_key = p_attempt_key and user_id = p_user_id;
  if not found then
    raise exception 'foundation_intake_approval_not_found';
  end if;
  return public.foundation_intake_approval_payload(v_approval_id, true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.assert_foundation_intake_compile_set(p_workspace_key text,p_user_id uuid,p_document_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE aid uuid; expected uuid[]; supplied uuid[]; n integer; BEGIN IF p_workspace_key IS NULL OR p_user_id IS NULL OR p_document_ids IS NULL OR cardinality(p_document_ids)<1 THEN RAISE EXCEPTION 'foundation_intake_approval_compile_set_invalid'; END IF; SELECT array_agg(DISTINCT x ORDER BY x) INTO supplied FROM unnest(p_document_ids) x; IF cardinality(supplied)<>cardinality(p_document_ids) THEN RAISE EXCEPTION 'foundation_intake_approval_compile_set_invalid'; END IF; PERFORM pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:'||p_workspace_key,0)); SELECT count(DISTINCT a.approval_id),min(a.approval_id::text)::uuid INTO n,aid FROM public.foundation_intake_approval_files f JOIN public.foundation_intake_approvals a USING(approval_id) WHERE f.document_id=ANY(supplied); IF n=0 THEN RETURN jsonb_build_object('allowed',true,'approvalRequired',false); END IF; IF n<>1 THEN RAISE EXCEPTION 'foundation_intake_approval_compile_set_mixed'; END IF; SELECT array_agg(f.document_id ORDER BY f.document_id) INTO expected FROM public.foundation_intake_approval_files f WHERE f.approval_id=aid; IF expected IS DISTINCT FROM supplied THEN RAISE EXCEPTION 'foundation_intake_approval_compile_set_incomplete'; END IF; IF NOT EXISTS(SELECT 1 FROM public.foundation_intake_approvals a WHERE a.approval_id=aid AND a.workspace_key=p_workspace_key AND a.user_id=p_user_id) THEN RAISE EXCEPTION 'foundation_intake_approval_compile_set_principal'; END IF; IF NOT EXISTS(SELECT 1 FROM public.foundation_intake_approvals a WHERE a.approval_id=aid AND a.state='approved') THEN RAISE EXCEPTION 'foundation_intake_approval_compile_set_not_ready'; END IF; IF EXISTS(SELECT 1 FROM public.foundation_intake_approval_files f LEFT JOIN public.foundation_compute_reservations r USING(document_id) WHERE f.approval_id=aid AND (f.state<>'confirmed' OR r.reservation_id IS NULL OR r.state::text NOT IN('reserved','settled') OR (r.state::text='reserved' AND r.expires_at<=clock_timestamp()))) THEN RAISE EXCEPTION 'foundation_intake_approval_compile_set_not_ready'; END IF; RETURN jsonb_build_object('allowed',true,'approvalRequired',true,'approvalId',aid,'pricingFingerprint',(SELECT a.pricing_fingerprint FROM public.foundation_intake_approvals a WHERE a.approval_id=aid)); END; $$; -- Grants. Service role only, matching every other Foundation billing RPC.
-- ---------------------------------------------------------------------------------------------

revoke all on function public.foundation_intake_approval_guard() from public, anon, authenticated;
revoke all on function public.foundation_intake_approval_file_guard() from public, anon, authenticated;
revoke all on function public.foundation_intake_approval_reservation_guard() from public, anon, authenticated;
revoke all on function public.foundation_intake_approval_file_payload(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.foundation_intake_approval_payload(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.create_foundation_intake_approval(text, uuid, text, text, text, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.reserve_foundation_intake_approved_file(text, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.confirm_foundation_intake_approved_file(text, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_foundation_intake_approved_file(text, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.settle_foundation_intake_approved_compute(text, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.read_foundation_intake_approval(text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_foundation_intake_approval(text, uuid, text, text, text, integer, jsonb)
  to service_role;
grant execute on function public.reserve_foundation_intake_approved_file(text, uuid, text, text, text, text)
  to service_role;
grant execute on function public.confirm_foundation_intake_approved_file(text, uuid, text, text, text)
  to service_role;
grant execute on function public.cancel_foundation_intake_approved_file(text, uuid, text, text, text)
  to service_role;
grant execute on function public.settle_foundation_intake_approved_compute(text, uuid, text, integer, text)
  to service_role;
grant execute on function public.read_foundation_intake_approval(text, uuid, text)
  to service_role;

revoke all on function public.assert_foundation_intake_compile_set(text,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.assert_foundation_intake_compile_set(text,uuid,uuid[]) to service_role;
revoke all on function public.confirm_foundation_intake_approved_upload(text,uuid,text,text,text,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.confirm_foundation_intake_approved_upload(text,uuid,text,text,text,uuid,text,bigint,text) to service_role;
commit;
