-- FD-03: included pages do not roll over. The unused included-page credit of a billing month is
-- expired when the next month's grant is applied.
--
-- /pricing publishes the term. Nothing in the ledger enforced it: `apply_foundation_billing_event_v4`
-- (0035) adds each renewal transaction's allowance to `credit_balance`, and no job, trigger or
-- route ever reduces it, so a customer who used 100 of 500 included pages carried 400 into the
-- next month. That is a term the code did not keep, which is the defect -- not the rollover.
--
-- Lazy expiry, no scheduled job. The only moment the balance has to be right is the moment the
-- next period's pages arrive, and what is left cannot be spent after the plan lapses anyway:
-- `reserve_foundation_compute_v3` spends a balance only while `subscription_status` is 'active'
-- or 'trialing'. What this does leave is a short window after the period ends and before the
-- renewal webhook lands, in which the old month's leftovers are still spendable. That window is
-- the difference between this mechanism and the published sentence, and it is named in the lane
-- report rather than hidden here.
--
-- WHAT MAY BE EXPIRED, AND WHAT MAY NOT.
-- `credit_balance` is one scalar pool that several kinds of credit flow into (0005, 0035):
-- `purchased` credit packs, subscription `allowance` (= included pages), and `reversed` refunds
-- of either. Consumption is attributed to no kind at all -- the reservation functions subtract
-- from the scalar -- so the included-page portion that is left cannot be read off the ledger.
-- It can be bounded, and the bound is taken in the customer's favour:
--
--   expired = greatest(0, credit_balance - greatest(0, sum(credit_delta)
--                            over this workspace's ledger rows whose offer_code
--                            differs from the offer now being granted))
--
-- Every credit that is not this offer's included pages is a floor the expiry never goes below.
-- Because consumption can only reduce credit that the floor still counts as present, the floor
-- over-estimates what survives, so the units expired are never more than the included-page credit
-- that is really left. Money the customer paid for is protected by arithmetic, not by convention.
--
-- The expiry can be smaller than the true remainder, in two named cases, both under-expiring and
-- both in the customer's favour:
--   * a credit pack that was bought and then spent keeps a floor the customer no longer holds;
--   * after the observer -> studio replacement (0010) the pre-upgrade plan's grants stay in the
--     floor, so a Team renewal may expire nothing. That is deliberate: the upgrade transaction
--     lands mid-month while the Developer month it replaces is still paid for, and expiring it
--     there would take pages the customer bought. The schema records no billing-period boundary
--     -- Paddle sends one, nothing stores it -- so "the previous period of this plan has ended"
--     is inferred from "the same plan granted again", which is exactly true for a renewal and
--     silent for a plan change.
-- ponytail: attributing consumption to a kind, or recording the subscription id and period end on
-- the grant, is what would make the split exact. Both change every reservation path in the
-- Protected Core and need a same-condition benchmark, not a migration.
--
-- No `purchased` row can exist today: every offer in `nextjs/lib/billing-catalog.ts` is a
-- subscription, so the webhook parser's `purchase` branch is unreachable and the floor is 0 for
-- every live account. The floor is written for the day a credit pack is sold, not for rows in the
-- data.
--
-- The expiry is a ledger row and never a silent UPDATE: `kind = 'allowance_expired'` is the
-- reason code, the granting event and transaction record what caused it, and `credit_delta` is
-- negative. The RPC returns the units it expired, so the webhook handler has a receipt.
begin;

-- One new kind. The vocabulary stays in one readable list, and the file stays re-runnable.
alter table public.foundation_credit_ledger drop constraint if exists foundation_credit_ledger_kind_check;
alter table public.foundation_credit_ledger add constraint foundation_credit_ledger_kind_check
  check (kind in ('purchased', 'allowance', 'reversed', 'allowance_expired'));

-- The grant and the expiry it triggers are two facts about one event, so `unique (event_id)`
-- becomes `unique (event_id, kind)`. Nothing loses a guarantee: every insert site writes one
-- fixed kind per event (0005 purchase/reversal, 0035 allowance/reversal), so (event_id, kind) is
-- violated by exactly the same second insert that (event_id) refused, and each kind keeps its own
-- transaction-scoped unique index. This constraint is also the expiry row's dedupe: one grant
-- event can expire its predecessor once and only once.
--
-- The old constraint is dropped by its definition, not by a guessed name: 0005 declared it inline
-- as a column `unique`, so the name belongs to Postgres rather than to this repository.
do $$
declare
  legacy_name text;
begin
  select conname into legacy_name from pg_constraint
   where conrelid = 'public.foundation_credit_ledger'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (event_id)';
  if legacy_name is not null then
    execute format('alter table public.foundation_credit_ledger drop constraint %I', legacy_name);
  end if;
end $$;

alter table public.foundation_credit_ledger drop constraint if exists foundation_credit_ledger_event_id_kind_key;
alter table public.foundation_credit_ledger add constraint foundation_credit_ledger_event_id_kind_key
  unique (event_id, kind);

comment on constraint foundation_credit_ledger_event_id_kind_key on public.foundation_credit_ledger is
  'One row per event per kind: a renewal event writes its allowance grant and the expiry of the previous period remainder.';

-- Copied from 0035 (lines 20-151) with one hunk added inside the allowance branch, four
-- declarations and one returned field. The signature is unchanged, so the ACL 0035 granted
-- survives the replace and is deliberately not restated.
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
  balance_before integer := 0;
  other_offer_credits integer := 0;
  expired_units integer := 0;
  expiry_inserted integer := 0;
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
    -- No ledger or balance change occurred in this invocation. Keep the same explicit
    -- receipt field as the grant/duplicate-transaction path, including repeat delivery.
    return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id, 'expiredIncludedUnits', 0);
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
    -- FD-03. This period's pages replace what is left of the last period's, they do not add to
    -- it. The account row is already locked by the `for update` above, and the grant row inserted
    -- immediately above carries this offer_code, so it falls outside the floor by construction.
    select credit_balance into balance_before from public.foundation_billing_accounts
      where workspace_key = p_workspace_key;
    select greatest(0, coalesce(sum(credit_delta), 0)) into other_offer_credits
      from public.foundation_credit_ledger
      where workspace_key = p_workspace_key and offer_code is distinct from p_offer_code;
    expired_units := greatest(0, balance_before - other_offer_credits);
    if expired_units > 0 then
      insert into public.foundation_credit_ledger
        (workspace_key, user_id, event_id, kind, offer_code, transaction_id, credit_delta)
      values
        (p_workspace_key, p_user_id, p_event_id, 'allowance_expired', p_offer_code, p_transaction_id, -expired_units)
      on conflict do nothing;
      get diagnostics expiry_inserted = row_count;
      -- The balance follows the ledger row and never the intention: if the row did not land
      -- because this event has already expired its predecessor, nothing is taken a second time.
      if expiry_inserted <> 1 then expired_units := 0; end if;
    end if;
    update public.foundation_billing_accounts set
      credit_balance = credit_balance - expired_units + p_credit_delta,
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
  return jsonb_build_object(
    'status', case when inserted_count = 1 then 'allowance_granted' else 'duplicate_transaction' end,
    'eventId', p_event_id,
    'expiredIncludedUnits', expired_units
  );
end;
$$;

commit;
