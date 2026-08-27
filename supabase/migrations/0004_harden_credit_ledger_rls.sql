-- Apply only to the dedicated foundation project. Both tables are internal command/ledger state,
-- so this makes their browser-facing default-deny posture explicit as well as privilege-based.
begin;

create policy credit_ledger_entries_no_client_access on public.credit_ledger_entries
  as restrictive for all to anon, authenticated using (false) with check (false);

create policy gpu_job_reservations_no_client_access on public.gpu_job_reservations
  as restrictive for all to anon, authenticated using (false) with check (false);

commit;
