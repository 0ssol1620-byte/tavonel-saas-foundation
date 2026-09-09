begin;
select plan(1);
do $$
begin
  assert not has_function_privilege('anon', 'public.claim_cdr_identity_request(uuid)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.claim_cdr_identity_request(uuid)', 'EXECUTE');
  assert has_function_privilege('service_role', 'public.claim_cdr_identity_request(uuid)', 'EXECUTE');
  assert not has_table_privilege('service_role', 'public.foundation_cdr_identity_requests', 'SELECT');
  assert (select relrowsecurity from pg_class where oid='public.foundation_cdr_identity_requests'::regclass);
end $$;
set local role service_role;
do $$
declare i integer;
begin
  assert not public.claim_cdr_identity_request(null);
  assert public.claim_cdr_identity_request('11111111-1111-4111-8111-111111111111');
  assert not public.claim_cdr_identity_request('11111111-1111-4111-8111-111111111111');
  for i in 1..59 loop
    assert public.claim_cdr_identity_request(('22222222-2222-4222-8222-' || lpad(i::text,12,'0'))::uuid);
  end loop;
  assert not public.claim_cdr_identity_request('33333333-3333-4333-8333-333333333333');
end $$;
reset role;
update public.foundation_cdr_identity_requests set issued_at=clock_timestamp()-interval '4 minutes';
set local role service_role;
do $$ begin
  assert public.claim_cdr_identity_request('33333333-3333-4333-8333-333333333333');
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.foundation_cdr_identity_requests)=1;
end $$;
select ok(true, 'identity replay, rate, retention and service-only guards passed');
select * from finish();
rollback;
