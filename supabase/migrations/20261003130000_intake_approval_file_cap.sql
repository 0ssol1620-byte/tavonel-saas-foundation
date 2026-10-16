-- Keep the complete-set approval bound aligned with the workspace's supported 128-file corpus.
-- This migration follows the held initial approval migration so an already-applied candidate can
-- be advanced safely. It does not change quote arithmetic, prices, credits, or reservation rules.
alter table public.foundation_intake_approvals
  drop constraint if exists foundation_intake_approvals_file_count_check;
alter table public.foundation_intake_approvals
  add constraint foundation_intake_approvals_file_count_check
  check (file_count between 1 and 128);

alter table public.foundation_intake_approvals
  drop constraint if exists foundation_intake_approvals_aggregate_maximum_pages_check;
alter table public.foundation_intake_approvals
  add constraint foundation_intake_approvals_aggregate_maximum_pages_check
  check (aggregate_maximum_pages between 1 and 10240);

do $$
declare
  v_definition text;
  v_old text := 'if v_count < 1 or v_count > 20 then';
  v_new text := 'if v_count < 1 or v_count > 128 then';
begin
  v_definition := pg_get_functiondef(
    'public.create_foundation_intake_approval(text,uuid,text,text,text,integer,jsonb)'::regprocedure
  );
  if position(v_new in v_definition) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'foundation_intake_approval_file_cap_definition_unexpected';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$$;
