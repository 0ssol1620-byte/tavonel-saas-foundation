-- A free-compute capability consumes evaluation quota once it is issued.
--
-- Without this database backstop an abusive client could reserve standard units, deliberately let
-- the capability expire, and reserve again. No paid credit would be lost, but enough throw-away
-- reservations could consume the shared free-compute circuit breaker. Count expired/abandoned
-- trial reservations against the user's lifetime evaluation quota; only an explicit release is
-- reusable capacity.
begin;

create or replace function public.guard_foundation_trial_compute_lifetime()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_limit integer;
  v_consumed bigint := 0;
begin
  if new.billing_source <> 'trial' then
    return new;
  end if;

  -- Serialize by user as a second layer underneath the workspace-level lock in the reservation
  -- RPC. The trigger therefore stays correct even if a future server path inserts a trial
  -- reservation through a different workspace-scoped orchestration function.
  perform pg_advisory_xact_lock(hashtextextended('foundation-trial-compute-user:' || new.user_id::text, 0));

  select page_limit * 4 into v_limit
    from public.foundation_trial_policy
   where policy_key = 'default' and enabled = true;
  if v_limit is null then
    raise exception 'foundation_trial_disabled';
  end if;

  select coalesce(sum(
    case
      when state = 'released' then 0
      when state in ('settled', 'operator_review') then coalesce(settled_credits, reserved_credits)
      else reserved_credits
    end
  ), 0)
    into v_consumed
    from public.foundation_compute_reservations
   where user_id = new.user_id
     and billing_source = 'trial';

  if v_consumed + new.reserved_credits > v_limit then
    raise exception 'foundation_trial_page_limit_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists foundation_trial_compute_lifetime_guard
  on public.foundation_compute_reservations;
create trigger foundation_trial_compute_lifetime_guard
before insert on public.foundation_compute_reservations
for each row execute function public.guard_foundation_trial_compute_lifetime();

revoke all on function public.guard_foundation_trial_compute_lifetime()
  from public, anon, authenticated;

grant execute on function public.guard_foundation_trial_compute_lifetime() to service_role;

commit;
