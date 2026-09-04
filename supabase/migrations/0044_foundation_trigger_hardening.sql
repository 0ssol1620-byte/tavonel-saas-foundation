-- 0044 — harden pre-existing internal trigger helpers surfaced by the live advisor.
begin;

alter function public.reject_foundation_job_event_mutation() set search_path = public, pg_temp;
revoke all on function public.foundation_enable_subscription_overage() from public, anon, authenticated;
grant execute on function public.foundation_enable_subscription_overage() to service_role;

commit;
