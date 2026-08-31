-- Audit fix (independent review of 0020_retrieval_foundation.sql): the compile-run FK
-- into foundation_world_versions matched any lifecycle_status, so a retrieval compile
-- run could be created against an already-superseded world version with nothing to stop
-- it. A row that already exists must stay valid even after its world is later superseded
-- (that is the correct historical record), so this cannot be an ordinary CHECK constraint
-- — it must gate creation, not existence. A BEFORE INSERT trigger does exactly that.
begin;

create or replace function public.enforce_foundation_retrieval_compile_run_active_world()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.foundation_world_versions
    where workspace_key = new.workspace_key
      and collection_id = new.collection_id
      and manifest_digest = new.world_manifest_digest
      and lifecycle_status = 'active'
  ) then
    raise exception 'retrieval_compile_run_requires_active_world';
  end if;
  return new;
end;
$$;

create trigger foundation_retrieval_compile_runs_require_active_world
  before insert on public.foundation_retrieval_compile_runs
  for each row execute function public.enforce_foundation_retrieval_compile_run_active_world();

commit;
