-- WO-C-T2 (20261123120000): a member's work draws on the workspace's plan -- the owner's grant and
-- the workspace's billing account -- never the member's own, and never twice.
--
-- Users: 1 owns a Team workspace (20 credits, no overage); 2 is its member, 3 its admin, 7 a stranger.
-- 4 owns a workspace on a free evaluation; 5 owns one covered by an operator grant; 6 is a member of
-- both and holds an operator grant of their own. Every row is rolled back.
begin;
select plan(39);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-c2c2-4c2c-8c2c-c2c2c2c2c2c2')::uuid,
  'authenticated', 'authenticated', 'payer-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 7) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-c2c2-4c2c-8c2c-c2c2c2c2c2c2')::uuid
$$;
-- The workspace the signup trigger bootstraps for user i, owned by user i.
create function pg_temp.ws(i integer) returns text language sql immutable as $$
  select 'pilot-' || left(regexp_replace(pg_temp.uid(i)::text, '[^A-Za-z0-9]', '', 'g'), 16)
$$;
create function pg_temp.join_ws(owner integer, i integer, role text) returns void language sql as $$
  insert into public.foundation_workspace_members (workspace_key, user_id, role, state, invited_by, invited_at, accepted_at, authorization_revision)
  values (pg_temp.ws(owner), pg_temp.uid(i), role, 'active', pg_temp.uid(owner), now(), now(), 1)
$$;
create function pg_temp.doc(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-d0c0-4d0c-8d0c-d0c0d0c0d0c0')::uuid
$$;
create function pg_temp.balance(owner integer) returns integer language sql as $$
  select credit_balance from public.foundation_billing_accounts where workspace_key = pg_temp.ws(owner)
$$;
create function pg_temp.hold(owner integer, actor integer, d integer, reserved integer, maximum integer) returns jsonb language sql as $$
  select public.reserve_foundation_compute_v3(pg_temp.ws(owner), pg_temp.doc(d), pg_temp.uid(actor), reserved, maximum)
$$;
create function pg_temp.settle(owner integer, d integer, outcome text, pages integer, sha text) returns jsonb language sql as $$
  select public.settle_foundation_compute_v4(pg_temp.ws(owner), pg_temp.doc(d), outcome, pages, null,
    case when sha is null then null else 'sha256:' || repeat(sha, 64) end, 'OCR_COMPLETED')
$$;
create function pg_temp.row_of(d integer) returns text language sql as $$
  select user_id::text || '/' || coalesce(actor_user_id::text, '-') from public.foundation_compute_reservations
   where document_id = pg_temp.doc(d)
$$;
create function pg_temp.upload(owner integer, actor integer, d integer) returns jsonb language sql as $$
  select public.reserve_foundation_intake_admission(pg_temp.ws(owner), pg_temp.doc(d), pg_temp.uid(actor),
    'quarantine/' || pg_temp.ws(owner) || '/' || pg_temp.doc(d)::text || '/source', 1024, 'application/pdf',
    '{"personal": 1000000000, "developer": 1000000000, "team": 1000000000, "business": 1000000000}'::jsonb)
$$;

insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status, credit_balance)
values (pg_temp.ws(1), pg_temp.uid(1), 'studio_access', 'team', 'active', 20),
       (pg_temp.ws(5), pg_temp.uid(5), null, null, 'inactive', 0);
select pg_temp.join_ws(1, 2, 'member');
select pg_temp.join_ws(1, 3, 'admin');
select pg_temp.join_ws(4, 6, 'member');
select pg_temp.join_ws(5, 6, 'member');
insert into public.foundation_self_service_trials (user_id, workspace_key, status, expires_at)
values (pg_temp.uid(4), pg_temp.ws(4), 'trialing', now() + interval '7 days');
insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, billing_exempt, trial_exempt)
values (pg_temp.uid(5), 'owner', 'studio_access', true, true),
       (pg_temp.uid(6), 'owner', 'studio_access', true, true);

-- ---------------------------------------------------------------------------
-- 1. Whose plan: the owner's for an admin or member, the caller's own for everyone else.
-- ---------------------------------------------------------------------------
select is(public.foundation_workspace_payer(pg_temp.ws(1), pg_temp.uid(1)), pg_temp.uid(1), 'the owner draws on their own plan');
select is(public.foundation_workspace_payer(pg_temp.ws(1), pg_temp.uid(2)), pg_temp.uid(1), 'a member draws on the owner''s');
select is(public.foundation_workspace_payer(pg_temp.ws(1), pg_temp.uid(3)), pg_temp.uid(1), 'an admin draws on the owner''s');
select is(public.foundation_workspace_payer(pg_temp.ws(1), pg_temp.uid(7)), pg_temp.uid(7), 'a stranger resolves to themselves, as before');

-- ---------------------------------------------------------------------------
-- 2. A member's compile holds and debits the owner's account; the row names payer and actor.
-- ---------------------------------------------------------------------------
select is(pg_temp.hold(1, 2, 1, 12, 18)->>'billingSource', 'paid', 'a member''s hold is paid from the workspace''s account');
select is(pg_temp.balance(1), 8, 'the owner''s balance carries the member''s hold');
select is(pg_temp.row_of(1), pg_temp.uid(1)::text || '/' || pg_temp.uid(2)::text, 'user_id is the payer, actor_user_id the member');
select is(pg_temp.hold(1, 2, 1, 12, 18)->>'idempotentReplay', 'true', 'the member''s retry is a replay');
select throws_ok($$select pg_temp.hold(1, 1, 1, 12, 18)$$, 'foundation_compute_idempotency_conflict',
  'the owner cannot replay the member''s hold as their own');

-- ---------------------------------------------------------------------------
-- 3. One allowance: owner and member holds together admit exactly the balance.
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.hold(1, 1, 2, 12, 18)$$, 'foundation_credits_required',
  'with 8 left the owner cannot hold 12');
select is(pg_temp.hold(1, 1, 2, 8, 12)->>'billingSource', 'paid', 'the owner holds the last 8');
select is(pg_temp.row_of(2), pg_temp.uid(1)::text || '/' || pg_temp.uid(1)::text, 'an owner''s row names the owner twice');
select is(pg_temp.balance(1), 0, 'the allowance is spent once');
select throws_ok($$select pg_temp.hold(1, 2, 3, 4, 6)$$, 'foundation_credits_required',
  'the member is refused at the allowance, not given a second one');

-- ---------------------------------------------------------------------------
-- 4. A revoked member's in-flight hold settles exactly as an owner's would.
-- ---------------------------------------------------------------------------
update public.foundation_workspace_members set state = 'revoked', revoked_at = now()
 where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(2);
select is(pg_temp.settle(1, 1, 'settled', 3, 'a')->>'status', 'processed', 'the revoked member''s read settles');
select is(pg_temp.settle(1, 1, 'settled', 3, 'a')->>'status', 'duplicate', 'and a redelivery is a duplicate');
select is(pg_temp.balance(1), 0, 'three pages charge the whole 12 held, from the owner''s account');
select is(pg_temp.settle(1, 2, 'operator_review', null, null)->>'releasedCredits', '8', 'the owner''s failed read releases its hold');
select is(pg_temp.balance(1), 8, 'the release returns to the one account');
select is(public.foundation_workspace_payer(pg_temp.ws(1), pg_temp.uid(2)), pg_temp.uid(2), 'once revoked, a member is a stranger');
select throws_ok($$select pg_temp.hold(1, 2, 4, 4, 6)$$, 'foundation_subscription_required',
  'a revoked member reserves nothing new');

-- ---------------------------------------------------------------------------
-- 5. A source is paid once per workspace, whoever reads it.
-- ---------------------------------------------------------------------------
select is(pg_temp.hold(1, 3, 5, 4, 6)->>'billingSource', 'paid', 'the admin holds from the same account');
select is(pg_temp.settle(1, 5, 'settled', 3, 'a')->>'chargeBasis', 'unchanged_source',
  'the admin re-reading the member''s bytes is not charged again');
select is((select count(*)::integer from public.foundation_compute_reservations
  where workspace_key = pg_temp.ws(1) and metered_source_sha256 = 'sha256:' || repeat('a', 64)
    and state = 'settled' and settled_credits > 0 and (reversed_at is null or recharged_at is not null)),
  1, 'at most one live paid charge per workspace and source');
select is(pg_temp.balance(1), 8, 'the free re-read releases its hold');

-- ---------------------------------------------------------------------------
-- 6. A member never draws on a free evaluation, and their own grant does not carry.
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.hold(4, 6, 6, 4, 6)$$, 'foundation_subscription_required',
  'a member of a workspace on a free evaluation is refused, own operator grant or not');
select is((select count(*)::integer from public.foundation_compute_reservations where document_id = pg_temp.doc(6)), 0,
  'and nothing is held');
select is(pg_temp.hold(5, 6, 7, 4, 6)->>'billingSource', 'owner', 'the owner''s operator grant covers the member');
select is(pg_temp.row_of(7), pg_temp.uid(5)::text || '/' || pg_temp.uid(6)::text, 'the grant-covered hold names the owner as payer');

-- ---------------------------------------------------------------------------
-- 7. Uploads: the owner's plan decides; the admission keeps the uploader.
-- ---------------------------------------------------------------------------
select is(pg_temp.upload(1, 3, 8)->>'intakeClass', 'paid', 'an admin uploads under the owner''s plan');
select is((select user_id from public.foundation_intake_admissions where document_id = pg_temp.doc(8)), pg_temp.uid(3),
  'the admission records the uploader');
select throws_ok($$select pg_temp.upload(4, 6, 9)$$, 'foundation_subscription_required',
  'a member cannot upload into a free evaluation');
select is(pg_temp.upload(5, 6, 10)->>'intakeClass', 'owner', 'the owner''s grant covers a member''s upload');

-- ---------------------------------------------------------------------------
-- 8. No billing account and no active owner: refused, never the member's own plan. (The one-owner
--    check is deferred to commit, which this rolled-back transaction never reaches.) With an
--    account, the payer is its holder, as foundation_workspace_capped_plan reads it.
-- ---------------------------------------------------------------------------
select is(public.foundation_workspace_payer(pg_temp.ws(5), pg_temp.uid(6)), pg_temp.uid(5), 'with an account, its holder pays');
update public.foundation_workspace_members set state = 'revoked', revoked_at = now()
 where workspace_key = pg_temp.ws(4) and user_id = pg_temp.uid(4);
select throws_ok($$select pg_temp.hold(4, 6, 11, 4, 6)$$, 'foundation_workspace_owner_missing',
  'a workspace with no account and no active owner charges no one');
select throws_ok($$select pg_temp.upload(4, 6, 12)$$, 'foundation_workspace_owner_missing',
  'and admits no upload');
update public.foundation_workspace_members set state = 'active', revoked_at = null
 where workspace_key = pg_temp.ws(4) and user_id = pg_temp.uid(4);

-- ---------------------------------------------------------------------------
-- 9. The query meter was already the workspace's: one allowance for every caller.
-- ---------------------------------------------------------------------------
select is(public.admit_foundation_knowledge_query(pg_temp.ws(1), '{"team": 2}'::jsonb)->>'status', 'admitted', 'first query unit');
select is(public.admit_foundation_knowledge_query(pg_temp.ws(1), '{"team": 2}'::jsonb)->>'status', 'admitted', 'second query unit');
select is(public.admit_foundation_knowledge_query(pg_temp.ws(1), '{"team": 2}'::jsonb)->>'status', 'exhausted',
  'a third, from whoever asks, is refused');

select * from finish();
rollback;
