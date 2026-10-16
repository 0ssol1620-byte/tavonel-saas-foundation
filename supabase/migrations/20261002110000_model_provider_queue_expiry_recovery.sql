-- Recover the fair queue from stale queued reservations.
-- reserve_model_provider_spend_v1 sweeps queued rows older than 15 minutes to state 'expired' with
-- reason QUEUE_EXPIRED. Those rows were never admitted, so they keep a null admission and expiry
-- and the sweep writes no ledger entry for them. lifecycle_v2 required every row outside
-- queued/rejected to be admitted, so the sweep raised a check violation and aborted every later
-- reservation call once any queued row went stale. lifecycle_v3 keeps every v2 branch and adds
-- exactly one shape: a never-admitted, unpending queue expiry. The reason is compared with
-- `is not distinct from` so a null reason cannot satisfy the branch through three-valued logic.
-- Rerunnable: v3 is dropped and recreated, and v2 is dropped only while it still exists. Both
-- earlier model-provider migrations are left unchanged.
begin;

alter table public.model_provider_spend_reservations
  drop constraint if exists model_provider_spend_reservation_lifecycle_v3;
alter table public.model_provider_spend_reservations
  add constraint model_provider_spend_reservation_lifecycle_v3 check (
    (state in ('queued', 'rejected') and admitted_at is null and expires_at is null
      and not reconciliation_pending) or
    (state = 'expired' and reason_code is not distinct from 'QUEUE_EXPIRED'
      and admitted_at is null and expires_at is null and not reconciliation_pending) or
    (state not in ('queued', 'rejected') and admitted_at is not null and
      ((expires_at is not null and not reconciliation_pending) or
       (state = 'reserved' and expires_at is null and reconciliation_pending)))
  );
alter table public.model_provider_spend_reservations
  drop constraint if exists model_provider_spend_reservation_lifecycle_v2;

commit;
