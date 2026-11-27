-- Product measurement and field vitals (WO-AN-RUM-1, migration 20261127100000, provisional slot).
--
-- What it proves: the four tables have RLS on with no policy and no client role can execute the six
-- functions; nothing is recorded without an allowed row; facts are recorded once; a second yes keeps
-- the first enrolment and the first campaign; a withdrawal deletes every fact and the campaign; an
-- unknown event name, an empty call and a malformed path are refused whole; deleting the auth user
-- deletes everything; field vitals are counters with no identifier, and the p75 is the nearest-rank
-- bucket; the D7/D30 read model counts returns only after the first agent read and inside the window.
begin;
select plan(40);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-0a11-4a11-8a11-0a110a110a11')::uuid,
  'authenticated', 'authenticated', 'pm-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 4) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-0a11-4a11-8a11-0a110a110a11')::uuid
$$;
create function pg_temp.subject(i integer) returns uuid language sql stable as $$
  select subject from public.foundation_product_measurement_consents where user_id = pg_temp.uid(i)
$$;
create function pg_temp.facts(i integer) returns bigint language sql stable as $$
  select (select count(*) from public.foundation_product_milestones m
           join public.foundation_product_measurement_consents c on c.subject = m.subject where c.user_id = pg_temp.uid(i))
       + (select count(*) from public.foundation_product_active_days d
           join public.foundation_product_measurement_consents c on c.subject = d.subject where c.user_id = pg_temp.uid(i))
$$;

-- 1. No client reaches anything.
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('foundation_product_measurement_consents', 'foundation_product_milestones',
    'foundation_product_active_days', 'foundation_field_vitals_daily')), 'RLS is on for all four tables');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename in (
  'foundation_product_measurement_consents', 'foundation_product_milestones', 'foundation_product_active_days',
  'foundation_field_vitals_daily')), 0, 'no policy exists on any of them');
select is_empty($$
  select p.proname || ':' || r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where n.nspname = 'public' and p.proname in ('set_product_measurement_consent', 'read_product_measurement_consent',
     'record_product_measurement', 'record_field_vitals', 'product_measurement_summary', 'field_vitals_summary')
     and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
$$, 'neither anon nor authenticated may execute any of the six functions');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('set_product_measurement_consent', 'read_product_measurement_consent',
    'record_product_measurement', 'record_field_vitals', 'product_measurement_summary', 'field_vitals_summary')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')), 6, 'service_role executes all six');

-- 2. Fail closed without consent.
select is(public.record_product_measurement(pg_temp.uid(1), array['first_verified_record']), 'no_consent', 'no row: nothing recorded');
select is((select count(*)::integer from public.foundation_product_milestones), 0, 'and no fact exists');
select is(public.read_product_measurement_consent(pg_temp.uid(1)), null::jsonb, 'no choice reads as null');
select is((public.set_product_measurement_consent(pg_temp.uid(1), false, 'product-measurement-v1', null, null))->>'allowed', 'false', 'a refusal is stored');
select is(public.record_product_measurement(pg_temp.uid(1), array['active_day']), 'no_consent', 'a refusal records nothing');
select is(pg_temp.facts(1), 0::bigint, 'still no fact after a refusal');

-- 3. Allowed: facts once, choice readable without the subject or the campaign.
select is((public.set_product_measurement_consent(pg_temp.uid(2), true, 'product-measurement-v1', 'd35_dev_mcp_en_us', 'ad_1'))->>'allowed', 'true', 'a yes is stored');
select is(public.record_product_measurement(pg_temp.uid(2), array['first_verified_record', 'active_day']), 'recorded', 'facts recorded with consent');
select is(public.record_product_measurement(pg_temp.uid(2), array['first_verified_record', 'active_day']), 'recorded', 'a repeat is accepted');
select is(pg_temp.facts(2), 2::bigint, 'and records nothing twice');
select is((select array_agg(k order by k) from jsonb_object_keys(public.read_product_measurement_consent(pg_temp.uid(2))) k),
  array['allowed', 'decided_at'], 'the read returns the choice and its time only');
select throws_ok($$ select public.record_product_measurement(pg_temp.uid(2), array['page_view']) $$, '22023', null, 'an unknown event is refused');
select throws_ok($$ select public.record_product_measurement(pg_temp.uid(2), array[]::text[]) $$, '22023', null, 'an empty call is refused');
select throws_ok($$ select public.record_product_measurement(pg_temp.uid(2), array['active_day', 'first_agent_read', 'first_verified_record', 'active_day']) $$,
  '22023', null, 'more than three names is refused');
select throws_ok($$ select public.set_product_measurement_consent(pg_temp.uid(3), true, 'v1', null, null) $$, '23514', null, 'a malformed version is refused');
select throws_ok($$ select public.set_product_measurement_consent(pg_temp.uid(3), true, 'product-measurement-v1', 'Has Spaces', null) $$,
  '23514', null, 'a campaign label outside the pattern is refused');

-- 4. A second yes keeps the first enrolment and the first touch.
update public.foundation_product_measurement_consents set enrolled_at = now() - interval '3 days' where user_id = pg_temp.uid(2);
select public.set_product_measurement_consent(pg_temp.uid(2), true, 'product-measurement-v1', 'd35_eng_revision_en_us', null);
select is((select campaign from public.foundation_product_measurement_consents where user_id = pg_temp.uid(2)), 'd35_dev_mcp_en_us', 'the first campaign stays');
select ok((select enrolled_at < now() - interval '2 days' from public.foundation_product_measurement_consents where user_id = pg_temp.uid(2)), 'the first enrolment stays');

-- 5. Withdrawal deletes the facts and the label; a later yes starts a new enrolment.
select public.set_product_measurement_consent(pg_temp.uid(2), false, 'product-measurement-v1', 'd35_dev_mcp_en_us', null);
select is((select count(*)::integer from public.foundation_product_milestones) + (select count(*)::integer from public.foundation_product_active_days), 0, 'withdrawal deletes every fact');
select is((select campaign from public.foundation_product_measurement_consents where user_id = pg_temp.uid(2)), null, 'and the campaign');
select is(public.record_product_measurement(pg_temp.uid(2), array['first_agent_read']), 'no_consent', 'and stops recording');
select public.set_product_measurement_consent(pg_temp.uid(2), true, 'product-measurement-v1', null, null);
select ok((select enrolled_at > now() - interval '1 minute' from public.foundation_product_measurement_consents where user_id = pg_temp.uid(2)), 'a new yes is a new enrolment');

-- 6. Deleting the account deletes everything.
select public.record_product_measurement(pg_temp.uid(2), array['first_agent_read', 'active_day']);
select is((select string_agg(conrelid::regclass::text || '->' || confrelid::regclass::text || ':' || confdeltype, ',' order by conrelid::regclass::text)
  from pg_constraint where contype = 'f' and conrelid in ('public.foundation_product_measurement_consents'::regclass,
    'public.foundation_product_milestones'::regclass, 'public.foundation_product_active_days'::regclass)),
  'foundation_product_active_days->foundation_product_measurement_consents:c,foundation_product_measurement_consents->auth.users:c,foundation_product_milestones->foundation_product_measurement_consents:c',
  'the account deletes its choice, and the choice deletes its facts (cascade)');
delete from public.foundation_product_measurement_consents where user_id = pg_temp.uid(2);
select is((select count(*)::integer from public.foundation_product_milestones) + (select count(*)::integer from public.foundation_product_active_days), 0, 'a deleted choice leaves no fact');

-- 7. The D7/D30 read model. User 3 enrolled 40 days ago, first agent read on day 2, active on day 2
-- (same day as the read: not a return), day 5 (a d7 return) and day 26 (a d30 return). User 4 enrolled
-- 10 days ago, never read, active on day 3: in the d7 denominator, not retained.
select public.set_product_measurement_consent(pg_temp.uid(3), true, 'product-measurement-v1', 'd35_dev_mcp_en_us', null);
select public.set_product_measurement_consent(pg_temp.uid(4), true, 'product-measurement-v1', null, null);
update public.foundation_product_measurement_consents set enrolled_at = date_trunc('day', now()) - interval '40 days' + interval '1 hour' where user_id = pg_temp.uid(3);
update public.foundation_product_measurement_consents set enrolled_at = date_trunc('day', now()) - interval '10 days' + interval '1 hour' where user_id = pg_temp.uid(4);
insert into public.foundation_product_milestones (subject, milestone, occurred_at)
values (pg_temp.subject(3), 'first_agent_read', date_trunc('day', now()) - interval '38 days' + interval '2 hours');
insert into public.foundation_product_active_days (subject, day) values
  (pg_temp.subject(3), (date_trunc('day', now()) - interval '38 days')::date),
  (pg_temp.subject(3), (date_trunc('day', now()) - interval '35 days')::date),
  (pg_temp.subject(3), (date_trunc('day', now()) - interval '14 days')::date),
  (pg_temp.subject(4), (date_trunc('day', now()) - interval '7 days')::date);
select results_eq($$ select campaign, enrolled, first_verified_record, first_agent_read, d7_evaluable, d7_retained, d30_evaluable, d30_retained
  from public.product_measurement_summary(now()) order by campaign collate "C" $$,
  $$ values ('(all)', 2::bigint, 0::bigint, 1::bigint, 2::bigint, 1::bigint, 1::bigint, 1::bigint),
            ('(none)', 1::bigint, 0::bigint, 0::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint),
            ('d35_dev_mcp_en_us', 1::bigint, 0::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint) $$,
  'counts per campaign and in total, with denominators');
delete from public.foundation_product_active_days where subject = pg_temp.subject(3) and day = (date_trunc('day', now()) - interval '35 days')::date;
select is((select d7_retained from public.product_measurement_summary(now()) where campaign = '(all)'), 0::bigint,
  'activity on the day of the first read is not a return');
select is((select d30_evaluable from public.product_measurement_summary(now() - interval '20 days') where campaign = '(all)'), 0::bigint,
  'a window that has not closed by the cutoff is not evaluable');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'foundation_product_milestones'), array['milestone', 'occurred_at', 'subject'],
  'a fact carries a subject, a name and a time, nothing else');

-- 8. Field vitals: counters, nearest-rank p75, refusals.
select public.record_field_vitals('/', 1::smallint, 2::smallint, 0::smallint);
select public.record_field_vitals('/', 1::smallint, null, null);
select is((select samples from public.foundation_field_vitals_daily where path = '/' and metric = 'lcp' and bucket = 1), 2::bigint, 'one counter per bucket, incremented');
select is((select count(*)::integer from public.foundation_field_vitals_daily where path = '/' and metric = 'inp'), 1, 'an unobserved metric adds nothing');
select public.record_field_vitals('/pricing', 3::smallint, null, null);
select public.record_field_vitals('/pricing', 2::smallint, null, null);
select public.record_field_vitals('/pricing', 4::smallint, null, null);
select public.record_field_vitals('/pricing', 1::smallint, null, null);
select is((select p75_bucket from public.field_vitals_summary(current_date - 1, current_date + 1) where path = '/pricing' and metric = 'lcp'),
  3::smallint, 'p75 of {1,2,3,4} is the third sample (nearest rank, no interpolation)');
select is((select samples from public.field_vitals_summary(current_date - 1, current_date + 1) where path = '/pricing' and metric = 'lcp'),
  4::bigint, 'with its sample count');
select throws_ok($$ select public.record_field_vitals('/', null, null, null) $$, '22023', null, 'a call with no metric is refused');
select throws_ok($$ select public.record_field_vitals('/Docs?x=1', 1::smallint, null, null) $$, '22023', null, 'a path with a query is refused');
select throws_ok($$ select public.record_field_vitals('/', 40::smallint, null, null) $$, '23514', null, 'a bucket past 39 is refused');
select throws_ok($$ select * from public.field_vitals_summary(current_date - 100, current_date) $$, '22023', null, 'a range past 92 days is refused');

select * from finish();
rollback;
