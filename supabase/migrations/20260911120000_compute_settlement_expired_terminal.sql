-- FINDING O04-1 closed: `expired` is a terminal compute state, and a settlement that arrives
-- after the expiry sweep is refused instead of returning the hold a second time.
--
-- Evidence: the O04-1 block in `supabase/tests/billing_reconciliation.sql`, written to the
-- broken behaviour on purpose and flipped to the fixed behaviour in this same commit.
-- Reproduction, in one account: `reserve_foundation_compute_v3` sweeps every lapsed
-- reservation, sets it to `expired` and returns `reserved_credits` to `credit_balance`
-- (0045:389-402). `settle_foundation_compute_v3` then treated only `settled`, `released` and
-- `operator_review` as terminal (0045:546), so a late settlement for that same document fell
-- through to the paid branch and released `reserved_credits - actual` into the balance again.
-- The fixture measured 2012 against 2000 ever granted. Direction matters: it over-credits the
-- account rather than over-charging the customer, which is why it was published as a
-- reconciliation finding and not as an incident.
--
-- The change is `'expired'` added to that list plus its own error name, so a caller can tell a
-- lapsed capability from two settlements that genuinely disagree -- reusing
-- `foundation_compute_settlement_conflict` would make a hold the sweep already returned look
-- like a contested charge. No data is rewritten and no other branch moves: one
-- `create or replace`, which keeps the signature and therefore the grants from 0045:643-650,
-- and every settlement receipt already written stays as it is.
--
-- Re-runnable: `create or replace` only, no DDL on tables and no DML.
begin;

create or replace function public.settle_foundation_compute_v3(
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
  reservation public.foundation_compute_reservations%rowtype;
  account public.foundation_billing_accounts%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  target_state public.foundation_compute_state;
  released_units integer;
  overage_delta integer;
  v_trial_total bigint := 0;
begin
  if p_outcome not in ('settled', 'operator_review', 'released')
    or p_actual_credits < 0 or p_actual_credits > 60000
    or (p_outcome = 'released' and p_actual_credits <> 0)
    or p_reason_code !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'foundation_compute_settlement_invalid';
  end if;
  target_state := p_outcome::public.foundation_compute_state;
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || p_workspace_key, 0));
  select * into reservation from public.foundation_compute_reservations
    where workspace_key = p_workspace_key and document_id = p_document_id for update;
  if not found then raise exception 'foundation_compute_reservation_not_found'; end if;

  -- FINDING O04-1. 'expired' belongs in this list: the sweep in reserve_foundation_compute_v3
  -- has already returned the hold and written reason_code = 'CAPABILITY_EXPIRED', so there is
  -- nothing left for a settlement to move. p_outcome can never be 'expired' (the shape check
  -- above admits only settled / operator_review / released), so the duplicate branch cannot
  -- match it and every late settlement for a lapsed capability is refused -- under its own
  -- error name, because a hold the sweep returned is not a contested charge.
  if reservation.state in ('settled', 'released', 'operator_review', 'expired') then
    if reservation.state = target_state and reservation.settled_credits = p_actual_credits then
      return jsonb_build_object('status', 'duplicate', 'reservationId', reservation.reservation_id,
        'billingSource', reservation.billing_source);
    end if;
    if reservation.state = 'expired' then
      raise exception 'foundation_compute_settlement_expired';
    end if;
    raise exception 'foundation_compute_settlement_conflict';
  end if;

  if reservation.billing_source in ('owner', 'trial') then
    -- Free access is never turned into an overage charge. If observed work exceeds the
    -- preflight maximum we preserve the observed amount for accounting and close the run;
    -- future trial reservations see the consumed budget and stop there.
    if p_actual_credits > reservation.maximum_credits then
      update public.foundation_compute_reservations
         set maximum_credits = p_actual_credits
       where reservation_id = reservation.reservation_id;
      reservation.maximum_credits := p_actual_credits;
    end if;
    update public.foundation_compute_reservations
       set state = target_state, settled_credits = p_actual_credits, reason_code = p_reason_code,
           settled_at = now(), updated_at = now()
     where reservation_id = reservation.reservation_id;

    if reservation.billing_source = 'trial' then
      if p_actual_credits > reservation.reserved_credits then
        insert into public.foundation_trial_daily_budget (budget_day, observed_overage_units)
        values (reservation.created_at::date, p_actual_credits - reservation.reserved_credits)
        on conflict (budget_day) do update
          set observed_overage_units = public.foundation_trial_daily_budget.observed_overage_units + excluded.observed_overage_units,
              updated_at = now();
      end if;
      select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
      select coalesce(sum(settled_credits), 0) into v_trial_total
        from public.foundation_compute_reservations
       where user_id = reservation.user_id and billing_source = 'trial'
         and state in ('settled', 'operator_review');
      if found and v_trial_total >= v_policy.page_limit * 4 then
        update public.foundation_self_service_trials
           set status = 'expired', ended_reason = 'TRIAL_PAGE_QUOTA_EXHAUSTED', updated_at = now()
         where user_id = reservation.user_id and status = 'trialing';
      end if;
    end if;

    return jsonb_build_object(
      'status', 'processed', 'reservationId', reservation.reservation_id,
      'state', target_state, 'settledCredits', p_actual_credits,
      'reservedCredits', reservation.reserved_credits,
      'maximumCredits', reservation.maximum_credits,
      'releasedCredits', greatest(0, reservation.reserved_credits - p_actual_credits),
      'overageCredits', 0, 'billingSource', reservation.billing_source
    );
  end if;

  if p_actual_credits > reservation.maximum_credits then
    raise exception 'foundation_compute_maximum_charge_exceeded';
  end if;
  select * into account from public.foundation_billing_accounts
    where workspace_key = p_workspace_key for update;
  if not found or account.user_id <> reservation.user_id then raise exception 'foundation_billing_account_required'; end if;
  overage_delta := greatest(0, p_actual_credits - reservation.reserved_credits);
  if overage_delta > 0 and (account.overage_enabled = false or account.billing_hold) then
    raise exception 'foundation_compute_overage_not_enabled';
  end if;
  released_units := greatest(0, reservation.reserved_credits - p_actual_credits);
  update public.foundation_billing_accounts
    set credit_balance = credit_balance + released_units,
        overage_units = overage_units + overage_delta,
        lifetime_overage_units = lifetime_overage_units + overage_delta,
        updated_at = now()
    where workspace_key = p_workspace_key;
  update public.foundation_compute_reservations
    set state = target_state, settled_credits = p_actual_credits, reason_code = p_reason_code,
        settled_at = now(), updated_at = now()
    where reservation_id = reservation.reservation_id;

  return jsonb_build_object(
    'status', 'processed', 'reservationId', reservation.reservation_id,
    'state', target_state, 'settledCredits', p_actual_credits,
    'reservedCredits', reservation.reserved_credits,
    'maximumCredits', reservation.maximum_credits,
    'releasedCredits', released_units, 'overageCredits', overage_delta,
    'billingSource', 'paid'
  );
end;
$$;

commit;
