-- prepare_founder_test_reset inserts a ledger row before it can seal a reset.
-- The original table required state but did not assign the initial value, so
-- dry-run failed with a NOT NULL violation before returning an inventory.
alter table public.founder_test_reset_ledger
  alter column state set default 'prepared';
