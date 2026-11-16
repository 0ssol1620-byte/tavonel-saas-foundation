-- Page meter, phase 1 of pricing v2: settle a read by the pages it read, not by the document.
--
-- Until now an OCR read settled a flat 2 credits whatever its length (the worker's `0 | 2` wire
-- type), while every quote, hold and plan was in pages (ADR-0005, rows P8 and P9). This migration
-- moves the charge into the ledger, from facts the CDR worker observed:
--
--   1. Pages. `settle_foundation_compute_v4` takes the page count of the sanitized PDF the reader
--      read (ADR-0005 C1) and settles 4 credits a standard page and 6 a complex page, the two
--      constants `nextjs/lib/usage-pricing.ts` already quotes and holds with
--      (STANDARD_UNITS_PER_PAGE, MAX_UNITS_PER_PAGE). `nextjs/lib/page-meter.test.ts` reads this
--      file and fails if either literal drifts from the code.
--      Nothing in the pipeline classifies a page as complex yet (ADR-0005, "Three units" item 3),
--      so the worker reports no complex count; `metered_complex_pages` stays null and the read is
--      charged as standard pages, the lower of the two rates. No complexity is inferred.
--      Fail closed: a `settled` outcome with no page count is refused
--      (`foundation_compute_page_count_required`); nothing here guesses a length. The charge is
--      capped at what the customer approved -- `maximum_credits`, or `reserved_credits` when the
--      paid account may not run into overage -- and a capped charge says so (`pages_capped`).
--   2. Unchanged source. A `settled` read whose worker-observed source digest already has a
--      settled, unreversed read in the SAME workspace settles at 0 (`unchanged_source`) and names
--      the reservation it matched. The digest is the one the worker computed over the bytes it
--      read, never the client-supplied digest recorded at upload confirm, which the uploader can
--      choose. Another workspace's reads are never looked at.
--   3. No usable output. `operator_review` (the reader failed) settles 0 (`no_usable_output`), and
--      a compile job that settles `failed` reverses the page charge of every document in it whose
--      source no `ready` or `review_required` compile ever used, through that document or another
--      read of the same bytes in the workspace (`COMPILE_FAILED_NO_OUTPUT`), once.
--      Only reads this function settled are reversed: a pre-meter per-document charge
--      (`charge_basis` null) is left as it was booked. A reversal undoes exactly what settlement
--      booked: the held part goes back to the balance and the part above the hold comes off the
--      overage counters, never both for the same credit.
--   4. Refunded, then used (OC-3, WO-D27-4). A reversed read that a later compile turns into a
--      `ready` world is charged again, once, on that first `ready`, for exactly what the
--      reversal gave back (`recharged_credits = reversed_credits`). Otherwise making a compile
--      fail on purpose and then recompiling is a repeatable free read. The held part comes off
--      the balance as far as the balance still holds it; what no longer fits is booked as
--      overage rather than dropped (`recharged_balance_credits` says how much was which). A
--      charged-again read counts as paid for rule 2. Rule 2 binds the re-charge too: a refunded
--      read is not charged again while the workspace holds a live paid charge for the same bytes
--      (settled above 0, never refunded or charged again), so a source is paid once however many
--      documents carry it; of two refunded twins one world uses, the earlier-settled is charged.
--      `review_required` is not yet a world and
--      charges nothing; a read a world used is never reversed again (rule 3 already looks for
--      a `ready` compile).
--
-- Idempotent: a redelivered settlement with the same outcome, pages and digest answers
-- `duplicate` with the stored receipt; any other second settlement conflicts. The free-source
-- decision is taken once, under the workspace's compute lock, so two concurrent re-compiles of
-- one source cannot both be free or both be charged.
--
-- `settle_foundation_compute_v3` is unchanged and keeps every release path (`released`, 0). The
-- settle route sends `settled` and `operator_review` here only.
--
-- No new table, so no new RLS policy: the columns land on `foundation_compute_reservations`,
-- which has RLS enabled and no grant to anon or authenticated (0009, 0053). No row is rewritten
-- and no backfill runs: every existing settlement keeps its per-document credits and a null
-- `charge_basis`, which is how a reader tells the two regimes apart.
begin;

alter table public.foundation_compute_reservations
  add column if not exists metered_pages integer,
  add column if not exists metered_complex_pages integer,
  add column if not exists metered_source_sha256 text,
  add column if not exists charge_basis text,
  add column if not exists charge_basis_reservation_id uuid,
  add column if not exists reversed_credits integer,
  add column if not exists reversal_reason text,
  add column if not exists reversal_compile_job_id text,
  add column if not exists reversed_at timestamptz,
  add column if not exists recharged_credits integer,
  add column if not exists recharged_balance_credits integer,
  add column if not exists recharge_compile_job_id text,
  add column if not exists recharged_at timestamptz;

alter table public.foundation_compute_reservations
  add constraint foundation_compute_metered_pages_range
    check (metered_pages is null or metered_pages between 1 and 10000),
  add constraint foundation_compute_metered_complex_pages_range
    check (metered_complex_pages is null
      or (metered_pages is not null and metered_complex_pages between 0 and metered_pages)),
  add constraint foundation_compute_metered_source_sha256_shape
    check (metered_source_sha256 is null or metered_source_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  add constraint foundation_compute_charge_basis_known
    check (charge_basis is null
      or charge_basis in ('pages', 'pages_capped', 'unchanged_source', 'no_usable_output')),
  add constraint foundation_compute_unchanged_source_names_its_match
    check ((charge_basis = 'unchanged_source') = (charge_basis_reservation_id is not null)),
  add constraint foundation_compute_reversal_complete
    check ((reversed_at is null) = (reversed_credits is null)
      and (reversed_at is null) = (reversal_reason is null)
      and (reversed_credits is null or (reversed_credits > 0 and reversed_credits <= settled_credits))
      and (reversal_reason is null or reversal_reason ~ '^[A-Z0-9_]{3,80}$')),
  add constraint foundation_compute_recharge_complete
    check ((recharged_at is null) = (recharged_credits is null)
      and (recharged_at is null) = (recharged_balance_credits is null)
      and (recharged_at is null) = (recharge_compile_job_id is null)
      and (recharged_at is null or (reversed_at is not null
        and recharged_credits = reversed_credits
        and recharged_balance_credits between 0 and recharged_credits)));

create index if not exists foundation_compute_reservations_settled_source_idx
  on public.foundation_compute_reservations (workspace_key, metered_source_sha256)
  where state = 'settled' and metered_source_sha256 is not null;

create or replace function public.foundation_compute_settlement_receipt(
  r public.foundation_compute_reservations,
  p_status text,
  p_released integer,
  p_overage integer
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status', p_status, 'reservationId', r.reservation_id,
    'state', r.state, 'settledCredits', r.settled_credits,
    'reservedCredits', r.reserved_credits, 'maximumCredits', r.maximum_credits,
    'releasedCredits', p_released, 'overageCredits', p_overage,
    'billingSource', r.billing_source,
    'meteredPages', r.metered_pages, 'meteredComplexPages', r.metered_complex_pages,
    'chargeBasis', r.charge_basis, 'chargeBasisReservationId', r.charge_basis_reservation_id
  );
$$;

create function public.settle_foundation_compute_v4(
  p_workspace_key text,
  p_document_id uuid,
  p_outcome text,
  p_pages integer,
  p_complex_pages integer,
  p_source_sha256 text,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.foundation_compute_reservations%rowtype;
  account public.foundation_billing_accounts%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  v_complex integer;
  v_prior uuid;
  v_metered integer;
  v_cap integer;
  v_credits integer;
  v_basis text;
  v_released integer;
  v_overage integer := 0;
  v_trial_total bigint := 0;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_id is null
    or p_outcome is null or p_outcome not in ('settled', 'operator_review')
    or p_reason_code is null or p_reason_code !~ '^[A-Z0-9_]{3,80}$'
    or (p_pages is not null and (p_pages < 1 or p_pages > 10000))
    or (p_complex_pages is not null and (p_pages is null or p_complex_pages < 0 or p_complex_pages > p_pages))
    or (p_source_sha256 is not null and p_source_sha256 !~ '^sha256:[a-f0-9]{64}$') then
    raise exception 'foundation_compute_settlement_invalid';
  end if;
  -- A read is never charged on a guessed length. The worker settles a read it cannot count as
  -- operator_review; a `settled` that arrives without pages is refused and stays retryable.
  if p_outcome = 'settled' and p_pages is null then
    raise exception 'foundation_compute_page_count_required';
  end if;
  v_complex := case when p_pages is null then null else coalesce(p_complex_pages, 0) end;

  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || p_workspace_key, 0));
  select * into r from public.foundation_compute_reservations
   where workspace_key = p_workspace_key and document_id = p_document_id
   for update;
  if not found then raise exception 'foundation_compute_reservation_not_found'; end if;

  if r.state <> 'reserved' then
    if r.state::text = p_outcome and r.charge_basis is not null
      and r.metered_pages is not distinct from p_pages
      and r.metered_complex_pages is not distinct from p_complex_pages
      and r.metered_source_sha256 is not distinct from p_source_sha256 then
      return public.foundation_compute_settlement_receipt(r, 'duplicate', 0, 0);
    end if;
    if r.state = 'expired' then raise exception 'foundation_compute_settlement_expired'; end if;
    raise exception 'foundation_compute_settlement_conflict';
  end if;

  if r.billing_source = 'paid' then
    select * into account from public.foundation_billing_accounts
     where workspace_key = p_workspace_key for update;
    if not found or account.user_id <> r.user_id then
      raise exception 'foundation_billing_account_required';
    end if;
  end if;

  if p_outcome = 'operator_review' then
    v_credits := 0;
    v_basis := 'no_usable_output';
  else
    select prior.reservation_id into v_prior
      from public.foundation_compute_reservations prior
     where prior.workspace_key = p_workspace_key
       and prior.state = 'settled'
       and prior.metered_source_sha256 = p_source_sha256
       and (prior.reversed_at is null or prior.recharged_at is not null)
       and prior.reservation_id <> r.reservation_id
     order by prior.settled_at, prior.reservation_id
     limit 1;
    if v_prior is not null then
      v_credits := 0;
      v_basis := 'unchanged_source';
    else
      -- STANDARD_UNITS_PER_PAGE and MAX_UNITS_PER_PAGE (nextjs/lib/usage-pricing.ts).
      v_metered := (p_pages - v_complex) * 4 + v_complex * 6;
      v_cap := case
        when r.billing_source = 'paid' and (not account.overage_enabled or account.billing_hold)
          then r.reserved_credits
        else r.maximum_credits
      end;
      v_credits := least(v_metered, v_cap);
      v_basis := case when v_credits < v_metered then 'pages_capped' else 'pages' end;
    end if;
  end if;

  v_released := greatest(0, r.reserved_credits - v_credits);
  if r.billing_source = 'paid' then
    v_overage := greatest(0, v_credits - r.reserved_credits);
    update public.foundation_billing_accounts
       set credit_balance = credit_balance + v_released,
           overage_units = overage_units + v_overage,
           lifetime_overage_units = lifetime_overage_units + v_overage,
           updated_at = now()
     where workspace_key = p_workspace_key;
  end if;

  update public.foundation_compute_reservations
     set state = p_outcome::public.foundation_compute_state,
         settled_credits = v_credits, reason_code = p_reason_code,
         metered_pages = p_pages, metered_complex_pages = p_complex_pages,
         metered_source_sha256 = p_source_sha256,
         charge_basis = v_basis, charge_basis_reservation_id = v_prior,
         settled_at = now(), updated_at = now()
   where reservation_id = r.reservation_id
  returning * into r;

  if r.billing_source = 'trial' then
    if v_credits > r.reserved_credits then
      insert into public.foundation_trial_daily_budget (budget_day, observed_overage_units)
      values (r.created_at::date, v_credits - r.reserved_credits)
      on conflict (budget_day) do update
        set observed_overage_units = public.foundation_trial_daily_budget.observed_overage_units + excluded.observed_overage_units,
            updated_at = now();
    end if;
    select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
    select coalesce(sum(settled_credits), 0) into v_trial_total
      from public.foundation_compute_reservations
     where user_id = r.user_id and billing_source = 'trial'
       and state in ('settled', 'operator_review');
    if v_policy.policy_key is not null and v_trial_total >= v_policy.page_limit * 4 then
      update public.foundation_self_service_trials
         set status = 'expired', ended_reason = 'TRIAL_PAGE_QUOTA_EXHAUSTED', updated_at = now()
       where user_id = r.user_id and status = 'trialing';
    end if;
  end if;

  return public.foundation_compute_settlement_receipt(r, 'processed', v_released, v_overage);
end;
$$;

-- A compile that settles `failed` produced no world. Every document in it whose source no `ready`
-- or `review_required` compile has ever used -- through this document or through another read of
-- the same bytes in this workspace -- gets its page charge back, once. (A world built from a
-- refunded twin is paid for by this read: OC-3 does not charge the twin while this one is live,
-- so refunding this one too would leave the world free.) A paid account gets
-- the credits returned to its balance; owner and trial reads moved no balance, so the reversal
-- is recorded and nothing else moves. `cancelled` is the customer's own stop and reverses nothing.
create function public.reverse_foundation_compute_for_failed_compile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.foundation_compute_reservations%rowtype;
  v_outstanding integer;
  v_overage_back integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || new.workspace_key, 0));
  for r in
    select c.* from public.foundation_compute_reservations c
     where c.workspace_key = new.workspace_key
       and c.document_id::text = any (new.document_ids)
       and c.state = 'settled' and c.settled_credits > 0 and c.reversed_at is null
       and c.charge_basis is not null
       and not exists (
         select 1 from public.foundation_compile_jobs j
           join public.foundation_compute_reservations u
             on u.workspace_key = j.workspace_key and u.document_id::text = any (j.document_ids)
          where j.workspace_key = new.workspace_key
            and j.state in ('ready', 'review_required')
            and (u.document_id = c.document_id or u.metered_source_sha256 = c.metered_source_sha256))
     for update of c
  loop
    v_overage_back := 0;
    if r.billing_source = 'paid' then
      -- Settlement took min(charge, hold) from the balance and booked the rest as overage units.
      -- ponytail: nothing drains overage_units today. If a billing report ever has, only the
      -- overage still outstanding is reversed, and reversed_credits records the smaller amount.
      select overage_units into v_outstanding from public.foundation_billing_accounts
       where workspace_key = new.workspace_key for update;
      v_overage_back := least(greatest(0, r.settled_credits - r.reserved_credits), coalesce(v_outstanding, 0));
      update public.foundation_billing_accounts
         set credit_balance = credit_balance + least(r.settled_credits, r.reserved_credits),
             overage_units = overage_units - v_overage_back,
             lifetime_overage_units = lifetime_overage_units - v_overage_back,
             updated_at = now()
       where workspace_key = new.workspace_key;
    end if;
    update public.foundation_compute_reservations
       set reversed_credits = case when r.billing_source = 'paid'
             then least(r.settled_credits, r.reserved_credits) + v_overage_back
             else r.settled_credits end,
           reversal_reason = 'COMPILE_FAILED_NO_OUTPUT',
           reversal_compile_job_id = new.job_id, reversed_at = now(), updated_at = now()
     where reservation_id = r.reservation_id;
  end loop;
  return null;
end;
$$;

create trigger foundation_compile_jobs_reverse_failed_compute
after update of state on public.foundation_compile_jobs
for each row
when (new.state = 'failed' and old.state is distinct from new.state)
execute function public.reverse_foundation_compute_for_failed_compile();

-- OC-3: a compile that reaches `ready` used its documents. Every read in it that a failed compile
-- refunded is charged again, once, for exactly what the refund gave back (rule 4 above) -- unless
-- the workspace already holds a live paid charge for the same bytes: a read of that source settled
-- above 0 and never refunded, or charged again. A workspace pays for a source once (rule 2). The
-- check is made per row inside the loop, so a twin this same loop charged again counts; the
-- earliest-settled refunded read is the one charged.
create function public.recharge_foundation_compute_for_ready_compile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.foundation_compute_reservations%rowtype;
  v_balance integer;
  v_from_balance integer;
  v_overage integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || new.workspace_key, 0));
  for r in
    select c.* from public.foundation_compute_reservations c
     where c.workspace_key = new.workspace_key
       and c.document_id::text = any (new.document_ids)
       and c.reversed_at is not null and c.recharged_at is null
     order by c.settled_at, c.document_id
     for update of c
  loop
    if exists (
      select 1 from public.foundation_compute_reservations p
       where p.workspace_key = r.workspace_key
         and p.reservation_id <> r.reservation_id
         and p.metered_source_sha256 = r.metered_source_sha256
         and p.state = 'settled' and p.settled_credits > 0
         and (p.reversed_at is null or p.recharged_at is not null)) then
      continue;
    end if;
    v_from_balance := 0;
    if r.billing_source = 'paid' then
      -- The reversal gave back least(charge, hold) to the balance and the rest off overage.
      -- ponytail: a balance spent since the refund cannot pay the held part, so that shortfall is
      -- booked as overage even on an account with overage off -- the alternative is a free read.
      select credit_balance into v_balance from public.foundation_billing_accounts
       where workspace_key = new.workspace_key for update;
      v_from_balance := least(least(r.settled_credits, r.reserved_credits), greatest(0, coalesce(v_balance, 0)));
      v_overage := r.reversed_credits - v_from_balance;
      update public.foundation_billing_accounts
         set credit_balance = credit_balance - v_from_balance,
             overage_units = overage_units + v_overage,
             lifetime_overage_units = lifetime_overage_units + v_overage,
             updated_at = now()
       where workspace_key = new.workspace_key;
    end if;
    update public.foundation_compute_reservations
       set recharged_credits = r.reversed_credits, recharged_balance_credits = v_from_balance,
           recharge_compile_job_id = new.job_id, recharged_at = now(), updated_at = now()
     where reservation_id = r.reservation_id;
  end loop;
  return null;
end;
$$;

create trigger foundation_compile_jobs_recharge_ready_compute
after insert or update of state on public.foundation_compile_jobs
for each row
when (new.state = 'ready')
execute function public.recharge_foundation_compute_for_ready_compile();

revoke all on function public.recharge_foundation_compute_for_ready_compile()
  from public, anon, authenticated;
revoke all on function public.foundation_compute_settlement_receipt(public.foundation_compute_reservations, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_foundation_compute_v4(text, uuid, text, integer, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.reverse_foundation_compute_for_failed_compile()
  from public, anon, authenticated;
grant execute on function public.settle_foundation_compute_v4(text, uuid, text, integer, integer, text, text)
  to service_role;

commit;
