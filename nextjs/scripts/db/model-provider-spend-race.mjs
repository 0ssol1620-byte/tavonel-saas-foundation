import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

// Deliberately loopback-only. This script is a rehearsal on a fresh disposable database, never a
// production load test. It writes append-only ledger rows it cannot remove, so it refuses to run
// against any database that already carries an active global budget or a live reservation.
if (process.env.MODEL_PROVIDER_SPEND_RACE_TEST !== '1') throw new Error('Explicit local rehearsal opt-in required');
// Only the disposable stack db-rehearsal.yml starts is accepted: loopback port 54322, password postgres.
const LOCAL_PORT = '54322', LOCAL_PASSWORD = 'postgres';
if (process.env.PGPORT !== undefined && process.env.PGPORT !== LOCAL_PORT) {
  throw new Error(`PGPORT must be unset or exactly ${LOCAL_PORT}`);
}
if (process.env.PGPASSWORD !== LOCAL_PASSWORD) throw new Error('PGPASSWORD must be the disposable local stack password');
// Loopback, port and password do not prove disposability: a developer's own PostgreSQL service can
// answer on all three. db-rehearsal.yml writes a fresh random marker into the stack it just started
// (via the DB_URL `supabase status` printed for that stack) and hands it over here; nothing is
// written unless the connected database holds exactly that marker.
const marker = process.env.MODEL_PROVIDER_SPEND_RACE_MARKER ?? '';
if (!/^tavonel-disposable-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(marker)) {
  throw new Error('MODEL_PROVIDER_SPEND_RACE_MARKER from the CI fresh-stack step is required');
}
const port = LOCAL_PORT;
// One root-owned system binary, never PATH lookup or an override: the runner's postgresql-client.
const executable = '/usr/bin/psql';
if (!existsSync(executable)) throw new Error(`Trusted psql not found at ${executable}`);
// No PG* variable reaches psql except the known local password. PGHOSTADDR, PGSERVICE, PGPASSFILE
// and friends could otherwise redirect or re-authenticate a connection that names 127.0.0.1.
const childEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key))),
  PGPASSWORD: LOCAL_PASSWORD,
};
const conninfo = appName => `host=127.0.0.1 hostaddr=127.0.0.1 port=${port} user=postgres dbname=postgres connect_timeout=5 application_name=${appName}`;
const quote = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const GLOBAL_LOCK_KEY = "hashtextextended('model_provider_spend:global', 0)";

function launch(appName) {
  return spawn(executable, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', conninfo(appName)],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: childEnv });
}
// Every call is its own psql subprocess, so its own server connection.
function psql(text, appName) {
  return new Promise((resolve, reject) => {
    const child = launch(appName);
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => resolve({ code, out: out.trim(), err }));
    child.stdin.end(text);
  });
}
async function sql(text, appName = `${prefix}-ctl`) {
  const result = await psql(text, appName);
  if (result.code !== 0) throw new Error(`local SQL failed (${result.code}): ${result.err.slice(0, 1000)}`);
  return result.out;
}
// A session that takes the global spend lock and keeps it until release() ends its input.
function openLockHolder(appName) {
  const child = launch(appName);
  let out = '', err = '', released = false;
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  child.stdin.on('error', () => {});
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve({ code, out: out.trim(), err }));
  });
  child.stdin.write(`select pg_advisory_lock(${GLOBAL_LOCK_KEY});\n`);
  return {
    release() {
      if (!released) { released = true; child.stdin.end(`select pg_advisory_unlock(${GLOBAL_LOCK_KEY});\n`); }
      return closed;
    },
  };
}
async function waitFor(label, probe, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(200);
  }
}
// Advisory locks on a bigint key appear in pg_locks split into classid (high) and objid (low).
const globalLockSessions = (granted, appNames) => `
  select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
   cross join (select ${GLOBAL_LOCK_KEY} as k) lock_key
   where l.locktype = 'advisory' and l.objsubid = 1 and l.granted = ${granted}
     and l.database = (select oid from pg_database where datname = current_database())
     and l.classid::bigint = (lock_key.k >> 32) & 4294967295
     and l.objid::bigint = lock_key.k & 4294967295
     and a.application_name in (${appNames.map(quote).join(',')});`;

const run = randomUUID().replaceAll('-', '').slice(0, 16);
const prefix = `mps-race-${run}`;
const provider = `race-provider-${run}`;
const model = `race-model-${run}`;
const meter = `race_meter_${run}`;
const priceVersion = `race-${run}`;
const UNIT_MICROUSD = 500, UNITS = 10, COST = UNIT_MICROUSD * UNITS;
const tenant = side => ({
  id: `race-${side}-${run}`,
  requestKey: `race-req-${side}-${run}`,
  digest: `sha256:${createHash('sha256').update(`${prefix}:${side}`).digest('hex')}`,
});
const oldTenant = tenant('old'), newTenant = tenant('new');
const reserveSql = (who, seconds) => `set role service_role; select public.reserve_model_provider_spend_v1(${
  [who.id, who.requestKey, who.digest, provider, model, meter].map(quote).join(',')}, ${UNITS}, ${seconds});`;
const holderApp = `${prefix}-holder`, settleApp = `${prefix}-settle`, reserveApp = `${prefix}-reserve`;

const checks = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
let holder = null, wroteFixtures = false;
const pending = [];
try {
  const versionNum = Number(await sql('show server_version_num;'));
  assert.equal(Math.floor(versionNum / 10000), 17, `PostgreSQL 17 required, server reports ${versionNum}`);
  const version = await sql('show server_version;');
  passed(`PostgreSQL ${version}`);
  assert.equal(await sql(`select count(*) from pg_constraint
    where conrelid = 'public.model_provider_spend_reservations'::regclass
      and conname = 'model_provider_spend_reservation_lifecycle_v3';`), '1');
  passed('queued-expiry lifecycle_v3 constraint is installed');

  // Precondition and fixtures commit together under the global spend lock, so no other writer
  // can slip a budget or reservation in between the check and the inserts.
  await sql(`begin;
    select pg_advisory_xact_lock(${GLOBAL_LOCK_KEY});
    do $race$
    declare v_budgets bigint; v_live bigint;
    begin
      -- A database without the marker table errors here too: either way nothing is written.
      if not exists (select 1 from tavonel_ci_fixture.disposable_marker where value = ${quote(marker)}) then
        raise exception 'model_provider_spend_race_requires_ci_disposable_marker';
      end if;
      select count(*) into v_budgets from public.model_provider_spend_budgets
       where scope_kind = 'global' and enabled and period_end > clock_timestamp();
      select count(*) into v_live from public.model_provider_spend_reservations
       where state in ('queued', 'reserved');
      if v_budgets <> 0 or v_live <> 0 then
        raise exception 'model_provider_spend_race_requires_fresh_database: % active global budget(s), % live reservation(s)',
          v_budgets, v_live;
      end if;
    end
    $race$;
    insert into public.model_provider_prices
      (provider, model, meter, price_version, unit_microusd, effective_from, enabled)
    values (${[provider, model, meter, priceVersion].map(quote).join(',')}, ${UNIT_MICROUSD},
            clock_timestamp() - interval '1 minute', true);
    insert into public.model_provider_spend_budgets
      (scope_kind, tenant_id, period_start, period_end, spend_limit_microusd, concurrency_limit, enabled)
    select scope_kind, tenant_id, clock_timestamp() - interval '1 minute',
           clock_timestamp() + interval '10 minutes', 1000000, 4, true
      from (values ('global', null), ('tenant', ${quote(oldTenant.id)}), ('tenant', ${quote(newTenant.id)}))
           as budget(scope_kind, tenant_id);
    commit;`);
  wroteFixtures = true;
  passed('fresh database: no prior active global budget or live reservation; synthetic price and budgets created');

  const held = JSON.parse(await sql(reserveSql(oldTenant, 1)));
  assert.equal(held.status, 'reserved');
  assert.equal(held.tenantId, oldTenant.id);
  assert.equal(held.reservedMicrousd, COST);
  assert.equal(typeof held.expiresAt, 'string');
  const oldId = held.reservationId;
  passed('one reservation admitted with a one-second hold');

  // The database clock, not this process's clock, decides expiry.
  await waitFor('the one-second hold to expire', async () => await sql(`select expires_at <= clock_timestamp()
    from public.model_provider_spend_reservations where reservation_id = ${quote(oldId)}::uuid;`) === 't');
  assert.equal(await sql(`select r.state || ':' || (select count(*) from public.model_provider_spend_ledger l
      where l.reservation_id = r.reservation_id and l.entry_kind = 'expire')
    from public.model_provider_spend_reservations r where r.reservation_id = ${quote(oldId)}::uuid;`), 'reserved:0');
  passed('hold is past its expiry and nothing has expired it yet');

  holder = openLockHolder(holderApp);
  await waitFor('the holder to take the global spend lock',
    async () => await sql(globalLockSessions(true, [holderApp])) === '1');
  passed('global spend advisory lock held by an independent session');

  // Neither call is provider work: settlement releases zero units, and the reserve only admits.
  const settling = psql(`set role service_role; select public.settle_model_provider_spend_v1(${
    quote(oldTenant.id)}, ${quote(oldId)}::uuid, 'released', 0, 'RACE_TEST_RELEASE');`, settleApp);
  const reserving = psql(reserveSql(newTenant, 30), reserveApp);
  pending.push(settling, reserving);
  await waitFor('settlement and the other tenant\'s reserve to queue on the global lock',
    async () => await sql(globalLockSessions(false, [settleApp, reserveApp])) === '2');
  passed('settlement and a different-tenant reserve both wait on the same global lock');

  const unlocked = await holder.release();
  assert.equal(unlocked.code, 0, `lock holder failed: ${unlocked.err.slice(0, 1000)}`);
  assert.equal(unlocked.out.split('\n').pop(), 't');
  const [settled, reserved] = await Promise.all([settling, reserving]);

  let order;
  if (settled.code === 0) {
    const receipt = JSON.parse(settled.out);
    assert.equal(receipt.status, 'expired');
    assert.equal(receipt.reservationId, oldId);
    assert.equal(receipt.refundedMicrousd, COST);
    order = 'settlement first: settlement expired and refunded the hold';
  } else {
    assert.match(settled.err, /model_provider_reservation_not_active/,
      `unexpected settlement failure: ${settled.err.slice(0, 1000)}`);
    order = 'reserve first: the admission sweep expired and refunded the hold';
  }
  passed(`settlement outcome is one of the two lock orders (${order})`);

  assert.equal(reserved.code, 0, `different-tenant reserve failed: ${reserved.err.slice(0, 1000)}`);
  const admitted = JSON.parse(reserved.out);
  assert.equal(admitted.status, 'reserved');
  assert.equal(admitted.tenantId, newTenant.id);
  assert.equal(admitted.idempotentReplay, false);
  passed('different tenant admitted after the lock is released');

  assert.equal(await sql(`select state || ':' || coalesce(reason_code, '')
    from public.model_provider_spend_reservations where reservation_id = ${quote(oldId)}::uuid;`),
  'expired:RESERVATION_EXPIRED');
  assert.equal(await sql(`select count(*) from public.model_provider_spend_ledger
    where reservation_id = ${quote(oldId)}::uuid and entry_kind = 'expire';`), '1');
  assert.equal(await sql(`select string_agg(entry_kind || ':' || reserved_delta_microusd || ':' || spent_delta_microusd,
      ',' order by entry_id)
    from public.model_provider_spend_ledger where reservation_id = ${quote(oldId)}::uuid;`),
  `reserve:${COST}:0,expire:-${COST}:0`);
  passed('old hold ends expired with exactly one expire refund and no spend');

  assert.equal(await sql(`select state from public.model_provider_spend_reservations
    where reservation_id = ${quote(admitted.reservationId)}::uuid;`), 'reserved');
  assert.equal(await sql(`select string_agg(entry_kind || ':' || reserved_delta_microusd, ',' order by entry_id)
    from public.model_provider_spend_ledger where reservation_id = ${quote(admitted.reservationId)}::uuid;`),
  `reserve:${COST}`);
  passed('new tenant holds exactly one reserve entry');

  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, serverVersion: version, lockOrder: order,
    scope: 'isolated loopback database; no provider call, no charge' }));
} finally {
  // Releasing the lock lets any still-waiting call finish, so no psql child is left behind.
  if (holder) await holder.release().catch(() => {});
  await Promise.allSettled(pending);
  // Nothing is deleted. The ledger is append-only and references the reservations, which in turn
  // reference the price; budgets and tenant turns stay alongside them as the run's receipt.
  if (wroteFixtures) {
    console.log(`NOTICE synthetic rows from run ${prefix} remain in this disposable database and must be ` +
      'discarded with its stack: 1 price, 3 budgets (1 global, active for 10 minutes), up to 2 reservations ' +
      '(one still reserved), their ledger entries, and tenant turns for ' +
      `${oldTenant.id} and ${newTenant.id}. Rerunning against the same database is refused by design.`);
  }
}
