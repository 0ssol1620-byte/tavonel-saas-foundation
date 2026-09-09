import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Deliberately loopback-only. This script is a rehearsal, never a production load test.
if (process.env.LOCAL_OPERATION_GUARD_TEST !== '1') throw new Error('Explicit local rehearsal opt-in required');
const port = process.env.PGPORT || '55439';
if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid local database port');
const executable = process.env.PSQL_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/17/bin/psql.exe' : 'psql');
const quote = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
function sql(text) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-X', '-qAt', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PGCONNECT_TIMEOUT: '5' } });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`local SQL failed (${code}): ${err.slice(0, 1000)}`)));
    child.stdin.end(text);
  });
}
const prefix = `guard-test-${randomUUID()}`;
const contactKeys = Array.from({length:4},(_,i)=>createHash('sha256').update(`${prefix}:contact:${i}`).digest('hex'));
const key = 'a'.repeat(64), digest = 'b'.repeat(64);
const acquire = async (workspace, scope, owner, requestKey = null, bodyDigest = null) => JSON.parse(await sql(
  `set role service_role; select public.acquire_foundation_operation(${[workspace, scope, owner, requestKey, bodyDigest].map(quote).join(',')});`));
const finish = async (workspace, owner, ciphertext = null) => sql(
  `set role service_role; select public.finish_foundation_operation(${[workspace, 'ask', owner, ciphertext].map(quote).join(',')});`);
const checks = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  const version = await sql('show server_version;');
  assert.match(version, /^17\./); passed(`PostgreSQL ${version}`);
  for (const [scope, limit] of [['ask',4], ['export',2]]) {
    const results = await Promise.all(Array.from({length:20}, () => acquire(`${prefix}-${scope}`, scope, randomUUID())));
    assert.equal(results.filter(r => r.code === 'ACQUIRED').length, limit);
    assert.equal(results.filter(r => r.code === 'WORKSPACE_CONCURRENCY_LIMIT').length, 20-limit);
    passed(`${scope}: 20 independent database connections admit exactly ${limit}`);
  }
  const owners = Array.from({length:12},()=>randomUUID());
  const requests = await Promise.all(owners.map(owner=>acquire(`${prefix}-key`, 'ask', owner, key, digest)));
  assert.equal(requests.filter(r=>r.code==='ACQUIRED').length,1);
  assert.equal(requests.filter(r=>r.code==='IDEMPOTENCY_IN_PROGRESS').length,11);
  passed('same key: 12 concurrent connections execute once');
  const owner = owners[requests.findIndex(r=>r.code==='ACQUIRED')];
  assert.equal((await acquire(`${prefix}-key`, 'ask', randomUUID(), key, 'c'.repeat(64))).code,'IDEMPOTENCY_CONFLICT');
  passed('same key / different request refuses');
  assert.equal(await finish(`${prefix}-key`, randomUUID()), 'f');
  assert.equal((await acquire(`${prefix}-key`, 'ask', randomUUID(), key, digest)).code,'IDEMPOTENCY_IN_PROGRESS');
  passed('foreign owner cannot release another lease');
  const ciphertext = 'synthetic-database-fixture-not-customer-content'.repeat(2);
  assert.equal(await finish(`${prefix}-key`, owner, ciphertext), 't');
  const replay = await acquire(`${prefix}-key`, 'ask', randomUUID(), key, digest);
  assert.deepEqual(replay,{code:'REPLAY',ciphertext}); passed('completion releases capacity and preserves replay');
  assert.equal(await finish(`${prefix}-key`, owner), 'f');
  passed('finally/repeated release cannot delete a completed replay');
  const staleOwner = randomUUID(), nextOwner=randomUUID();
  await acquire(`${prefix}-stale`, 'ask', staleOwner, key, digest);
  await sql(`update public.foundation_operation_leases set expires_at='2000-01-01' where workspace_key=${quote(`${prefix}-stale`)};`);
  assert.equal((await acquire(`${prefix}-stale`, 'ask', nextOwner, key, digest)).code,'ACQUIRED');
  assert.equal(await finish(`${prefix}-stale`, staleOwner, ciphertext),'f');
  assert.equal(await finish(`${prefix}-stale`, staleOwner),'f');
  assert.equal((await acquire(`${prefix}-stale`, 'ask', randomUUID(), key, digest)).code,'IDEMPOTENCY_IN_PROGRESS');
  passed('expired worker fenced from successor completion and release');
  for (const role of ['anon','authenticated']) {
    assert.equal(await sql(`select has_function_privilege(${quote(role)},'public.acquire_foundation_operation(text,text,uuid,text,text)','execute');`),'f');
    assert.equal(await sql(`select has_table_privilege(${quote(role)},'public.foundation_operation_leases','select');`),'f');
  }
  passed('anonymous and authenticated database roles have no RPC or table access');
  assert.equal(await sql("select relrowsecurity from pg_class where oid='public.foundation_operation_leases'::regclass;"),'t');
  passed('row-level security enabled');
  const contact = (ip, domain) => sql(`set role service_role; select public.consume_foundation_contact_limits(${quote(ip)},${quote(domain)});`);
  const admissions = await Promise.all(Array.from({length:20},()=>contact(contactKeys[0],contactKeys[1])));
  assert.equal(admissions.filter(value=>value==='t').length,5);
  assert.equal(admissions.filter(value=>value==='f').length,15);
  passed('contact: 20 connections admit exactly five in a sliding window');
  assert.equal(await contact(contactKeys[2],contactKeys[1]),'f');
  assert.equal(await contact(contactKeys[0],contactKeys[3]),'f');
  passed('contact: changing only IP or only domain does not reset allowance');
  assert.equal(await sql(`select max(cardinality(request_times)) from public.foundation_contact_windows where bucket_key in (${contactKeys.map(quote).join(',')});`),'5');
  passed('contact: rejected traffic cannot grow timestamp arrays');
  for (const role of ['anon','authenticated']) {
    assert.equal(await sql(`select has_function_privilege(${quote(role)},'public.consume_foundation_contact_limits(text,text)','execute');`),'f');
    assert.equal(await sql(`select has_table_privilege(${quote(role)},'public.foundation_contact_windows','select');`),'f');
  }
  passed('contact: direct client roles cannot read buckets or grant admission');
  await sql(`insert into public.foundation_operation_leases
    (workspace_key,operation_scope,owner_token,request_key,body_digest,state,response_ciphertext,expires_at)
    select ${quote(prefix+'-key-cap')},'ask',gen_random_uuid(),md5(i::text)||md5(i::text),
      ${quote(digest)},'completed',repeat('a',64),now()+interval '10 minutes'
    from generate_series(1,300) i;`);
  assert.equal((await acquire(prefix+'-key-cap','ask',randomUUID(),key,digest)).code,'WORKSPACE_CACHE_CAPACITY_LIMIT');
  const retainedKey=await sql("select md5('1')||md5('1');");
  assert.equal((await acquire(prefix+'-key-cap','ask',randomUUID(),retainedKey,digest)).code,'REPLAY');
  passed('300-key cap refuses new keys without evicting valid replay');

  await sql(`insert into public.foundation_operation_leases
    (workspace_key,operation_scope,owner_token,request_key,body_digest,state,response_ciphertext,expires_at)
    select ${quote(prefix+'-byte-cap')},'ask',gen_random_uuid(),md5(i::text)||md5(i::text),
      ${quote(digest)},'completed',repeat('a',1390000),now()+interval '10 minutes'
    from generate_series(1,10) i;`);
  const reserved=await Promise.all(Array.from({length:20},(_,i)=>acquire(prefix+'-byte-cap','ask',randomUUID(),
    createHash('sha256').update(`${prefix}:capacity:${i}`).digest('hex'),digest)));
  assert.equal(reserved.filter(r=>r.code==='ACQUIRED').length,2);
  assert.equal(reserved.filter(r=>r.code==='WORKSPACE_CACHE_CAPACITY_LIMIT').length,18);
  passed('20 writers reserve ciphertext capacity atomically before doing work');
  console.log(JSON.stringify({status:'PASS',checks:checks.length,serverVersion:version,scope:'isolated loopback database; no production test'}));
} finally {
  // Delete only this run's synthetic rows, never a database or a table.
  await sql(`delete from public.foundation_operation_leases where workspace_key like ${quote(prefix+'%')};`);
  await sql(`delete from public.foundation_contact_windows where bucket_key in (${contactKeys.map(quote).join(',')});`);
}
