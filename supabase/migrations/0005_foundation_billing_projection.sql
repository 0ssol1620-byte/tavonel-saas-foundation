-- Dedicated Foundation billing projection. Apply only to the Supabase project bound to
-- tavonel-saas-foundation; browser roles receive no table or RPC privileges.
begin;

create table public.foundation_billing_accounts (
  workspace_key text primary key check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  access_plan text check (access_plan is null or access_plan in ('observer_access', 'studio_access')),
  subscription_status text not null default 'inactive'
    check (subscription_status in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'inactive')),
  paddle_customer_id text unique,
  paddle_subscription_id text unique,
  credit_balance integer not null default 0,
  lifetime_credits_purchased integer not null default 0 check (lifetime_credits_purchased >= 0),
  lifetime_credits_reversed integer not null default 0 check (lifetime_credits_reversed >= 0),
  billing_hold boolean not null default false,
  last_subscription_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.foundation_billing_events (
  event_id text primary key check (event_id ~ '^evt_[a-z0-9]{26}$'),
  event_type text not null,
  occurred_at timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  action text not null check (action in ('purchase', 'subscription', 'reversal')),
  processing_result text not null default 'received',
  workspace_key text,
  user_id uuid,
  transaction_id text,
  subscription_id text,
  adjustment_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index foundation_billing_events_occurred_idx on public.foundation_billing_events (occurred_at desc);

create table public.foundation_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null references public.foundation_billing_accounts(workspace_key) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  event_id text not null unique references public.foundation_billing_events(event_id) on delete restrict,
  kind text not null check (kind in ('purchased', 'reversed')),
  offer_code text,
  transaction_id text,
  reversal_of_transaction_id text,
  credit_delta integer not null,
  created_at timestamptz not null default now()
);
create unique index foundation_credit_purchase_transaction_idx
  on public.foundation_credit_ledger (transaction_id) where kind = 'purchased';
create unique index foundation_credit_reversal_transaction_idx
  on public.foundation_credit_ledger (reversal_of_transaction_id) where kind = 'reversed';
create index foundation_credit_ledger_workspace_idx on public.foundation_credit_ledger (workspace_key, created_at desc);

create table public.foundation_pending_reversals (
  event_id text primary key references public.foundation_billing_events(event_id) on delete restrict,
  transaction_id text not null unique,
  adjustment_id text not null unique,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.foundation_billing_accounts enable row level security;
alter table public.foundation_billing_events enable row level security;
alter table public.foundation_credit_ledger enable row level security;
alter table public.foundation_pending_reversals enable row level security;

revoke all on public.foundation_billing_accounts, public.foundation_billing_events,
  public.foundation_credit_ledger, public.foundation_pending_reversals from public, anon, authenticated;
grant select, insert, update, delete on public.foundation_billing_accounts, public.foundation_billing_events,
  public.foundation_credit_ledger, public.foundation_pending_reversals to service_role;

create or replace function public.apply_foundation_billing_event(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload_sha256 text,
  p_action text,
  p_workspace_key text default null,
  p_user_id uuid default null,
  p_offer_code text default null,
  p_transaction_id text default null,
  p_customer_id text default null,
  p_subscription_id text default null,
  p_subscription_status text default null,
  p_credit_delta integer default 0,
  p_adjustment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_owner uuid;
  v_purchase public.foundation_credit_ledger%rowtype;
  v_pending public.foundation_pending_reversals%rowtype;
  v_result text := 'processed';
begin
  if p_action not in ('purchase', 'subscription', 'reversal') then
    raise exception 'billing_action_invalid';
  end if;

  insert into public.foundation_billing_events (
    event_id, event_type, occurred_at, payload_sha256, action, workspace_key, user_id,
    transaction_id, subscription_id, adjustment_id
  ) values (
    p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, p_workspace_key, p_user_id,
    p_transaction_id, p_subscription_id, p_adjustment_id
  ) on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
  end if;

  if p_action in ('purchase', 'subscription') then
    if p_workspace_key is null or p_user_id is null or p_offer_code is null or p_customer_id is null then
      raise exception 'billing_identity_binding_required';
    end if;
    insert into public.foundation_billing_accounts (workspace_key, user_id, paddle_customer_id)
    values (p_workspace_key, p_user_id, p_customer_id)
    on conflict (workspace_key) do nothing;
    select user_id into v_owner from public.foundation_billing_accounts where workspace_key = p_workspace_key for update;
    if v_owner is distinct from p_user_id then raise exception 'billing_workspace_owner_mismatch'; end if;
    update public.foundation_billing_accounts
      set paddle_customer_id = coalesce(paddle_customer_id, p_customer_id), updated_at = now()
      where workspace_key = p_workspace_key
        and (paddle_customer_id is null or paddle_customer_id = p_customer_id);
    if not found then raise exception 'billing_customer_mismatch'; end if;
  end if;

  if p_action = 'purchase' then
    if p_offer_code not in ('credit_starter', 'credit_builder', 'credit_scale')
      or p_transaction_id is null or p_credit_delta <= 0 then
      raise exception 'billing_purchase_contract_invalid';
    end if;
    insert into public.foundation_credit_ledger (
      workspace_key, user_id, event_id, kind, offer_code, transaction_id, credit_delta
    ) values (
      p_workspace_key, p_user_id, p_event_id, 'purchased', p_offer_code, p_transaction_id, p_credit_delta
    ) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      update public.foundation_billing_accounts set
        credit_balance = credit_balance + p_credit_delta,
        lifetime_credits_purchased = lifetime_credits_purchased + p_credit_delta,
        updated_at = now()
      where workspace_key = p_workspace_key;
      select * into v_pending from public.foundation_pending_reversals
        where transaction_id = p_transaction_id for update;
      if found then
        insert into public.foundation_credit_ledger (
          workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta
        ) values (
          p_workspace_key, p_user_id, v_pending.event_id, 'reversed', p_offer_code, p_transaction_id, -p_credit_delta
        ) on conflict do nothing;
        if found then
          update public.foundation_billing_accounts set
            credit_balance = credit_balance - p_credit_delta,
            lifetime_credits_reversed = lifetime_credits_reversed + p_credit_delta,
            billing_hold = true,
            updated_at = now()
          where workspace_key = p_workspace_key;
          update public.foundation_billing_events set
            workspace_key = p_workspace_key, user_id = p_user_id,
            processing_result = 'reversal_applied', processed_at = now()
          where event_id = v_pending.event_id;
        end if;
        delete from public.foundation_pending_reversals where event_id = v_pending.event_id;
      end if;
    else
      v_result := 'duplicate_transaction';
    end if;
  elsif p_action = 'subscription' then
    if p_offer_code not in ('observer_access', 'studio_access')
      or p_subscription_id is null
      or p_subscription_status not in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'inactive') then
      raise exception 'billing_subscription_contract_invalid';
    end if;
    update public.foundation_billing_accounts set
      access_plan = p_offer_code,
      subscription_status = p_subscription_status,
      paddle_subscription_id = p_subscription_id,
      last_subscription_event_at = p_occurred_at,
      updated_at = now()
    where workspace_key = p_workspace_key
      and (last_subscription_event_at is null or p_occurred_at >= last_subscription_event_at)
      and (paddle_subscription_id is null or paddle_subscription_id = p_subscription_id);
    if not found then v_result := 'stale_or_mismatched_subscription'; end if;
  else
    if p_transaction_id is null or p_adjustment_id is null then
      raise exception 'billing_reversal_contract_invalid';
    end if;
    select * into v_purchase from public.foundation_credit_ledger
      where transaction_id = p_transaction_id and kind = 'purchased' for update;
    if not found then
      insert into public.foundation_pending_reversals (event_id, transaction_id, adjustment_id, occurred_at)
      values (p_event_id, p_transaction_id, p_adjustment_id, p_occurred_at)
      on conflict do nothing;
      v_result := 'pending_original_transaction';
    else
      insert into public.foundation_credit_ledger (
        workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta
      ) values (
        v_purchase.workspace_key, v_purchase.user_id, p_event_id, 'reversed', v_purchase.offer_code,
        p_transaction_id, -v_purchase.credit_delta
      ) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 1 then
        update public.foundation_billing_accounts set
          credit_balance = credit_balance - v_purchase.credit_delta,
          lifetime_credits_reversed = lifetime_credits_reversed + v_purchase.credit_delta,
          billing_hold = true,
          updated_at = now()
        where workspace_key = v_purchase.workspace_key;
        update public.foundation_billing_events set
          workspace_key = v_purchase.workspace_key, user_id = v_purchase.user_id
        where event_id = p_event_id;
      else
        v_result := 'duplicate_reversal';
      end if;
    end if;
  end if;

  update public.foundation_billing_events
    set processing_result = v_result, processed_at = now()
    where event_id = p_event_id;

  return jsonb_build_object('status', v_result, 'eventId', p_event_id);
exception when others then
  raise;
end;
$$;

revoke all on function public.apply_foundation_billing_event(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.apply_foundation_billing_event(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) to service_role;

commit;
