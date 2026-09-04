-- Cross-account source reuse guard for the free evaluation.
--
-- The browser never decides this signal. After an upload reaches the quarantine bucket, the
-- application reads at most the already-enforced 5 MiB object, hashes the bytes, then HMACs that
-- digest with a server secret. Only that keyed digest reaches this table. Raw source bytes, raw
-- SHA-256 values, IP addresses, and browser fingerprints are not stored here.
--
-- Exact source reuse is a strong but not infallible abuse signal: two legitimate people can own
-- the same template. We therefore stop *free compute* and return a review-required decision
-- rather than banning the account. Paid and owner access never enter this ledger.
begin;

create table if not exists public.foundation_trial_source_digests (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  document_id uuid not null,
  content_hmac text not null check (content_hmac ~ '^hmac256:[a-f0-9]{64}$'),
  decision text not null check (decision in ('allow', 'review')),
  reason_code text not null check (reason_code ~ '^[A-Z0-9_]{3,80}$'),
  observed_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
create index if not exists foundation_trial_source_digest_lookup_idx
  on public.foundation_trial_source_digests (content_hmac, observed_at desc);

alter table public.foundation_trial_source_digests enable row level security;
revoke all on public.foundation_trial_source_digests from public, anon, authenticated;
grant select, insert, update, delete on public.foundation_trial_source_digests to service_role;

-- Start conservatively: 1,000 standard units = 250 standard pages/day. The per-account ceiling
-- remains 50 pages. Operators can raise this row without a deploy once legitimate demand grows.
update public.foundation_trial_policy
   set daily_standard_unit_limit = least(daily_standard_unit_limit, 1000), updated_at = now()
 where policy_key = 'default';

create or replace function public.assess_foundation_trial_source_digest(
  p_user_id uuid,
  p_workspace_key text,
  p_document_id uuid,
  p_content_hmac text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trial public.foundation_self_service_trials%rowtype;
  v_existing public.foundation_trial_source_digests%rowtype;
  v_other_users integer := 0;
  v_paid boolean := false;
  v_owner boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_content_hmac !~ '^hmac256:[a-f0-9]{64}$' then
    raise exception 'foundation_trial_source_digest_invalid';
  end if;

  select exists(
    select 1 from public.foundation_account_access_grants
     where user_id = p_user_id and active = true and trial_exempt = true
  ) into v_owner;
  if v_owner then
    return jsonb_build_object('status', 'not_trial', 'source', 'owner');
  end if;

  select exists(
    select 1 from public.foundation_billing_accounts
     where user_id = p_user_id and workspace_key = p_workspace_key
       and billing_hold = false
       and access_plan in ('observer_access', 'studio_access')
       and subscription_status in ('active', 'trialing')
  ) into v_paid;
  if v_paid then
    return jsonb_build_object('status', 'not_trial', 'source', 'paid');
  end if;

  select * into v_trial
    from public.foundation_self_service_trials
   where user_id = p_user_id and workspace_key = p_workspace_key
   for update;
  if not found or v_trial.status <> 'trialing' or v_trial.expires_at <= v_now then
    return jsonb_build_object('status', 'not_trial', 'source', 'none');
  end if;

  -- Serialize one exact content signal so simultaneous new accounts cannot both become the
  -- first allowed claimant for the same bytes.
  perform pg_advisory_xact_lock(hashtextextended('foundation-trial-source:' || p_content_hmac, 0));

  select * into v_existing
    from public.foundation_trial_source_digests
   where user_id = p_user_id and document_id = p_document_id
   for update;
  if found then
    if v_existing.workspace_key <> p_workspace_key or v_existing.content_hmac <> p_content_hmac then
      raise exception 'foundation_trial_source_digest_idempotency_conflict';
    end if;
    if v_existing.decision = 'allow' then
      return jsonb_build_object('status', 'allow', 'idempotentReplay', true);
    end if;
    return jsonb_build_object(
      'status', 'denied', 'code', 'TRIAL_SOURCE_REVIEW_REQUIRED', 'idempotentReplay', true
    );
  end if;

  select count(distinct user_id) into v_other_users
    from public.foundation_trial_source_digests
   where content_hmac = p_content_hmac
     and user_id <> p_user_id
     and decision = 'allow'
     and observed_at >= v_now - interval '30 days';

  if v_other_users > 0 then
    insert into public.foundation_trial_source_digests (
      user_id, workspace_key, document_id, content_hmac, decision, reason_code, observed_at
    ) values (
      p_user_id, p_workspace_key, p_document_id, p_content_hmac,
      'review', 'EXACT_SOURCE_REUSED_ACROSS_TRIALS', v_now
    );
    return jsonb_build_object(
      'status', 'denied', 'code', 'TRIAL_SOURCE_REVIEW_REQUIRED', 'idempotentReplay', false
    );
  end if;

  insert into public.foundation_trial_source_digests (
    user_id, workspace_key, document_id, content_hmac, decision, reason_code, observed_at
  ) values (
    p_user_id, p_workspace_key, p_document_id, p_content_hmac,
    'allow', 'FIRST_TRIAL_SOURCE_CLAIM', v_now
  );
  return jsonb_build_object('status', 'allow', 'idempotentReplay', false);
end;
$$;

revoke all on function public.assess_foundation_trial_source_digest(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.assess_foundation_trial_source_digest(uuid, text, uuid, text)
  to service_role;

commit;
