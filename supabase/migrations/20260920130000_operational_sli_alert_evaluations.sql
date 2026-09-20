-- B35: durable, idempotent evaluations of the internal operational SLI.
-- This records alert intent for operators. It does not deliver an external notification.
begin;

create table public.foundation_operational_sli_evaluations (
  evaluation_key text primary key check (evaluation_key ~ '^sha256:[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  state text not null check (state in ('available', 'degraded', 'stale', 'blocked')),
  payload_sha256 text not null check (payload_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  evaluation jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (window_started_at),
  check ((extract(epoch from window_started_at) % 300) = 0),
  check (evaluation->>'schemaVersion' = 'tavonel.operational_sli.v1'),
  check (evaluation->>'state' = state),
  check (octet_length(evaluation::text) <= 16384),
  check (evaluation ? 'alerts' and jsonb_typeof(evaluation->'alerts') = 'array')
);

create index foundation_operational_sli_evaluations_window_idx
  on public.foundation_operational_sli_evaluations (window_started_at desc, evaluation_key);

alter table public.foundation_operational_sli_evaluations enable row level security;
revoke all on public.foundation_operational_sli_evaluations from public, anon, authenticated, service_role;
grant select on public.foundation_operational_sli_evaluations to service_role;

create or replace function public.prevent_foundation_operational_sli_evaluation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'foundation_operational_sli_evaluations_append_only';
end;
$$;

create trigger foundation_operational_sli_evaluations_append_only
  before update or delete on public.foundation_operational_sli_evaluations
  for each row execute function public.prevent_foundation_operational_sli_evaluation_mutation();

create or replace function public.record_foundation_operational_sli(
  p_window_started_at timestamptz,
  p_evaluation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload_sha256 text;
  v_evaluation_key text;
  v_existing public.foundation_operational_sli_evaluations%rowtype;
begin
  if p_window_started_at is null
    or (extract(epoch from p_window_started_at) % 300) <> 0
    or p_evaluation is null
    or p_evaluation->>'schemaVersion' <> 'tavonel.operational_sli.v1'
    or p_evaluation->>'state' not in ('available', 'degraded', 'stale', 'blocked')
    or p_evaluation->>'evaluatedAt' <> to_char(p_window_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or octet_length(p_evaluation::text) > 16384
    or not (p_evaluation ? 'alerts')
    or jsonb_typeof(p_evaluation->'alerts') <> 'array' then
    raise exception 'operational_sli_evaluation_contract_invalid';
  end if;

  v_payload_sha256 := 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_evaluation::text, 'UTF8'), 'sha256'), 'hex'
  );
  v_evaluation_key := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'tavonel.operational_sli_alert_evaluation.v1' || pg_catalog.chr(10) ||
        to_char(p_window_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_evaluation_key, 0));
  select * into v_existing
    from public.foundation_operational_sli_evaluations
   where evaluation_key = v_evaluation_key;
  if found then
    if v_existing.payload_sha256 is distinct from v_payload_sha256 then
      raise exception 'operational_sli_evaluation_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'evaluationKey', v_existing.evaluation_key,
      'payloadSha256', v_existing.payload_sha256,
      'windowStartedAt', to_char(v_existing.window_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'status', 'replayed'
    );
  end if;

  insert into public.foundation_operational_sli_evaluations (
    evaluation_key, window_started_at, state, payload_sha256, evaluation
  ) values (
    v_evaluation_key, p_window_started_at, p_evaluation->>'state', v_payload_sha256, p_evaluation
  );

  return pg_catalog.jsonb_build_object(
    'evaluationKey', v_evaluation_key,
    'payloadSha256', v_payload_sha256,
    'windowStartedAt', to_char(p_window_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', 'recorded'
  );
end;
$$;

revoke all on function public.record_foundation_operational_sli(timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_foundation_operational_sli(timestamptz, jsonb)
  to service_role;
revoke execute on function public.prevent_foundation_operational_sli_evaluation_mutation()
  from public, anon, authenticated, service_role;

commit;
