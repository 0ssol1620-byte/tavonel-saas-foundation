-- WO-AN-RUM-1: consented product measurement (D26) and aggregate field vitals (U19/U43). Expand only.
--
-- Ordering: PROVISIONAL. 20261127100000 is later than every migration on the train head
-- (20261127050000); the lead renames it at merge, together with
-- supabase/drafts/rollback-20261127100000-product-measurement.sql.
--
-- Two separate stores, neither readable by any client role:
--
-- 1. Product measurement, per consenting user. A row in foundation_product_measurement_consents is
--    the user's own choice, made in the workspace. Facts are recorded only while it says allowed:
--    the first verified record, the first agent read (both once), and the UTC days with a qualifying
--    use. Facts are keyed by `subject`, a random id, never by user id, email or workspace; they carry
--    no text, path, question, title or token. Turning it off deletes the facts in the same statement
--    (cascade from a fresh row), and deleting the auth user deletes everything (cascade).
--    The optional campaign label is a registered campaign id the server accepted, nothing else.
--
-- 2. Field vitals, aggregate only. foundation_field_vitals_daily is a counter per (UTC day, public
--    path, metric, bucket). There is no per-visit row, no identifier and no timestamp finer than a
--    day, so nothing here can be joined to a person. Row count is bounded by days x paths x 3 x 40.
--
-- Client access: none. RLS on with no policy; no table privilege for any role. service_role reaches
-- the tables only through the functions below (security definer, empty search_path). The two
-- summary functions return counts only.
begin;

create table public.foundation_product_measurement_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  subject uuid not null unique default gen_random_uuid(),
  allowed boolean not null,
  consent_version text not null check (consent_version ~ '^product-measurement-v[0-9]{1,3}$'),
  decided_at timestamptz not null default clock_timestamp(),
  enrolled_at timestamptz,
  campaign text check (campaign is null or campaign ~ '^[a-z0-9_]{1,64}$'),
  campaign_content text check (campaign_content is null or campaign_content ~ '^[a-z0-9_-]{1,64}$'),
  -- A refusal holds nothing but the refusal; an allowed row always has its enrolment time.
  check (coalesce(case when allowed then enrolled_at is not null
    else enrolled_at is null and campaign is null and campaign_content is null end, false)),
  check (campaign_content is null or campaign is not null)
);

create table public.foundation_product_milestones (
  subject uuid not null references public.foundation_product_measurement_consents (subject) on delete cascade,
  milestone text not null check (milestone in ('first_verified_record', 'first_agent_read')),
  occurred_at timestamptz not null default clock_timestamp(),
  primary key (subject, milestone)
);

create table public.foundation_product_active_days (
  subject uuid not null references public.foundation_product_measurement_consents (subject) on delete cascade,
  day date not null,
  primary key (subject, day)
);

create table public.foundation_field_vitals_daily (
  day date not null,
  path text not null check (path ~ '^/[a-z0-9/_-]{0,80}$'),
  metric text not null check (metric in ('lcp', 'inp', 'cls')),
  bucket smallint not null check (bucket between 0 and 39),
  samples bigint not null check (samples > 0),
  primary key (day, path, metric, bucket)
);

alter table public.foundation_product_measurement_consents enable row level security;
alter table public.foundation_product_milestones enable row level security;
alter table public.foundation_product_active_days enable row level security;
alter table public.foundation_field_vitals_daily enable row level security;
revoke all on public.foundation_product_measurement_consents from public, anon, authenticated, service_role;
revoke all on public.foundation_product_milestones from public, anon, authenticated, service_role;
revoke all on public.foundation_product_active_days from public, anon, authenticated, service_role;
revoke all on public.foundation_field_vitals_daily from public, anon, authenticated, service_role;

-- The user's choice. Allowing twice keeps the first enrolment and the first campaign label (first
-- touch is never overwritten). Refusing or withdrawing replaces the row: the old subject goes, and
-- its facts go with it by cascade, so a withdrawal leaves nothing measured behind.
create function public.set_product_measurement_consent(
  p_user_id uuid, p_allowed boolean, p_version text, p_campaign text, p_campaign_content text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.foundation_product_measurement_consents;
begin
  if p_user_id is null or p_allowed is null or p_version is null then
    raise exception 'product_measurement_request_invalid' using errcode = '22023';
  end if;
  if not p_allowed then
    delete from public.foundation_product_measurement_consents where user_id = p_user_id;
    insert into public.foundation_product_measurement_consents (user_id, allowed, consent_version)
    values (p_user_id, false, p_version)
    returning * into v_row;
  else
    insert into public.foundation_product_measurement_consents
      (user_id, allowed, consent_version, enrolled_at, campaign, campaign_content)
    values (p_user_id, true, p_version, pg_catalog.clock_timestamp(), p_campaign, p_campaign_content)
    on conflict (user_id) do update
      set allowed = true,
          consent_version = excluded.consent_version,
          decided_at = case when public.foundation_product_measurement_consents.allowed
            then public.foundation_product_measurement_consents.decided_at else excluded.decided_at end,
          enrolled_at = coalesce(public.foundation_product_measurement_consents.enrolled_at, excluded.enrolled_at),
          campaign = case when public.foundation_product_measurement_consents.allowed
            then public.foundation_product_measurement_consents.campaign else excluded.campaign end,
          campaign_content = case when public.foundation_product_measurement_consents.allowed
            then public.foundation_product_measurement_consents.campaign_content else excluded.campaign_content end
    returning * into v_row;
  end if;
  return pg_catalog.jsonb_build_object('allowed', v_row.allowed, 'decided_at', v_row.decided_at);
end;
$$;

-- The caller's own choice, or null when none was made. Returns no subject and no campaign.
create function public.read_product_measurement_consent(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('allowed', c.allowed, 'decided_at', c.decided_at)
    from public.foundation_product_measurement_consents c
   where c.user_id = p_user_id;
$$;

-- Records facts for a user only while that user's row says allowed. Every name is checked before
-- the consent is read, so an invalid call is refused whoever makes it. Returns 'recorded' or
-- 'no_consent'; repeating a call records nothing twice.
create function public.record_product_measurement(p_user_id uuid, p_events text[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject uuid;
begin
  if p_user_id is null or p_events is null or pg_catalog.cardinality(p_events) not between 1 and 3
     or exists (select 1 from pg_catalog.unnest(p_events) as e(name)
                 where e.name is null or e.name not in ('first_verified_record', 'first_agent_read', 'active_day')) then
    raise exception 'product_measurement_request_invalid' using errcode = '22023';
  end if;
  select c.subject into v_subject
    from public.foundation_product_measurement_consents c
   where c.user_id = p_user_id and c.allowed;
  if v_subject is null then
    return 'no_consent';
  end if;
  insert into public.foundation_product_milestones (subject, milestone)
  select distinct v_subject, e.name from pg_catalog.unnest(p_events) as e(name) where e.name <> 'active_day'
  on conflict (subject, milestone) do nothing;
  if 'active_day' = any (p_events) then
    insert into public.foundation_product_active_days (subject, day)
    values (v_subject, (pg_catalog.clock_timestamp() at time zone 'UTC')::date)
    on conflict (subject, day) do nothing;
  end if;
  return 'recorded';
end;
$$;

-- One page load's three buckets, added to today's counters. A null bucket is a metric the browser
-- did not observe and adds nothing; at least one must be present.
create function public.record_field_vitals(p_path text, p_lcp smallint, p_inp smallint, p_cls smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_path is null or p_path !~ '^/[a-z0-9/_-]{0,80}$' or coalesce(p_lcp, p_inp, p_cls) is null then
    raise exception 'field_vitals_request_invalid' using errcode = '22023';
  end if;
  insert into public.foundation_field_vitals_daily (day, path, metric, bucket, samples)
  select (pg_catalog.clock_timestamp() at time zone 'UTC')::date, p_path, m.metric, m.bucket, 1
    from (values ('lcp', p_lcp), ('inp', p_inp), ('cls', p_cls)) as m(metric, bucket)
   where m.bucket is not null
  on conflict (day, path, metric, bucket)
    do update set samples = public.foundation_field_vitals_daily.samples + 1;
end;
$$;

-- The read model for D26 and D35: counts per campaign label plus one '(all)' row, never a subject.
-- Retention (WO-EXT-07 spec section 6 at day resolution): anchor A = enrolment day (UTC); a return is
-- an active day strictly after the day of the first agent read; d7 = a return with A+1 <= day <= A+7,
-- evaluable once A + 8 days <= cutoff; d30 = a return with A+24 <= day <= A+30, evaluable once
-- A + 31 days <= cutoff. Denominators include accounts that never reached a first agent read.
create function public.product_measurement_summary(p_cutoff timestamptz)
returns table (
  campaign text, enrolled bigint, first_verified_record bigint, first_agent_read bigint,
  d7_evaluable bigint, d7_retained bigint, d30_evaluable bigint, d30_retained bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select k.subject, coalesce(k.campaign, '(none)') as campaign, k.enrolled_at,
           (k.enrolled_at at time zone 'UTC')::date as a
      from public.foundation_product_measurement_consents k
     where k.allowed and k.enrolled_at <= p_cutoff
  ), m as (
    select c.*,
           (select x.occurred_at from public.foundation_product_milestones x
             where x.subject = c.subject and x.milestone = 'first_verified_record' and x.occurred_at <= p_cutoff) as fvr,
           (select x.occurred_at from public.foundation_product_milestones x
             where x.subject = c.subject and x.milestone = 'first_agent_read' and x.occurred_at <= p_cutoff) as far
      from c
  ), r as (
    select m.*,
           exists (select 1 from public.foundation_product_active_days d
                    where d.subject = m.subject and d.day > (m.far at time zone 'UTC')::date
                      and d.day between m.a + 1 and m.a + 7 and d.day <= (p_cutoff at time zone 'UTC')::date) as ret7,
           exists (select 1 from public.foundation_product_active_days d
                    where d.subject = m.subject and d.day > (m.far at time zone 'UTC')::date
                      and d.day between m.a + 24 and m.a + 30 and d.day <= (p_cutoff at time zone 'UTC')::date) as ret30
      from m
  )
  select coalesce(r.campaign, '(all)'), count(*), count(r.fvr), count(r.far),
         count(*) filter (where r.enrolled_at + interval '8 days' <= p_cutoff),
         count(*) filter (where r.enrolled_at + interval '8 days' <= p_cutoff and r.ret7),
         count(*) filter (where r.enrolled_at + interval '31 days' <= p_cutoff),
         count(*) filter (where r.enrolled_at + interval '31 days' <= p_cutoff and r.ret30)
    from r
   group by grouping sets ((r.campaign), ())
   order by 1;
$$;

-- Field p75 per (path, metric) over an inclusive UTC day range of at most 92 days: the bucket that
-- holds the nearest-rank 75th percentile sample (smallest bucket whose running count reaches
-- ceil(0.75 n)). The caller converts a bucket to its range; the samples column is n.
create function public.field_vitals_summary(p_from date, p_to date)
returns table (path text, metric text, samples bigint, p75_bucket smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'field_vitals_range_invalid' using errcode = '22023';
  end if;
  return query
  with t as (
    select v.path, v.metric, v.bucket, sum(v.samples)::bigint as n
      from public.foundation_field_vitals_daily v
     where v.day between p_from and p_to
     group by v.path, v.metric, v.bucket
  ), w as (
    select t.*, sum(t.n) over (partition by t.path, t.metric order by t.bucket) as running,
           sum(t.n) over (partition by t.path, t.metric) as total
      from t
  )
  select w.path, w.metric, max(w.total)::bigint,
         min(w.bucket) filter (where w.running >= ceil(0.75 * w.total))::smallint
    from w
   group by w.path, w.metric
   order by w.path, w.metric;
end;
$$;

revoke all on function public.set_product_measurement_consent(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.read_product_measurement_consent(uuid) from public, anon, authenticated;
revoke all on function public.record_product_measurement(uuid, text[]) from public, anon, authenticated;
revoke all on function public.record_field_vitals(text, smallint, smallint, smallint) from public, anon, authenticated;
revoke all on function public.product_measurement_summary(timestamptz) from public, anon, authenticated;
revoke all on function public.field_vitals_summary(date, date) from public, anon, authenticated;
grant execute on function public.set_product_measurement_consent(uuid, boolean, text, text, text) to service_role;
grant execute on function public.read_product_measurement_consent(uuid) to service_role;
grant execute on function public.record_product_measurement(uuid, text[]) to service_role;
grant execute on function public.record_field_vitals(text, smallint, smallint, smallint) to service_role;
grant execute on function public.product_measurement_summary(timestamptz) to service_role;
grant execute on function public.field_vitals_summary(date, date) to service_role;

commit;
