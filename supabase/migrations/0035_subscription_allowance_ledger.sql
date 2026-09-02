-- Grant included compile usage from signed subscription transactions. Each Paddle transaction is
-- one idempotent allowance period; renewals therefore grant once without trusting redirects.
begin;

alter table public.foundation_billing_events drop constraint if exists foundation_billing_events_action_check;
alter table public.foundation_billing_events add constraint foundation_billing_events_action_check
  check (action in ('purchase', 'subscription', 'allowance', 'reversal'));

alter table public.foundation_credit_ledger drop constraint if exists foundation_credit_ledger_kind_check;
alter table public.foundation_credit_ledger add constraint foundation_credit_ledger_kind_check
  check (kind in ('purchased', 'allowance', 'reversed'));

alter table public.foundation_billing_accounts
  add column if not exists lifetime_allowance_units integer not null default 0
    check (lifetime_allowance_units >= 0);

create unique index if not exists foundation_allowance_transaction_idx
  on public.foundation_credit_ledger (transaction_id) where kind = 'allowance';

create or replace function public.apply_foundation_billing_event_v4(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_payload_sha256 text,
  p_action text, p_workspace_key text default null, p_user_id uuid default null,
  p_offer_code text default null, p_transaction_id text default null, p_customer_id text default null,
  p_subscription_id text default null, p_subscription_status text default null,
  p_credit_delta integer default 0, p_adjustment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
  owner_id uuid;
  existing public.foundation_billing_events%rowtype;
  allowance public.foundation_credit_ledger%rowtype;
  pending public.foundation_pending_reversals%rowtype;
  reversal_inserted integer := 0;
begin
  if p_action not in ('allowance', 'reversal') then
    return public.apply_foundation_billing_event_v3(
      p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
      p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
      p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foundation-billing-event:' || p_event_id, 0));
  select * into existing from public.foundation_billing_events where event_id = p_event_id;
  if found then
    if existing.payload_sha256 <> p_payload_sha256 or existing.action <> p_action then
      raise exception 'foundation_billing_event_id_conflict';
    end if;
    return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
  end if;

  if p_action = 'reversal' then
    select * into allowance from public.foundation_credit_ledger
      where transaction_id = p_transaction_id and kind = 'allowance' for update;
    if not found then
      return public.apply_foundation_billing_event_v3(
        p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
        p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
        p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
      );
    end if;
    insert into public.foundation_billing_events
      (event_id, event_type, occurred_at, payload_sha256, action, workspace_key, user_id, transaction_id, adjustment_id, processing_result, processed_at)
    values
      (p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, allowance.workspace_key, allowance.user_id, p_transaction_id, p_adjustment_id, 'reversal_applied', now());
    insert into public.foundation_credit_ledger
      (workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta)
    values
      (allowance.workspace_key, allowance.user_id, p_event_id, 'reversed', allowance.offer_code, p_transaction_id, -allowance.credit_delta)
    on conflict do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 1 then
      update public.foundation_billing_accounts set
        credit_balance = greatest(0, credit_balance - allowance.credit_delta),
        lifetime_credits_reversed = lifetime_credits_reversed + allowance.credit_delta,
        billing_hold = true,
        updated_at = now()
      where workspace_key = allowance.workspace_key;
    end if;
    return jsonb_build_object('status', 'reversal_applied', 'eventId', p_event_id);
  end if;

  if p_event_type <> 'transaction.completed'
    or p_offer_code not in ('observer_access', 'studio_access')
    or p_workspace_key is null or p_user_id is null or p_customer_id is null
    or p_transaction_id is null or p_credit_delta <= 0 then
    raise exception 'billing_allowance_contract_invalid';
  end if;
  insert into public.foundation_billing_events
    (event_id, event_type, occurred_at, payload_sha256, action, workspace_key, user_id, transaction_id)
  values
    (p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, p_workspace_key, p_user_id, p_transaction_id);
  insert into public.foundation_billing_accounts (workspace_key, user_id, paddle_customer_id)
  values (p_workspace_key, p_user_id, p_customer_id)
  on conflict (workspace_key) do nothing;
  select user_id into owner_id from public.foundation_billing_accounts where workspace_key = p_workspace_key for update;
  if owner_id is distinct from p_user_id then raise exception 'billing_workspace_owner_mismatch'; end if;
  update public.foundation_billing_accounts set paddle_customer_id = coalesce(paddle_customer_id, p_customer_id), updated_at = now()
    where workspace_key = p_workspace_key and (paddle_customer_id is null or paddle_customer_id = p_customer_id);
  if not found then raise exception 'billing_customer_mismatch'; end if;
  insert into public.foundation_credit_ledger
    (workspace_key, user_id, event_id, kind, offer_code, transaction_id, credit_delta)
  values
    (p_workspace_key, p_user_id, p_event_id, 'allowance', p_offer_code, p_transaction_id, p_credit_delta)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    update public.foundation_billing_accounts set
      credit_balance = credit_balance + p_credit_delta,
      lifetime_allowance_units = lifetime_allowance_units + p_credit_delta,
      updated_at = now()
    where workspace_key = p_workspace_key;

    -- Paddle can deliver an adjustment before its transaction. V3 stores that adjustment in
    -- the pending ledger; connect it here so delivery order cannot resurrect refunded usage.
    select * into pending from public.foundation_pending_reversals
      where transaction_id = p_transaction_id for update;
    if found then
      insert into public.foundation_credit_ledger
        (workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta)
      values
        (p_workspace_key, p_user_id, pending.event_id, 'reversed', p_offer_code, p_transaction_id, -p_credit_delta)
      on conflict do nothing;
      get diagnostics reversal_inserted = row_count;
      if reversal_inserted = 1 then
        update public.foundation_billing_accounts set
          credit_balance = greatest(0, credit_balance - p_credit_delta),
          lifetime_credits_reversed = lifetime_credits_reversed + p_credit_delta,
          billing_hold = true,
          updated_at = now()
        where workspace_key = p_workspace_key;
        update public.foundation_billing_events set
          workspace_key = p_workspace_key,
          user_id = p_user_id,
          processing_result = 'reversal_applied',
          processed_at = now()
        where event_id = pending.event_id;
      end if;
      delete from public.foundation_pending_reversals where event_id = pending.event_id;
    end if;
  end if;
  update public.foundation_billing_events set processing_result = case when inserted_count = 1 then 'allowance_granted' else 'duplicate_transaction' end, processed_at = now()
    where event_id = p_event_id;
  return jsonb_build_object('status', case when inserted_count = 1 then 'allowance_granted' else 'duplicate_transaction' end, 'eventId', p_event_id);
end;
$$;

revoke all on function public.apply_foundation_billing_event_v4(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.apply_foundation_billing_event_v4(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) to service_role;

commit;
