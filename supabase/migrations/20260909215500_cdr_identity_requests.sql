-- Service-only replay and issuance budget. Contains no token or document data.
create table public.foundation_cdr_identity_requests (
  request_id uuid primary key,
  issued_at timestamptz not null default clock_timestamp()
);
alter table public.foundation_cdr_identity_requests enable row level security;
revoke all on public.foundation_cdr_identity_requests from public, anon, authenticated, service_role;

create function public.claim_cdr_identity_request(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz;
begin
  if p_request_id is null then return false; end if;
  -- Serialize only this small global token-issuance budget, not customer operations.
  perform pg_catalog.pg_advisory_xact_lock(9172300910);
  v_now := pg_catalog.clock_timestamp();
  delete from public.foundation_cdr_identity_requests where issued_at < v_now - interval '3 minutes';
  if exists(select 1 from public.foundation_cdr_identity_requests where request_id = p_request_id)
    or (select count(*) from public.foundation_cdr_identity_requests where issued_at >= v_now - interval '1 minute') >= 60 then
    return false;
  end if;
  insert into public.foundation_cdr_identity_requests(request_id, issued_at) values (p_request_id, v_now);
  return true;
end;
$$;
revoke all on function public.claim_cdr_identity_request(uuid) from public, anon, authenticated;
grant execute on function public.claim_cdr_identity_request(uuid) to service_role;
