-- Provider-wide model circuit state. No provider is usable merely because this migration ran:
-- an operator must initialize a named provider and then explicitly enable it.
begin;

create table public.model_provider_circuit_states (
  provider text primary key check (provider ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  enabled boolean not null default false,
  phase text not null default 'closed' check (phase in ('closed', 'open', 'half_open')),
  revision bigint not null default 0 check (revision >= 0),
  correlated_failures integer not null default 0 check (correlated_failures >= 0),
  failure_window_started_at timestamptz,
  opened_at timestamptz,
  cooldown_until timestamptz,
  probe_admission_id text check (probe_admission_id is null or probe_admission_id ~ '^[A-Za-z0-9._~-]{8,128}$'),
  probe_expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (phase = 'closed' and opened_at is null and cooldown_until is null
      and probe_admission_id is null and probe_expires_at is null)
    or (phase = 'open' and opened_at is not null and cooldown_until is not null
      and probe_admission_id is null and probe_expires_at is null)
    or (phase = 'half_open' and opened_at is not null and cooldown_until is not null
      and probe_admission_id is not null and probe_expires_at is not null)
  )
);

create table public.model_provider_circuit_events (
  event_id text primary key check (event_id ~ '^(admission|outcome):[A-Za-z0-9._~-]{8,128}$'),
  provider text not null references public.model_provider_circuit_states(provider),
  admission_id text not null check (admission_id ~ '^[A-Za-z0-9._~-]{8,128}$'),
  kind text not null check (kind in ('admission', 'outcome')),
  from_phase text not null check (from_phase in ('closed', 'open', 'half_open')),
  to_phase text not null check (to_phase in ('closed', 'open', 'half_open')),
  reason text not null check (reason ~ '^[a-z][a-z0-9_]{2,79}$'),
  occurred_at timestamptz not null,
  resulting_revision bigint not null check (resulting_revision >= 1),
  event jsonb not null check (octet_length(event::text) <= 8192),
  receipt jsonb check (receipt is null or octet_length(receipt::text) <= 8192),
  created_at timestamptz not null default clock_timestamp(),
  unique (provider, resulting_revision),
  check ((kind = 'admission' and receipt is not null) or (kind = 'outcome' and receipt is null))
);

create index model_provider_circuit_events_provider_created_idx
  on public.model_provider_circuit_events (provider, created_at desc, event_id);

alter table public.model_provider_circuit_states enable row level security;
alter table public.model_provider_circuit_events enable row level security;
revoke all on public.model_provider_circuit_states from public, anon, authenticated, service_role;
revoke all on public.model_provider_circuit_events from public, anon, authenticated, service_role;

create or replace function public.model_provider_circuit_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'model_provider_circuit_events_immutable';
end;
$$;

create trigger model_provider_circuit_events_immutable
  before update or delete on public.model_provider_circuit_events
  for each row execute function public.model_provider_circuit_events_immutable();

create or replace function public.model_provider_circuit_state_json_v1(
  p_state public.model_provider_circuit_states
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 'tavonel.model_provider_circuit.v1',
    'provider', p_state.provider,
    'phase', p_state.phase,
    'revision', p_state.revision,
    'correlatedFailures', p_state.correlated_failures,
    'failureWindowStartedAt', case when p_state.failure_window_started_at is null then null else
      to_char(p_state.failure_window_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'openedAt', case when p_state.opened_at is null then null else
      to_char(p_state.opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'cooldownUntil', case when p_state.cooldown_until is null then null else
      to_char(p_state.cooldown_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'probeAdmissionId', p_state.probe_admission_id,
    'probeExpiresAt', case when p_state.probe_expires_at is null then null else
      to_char(p_state.probe_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'updatedAt', to_char(p_state.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

create or replace function public.initialize_model_provider_circuit_v1(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted_count integer;
  v_enabled boolean;
begin
  if p_provider is null or p_provider !~ '^[a-z0-9][a-z0-9._-]{1,63}$' then
    raise exception 'model_provider_circuit_provider_invalid';
  end if;
  insert into public.model_provider_circuit_states (provider, enabled)
    values (p_provider, false)
    on conflict (provider) do nothing;
  get diagnostics v_inserted_count = row_count;
  select enabled into v_enabled from public.model_provider_circuit_states where provider = p_provider;
  return pg_catalog.jsonb_build_object(
    'status', case when v_inserted_count = 1 then 'initialized' else 'existing' end,
    'provider', p_provider,
    'enabled', v_enabled
  );
end;
$$;

create or replace function public.set_model_provider_circuit_enabled_v1(
  p_provider text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider is null or p_provider !~ '^[a-z0-9][a-z0-9._-]{1,63}$' or p_enabled is null then
    raise exception 'model_provider_circuit_configuration_invalid';
  end if;
  update public.model_provider_circuit_states
     set enabled = p_enabled, updated_at = clock_timestamp()
   where provider = p_provider;
  if not found then raise exception 'model_provider_circuit_state_unavailable'; end if;
  return pg_catalog.jsonb_build_object('status', 'configured', 'provider', p_provider, 'enabled', p_enabled);
end;
$$;

create or replace function public.read_model_provider_circuit_v1(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.model_provider_circuit_states%rowtype;
begin
  if p_provider is null or p_provider !~ '^[a-z0-9][a-z0-9._-]{1,63}$' then
    raise exception 'model_provider_circuit_provider_invalid';
  end if;
  select * into v_state from public.model_provider_circuit_states where provider = p_provider;
  if not found then raise exception 'model_provider_circuit_state_unavailable'; end if;
  if not v_state.enabled then raise exception 'model_provider_circuit_disabled'; end if;
  return pg_catalog.jsonb_build_object('state', public.model_provider_circuit_state_json_v1(v_state));
end;
$$;

create or replace function public.commit_model_provider_circuit_event_v1(
  p_kind text,
  p_provider text,
  p_expected_revision bigint,
  p_next_state jsonb,
  p_event jsonb,
  p_receipt jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.model_provider_circuit_states%rowtype;
  v_existing public.model_provider_circuit_events%rowtype;
  v_event_id text;
  v_admission_id text;
  v_next_revision bigint;
  v_correlated_failures integer;
  v_phase text;
  v_failure_window_started_at timestamptz;
  v_opened_at timestamptz;
  v_cooldown_until timestamptz;
  v_probe_admission_id text;
  v_probe_expires_at timestamptz;
  v_updated_at timestamptz;
begin
  if p_kind not in ('admission', 'outcome')
    or p_provider is null or p_provider !~ '^[a-z0-9][a-z0-9._-]{1,63}$'
    or p_expected_revision is null or p_expected_revision < 0
    or p_next_state is null or p_event is null
    or octet_length(p_next_state::text) > 8192 or octet_length(p_event::text) > 8192
    or p_next_state->>'schemaVersion' <> 'tavonel.model_provider_circuit.v1'
    or p_next_state->>'provider' <> p_provider
    or p_event->>'schemaVersion' <> 'tavonel.model_provider_circuit.v1'
    or p_event->>'provider' <> p_provider
    or p_event->>'kind' <> p_kind then
    raise exception 'model_provider_circuit_commit_invalid';
  end if;

  v_event_id := p_event->>'eventId';
  v_admission_id := p_event->>'admissionId';
  if v_event_id !~ ('^' || p_kind || ':[A-Za-z0-9._~-]{8,128}$')
    or v_admission_id !~ '^[A-Za-z0-9._~-]{8,128}$'
    or v_event_id <> p_kind || ':' || v_admission_id
    or p_event->>'fromPhase' not in ('closed', 'open', 'half_open')
    or p_event->>'toPhase' not in ('closed', 'open', 'half_open')
    or p_event->>'reason' !~ '^[a-z][a-z0-9_]{2,79}$' then
    raise exception 'model_provider_circuit_event_invalid';
  end if;
  if (p_kind = 'admission' and (p_receipt is null
      or p_receipt->>'schemaVersion' <> 'tavonel.model_provider_circuit.v1'
      or p_receipt->>'provider' <> p_provider
      or p_receipt->>'admissionId' <> v_admission_id
      or p_receipt->>'eventId' <> v_event_id
      or p_receipt->>'mode' not in ('normal', 'probe')
      or octet_length(p_receipt::text) > 8192))
    or (p_kind = 'outcome' and p_receipt is not null) then
    raise exception 'model_provider_circuit_receipt_invalid';
  end if;

  begin
    v_next_revision := (p_next_state->>'revision')::bigint;
    v_correlated_failures := (p_next_state->>'correlatedFailures')::integer;
    v_phase := p_next_state->>'phase';
    v_failure_window_started_at := nullif(p_next_state->>'failureWindowStartedAt', '')::timestamptz;
    v_opened_at := nullif(p_next_state->>'openedAt', '')::timestamptz;
    v_cooldown_until := nullif(p_next_state->>'cooldownUntil', '')::timestamptz;
    v_probe_admission_id := nullif(p_next_state->>'probeAdmissionId', '');
    v_probe_expires_at := nullif(p_next_state->>'probeExpiresAt', '')::timestamptz;
    v_updated_at := (p_next_state->>'updatedAt')::timestamptz;
    perform (p_event->>'occurredAt')::timestamptz;
    if p_receipt is not null then
      perform (p_receipt->>'admittedAt')::timestamptz;
      perform (p_receipt->>'expiresAt')::timestamptz;
    end if;
  exception when others then
    raise exception 'model_provider_circuit_timestamp_or_number_invalid';
  end;
  if v_next_revision <> p_expected_revision + 1 or v_correlated_failures < 0
    or v_phase not in ('closed', 'open', 'half_open')
    or p_event->>'toPhase' <> v_phase
    or (p_receipt is not null and (p_receipt->>'committedRevision')::bigint <> v_next_revision)
    or (v_phase = 'closed' and (v_opened_at is not null or v_cooldown_until is not null
      or v_probe_admission_id is not null or v_probe_expires_at is not null))
    or (v_phase = 'open' and (v_opened_at is null or v_cooldown_until is null
      or v_probe_admission_id is not null or v_probe_expires_at is not null))
    or (v_phase = 'half_open' and (v_opened_at is null or v_cooldown_until is null
      or v_probe_admission_id is null or v_probe_expires_at is null)) then
    raise exception 'model_provider_circuit_transition_invalid';
  end if;

  select * into v_state from public.model_provider_circuit_states
   where provider = p_provider for update;
  if not found then raise exception 'model_provider_circuit_state_unavailable'; end if;
  if p_kind = 'admission' and not v_state.enabled then raise exception 'model_provider_circuit_disabled'; end if;

  select * into v_existing from public.model_provider_circuit_events where event_id = v_event_id;
  if found then
    if v_existing.provider <> p_provider or v_existing.kind <> p_kind
      or v_existing.event <> p_event or v_existing.receipt is distinct from p_receipt
      or v_existing.resulting_revision <> v_next_revision then
      raise exception 'model_provider_circuit_event_id_conflict';
    end if;
    return pg_catalog.jsonb_build_object('status', 'replayed',
      'committedRevision', v_existing.resulting_revision, 'eventId', v_existing.event_id);
  end if;
  if v_state.revision <> p_expected_revision then
    raise exception 'model_provider_circuit_revision_conflict';
  end if;
  if p_event->>'fromPhase' <> v_state.phase then
    raise exception 'model_provider_circuit_from_phase_conflict';
  end if;

  insert into public.model_provider_circuit_events (
    event_id, provider, admission_id, kind, from_phase, to_phase, reason,
    occurred_at, resulting_revision, event, receipt
  ) values (
    v_event_id, p_provider, v_admission_id, p_kind, p_event->>'fromPhase',
    p_event->>'toPhase', p_event->>'reason', (p_event->>'occurredAt')::timestamptz,
    v_next_revision, p_event, p_receipt
  );

  update public.model_provider_circuit_states
     set phase = v_phase,
         revision = v_next_revision,
         correlated_failures = v_correlated_failures,
         failure_window_started_at = v_failure_window_started_at,
         opened_at = v_opened_at,
         cooldown_until = v_cooldown_until,
         probe_admission_id = v_probe_admission_id,
         probe_expires_at = v_probe_expires_at,
         updated_at = v_updated_at
   where provider = p_provider;

  return pg_catalog.jsonb_build_object('status', 'committed',
    'committedRevision', v_next_revision, 'eventId', v_event_id);
end;
$$;

create or replace function public.commit_model_provider_circuit_admission_v1(
  p_provider text,
  p_expected_revision bigint,
  p_next_state jsonb,
  p_event jsonb,
  p_receipt jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.commit_model_provider_circuit_event_v1(
    'admission', p_provider, p_expected_revision, p_next_state, p_event, p_receipt
  );
$$;

create or replace function public.commit_model_provider_circuit_outcome_v1(
  p_provider text,
  p_expected_revision bigint,
  p_next_state jsonb,
  p_event jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.commit_model_provider_circuit_event_v1(
    'outcome', p_provider, p_expected_revision, p_next_state, p_event, null
  );
$$;

revoke execute on function public.model_provider_circuit_state_json_v1(public.model_provider_circuit_states)
  from public, anon, authenticated, service_role;
revoke execute on function public.model_provider_circuit_events_immutable()
  from public, anon, authenticated, service_role;
revoke execute on function public.commit_model_provider_circuit_event_v1(text, text, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.initialize_model_provider_circuit_v1(text) from public, anon, authenticated;
grant execute on function public.initialize_model_provider_circuit_v1(text) to service_role;
revoke all on function public.set_model_provider_circuit_enabled_v1(text, boolean) from public, anon, authenticated;
grant execute on function public.set_model_provider_circuit_enabled_v1(text, boolean) to service_role;
revoke all on function public.read_model_provider_circuit_v1(text) from public, anon, authenticated;
grant execute on function public.read_model_provider_circuit_v1(text) to service_role;
revoke all on function public.commit_model_provider_circuit_admission_v1(text, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_model_provider_circuit_admission_v1(text, bigint, jsonb, jsonb, jsonb)
  to service_role;
revoke all on function public.commit_model_provider_circuit_outcome_v1(text, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_model_provider_circuit_outcome_v1(text, bigint, jsonb, jsonb)
  to service_role;

commit;
