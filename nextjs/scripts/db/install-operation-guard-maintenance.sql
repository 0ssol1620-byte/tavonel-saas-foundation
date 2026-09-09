-- Explicit operator step AFTER migration 0055, BEFORE durable application rollout.
-- No provider credentials, HTTP calls, customer content, or changes to unrelated jobs.
-- A missing scheduler fails visibly; it must never be reported as configured by a no-op.
begin;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tavonel-operation-guard-maintenance-v1', 0));
create extension if not exists pg_cron;

do $$
declare
  v_existing record;
  v_command constant text := 'select public.prune_foundation_operations(); select public.prune_foundation_contact_limits();';
begin
  if to_regprocedure('public.prune_foundation_operations()') is null
     or to_regprocedure('public.prune_foundation_contact_limits()') is null then
    raise exception 'OPERATION_GUARD_MIGRATION_REQUIRED';
  end if;
  for v_existing in select * from cron.job where jobname = 'tavonel-operation-guard-prune' loop
    if v_existing.username <> current_user or v_existing.database <> current_database()
       or v_existing.command <> v_command or v_existing.schedule <> '* * * * *' then
      raise exception 'OPERATION_GUARD_JOB_OWNERSHIP_OR_DEFINITION_CONFLICT';
    end if;
  end loop;
  perform cron.schedule('tavonel-operation-guard-prune', '* * * * *', v_command);
end;
$$;

commit;

-- Resource identifiers and cadence only. A configured job is NOT evidence that it ran.
select jobname, schedule, active, database
from cron.job where jobname = 'tavonel-operation-guard-prune';
