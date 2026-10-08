import { gunzipSync } from 'node:zlib';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildRepairReceipt } from './repair-scope-gate.mjs';
import { isInsideWorkspace, planBrowserRuns, WORKSPACE_INTAKE_CAPTURE_NAMES } from './run-repair-check.mjs';
import { AFFECTED_BASELINE, buildAffectedMap } from './repair-scope.mjs';

const head = 'e'.repeat(40);
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const historicalHead = '6a32dbbe2afeaa7d0c4c446becfe8994b913fcc1';
const historicalBlobs = Object.freeze({
  '.github/workflows/db-rehearsal.yml': '7cb726d57e1f75fcfc64cd180ee0313186a3e133',
  '.github/workflows/repair-scope.yml': '8a55cc2118dac8afa98e9b179c5bd72a513baef0',
  'nextjs/scripts/repair-collector-only.mjs': '48a24437810a1857fccdca43ac8e247cd54915b8',
  'nextjs/scripts/repair-collector-only.test.mjs': '29fa082b8308a10fe6b4dc7ec55099c9658f7859',
  'nextjs/scripts/repair-scope-gate.mjs': '661349149abbb129abbf38c037e06af3e5f2d1b7',
  'nextjs/scripts/verify-repair-workflows.mjs': '88d04559c7721be6be29d0616f021c797dcadc87',
  'nextjs/e2e/workspace-intake-triage.spec.ts': '0d24a1c185cb05f931aa61413e8eb6da604c7113',
  'nextjs/scripts/repair-scope.mjs': '9cc2d96094675468671602da60943ffa5eb5c1c4',
  'nextjs/scripts/repair-scope.test.mjs': 'c978599b44621801142cd81a5f3dfbb9802f27d0',
});
const historicalCache = new Map();
function historicalBytes(path) {
  assert.ok(Object.hasOwn(historicalBlobs, path), 'Unowned historical fixture: ' + path);
  if (!historicalCache.has(path)) {
    const bytes = process.env.COLLECTOR_HISTORICAL_FIXTURE_DIR
      ? readFileSync(resolve(process.env.COLLECTOR_HISTORICAL_FIXTURE_DIR, path))
      : execFileSync('git', ['show', `${historicalHead}:${path}`], { stdio: 'pipe' });
    assert.equal(gitBlob(bytes), historicalBlobs[path], 'Historical 6a32 byte identity: ' + path);
    historicalCache.set(path, bytes);
  }
  return historicalCache.get(path);
}
// Historical eligibility is tested with its immutable verifier and source bytes.
// Current shared infrastructure is sealed and tested by the new repair profile.
const historicalModuleRoot = mkdtempSync(resolve(tmpdir(), 'repair-collector-historical-module-'));
assert.ok(isInsideWorkspace(resolve(tmpdir()), historicalModuleRoot));
after(() => rmSync(historicalModuleRoot, { recursive: true, force: true }));
const historicalModulePath = resolve(historicalModuleRoot, 'repair-collector-only.mjs');
writeFileSync(historicalModulePath, historicalBytes('nextjs/scripts/repair-collector-only.mjs'));
const { COLLECTOR_BASE, FULL_ANCHOR, CORRECTION_PARENT, CORRECTION_PATHS, PUBLISHED_CONFIG_BLOBS, FIX_BLOBS, CONFIG_PATHS, CONFIG_SEAL, REGRESSION_DEBT, KNOWN_REGRESSION, sealHash, verifyTrackedCheckout, classifyCollectorIntent, verifyCollectorSource, verifyPriorEvidence, verifyCollectorEligibility, collectorOnlyPlan, collectorLineageFailures, collectorJobDecision, failedCollectorPlan, failedCollectorReceipt } = await import(pathToFileURL(historicalModulePath).href);
const fixParent = CORRECTION_PARENT;
function gitFixture(options = {}) {
  const config = Object.fromEntries(CONFIG_PATHS.map(path => [path, historicalBytes(path)]));
  const all = [...Object.keys(FIX_BLOBS), ...CONFIG_PATHS];
  return (_command, args) => {
    if (args[0] === '-C') { assert.equal(args[1], 'fixture-root'); args = args.slice(2); }
    if (args[0] === 'rev-parse') return args[1] === '--show-toplevel' ? 'fixture-root' : options.checkout ?? head;
    if (args[0] === 'merge-base') { if (options.ancestor === false) throw new Error('not ancestor'); return ''; }
    if (args[0] === 'diff' && args[1] === '--raw') { if (options.dirty) throw new Error('dirty checkout'); return ''; }
    if (args[0] === 'rev-list') {
      if (args.at(-1) === head) return `${head} ${options.parent ?? CORRECTION_PARENT}${options.merge ? ` ${'a'.repeat(40)}` : ''}`;
      return `${fixParent} ${options.grandparent ?? COLLECTOR_BASE}`;
    }
    if (args[0] === 'diff') return (args.at(-1).startsWith(`${CORRECTION_PARENT}..`) ? options.correctionPaths ?? CORRECTION_PATHS : args.at(-1).endsWith(fixParent) ? options.parentPaths ?? all : options.paths ?? all).join('\0') + '\0';
    if (args[0] === 'ls-tree') {
      assert.equal(args[1], '--full-tree');
      const revision = args[2], path = args.at(-1);
      const blob = options.blobs?.[`${revision}:${path}`] ?? (FIX_BLOBS[path] ? FIX_BLOBS[path][revision === COLLECTOR_BASE ? 0 : 1] : revision === CORRECTION_PARENT ? PUBLISHED_CONFIG_BLOBS[path] : gitBlob(config[path]));
      if (!blob) return '';
      return `${options.unsafePath === path ? '120000' : '100644'} blob ${blob}\t${path}`;
    }
    if (args[0] === 'show') {
      const path = args[1].slice(41);
      return options.mutatedConfig === path ? Buffer.concat([config[path], Buffer.from('\n// altered\n')]) : config[path];
    }
    throw new Error(`Unexpected git command ${args.join(' ')}`);
  };
}
function evidenceFixture() {
  const run = (id, path, conclusion) => ({ id, path, head_sha: COLLECTOR_BASE, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion });
  const job = (id, run_id, conclusion, steps) => ({ id, run_id, head_sha: COLLECTOR_BASE, status: 'completed', conclusion, steps: steps.map(([name, conclusion]) => ({ name, status: 'completed', conclusion })) });
  return {
    repairRun: run(37320682454, '.github/workflows/repair-scope.yml', 'failure'),
    repairJob: job(111798647893, 37320682454, 'failure', [
      ['Scan repository secrets', 'success'], ['Run TypeScript and lint checks', 'success'],
      ['Run the normal CDR worker unit suite and types for reviewed OCR safety', 'success'], ['Run Foundation focused unit checks', 'success'],
      ['Run selected browser checks against one production server', 'success'], ['Require screenshots for the exact paired public UI candidate', 'success'],
      ['Require the four synthetic mounted intake preflight capture pairs', 'failure'], ['Fail closed on missing or failed scoped checks', 'failure'],
    ]),
    databaseRun: run(37320682223, '.github/workflows/db-rehearsal.yml', 'success'),
    databaseJob: job(111798647331, 37320682223, 'success', [['Run the pgTAP suite', 'success'], ['Apply the repair migrations a second time and re-run the suite', 'success'], ['Require both disposable pgTAP passes for the completed-read draft', 'success']]),
    transportJob: { ...job(111798647200, 37320682223, 'success', [
      ['Install the existing frozen Foundation dependencies', 'success'], ['Install one isolated Chromium runtime', 'success'],
      ['Fetch only the official checksum-qualified portable local S3 runtime', 'success'],
      ['Qualify actual Chromium signed PUT, CORS, refusal, redirect and host guards against actual local S3', 'success'],
    ]), name: 'Local Chromium signed-storage transport' },
  };
}
const normal = () => ({ headSha: head, repairAnchorSha: FULL_ANCHOR, pullRequestBaseSha: 'a'.repeat(40), groups: ['unit-regression', 'browser-regression', 'database-contract'],
  unitFiles: ['lib/settle-route.test.ts'], browserFiles: ['e2e/site-nav.spec.ts'], unknownPaths: ['scripts/repair-collector-only.mjs'],
  qualificationReasons: ['full release pending'], pendingFullDebt: ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair'],
  pendingQualificationDebt: ['database-contract'], deferredGroups: ['database-contract'], fullQualification: 'pending', runFullHermeticVitest: true });
function proofFixture() { return { eligible: true, source: verifyCollectorSource({ headSha: head, exec: gitFixture() }), evidence: verifyPriorEvidence(evidenceFixture()) }; }

// Preserve the original published28d native profile and its exact infrastructure fixtures.
const published28d='28d675b2ed3f8bf93ba439caca61940d477423e5',published28dBlobs={
  ".github/workflows/repair-scope.yml": "c7e8b90bd7ef52ba66d15bdd6c2ba896d769efee",
  "nextjs/scripts/repair-collector-only.mjs": "f13e370de7ca2692b53cbfa262cfd541de3fd633",
  "nextjs/scripts/repair-scope.mjs": "07b181b59bab2f636dafe9f1227b18e8113c452d",
  "nextjs/scripts/repair-scope.test.mjs": "26f5ada994eb32cc1a33c0e9c6893673a8110d26",
  "nextjs/scripts/repair-scope-gate.mjs": "305f9f854f6e85c64a6410b712f73c396a13aae1",
  "nextjs/scripts/verify-repair-workflows.mjs": "55a7f6ea85057a6cdb08ef9ac23e9ece552e1d01",
  "nextjs/scripts/repair-collector-only.test.mjs": "0e6198e86fd8d06ad27ff27617a67cc260b69750",
  "nextjs/scripts/repair-known-regression.mjs": "9a98148ba2c5ab19fee8fbd5ec705732b33c04d9",
  "nextjs/scripts/repair-known-regression.test.mjs": "0bf7d9a731c8111e1d0523ffee86050c0632dd33",
  ".github/workflows/db-rehearsal.yml": "9c8a57e33b383387075d89bf7059a7b7ce148041",
  "nextjs/scripts/run-repair-check.mjs": "57b1617fce020b9fce8ddc744b72962cd06e4e01",
  "nextjs/scripts/repair-test-report.mjs": "4e3878f8b6311f06879415d6fa87ad25de0d7254",
  "nextjs/vitest.repair-scope.config.ts": "67844b0446fb9e1e94d17ec235c1423faac535b6"
},published28dCache=process.env.PUBLIC_PAGES_PARENT_FIXTURE_ARCHIVE?JSON.parse(gunzipSync(readFileSync(process.env.PUBLIC_PAGES_PARENT_FIXTURE_ARCHIVE))):{};
function published28dBytes(p){if(p==='nextjs/lib/db-rehearsal-workflow.test.ts')return published852Bytes(p);if(!Object.hasOwn(published28dBlobs,p))return baselineBytes(p);const b=published28dCache[p]?Buffer.from(published28dCache[p],'base64'):execFileSync('git',['show',published28d+':'+p],{stdio:'pipe'});assert.equal(gitBlob(b),published28dBlobs[p],'Original28d fixture byte identity: '+p);return b;}
const nativeModuleRoot=mkdtempSync(resolve(tmpdir(),'repair-native28d-module-'));after(()=>rmSync(nativeModuleRoot,{recursive:true,force:true}));
writeFileSync(resolve(nativeModuleRoot,'repair-collector-only.mjs'),published28dBytes('nextjs/scripts/repair-collector-only.mjs'));
let nativeKnownSource=published28dBytes('nextjs/scripts/repair-known-regression.mjs').toString();for(const name of ['run-repair-check.mjs','repair-test-report.mjs'])nativeKnownSource=nativeKnownSource.replace('./'+name,pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)),name)).href);writeFileSync(resolve(nativeModuleRoot,'repair-known-regression.mjs'),nativeKnownSource);
const native=await import(pathToFileURL(resolve(nativeModuleRoot,'repair-collector-only.mjs')).href);
const nativeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// Historic pins: these fixtures model heads whose sealed owners are the bytes published at the verified affected baseline, never this
// working tree, so later CI-owner edits cannot move a historical profile's expected seals.
const baselineCache=new Map(),baselineBytes=p=>{if(!baselineCache.has(p))baselineCache.set(p,execFileSync('git',['-C',nativeRoot,'show',`${AFFECTED_BASELINE.commit}:${p}`],{stdio:'pipe',maxBuffer:64*1024*1024}));return baselineCache.get(p);};

// Frozen exact852 seal boundary: all thirteen sealed paths resolve only from authenticated historical bytes.
const published852='852ffbee9b71ee75ce2ee047874731596c13e837',published852Blobs={
  ".github/workflows/repair-scope.yml": "bc389e37e24a3544472a80da1012063cdd748eee",
  "nextjs/scripts/repair-collector-only.mjs": "6727bf88aac81dfd4827119cf15a48ffd3361dd3",
  "nextjs/scripts/repair-scope.mjs": "07b181b59bab2f636dafe9f1227b18e8113c452d",
  "nextjs/scripts/repair-scope.test.mjs": "823989f9f7fc71ab610f85386f88d6722ac6f8e9",
  "nextjs/scripts/repair-scope-gate.mjs": "667b64533c8f47674ea6170efd555b1bcb51b4e4",
  "nextjs/scripts/verify-repair-workflows.mjs": "963417ac33d1ef8f81c1c2e37e5e3437cb1e39b0",
  "nextjs/scripts/repair-collector-only.test.mjs": "37e780d262cfadbb8a0e0195150be4601e1368df",
  "nextjs/scripts/repair-known-regression.mjs": "8d00b72c36d1d15ddc01ee4a96dec38c318f8061",
  "nextjs/scripts/repair-known-regression.test.mjs": "0bf7d9a731c8111e1d0523ffee86050c0632dd33",
  ".github/workflows/db-rehearsal.yml": "9c8a57e33b383387075d89bf7059a7b7ce148041",
  "nextjs/scripts/run-repair-check.mjs": "8141b4ab6b24c30db5481a83c161320da6a06e90",
  "nextjs/scripts/repair-test-report.mjs": "4e3878f8b6311f06879415d6fa87ad25de0d7254",
  "nextjs/vitest.repair-scope.config.ts": "67844b0446fb9e1e94d17ec235c1423faac535b6",
  "nextjs/lib/db-rehearsal-workflow.test.ts": "3e723a40e1bf09e8be44bb6de96b74d77663ff75"
},published852Sealed=Object.freeze(['.github/workflows/repair-scope.yml','nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-scope.mjs','nextjs/scripts/repair-scope.test.mjs','nextjs/scripts/repair-scope-gate.mjs','nextjs/scripts/verify-repair-workflows.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-known-regression.mjs','nextjs/scripts/repair-known-regression.test.mjs','.github/workflows/db-rehearsal.yml','nextjs/scripts/run-repair-check.mjs','nextjs/scripts/repair-test-report.mjs','nextjs/vitest.repair-scope.config.ts']),published852Cache=process.env.NATIVE_WORLD_PARENT_FIXTURE_ARCHIVE?JSON.parse(gunzipSync(readFileSync(process.env.NATIVE_WORLD_PARENT_FIXTURE_ARCHIVE))):{};
function historical852Bytes(p,{cache=published852Cache,show=q=>execFileSync('git',['show',published852+':'+q],{stdio:'pipe'}),current=q=>baselineBytes(q)}={}){if(!Object.hasOwn(published852Blobs,p)){if(published852Sealed.includes(p))throw Error('Sealed852 fixture lacks an exact pin: '+p);return current(p);}const b=cache[p]?Buffer.from(cache[p],'base64'):show(p);assert.equal(gitBlob(b),published852Blobs[p],'Original852 fixture byte identity: '+p);return b;}
function published852Bytes(p){return historical852Bytes(p);}
const pageModuleRoot=mkdtempSync(resolve(tmpdir(),'repair-pages852-module-'));after(()=>rmSync(pageModuleRoot,{recursive:true,force:true}));writeFileSync(resolve(pageModuleRoot,'repair-collector-only.mjs'),published852Bytes('nextjs/scripts/repair-collector-only.mjs'));let pageKnown=published852Bytes('nextjs/scripts/repair-known-regression.mjs').toString();for(const name of ['run-repair-check.mjs','repair-test-report.mjs'])pageKnown=pageKnown.replace('./'+name,pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)),name)).href);writeFileSync(resolve(pageModuleRoot,'repair-known-regression.mjs'),pageKnown);const pages=await import(pathToFileURL(resolve(pageModuleRoot,'repair-collector-only.mjs')).href);
import * as world from './repair-collector-only.mjs';
import { REPAIR_SEAL_PATHS as worldRepairPaths } from './repair-known-regression.mjs';

test('historical852 sealed files never resolve from changed current candidate bytes when exact historical source is unavailable',()=>{
  assert.equal(published852Sealed.length,13);assert.equal(new Set(published852Sealed).size,13);
  for(const p of published852Sealed){assert.ok(Object.hasOwn(published852Blobs,p),p);let currentReads=0;const changed=Buffer.from('changed current candidate '+p),current=()=>{currentReads++;return changed;},show=()=>{throw Error('Historical852 source unavailable: '+p);};
    assert.throws(()=>historical852Bytes(p,{cache:{},show,current}),/Historical852 source unavailable/,p);
    assert.throws(()=>historical852Bytes(p,{cache:{[p]:changed.toString('base64')},show,current}),/Original852 fixture byte identity/,p);
    assert.throws(()=>historical852Bytes(p,{cache:{},show:()=>changed,current}),/Original852 fixture byte identity/,p);
    assert.equal(currentReads,0,p);}
});

test('collector source proof seals all infrastructure and preserves the three immutable fix blobs', () => {
  assert.deepEqual(Object.keys(CONFIG_SEAL).sort(), [...CONFIG_PATHS].sort());
  for (const [path, expected] of Object.entries(CONFIG_SEAL)) assert.equal(sealHash(path, historicalBytes(path)), expected, path);
  for (const [path, [, expected]] of Object.entries(FIX_BLOBS)) assert.equal(gitBlob(historicalBytes(path)), expected, path);
  assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture() }).eligible, true);
});

test('self seal rejects executable text and any noncanonical declaration while normalizing only six digest values', () => {
  const path = 'nextjs/scripts/repair-collector-only.mjs';
  const source = historicalBytes(path).toString('utf8');
  const originalHash = sealHash(path, Buffer.from(source));
  const block = /^\/\/ collector-seal:start\n[\s\S]*?^\/\/ collector-seal:end$/m.exec(source)[0];
  const replace = altered => Buffer.from(source.replace(block, altered));
  for (const mutated of [
    block.replace('// collector-seal:start\n', '// collector-seal:start\nglobalThis.injected = true;\n'),
    block.replace('\n// collector-seal:end', '\nglobalThis.injected = true;\n// collector-seal:end'),
    block.replace('Object.freeze({', 'Object.freeze((globalThis.injected = true, {').replace('\n});', '\n}));'),
    block.replace('Object.freeze({', 'Object.freeze({\n  // unbound comment'),
    block.replace('  ".github/workflows/db-rehearsal.yml":', '  "extra": "' + 'a'.repeat(64) + '",\n  ".github/workflows/db-rehearsal.yml":'),
    block.replace('  ".github/workflows/db-rehearsal.yml":', '  ".github/workflows/db-rehearsal.yml": "' + 'a'.repeat(64) + '",\n  ".github/workflows/db-rehearsal.yml":'),
    block.replace(/  "\.github\/workflows\/db-rehearsal.yml": [^\n]+\n/, ''),
    block.replace(/"[a-f0-9]{64}"/, '"short"'),
    block.replace(/"[a-f0-9]{64}"/, 'null'),
    block.replace('export const CONFIG_SEAL', 'export let CONFIG_SEAL'),
    block + '\n// collector-seal:start',
  ]) assert.throws(() => sealHash(path, replace(mutated)), /seal/);
  assert.equal(globalThis.injected, undefined);
  const changedDigest = block.replace(/"[a-f0-9]{64}"/, '"' + 'f'.repeat(64) + '"');
  assert.equal(sealHash(path, replace(changedDigest)), originalHash);
  const externalStatement = Buffer.from(source + '\nglobalThis.injected = true;\n');
  assert.notEqual(sealHash(path, externalStatement), originalHash);
});

test('collector source proof rejects every additional, missing, mutated or unsafe path and invalid parent/ancestor', () => {
  const all = [...Object.keys(FIX_BLOBS), ...CONFIG_PATHS];
  for (const path of all) {
    assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture({ paths: all.filter(other => other !== path) }) }).eligible, false, path);
    assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture({ unsafePath: path }) }).eligible, false, path);
  }
  for (const path of Object.keys(FIX_BLOBS)) for (const revision of [COLLECTOR_BASE, head, fixParent]) {
    assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture({ blobs: { [`${revision}:${path}`]: 'f'.repeat(40) } }) }).eligible, false, `${revision}:${path}`);
  }
  for (const path of CONFIG_PATHS) assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture({ mutatedConfig: path }) }).eligible, false, path);
  for (const extra of ['nextjs/app/page.tsx', 'supabase/tests/extra.sql', 'quarantine-sidecar/worker.ts', '.github/workflows/extra.yml', 'README.md']) assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture({ paths: [...all, extra] }) }).eligible, false, extra);
  for (const options of [{ ancestor: false }, { checkout: COLLECTOR_BASE }, { dirty: true }, { merge: true }, { parent: COLLECTOR_BASE }, { parent: 'd'.repeat(40) }, { grandparent: 'c'.repeat(40) }, { parentPaths: [...all, 'extra.ts'] }, { correctionPaths: [...CORRECTION_PATHS, 'README.md'] }, { correctionPaths: CORRECTION_PATHS.slice(1) }]) assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture(options) }).eligible, false);
  for (const path of CONFIG_PATHS) assert.equal(verifyCollectorSource({ headSha: head, exec: gitFixture({ blobs: { [`${CORRECTION_PARENT}:${path}`]: 'f'.repeat(40) } }) }).eligible, false);
  assert.equal(verifyCollectorSource({ headSha: COLLECTOR_BASE, exec: gitFixture() }).eligible, false);
});

test('readable unrelated parent selects normal without f082 ancestry while exact corrections retain strict ancestry', () => {
  let ancestryCalls = 0;
  const fixture = gitFixture({ parent: 'd'.repeat(40), ancestor: false });
  const unrelated = classifyCollectorIntent({ headSha: head, exec: (command, args, options) => {
    if (args[0] === 'merge-base') ancestryCalls++;
    return fixture(command, args, options);
  } });
  assert.equal(unrelated.classification, 'normal');
  assert.equal(unrelated.intended, false);
  assert.equal(ancestryCalls, 0);
  assert.equal(collectorJobDecision('success', String(unrelated.intended), 'false'), 'normal');
  for (const failedAncestry of [1, 2]) {
    let calls = 0;
    const exact = gitFixture();
    const intent = classifyCollectorIntent({ headSha: head, exec: (command, args, options) => {
      if (args[0] === 'merge-base' && ++calls === failedAncestry) throw new Error('not ancestor');
      return exact(command, args, options);
    } });
    assert.equal(intent.classification, 'unavailable');
    assert.equal(intent.intended, null);
  }
  for (const metadata of ['', `${head} unreadable`, `${'a'.repeat(40)} ${'d'.repeat(40)}`]) {
    const intent = classifyCollectorIntent({ headSha: head, exec: (command, args, options) => args[0] === 'rev-list' ? metadata : fixture(command, args, options) });
    assert.equal(intent.classification, 'unavailable');
  }
  const unreadable = classifyCollectorIntent({ headSha: head, exec: (command, args, options) => {
    if (args[0] === 'rev-list') throw new Error('Git parent metadata unavailable');
    return fixture(command, args, options);
  } });
  assert.equal(unreadable.classification, 'unavailable');
});

test('real Git unrelated checkout lacking f082 and full anchor selects normal from its readable parent', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'repair-collector-unrelated-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    const empty = resolve(root, '.empty-template'); mkdirSync(empty);
    const git = args => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', `core.hooksPath=${empty}`, ...args], { cwd: root, encoding: 'utf8' });
    git(['init', '--quiet', `--template=${empty}`]);
    for (const message of ['unrelated parent', 'unrelated head']) git(['-c', 'user.name=Collector fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', message]);
    const candidate = git(['rev-parse', 'HEAD']).trim();
    assert.throws(() => git(['cat-file', '-e', `${COLLECTOR_BASE}^{commit}`]));
    assert.throws(() => git(['cat-file', '-e', `${FULL_ANCHOR}^{commit}`]));
    const commands = [];
    const intent = classifyCollectorIntent({ headSha: candidate, exec: (_command, args) => { commands.push(args); return git(args); } });
    assert.equal(intent.classification, 'normal');
    assert.equal(intent.intended, false);
    assert.ok(commands.every(args => args[0] !== 'merge-base'));
    assert.equal(collectorJobDecision('success', String(intent.intended), 'false'), 'normal');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real Git source proof works from repository root and nested nextjs cwd with full-tree lookup and root-relative diff', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'repair-collector-real-git-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    const empty = resolve(root, '.empty-template');
    mkdirSync(empty);
    const git = (args, cwd = root, options = {}) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', `core.hooksPath=${empty}`, ...args], { cwd, encoding: 'utf8', ...options });
    git(['init', '--quiet', `--template=${empty}`]);
    git(['-c', 'user.name=Collector fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'base fixture']);
    const baseline = git(['rev-parse', 'HEAD']).trim();
    const paths = [...Object.keys(FIX_BLOBS), ...CONFIG_PATHS];
    for (const path of paths) {
      const target = resolve(root, path);
      mkdirSync(dirname(target), { recursive: true });
      const bytes = CORRECTION_PATHS.includes(path)
        ? process.env.COLLECTOR_PARENT_FIXTURE_DIR ? readFileSync(resolve(process.env.COLLECTOR_PARENT_FIXTURE_DIR, path)) : execFileSync('git', ['show', `${CORRECTION_PARENT}:${path}`])
        : historicalBytes(path);
      if (CORRECTION_PATHS.includes(path)) assert.equal(gitBlob(bytes), PUBLISHED_CONFIG_BLOBS[path], 'Exact e402 fixture preimage: ' + path);
      writeFileSync(target, bytes);
    }
    git(['add', '--', ...paths]);
    git(['-c', 'user.name=Collector fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'published e402 fixture']);
    const published = git(['rev-parse', 'HEAD']).trim();
    for (const path of CORRECTION_PATHS) writeFileSync(resolve(root, path), historicalBytes(path));
    git(['add', '--', ...CORRECTION_PATHS]);
    git(['-c', 'user.name=Collector fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'exact correction fixture']);
    const candidate = git(['rev-parse', 'HEAD']).trim();
    const nested = resolve(root, 'nextjs');
    const intake = 'nextjs/e2e/workspace-intake-triage.spec.ts';
    assert.equal(git(['ls-tree', candidate, '--', intake], nested).trim(), '', 'reproduce the original nested-cwd lookup failure');
    assert.match(git(['ls-tree', '--full-tree', candidate, '--', intake], nested), new RegExp(FIX_BLOBS[intake][1]));
    assert.equal(git(['rev-list', '--parents', '-n', '1', candidate], root), git(['rev-list', '--parents', '-n', '1', candidate], nested));
    git(['config', 'diff.relative', 'true']);
    for (const cwd of [root, nested]) {
      const commands = [];
      // Only the immutable upstream revision identities/preimages are substituted.
      // HEAD, candidate blobs, diff, ancestry and all path lookups execute real Git.
      const bridge = (_command, args, options) => {
        commands.push(args);
        if (args[0] === 'ls-tree' && args[2] === COLLECTOR_BASE) {
          const path = args.at(-1);
          return `100644 blob ${FIX_BLOBS[path][0]}\t${path}\n`;
        }
        const translated = args.map(arg => arg.replaceAll(CORRECTION_PARENT, published).replaceAll(COLLECTOR_BASE, baseline).replaceAll(FULL_ANCHOR, baseline));
        const result = git(translated, cwd, options);
        return args[0] === 'rev-list' ? result.replaceAll(baseline, COLLECTOR_BASE).replaceAll(published, CORRECTION_PARENT) : result;
      };
      const proof = verifyCollectorSource({ headSha: candidate, exec: bridge });
      assert.equal(proof.eligible, true, `${cwd}: ${proof.reason}`);
      assert.deepEqual(proof.exactChangedPaths, paths.sort());
      assert.ok(commands.filter(args => args[0] === 'ls-tree').every(args => args[1] === '--full-tree'));
      assert.ok(commands.filter(args => args.includes('--name-only')).every(args => args[0] === '-C'));
      const workflowPath = resolve(root, '.github/workflows/db-rehearsal.yml');
      const original = readFileSync(workflowPath);
      writeFileSync(workflowPath, Buffer.concat([original, Buffer.from('\n# dirty root workflow\n')]));
      assert.equal(git(['diff', '--quiet', 'HEAD'], nested), '', 'reproduce nested dirty-check omission with diff.relative=true');
      assert.equal(verifyCollectorSource({ headSha: candidate, exec: bridge }).eligible, false, 'dirty root workflow must reject both cwd contexts');
      assert.ok(commands.filter(args => args.includes('--raw')).every(args => args[0] === '-C'));
      writeFileSync(workflowPath, original);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fresh Linux-style checkout of exact f082 CRLF blobs passes immutable byte comparison and real mutations fail', () => {
  const fixturePaths = ['nextjs/public/developer/source-agent-operations.md', 'supabase/tests/foundation_approved_connection_batch_binding.sql', '.gitattributes'];
  const expected = ['92b89089552a590ffc0cc07b39b1ead12acf47cd', '45f8ef13c9769798e1d4c54e3e80c88094264ee3', 'bceb7178b4bbfd5d089e7b4018e05becc272db8d'];
  const root = mkdtempSync(resolve(tmpdir(), 'repair-collector-crlf-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    const empty = resolve(root, '.empty-template'); mkdirSync(empty);
    const git = (args, cwd = root, options = {}) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-c', `core.hooksPath=${empty}`, ...args], { cwd, encoding: 'utf8', ...options });
    git(['init', '--quiet', `--template=${empty}`]);
    for (const [index, path] of fixturePaths.entries()) {
      const bytes = execFileSync('git', ['-C', fileURLToPath(new URL('../../', import.meta.url)), 'show', expected[index]], { encoding: 'buffer', stdio: 'pipe' });
      assert.equal(gitBlob(bytes), expected[index], path);
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      writeFileSync(resolve(root, path), bytes);
      // Preserve exact committed CRLF object bytes, independent of add-time clean filters.
      const oid = git(['hash-object', '-w', '--stdin'], root, { input: bytes }).trim();
      assert.equal(oid, expected[index]);
      git(['update-index', '--add', '--cacheinfo', '100644', oid, path]);
    }
    git(['-c', 'user.name=Collector fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'exact pre-existing CRLF blobs']);
    const headSha = git(['rev-parse', 'HEAD']).trim();
    for (const path of fixturePaths) rmSync(resolve(root, path));
    git(['checkout', '--force', 'HEAD', '--', ...fixturePaths]);
    const nested = resolve(root, 'nextjs');
    for (const [index, path] of fixturePaths.entries()) assert.equal(gitBlob(readFileSync(resolve(root, path))), expected[index], 'fresh checkout must preserve exact HEAD bytes');
    assert.throws(() => git(['diff', '--quiet', 'HEAD']), 'reproduce original clean-checkout false positive');
    for (const cwd of [root, nested]) assert.equal(verifyTrackedCheckout({ repoRoot: root, headSha, exec: (_command, args, options) => git(args, cwd, options) }), true);
    for (const path of fixturePaths) {
      const target = resolve(root, path), original = readFileSync(target);
      writeFileSync(target, Buffer.concat([original, Buffer.from('\nactual content mutation\n')]));
      assert.throws(() => verifyTrackedCheckout({ repoRoot: root, headSha, exec: (_command, args, options) => git(args, nested, options) }), /content changed/);
      writeFileSync(target, original);
    }
    rmSync(resolve(root, fixturePaths[0]));
    assert.throws(() => verifyTrackedCheckout({ repoRoot: root, headSha, exec: (_command, args, options) => git(args, nested, options) }), /mode, type, deletion or addition/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prior evidence validates exact f082 run/job identities and successful steps without qualifying failed overall Repair', () => {
  const accepted = verifyPriorEvidence(evidenceFixture());
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.overallRepairConclusion, 'failure');
  assert.equal(accepted.fullQualification, 'pending');
  for (const field of ['repairRun', 'repairJob', 'databaseRun', 'databaseJob', 'transportJob']) for (const [key, value] of [['id', 1], ['head_sha', head], ['status', 'in_progress'], ['conclusion', 'cancelled']]) {
    const data = evidenceFixture(); data[field][key] = value;
    assert.equal(verifyPriorEvidence(data).eligible, false, `${field}.${key}`);
  }
  for (const field of ['repairRun', 'databaseRun']) { const data = evidenceFixture(); data[field].run_attempt = 2; assert.equal(verifyPriorEvidence(data).eligible, false); }
  for (const field of ['repairJob', 'databaseJob', 'transportJob']) for (const scenario of ['missing', 'duplicate', 'failed', 'skipped']) {
    const data = evidenceFixture();
    if (scenario === 'missing') data[field].steps.shift();
    else if (scenario === 'duplicate') data[field].steps.push({ ...data[field].steps[0] });
    else data[field].steps[0].conclusion = scenario === 'failed' ? 'failure' : 'skipped';
    assert.equal(verifyPriorEvidence(data).eligible, false, `${field}.${scenario}`);
  }
  const extraFailure = evidenceFixture(); extraFailure.repairJob.steps.push({ name: 'unrelated failure', status: 'completed', conclusion: 'failure' });
  assert.equal(verifyPriorEvidence(extraFailure).eligible, false);
  const missingTransport = evidenceFixture(); delete missingTransport.transportJob;
  assert.equal(verifyPriorEvidence(missingTransport).eligible, false);
  for (const key of ['run_id', 'name']) { const data = evidenceFixture(); data.transportJob[key] = 'unknown'; assert.equal(verifyPriorEvidence(data).eligible, false); }
  assert.equal(accepted.checks.storageTransport.jobId, 111798647200);
});

test('independent eligibility falls back without API access, never trusts source failure or broadens the exact endpoints', () => {
  let calls = 0;
  assert.equal(verifyCollectorEligibility({ headSha: head, exec: gitFixture({ dirty: true }), api: () => { calls++; } }).eligible, false);
  assert.equal(calls, 0);
  assert.equal(verifyCollectorEligibility({ headSha: head, exec: gitFixture(), api: () => { throw new Error('denied'); } }).eligible, false);
  const data = evidenceFixture(), endpoints = [];
  const api = endpoint => { endpoints.push(endpoint); return ({ 'actions/runs/37320682454': data.repairRun, 'actions/jobs/111798647893': data.repairJob, 'actions/runs/37320682223': data.databaseRun, 'actions/jobs/111798647331': data.databaseJob, 'actions/jobs/111798647200': data.transportJob })[endpoint]; };
  assert.equal(verifyCollectorEligibility({ headSha: head, exec: gitFixture(), api }).eligible, true);
  assert.equal(endpoints.length, 5);
});

test('affected-only plan runs only intake audit plus four pairs and preserves explicit inherited lineage and release debt', () => {
  const baseline = normal(), proof = proofFixture(), plan = collectorOnlyPlan(baseline, proof);
  assert.deepEqual(planBrowserRuns(plan.browserFiles, plan.runDetailIntegrity), [{ kind: 'project', project: 'audit', files: ['e2e/workspace-intake-triage.spec.ts'] }]);
  assert.equal(WORKSPACE_INTAKE_CAPTURE_NAMES.length, 4);
  for (const field of ['runFullHermeticVitest', 'runScriptContracts', 'runCdrWorkerChecks', 'runDatabaseRehearsal', 'requirePublicUiScreenshots']) assert.equal(plan[field], false);
  assert.deepEqual(plan.unitFiles, []);
  assert.equal(plan.requireWorkspaceIntakeCapture, true);
  assert.deepEqual(plan.pendingFullDebt, baseline.pendingFullDebt);
  assert.ok(baseline.pendingQualificationDebt.every(debt => plan.pendingQualificationDebt.includes(debt)));
  assert.ok(plan.pendingQualificationDebt.includes(REGRESSION_DEBT));
  assert.deepEqual(plan.knownRegressionObservations, [KNOWN_REGRESSION]);
  assert.equal(plan.repairAnchorSha, FULL_ANCHOR);
  assert.equal(plan.fullQualification, 'pending');
  assert.deepEqual(collectorLineageFailures(plan, proof), []);
  assert.ok(Object.values(plan.inheritedChecks).every(check => check.sourceHead === COLLECTOR_BASE && check.status.includes('not executed at current head')));
  const receipt = buildRepairReceipt(plan, { headSha: head, executedChecks: { selectedBrowsers: 'success', mountedCaptures: 'success' } });
  assert.equal(receipt.gate, 'passed-scoped-only');
  assert.equal(receipt.runResults['unit-regression'], undefined);
  assert.equal(receipt.passedGroupAnchors['database-contract'], undefined);
  assert.equal(receipt.inheritedChecks.database.sourceHead, COLLECTOR_BASE);
  assert.equal(receipt.inheritedChecks.database.runId, 37320682223);
  assert.equal(receipt.inheritedChecks.storageTransport.jobId, 111798647200);
  assert.equal(receipt.executedChecks.storageTransport, undefined);
  assert.equal(receipt.databaseObservation, 'prior successful f082 rehearsal; not executed at current head');
  assert.equal(receipt.fullQualification, 'pending');
  assert.ok(receipt.pendingDebt.includes('database-contract'));
  assert.deepEqual(receipt.executedChecks, { selectedBrowsers: 'success', mountedCaptures: 'success' });
  const failed = buildRepairReceipt(plan, { headSha: head, failures: ['capture missing'] });
  assert.equal(failed.gate, 'failed');
  assert.ok(Object.values(failed.inheritedChecks).every(check => check.status === 'not accepted for current head'));
});

test('final gate rejects changed lineage, plan scope, missing proof and a forged current-head qualification', () => {
  const proof = proofFixture(), plan = collectorOnlyPlan(normal(), proof);
  assert.ok(collectorLineageFailures(plan, { eligible: false, reason: 'API denied' }).length);
  for (const [key, value] of [['collectorOnly', null], ['inheritedChecks', {}], ['unitFiles', ['lib/extra.test.ts']], ['browserFiles', ['e2e/site-nav.spec.ts']], ['groups', ['unit-regression']], ['runCdrWorkerChecks', true], ['requireWorkspaceIntakeCapture', false], ['runFullHermeticVitest', true], ['fullQualification', 'passed']]) assert.ok(collectorLineageFailures({ ...plan, [key]: value }, proof).length, key);
  assert.throws(() => collectorOnlyPlan(normal(), { eligible: false }));
  assert.throws(() => collectorOnlyPlan({ ...normal(), repairAnchorSha: head }, proof));
  for (const altered of [{ ...plan, repairAnchorSha: head }, { ...plan, headSha: COLLECTOR_BASE }, { ...plan, pendingFullDebt: [] }, { ...plan, pendingQualificationDebt: [] }]) assert.ok(collectorLineageFailures(altered, proof).length);
});

test('both workflows independently verify eligibility and failed DB classification blocks expensive jobs', () => {
  const repair = readFileSync(resolve(process.cwd(), '../.github/workflows/repair-scope.yml'), 'utf8');
  const db = readFileSync(resolve(process.cwd(), '../.github/workflows/db-rehearsal.yml'), 'utf8');
  assert.ok(repair.includes('run: node scripts/repair-collector-only.mjs plan'));
  assert.ok(db.includes('run: node nextjs/scripts/repair-collector-only.mjs eligibility'));
  assert.ok(db.includes('COLLECTOR_EVENT: ${{ github.event_name }}'));
  const transport = db.slice(db.indexOf('  browser-storage-transport:'));
  assert.ok(transport.includes('needs: [collector-only-eligibility]'));
  assert.ok(transport.includes("if: always() && github.event_name == 'pull_request' && needs.collector-only-eligibility.result == 'success' && needs.collector-only-eligibility.outputs.intended == 'false' && needs.collector-only-eligibility.outputs.eligible == 'false'"));
  assert.ok(db.includes("always() && needs.collector-only-eligibility.result == 'success' &&"));
  assert.ok(db.includes("(needs.collector-only-eligibility.outputs.native_database == 'false' && needs.collector-only-eligibility.outputs.intended == 'false' && needs.collector-only-eligibility.outputs.eligible == 'false')"));
  assert.ok(db.includes("(needs.collector-only-eligibility.outputs.native_database == 'true' && needs.collector-only-eligibility.outputs.intended == 'true' && needs.collector-only-eligibility.outputs.eligible == 'false')"));
  assert.ok(db.includes('Require an explicit collector classifier decision'));
  assert.ok(db.includes('path: collector-only-failure-receipt.json'));
  assert.ok(repair.includes('node --test scripts/repair-collector-only.test.mjs'));
  assert.ok(repair.includes('node scripts/run-repair-check.mjs browser'));
  assert.ok(repair.includes('node scripts/run-repair-check.mjs intake-captures'));
  assert.equal((repair.match(/nextjs\/test-results\/repair-scope-intake-mounted\/intake-mounted-/g) ?? []).length, 8);
});

test('intended corrections fail fast for dirty bytes, wrong seals and unavailable API; unrelated changes remain normal', () => {
  for (const options of [{ dirty: true }, { mutatedConfig: 'nextjs/scripts/repair-collector-only.mjs' }]) {
    const exec = gitFixture(options);
    const intent = classifyCollectorIntent({ headSha: head, exec });
    assert.equal(intent.classification, 'intended');
    assert.equal(verifyCollectorEligibility({ headSha: head, exec, api: () => { throw Error('unexpected API call'); } }).eligible, false);
    assert.equal(collectorJobDecision('failure', 'true', 'false'), 'blocked');
  }
  assert.equal(classifyCollectorIntent({ headSha: head, exec: gitFixture() }).classification, 'intended');
  assert.equal(verifyCollectorEligibility({ headSha: head, exec: gitFixture(), api: () => { throw Error('API denied'); } }).eligible, false);
  const all = [...Object.keys(FIX_BLOBS), ...CONFIG_PATHS];
  const unrelated = gitFixture({ paths: [...all, 'nextjs/app/page.tsx'], correctionPaths: [...CORRECTION_PATHS, 'nextjs/app/page.tsx'] });
  assert.equal(classifyCollectorIntent({ headSha: head, exec: unrelated }).classification, 'normal');
  assert.equal(collectorJobDecision('success', 'false', 'false'), 'normal');
  assert.equal(classifyCollectorIntent({ headSha: head, exec: () => { throw Error('Git unavailable'); } }).classification, 'unavailable');
});

test('missing classifier decisions block expensive jobs and failure receipts reject inheritance while preserving 71-failure debt', () => {
  for (const result of ['success', 'failure', 'cancelled', 'skipped', undefined]) for (const intended of ['true', 'false', 'unknown', undefined]) for (const eligible of ['true', 'false', undefined]) {
    const expected = result === 'success' && intended === 'false' && eligible === 'false' ? 'normal' : result === 'success' && intended === 'true' && eligible === 'true' ? 'reuse' : 'blocked';
    assert.equal(collectorJobDecision(result, intended, eligible), expected);
  }
  const plan = failedCollectorPlan({ headSha: head, reason: 'API unavailable', intent: { classification: 'intended', intended: true } });
  const receipt = failedCollectorReceipt(plan);
  assert.equal(receipt.gate, 'failed');
  assert.equal(receipt.fullQualification, 'pending');
  assert.equal(receipt.runResults['collector-only-eligibility'], 'unqualified');
  assert.deepEqual(receipt.inheritedChecks, {});
  assert.ok(receipt.pendingDebt.includes(REGRESSION_DEBT));
  assert.equal(receipt.knownRegressionObservations[0].failed, 71);
  assert.equal(receipt.knownRegressionObservations[0].runId, 37330362300);
  const final = buildRepairReceipt(plan, { headSha: head, failures: ['collector eligibility failed'] });
  assert.equal(final.gate, 'failed');
  assert.deepEqual(final.inheritedChecks, {});
  assert.ok(final.pendingDebt.includes(REGRESSION_DEBT));
  const markerOnly = buildRepairReceipt(plan, { headSha: head });
  assert.equal(markerOnly.gate, 'failed');
  assert.deepEqual(markerOnly.passedGroupAnchors, {});
  assert.ok(markerOnly.gateFailures.some(reason => reason.includes('collector-only eligibility')));
});

test('actual workflow protocol blocks missing or failed classifier outputs and preserves failure debt', () => {
  const db = readFileSync(resolve(process.cwd(), '../.github/workflows/db-rehearsal.yml'), 'utf8');
  const script = db.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/)[1].replace(/^          /gm, '').replace("import('./nextjs/scripts/repair-collector-only.mjs')", 'import(' + JSON.stringify(new URL('./repair-collector-only.mjs', import.meta.url).href) + ')');
  const root = mkdtempSync(resolve(tmpdir(), 'repair-collector-protocol-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    for (const [result, intended, eligible, expected, nativeDatabase] of [['success', 'false', 'false', 0, 'false'], ['success', 'true', 'true', 0, 'false'], ['success', 'true', 'false', 0, 'true'], ['success', '', '', 1, 'false'], ['failure', 'true', 'false', 1, 'false'], ['success', 'true', 'false', 1, 'false'], ['success', 'false', 'false', 1, undefined], ['success', 'true', 'true', 1, 'true']]) {
      const run = spawnSync(process.execPath, ['--input-type=module'], { cwd: root, input: script, env: { ...process.env, CLASSIFIER_RESULT: result, INTENDED_RESULT: intended, ELIGIBLE_RESULT: eligible, NATIVE_DATABASE_RESULT: nativeDatabase, REPAIR_HEAD_SHA: head }, encoding: 'utf8' });
      assert.equal(run.status, expected, run.stderr);
      if (expected) {
        const receipt = JSON.parse(readFileSync(resolve(root, 'collector-only-failure-receipt.json'), 'utf8'));
        assert.equal(receipt.gate, 'failed');
        assert.deepEqual(receipt.inheritedChecks, {});
        assert.equal(receipt.databaseObservation, 'not executed; inherited evidence unaccepted');
        assert.ok(receipt.pendingDebt.includes(REGRESSION_DEBT));
        assert.ok(receipt.pendingDebt.includes('database-contract'));
        assert.deepEqual(receipt.pendingFullDebt, normal().pendingFullDebt);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('actual gate CLI rejects an eligibility-failure marker even when surrounding outcomes and its reason say success', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'repair-collector-failed-gate-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    const plan = failedCollectorPlan({ headSha: head, reason: 'success', intent: { classification: 'intended', intended: true } });
    writeFileSync(resolve(root, 'repair-plan.json'), JSON.stringify(plan));
    const env = { ...process.env, HEAD_SHA: head };
    for (const key of ['PLAN_RESULT', 'SECRET_RESULT', 'CHECK_RESULT', 'VITEST_RESULT', 'AUX_RESULT', 'WORKFLOW_RESULT']) env[key] = 'success';
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('./repair-scope-gate.mjs', import.meta.url))], { cwd: root, env, encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr);
    const receipt = JSON.parse(readFileSync(resolve(root, 'repair-receipt.json'), 'utf8'));
    assert.equal(receipt.gate, 'failed');
    assert.deepEqual(receipt.inheritedChecks, {});
    assert.ok(receipt.pendingDebt.includes(REGRESSION_DEBT));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

let nativeParentFixtureCache;
function nativeParentFixture() {
  if(!nativeParentFixtureCache){const endpoint=p=>JSON.parse(execFileSync('gh',['api','repos/0ssol1620-byte/tavonel-saas-foundation/'+p],{encoding:'utf8',timeout:20000})),value=process.env.NATIVE_DB_PARENT_EVIDENCE?JSON.parse(readFileSync(process.env.NATIVE_DB_PARENT_EVIDENCE,'utf8')):{run:endpoint('actions/runs/37387689345'),job:endpoint('actions/jobs/112025031853'),artifact:endpoint('actions/artifacts/11379078787')},archive=process.env.NATIVE_DB_PARENT_ARCHIVE?readFileSync(process.env.NATIVE_DB_PARENT_ARCHIVE):execFileSync('gh',['api','repos/0ssol1620-byte/tavonel-saas-foundation/actions/artifacts/11379078787/zip'],{timeout:20000});nativeParentFixtureCache={run:value.run,job:value.job,artifact:value.artifact,archive};}
  return {...structuredClone({run:nativeParentFixtureCache.run,job:nativeParentFixtureCache.job,artifact:nativeParentFixtureCache.artifact}),archive:Buffer.from(nativeParentFixtureCache.archive)};
}
function nativeApiFixture(fixture=nativeParentFixture()) {return p=>{const values={'actions/runs/37387689345':fixture.run,'actions/jobs/112025031853':fixture.job,'actions/artifacts/11379078787':fixture.artifact,'actions/artifacts/11379078787/zip':fixture.archive};if(!Object.hasOwn(values,p))throw Error('Unexpected native endpoint '+p);return Buffer.isBuffer(values[p])?Buffer.from(values[p]):structuredClone(values[p]);};}
function nativeGitFixture(options={}) {
  return (_command,original)=>{const args=original[0]==='-C'?original.slice(2):original;
    if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'native-fixture-root':options.checkout??head;
    if(args[0]==='rev-list')return args.at(-1)===native.NATIVE_DB_PARENT?`${native.NATIVE_DB_PARENT} ${options.grandparent??'203d14c615a99617e9073bfea3b2a281952f9b8f'}`:`${head} ${options.parent??native.NATIVE_DB_PARENT}`;
    if(args[0]==='merge-base'){if(options.ancestor===false)throw Error('Missing ancestry');return '';}
    if(args[0]==='diff'){if(args[1]==='--raw'){if(options.dirty)throw Error('Dirty native checkout');return '';}return (options.paths??[...new Set([...native.NATIVE_DB_CONFIG_PATHS,...Object.keys(native.NATIVE_DB_SOURCE_BLOBS)])]).join('\0')+'\0';}
    if(args[0]==='ls-tree'){const ref=args[2],p=args.at(-1),pin=native.NATIVE_DB_SOURCE_BLOBS[p];let oid=ref===native.COLLECTOR_BASE?native.NATIVE_DB_TRANSPORT_BLOBS[p]:pin?pin[ref===native.NATIVE_DB_PARENT?'before':'after']:ref===native.NATIVE_DB_PARENT?native.NATIVE_DB_PARENT_BLOBS[p]:native.NATIVE_DB_CONFIG_PATHS.includes(p)?gitBlob(published28dBytes(p)):native.NATIVE_DB_PARENT_BLOBS[p];if(options.badBlob===p)oid='f'.repeat(40);return oid?`${options.unsafe===p?'120000':'100644'} blob ${oid}\t${p}`:'';}
    if(args[0]==='show'){const p=args[1].slice(41),b=published28dBytes(p);return options.mutated===p?Buffer.concat([b,Buffer.from('\n')]):b;}
    throw Error('Unexpected native metadata query '+args.join(' '));
  };
}
function nativeProof(){return native.verifyNativeDbEligibility({headSha:head,exec:nativeGitFixture(),api:nativeApiFixture()});}
test('native DB source binds exact a3b, all16 paths, seven SQL payloads and transport dependencies before evidence reads',()=>{
  const proof=nativeProof();assert.equal(proof.eligible,true,proof.reason);assert.equal(proof.source.exactChangedPaths.length,16);assert.equal(proof.source.parent,native.NATIVE_DB_PARENT);assert.equal(Object.keys(proof.source.transportDependencyBlobs).length,16);
  const sql='supabase/drafts/native-purpose-candidate-reader.sql',runner='nextjs/scripts/run-repair-check.mjs';
  for(const options of [{checkout:'f'.repeat(40)},{parent:'f'.repeat(40)},{grandparent:'f'.repeat(40)},{ancestor:false},{dirty:true},{badBlob:sql},{mutated:sql},{unsafe:sql},{badBlob:runner},{badBlob:'nextjs/lib/r2-presign.ts'},{mutated:'nextjs/scripts/repair-scope-gate.mjs'},{paths:native.NATIVE_DB_CONFIG_PATHS},{paths:[...proof.source.exactChangedPaths,'nextjs/lib/auth.ts']}]){let reads=0;const result=native.verifyNativeDbEligibility({headSha:head,exec:nativeGitFixture(options),api:()=>{reads++;throw Error('Evidence must not be read');}});assert.equal(result.eligible,false,JSON.stringify(options));assert.equal(reads,0);}
});
test('native parent proof requires actual a3b run, receipt digest,659/22 units,158 browsers and all captures',()=>{
  const f=nativeParentFixture();assert.equal(native.verifyNativeDbParentEvidence(f).eligible,true);
  for(const mutate of [x=>x.run.head_sha=head,x=>x.run.run_attempt=2,x=>x.job.steps.find(s=>s.name==='Require exact file-backed Home and Pricing captures').conclusion='failure',x=>x.artifact.expired=true,x=>x.artifact.workflow_run.head_sha=head,x=>x.archive[100]^=1]){const changed=nativeParentFixture();mutate(changed);assert.equal(native.verifyNativeDbParentEvidence(changed).eligible,false);}
});
test('native Repair plan selects only owning and canonical source tests, retains DB debt and truthful historical transport',()=>{
  const proof=nativeProof(),normal={headSha:head,repairAnchorSha:native.FULL_ANCHOR,groups:['unknown'],unitFiles:[],browserFiles:['e2e/site-nav.spec.ts'],unknownPaths:['native'],runFullHermeticVitest:true},plan=native.nativeDbPlan(normal,proof);
  assert.deepEqual(plan.unitFiles,['lib/db-rehearsal-workflow.test.ts','lib/pgtap-fixtures.test.ts']);assert.deepEqual(plan.browserFiles,[]);assert.deepEqual(plan.unknownPaths,[]);
  for(const name of ['runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','runDatabaseRehearsal'])assert.equal(plan[name],false);
  assert.equal(plan.runWorkflowStaticGate,true);assert.equal(plan.inheritedChecks.database,undefined);assert.equal(plan.databaseBaselineEvidence,undefined);assert.equal(plan.knownRegressionResolution.passed,433);assert.match(plan.inheritedChecks.storageTransport.status,/historical.*not executed/);assert.deepEqual(native.nativeDbLineageFailures(plan,proof),[]);
  for(const change of [{unitFiles:[]},{browserFiles:['e2e/site-nav.spec.ts']},{deferredGroups:[]},{pendingQualificationDebt:[]},{pendingFullDebt:[]},{inheritedChecks:{...plan.inheritedChecks,database:{status:'success'}}},{nativeDbRehearsal:{eligible:true}},{runFullHermeticVitest:true}])assert.ok(native.nativeDbLineageFailures({...plan,...change},proof).length);
  const receipt=buildRepairReceipt(plan,{headSha:head,databaseResult:'success'});assert.equal(receipt.gate,'passed-scoped-only');assert.equal(receipt.runResults['database-contract'],'pending-deferred');assert.ok(receipt.pendingDebt.includes('database-contract'));assert.match(receipt.databaseObservation,/no DB inheritance accepted/);assert.equal(receipt.inheritedChecks.database,undefined);assert.match(receipt.inheritedChecks.storageTransport.status,/not executed/);
});
test('native DB decision permits fresh DB only and fails missing/contradictory classifier outputs',()=>{
  assert.deepEqual(native.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'false',nativeDatabase:'true'}),{explicit:true,runDatabase:true,runTransport:false});
  assert.deepEqual(native.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'true',nativeDatabase:'false'}),{explicit:true,runDatabase:false,runTransport:false});
  assert.deepEqual(native.nativeDbJobDecision({classifierResult:'success',intended:'false',eligible:'false',nativeDatabase:'false'}),{explicit:true,runDatabase:true,runTransport:true});
  for(const classifierResult of ['failure','cancelled','skipped',undefined])assert.deepEqual(native.nativeDbJobDecision({classifierResult,intended:'true',eligible:'false',nativeDatabase:'true'}),{explicit:false,runDatabase:false,runTransport:false});
  for(const [intended,eligible,nativeDatabase]of [['true','false','false'],['false','false','true'],['true','true','true'],['true','false',undefined]])assert.deepEqual(native.nativeDbJobDecision({classifierResult:'success',intended,eligible,nativeDatabase}),{explicit:false,runDatabase:false,runTransport:false});
});
test('native CLI rejects unavailable scope before normal planning and keeps failure receipts for both entry modes',()=>{
  for(const mode of ['plan','eligibility']){const temp=mkdtempSync(resolve(tmpdir(),'native-db-invalid-cli-'));try{const run=spawnSync(process.execPath,[resolve(nativeRoot,'nextjs/scripts/repair-collector-only.mjs'),mode],{cwd:temp,env:{...process.env,REPAIR_HEAD_SHA:head,GITHUB_OUTPUT:''},encoding:'utf8'});assert.equal(run.status,1);assert.match(run.stderr,/no installation or broad fallback/);const receipt=JSON.parse(readFileSync(resolve(temp,'collector-only-failure-receipt.json'),'utf8'));assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.inheritedChecks,{});assert.ok(receipt.pendingDebt.includes('database-contract'));assert.equal(receipt.fullQualification,'pending');}finally{rmSync(temp,{recursive:true,force:true});}}
});
test('native final gate rejects unqualified proof even with synthetic successful check and DB outcomes',()=>{
  const proof=nativeProof(),plan=native.nativeDbPlan({headSha:head,repairAnchorSha:native.FULL_ANCHOR},proof),temp=mkdtempSync(resolve(tmpdir(),'native-db-failed-gate-'));try{writeFileSync(resolve(temp,'repair-plan.json'),JSON.stringify(plan));const env={...process.env,HEAD_SHA:head,DATABASE_REHEARSAL_RESULT:'success'};for(const key of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT'])env[key]='success';const run=spawnSync(process.execPath,[resolve(nativeRoot,'nextjs/scripts/repair-scope-gate.mjs')],{cwd:temp,env,encoding:'utf8'});assert.equal(run.status,1);const receipt=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));assert.equal(receipt.gate,'failed');assert.ok(receipt.pendingDebt.includes('database-contract'));assert.equal(receipt.inheritedChecks.database,undefined);assert.equal(receipt.inheritedChecks.storageTransport.status,'not accepted for current head');}finally{rmSync(temp,{recursive:true,force:true});}
});
test('required native pgTAP gate rejects requested/checkout mismatch and skipped passes before any acceptance claim',()=>{
  const workflow=readFileSync(resolve(nativeRoot,'.github/workflows/db-rehearsal.yml'),'utf8'),block=workflow.slice(workflow.indexOf('      - name: Require both disposable pgTAP passes for exact native SQL')),start=block.indexOf("node --input-type=module <<'NODE'\n")+"node --input-type=module <<'NODE'\n".length,script=block.slice(start,block.indexOf('\n          NODE',start)).replace(/^ {10}/gm,''),temp=mkdtempSync(resolve(tmpdir(),'native-db-exact-head-gate-'));try{const env={...process.env,NATIVE_SCOPE_REQUIRED:'true',NATIVE_REQUESTED_HEAD:head,NATIVE_CHECKOUT_HEAD:'f'.repeat(40),NATIVE_STAGE_RESULT:'success',NATIVE_STATE:'ephemeral',FIRST_PGTAP_RESULT:'success',SECOND_PGTAP_RESULT:'skipped'};const run=spawnSync(process.execPath,['--input-type=module'],{cwd:temp,env,input:script,encoding:'utf8'});assert.equal(run.status,1);const receipt=JSON.parse(readFileSync(resolve(temp,'native-sql-rehearsal-receipt.json'),'utf8'));assert.equal(receipt.gate,'failed');assert.match(JSON.stringify(receipt),/exact requested head/);assert.match(JSON.stringify(receipt),/second pgTAP outcome: skipped/);}finally{rmSync(temp,{recursive:true,force:true});}
});


function pageGitFixture(options={}) {
  const configs=pages.PUBLIC_PAGES_CONFIG_PATHS,source=pages.PUBLIC_PAGES_SOURCE_BLOBS;
  return (_cmd,original)=>{const args=original[0]==='-C'?original.slice(2):original,p=args.at(-1);
    if(args[0]==='rev-parse')return p==='--show-toplevel'?nativeRoot:p===`${pages.PUBLIC_PAGES_SOURCE_PARENT}^{tree}`?options.parentTree??pages.PUBLIC_PAGES_SOURCE_PARENT_TREE:options.checkout??head;
    if(args[0]==='rev-list')return p===pages.PUBLIC_PAGES_SOURCE_PARENT?`${p} ${options.grandparent??pages.PUBLIC_PAGES_SOURCE_PARENT_BASE}`:`${head} ${options.parent??pages.PUBLIC_PAGES_SOURCE_PARENT}`;
    if(args[0]==='merge-base'){if(options.ancestor===false)throw Error('Missing ancestry');return '';}
    if(args[0]==='diff'){if(args[1]==='--raw'){if(options.dirty)throw Error('Dirty pages');return '';}return (options.paths??[...configs,...pages.PUBLIC_PAGES_CHANGED_SOURCES]).join('\0')+'\0';}
    if(args[0]==='ls-tree'){const ref=args[2],pin=source[p];let oid=pin?pin[ref===pages.PUBLIC_PAGES_SOURCE_PARENT?'before':'after']:ref===pages.PUBLIC_PAGES_SOURCE_PARENT?pages.PUBLIC_PAGES_PARENT_CONFIG_BLOBS[p]??pages.PUBLIC_PAGES_DB_BLOBS[p]??pages.PUBLIC_PAGES_PARENT_CHECKPOINT_BLOBS[p]??pages.NATIVE_DB_TRANSPORT_BLOBS[p]:configs.includes(p)||pages.CONFIG_PATHS.includes(p)||pages.PUBLIC_PAGES_PARENT_CHECKPOINT_BLOBS[p]&&!pages.PUBLIC_PAGES_DB_BLOBS[p]?gitBlob(published852Bytes(p)):pages.PUBLIC_PAGES_DB_BLOBS[p]??pages.NATIVE_DB_TRANSPORT_BLOBS[p];if(options.badBlob===p)oid='f'.repeat(40);return oid?`${options.unsafe===p?'120000':'100644'} blob ${oid}\t${p}`:'';}
    if(args[0]==='show'){const p=args[1].slice(41),b=published852Bytes(p);return options.mutated===p?Buffer.concat([b,Buffer.from('\n')]):b;}throw Error('Unexpected page source query '+args.join(' '));
  };
}
let pageEvidenceCache;
function pageEvidenceFixture(){
  if(!pageEvidenceCache){const endpoint=p=>JSON.parse(execFileSync('gh',['api','repos/0ssol1620-byte/tavonel-saas-foundation/'+p],{encoding:'utf8',timeout:20000})),archive=id=>execFileSync('gh',['api',`repos/0ssol1620-byte/tavonel-saas-foundation/actions/artifacts/${id}/zip`],{timeout:20000}),m=process.env.PUBLIC_PAGES_EVIDENCE?JSON.parse(readFileSync(process.env.PUBLIC_PAGES_EVIDENCE)):Object.fromEntries([['repairRun','actions/runs/37396201379'],['repairJob','actions/jobs/112052635651'],['repairArtifact','actions/artifacts/11382378932'],['dbRun','actions/runs/37396201273'],['dbJob','actions/jobs/112052706651'],['dbArtifact','actions/artifacts/11382619023']].map(([k,p])=>[k,endpoint(p)]));pageEvidenceCache={...m,repairArchive:process.env.PUBLIC_PAGES_REPAIR_ARCHIVE?readFileSync(process.env.PUBLIC_PAGES_REPAIR_ARCHIVE):archive(11382378932),dbArchive:process.env.PUBLIC_PAGES_DB_ARCHIVE?readFileSync(process.env.PUBLIC_PAGES_DB_ARCHIVE):archive(11382619023),priorUi:nativeParentFixture()};}const f=structuredClone(pageEvidenceCache);f.repairArchive=Buffer.from(f.repairArchive);f.dbArchive=Buffer.from(f.dbArchive);f.priorUi.archive=Buffer.from(f.priorUi.archive);return f;
}
function pageApiFixture(f=pageEvidenceFixture()){const values={'actions/runs/37396201379':f.repairRun,'actions/jobs/112052635651':f.repairJob,'actions/artifacts/11382378932':f.repairArtifact,'actions/artifacts/11382378932/zip':f.repairArchive,'actions/runs/37396201273':f.dbRun,'actions/jobs/112052706651':f.dbJob,'actions/artifacts/11382619023':f.dbArtifact,'actions/artifacts/11382619023/zip':f.dbArchive,...Object.fromEntries(['run','job','artifact','archive'].map((k,i)=>[['actions/runs/37387689345','actions/jobs/112025031853','actions/artifacts/11379078787','actions/artifacts/11379078787/zip'][i],f.priorUi[k]]))};return p=>{if(!Object.hasOwn(values,p))throw Error('Unexpected pages API '+p);return p.endsWith('/zip')?Buffer.from(values[p]):values[p];};}
function pageProof(){return pages.verifyPublicPagesEligibility({headSha:head,exec:pageGitFixture(),api:pageApiFixture()});}
test('public product heading correction binds exact1f894, two source deltas, three config owners and seven unchanged UI pins before evidence reads',()=>{
  const source=pages.verifyPublicPagesSource({headSha:head,exec:pageGitFixture()});assert.equal(source.eligible,true,source.reason);assert.equal(source.exactChangedPaths.length,5);
  for(const options of [{checkout:'f'.repeat(40)},{parent:'f'.repeat(40)},{grandparent:'f'.repeat(40)},{parentTree:'f'.repeat(40)},{ancestor:false},{dirty:true},{paths:pages.PUBLIC_PAGES_CONFIG_PATHS},...pages.PUBLIC_PAGES_CHANGED_SOURCES.map(p=>({paths:source.exactChangedPaths.filter(q=>q!==p)})),{paths:[...source.exactChangedPaths,'nextjs/lib/auth.ts']},{badBlob:'supabase/tests/global_collection_compile.sql'},{badBlob:'nextjs/lib/r2-presign.ts'},...Object.keys(pages.PUBLIC_PAGES_SOURCE_BLOBS).flatMap(p=>[{badBlob:p},{mutated:p},{unsafe:p}])]){let reads=0;const proof=pages.verifyPublicPagesEligibility({headSha:head,exec:pageGitFixture(options),api:()=>{reads++;throw Error('Must not read evidence');}});assert.equal(proof.eligible,false,JSON.stringify(options));assert.equal(reads,0);}
});
test('public product proof authenticates both exact28d artifact bytes and preserves native UNRUN debt',()=>{
  const proof=pageProof();assert.equal(proof.eligible,true,proof.reason);assert.equal(proof.evidence.nativeSql.receipt.realConcurrency,'UNRUN');assert.equal(proof.evidence.nativeSql.receipt.canonicalPinnedRowCrossSessionFk,'UNRUN');assert.equal(proof.evidence.parentUi.browserPassed,158);
  for(const mutate of [f=>f.repairRun.head_sha=head,f=>f.dbRun.head_sha=head,f=>f.repairArtifact.expired=true,f=>f.dbArtifact.expired=true,f=>f.repairJob.steps.find(s=>s.name==='Run Foundation focused unit checks').conclusion='skipped',f=>f.dbJob.steps.find(s=>s.name==='Run the pgTAP suite').conclusion='skipped',f=>f.repairArchive[100]^=1,f=>f.dbArchive[100]^=1]){const f=pageEvidenceFixture();mutate(f);assert.equal(pages.verifyPublicPagesEvidence(f).eligible,false);}
});
test('public product plan requires four owner suites, three configured browser groups and sixteen fresh captures',()=>{
  const proof=pageProof();assert.equal(proof.eligible,true,proof.reason);const normal={headSha:head,repairAnchorSha:pages.FULL_ANCHOR},plan=pages.publicPagesPlan(normal,proof);assert.equal(plan.unitFiles.length,4);assert.equal(plan.requirePublicProductCaptures,true);assert.equal(plan.runFullHermeticVitest,false);assert.equal(plan.runCdrWorkerChecks,false);assert.deepEqual(plan.pendingQualificationDebt,['database-contract']);assert.equal(plan.inheritedChecks.nativeSql.sourceHead,pages.PUBLIC_PAGES_PARENT);assert.deepEqual(pages.publicPagesLineageFailures(plan,proof),[]);
  for(const [key,value]of [['unitFiles',plan.unitFiles.slice(1)],['browserFiles',[]],['requirePublicProductCaptures',false],['pendingFullDebt',[]],['pendingQualificationDebt',[]],['fullQualification','passed'],['inheritedChecks',{}]])assert.ok(pages.publicPagesLineageFailures({...plan,[key]:value},proof).length,key);
  const receipt=buildRepairReceipt(plan,{headSha:head,databaseResult:'success'});assert.match(receipt.databaseObservation,/not executed at page head/);assert.ok(receipt.pendingDebt.includes('database-contract'));assert.equal(receipt.fullQualification,'pending');assert.throws(()=>pages.publicPagesPlan({...normal,repairAnchorSha:head},proof));
});
test('public product failed admission preserves authenticated historical resolution without accepting inheritance',()=>{
  const receipt=pages.failedCollectorReceipt(pages.failedCollectorPlan({headSha:head,reason:'Changed source',intent:{parent:pages.PUBLIC_PAGES_SOURCE_PARENT}})),preserved=pages.authenticateFailedPublicPagesResolution(receipt,{intent:{parent:pages.PUBLIC_PAGES_SOURCE_PARENT},api:nativeApiFixture()});assert.equal(preserved.knownRegressionResolution.passed,433);assert.equal(preserved.knownRegressionResolution.catalogue.passed,13);assert.deepEqual(preserved.inheritedChecks,{});assert.equal(preserved.gate,'failed');assert.equal(preserved.fullQualification,'pending');assert.ok(preserved.pendingDebt.includes('database-contract'));assert.ok(preserved.pendingDebt.includes('public-product-pages'));assert.deepEqual(preserved.historicalUiFailure,native.verifyNativeDbParentEvidence(nativeParentFixture()).historicalUiFailure);
});
test('public product final gate rejects synthetic success without exact source and actual report/capture evidence',()=>{
  const proof=pageProof();assert.equal(proof.eligible,true,proof.reason);const plan=pages.publicPagesPlan({headSha:head,repairAnchorSha:pages.FULL_ANCHOR},proof),temp=mkdtempSync(resolve(tmpdir(),'public-product-invalid-gate-'));try{writeFileSync(resolve(temp,'repair-plan.json'),JSON.stringify(plan));const env={...process.env,HEAD_SHA:head,DATABASE_REHEARSAL_RESULT:'success'};for(const k of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT','TARGETED_REPAIR_UNIT_RESULT','TRANSITIVE_TEST_RESULT','PUBLIC_PRODUCT_CAPTURE_RESULT','BROWSER_INSTALL_RESULT','BROWSER_BUILD_RESULT','BROWSER_RESULT'])env[k]='success';const run=spawnSync(process.execPath,[resolve(nativeRoot,'nextjs/scripts/repair-scope-gate.mjs')],{cwd:temp,env,encoding:'utf8'});assert.equal(run.status,1);const r=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json')));assert.equal(r.gate,'failed');assert.equal(r.fullQualification,'pending');assert.ok(r.pendingDebt.includes('database-contract'));assert.ok(r.gateFailures.some(f=>f.includes('fresh public product execution')));assert.equal(r.inheritedChecks.nativeSql.status,'not accepted for current head');}finally{rmSync(temp,{recursive:true,force:true});}
});
function worldGitFixture(options={}) {
  const configs=Object.keys(world.NATIVE_WORLD_PARENT_CONFIG_BLOBS),sources=world.NATIVE_WORLD_SOURCE_BLOBS,dependencies={...world.PUBLIC_PAGES_DB_BLOBS,...world.NATIVE_DB_TRANSPORT_BLOBS,...world.NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(world.PUBLIC_PAGES_SOURCE_BLOBS).map(([p,pin])=>[p,pin.after]))};
  return (_command,original)=>{const args=original[0]==='-C'?original.slice(2):original,p=args.at(-1);
    if(args[0]==='rev-parse')return p==='--show-toplevel'?nativeRoot:p===`${world.NATIVE_WORLD_PARENT}^{tree}`?options.parentTree??world.NATIVE_WORLD_PARENT_TREE:options.checkout??head;
    if(args[0]==='rev-list')return p===world.NATIVE_WORLD_PARENT?`${p} ${options.grandparent??world.NATIVE_WORLD_PARENT_BASE}`:`${head} ${options.parent??world.NATIVE_WORLD_PARENT}`;
    if(args[0]==='merge-base'){if(options.ancestor===false)throw Error('Missing ancestry');return '';}
    if(args[0]==='diff'){if(args[1]==='--raw'){if(options.dirty)throw Error('Dirty World');return '';}return (options.paths??[...world.NATIVE_WORLD_CHANGED_SOURCES,...configs]).join('\0')+'\0';}
    if(args[0]==='ls-tree'){const parent=args[2]===world.NATIVE_WORLD_PARENT,pin=sources[p];let oid=pin?pin[parent?'before':'after']:parent?world.NATIVE_WORLD_PARENT_CONFIG_BLOBS[p]??dependencies[p]:configs.includes(p)||world.CONFIG_PATHS.includes(p)||worldRepairPaths.includes(p)?gitBlob(baselineBytes(p)):dependencies[p];if(options.badBlob===p)oid='f'.repeat(40);return oid?`${options.unsafe===p?'120000':'100644'} blob ${oid}\t${p}`:'';}
    if(args[0]==='show'){const p=args[1].slice(41),b=baselineBytes(p);return options.mutated===p?Buffer.concat([b,Buffer.from('\n')]):b;}throw Error('Unexpected World Git query '+args.join(' '));
  };
}
function worldEvidenceFixture(){const record=process.env.NATIVE_WORLD_UI_EVIDENCE?JSON.parse(readFileSync(process.env.NATIVE_WORLD_UI_EVIDENCE)):Object.fromEntries([['run','actions/runs/37408812981'],['job','actions/jobs/112092360049'],['artifact','actions/artifacts/11388921618'],['captures','actions/artifacts/11388152745']].map(([k,p])=>[k,JSON.parse(execFileSync('gh',['api','repos/0ssol1620-byte/tavonel-saas-foundation/'+p],{encoding:'utf8',timeout:20000}))]));return {...record,archive:process.env.NATIVE_WORLD_UI_ARCHIVE?readFileSync(process.env.NATIVE_WORLD_UI_ARCHIVE):execFileSync('gh',['api','repos/0ssol1620-byte/tavonel-saas-foundation/actions/artifacts/11388921618/zip'],{timeout:20000})};}
function worldApiFixture(f=worldEvidenceFixture()){const map={'actions/runs/37408812981':f.run,'actions/jobs/112092360049':f.job,'actions/artifacts/11388921618':f.artifact,'actions/artifacts/11388921618/zip':f.archive,'actions/artifacts/11388152745':f.captures};return p=>{if(!Object.hasOwn(map,p))throw Error('Unexpected World evidence '+p);return map[p];};}
function worldProof(){return world.verifyNativeDbEligibility({headSha:head,exec:worldGitFixture(),api:worldApiFixture()});}
test('Native World fixture correction binds exact744, four deltas, all eight sources and three seals before evidence reads',()=>{
  const proof=worldProof();assert.equal(proof.eligible,true,proof.reason);assert.equal(proof.source.profile,'native-world');assert.equal(proof.source.exactChangedPaths.length,7);assert.equal(Object.keys(proof.source.unchangedPublicSourceBlobs).length,9);
  const delta=proof.source.exactChangedPaths;for(const options of [{checkout:'f'.repeat(40)},{parent:'f'.repeat(40)},{grandparent:'f'.repeat(40)},{parentTree:'f'.repeat(40)},{ancestor:false},{dirty:true},...delta.map(p=>({paths:delta.filter(q=>q!==p)})),{paths:[...delta,'nextjs/lib/auth.ts']},{paths:[...delta,'supabase/drafts/native-world-reduction-commit.sql']},...Object.keys(world.NATIVE_WORLD_SOURCE_BLOBS).flatMap(p=>[{badBlob:p},{mutated:p},{unsafe:p}]),...Object.keys(world.NATIVE_WORLD_PREREQUISITE_BLOBS).map(p=>({badBlob:p})),...Object.keys(world.PUBLIC_PAGES_SOURCE_BLOBS).map(p=>({badBlob:p})),{badBlob:'nextjs/lib/r2-presign.ts'},{mutated:'nextjs/scripts/repair-scope-gate.mjs'}]){let reads=0;const value=world.verifyNativeDbEligibility({headSha:head,exec:worldGitFixture(options),api:()=>{reads++;throw Error('Must not read evidence');}});assert.equal(value.eligible,false,JSON.stringify(options));assert.equal(reads,0);}
});
test('Native World requires actual852 receipt bytes,27 configured cases plus legitimate skip and exact16 captures',()=>{
  const f=worldEvidenceFixture();assert.equal(world.verifyNativeWorldParentEvidence(f).eligible,true);for(const mutate of [f=>f.run.head_sha=head,f=>f.run.run_attempt=2,f=>f.run.conclusion='failure',f=>f.job.head_sha=head,f=>f.job.steps.find(s=>s.name==='Run selected browser checks against one production server').conclusion='skipped',f=>f.artifact.expired=true,f=>f.captures.expired=true,f=>f.captures.digest='sha256:'+'0'.repeat(64),f=>f.captures.workflow_run.id++,f=>f.archive[100]^=1]){const x=worldEvidenceFixture();mutate(x);assert.equal(world.verifyNativeWorldParentEvidence(x).eligible,false);}
});
test('Native World selects77 product cases,57 DB owners and canonical SQL contracts; fresh DB and closed gates remain',()=>{
  const proof=worldProof(),normal={headSha:head,repairAnchorSha:world.FULL_ANCHOR,groups:['unknown'],unitFiles:[],browserFiles:['e2e/site-nav.spec.ts'],unknownPaths:['World'],runFullHermeticVitest:true},plan=world.nativeDbPlan(normal,proof);assert.deepEqual(plan.unitFiles,['lib/native-world-reduction-commit.test.ts','lib/db-rehearsal-workflow.test.ts','lib/pgtap-fixtures.test.ts']);assert.deepEqual(plan.browserFiles,[]);assert.equal(plan.nativeWorldCommit.publicGate,false);assert.equal(plan.nativeWorldCommit.defaultServices,null);assert.equal(plan.nativeWorldCommit.trustedDbVerifier,'ABSENT');assert.equal(plan.nativeWorldCommit.productionAdapters,'ABSENT');assert.equal(plan.nativeWorldCommit.realConcurrency,'UNRUN');assert.equal(plan.nativeWorldCommit.canonicalPinnedRowCrossSessionFk,'UNRUN');assert.equal(plan.inheritedChecks.parentScopedUi.sourceHead,world.NATIVE_WORLD_UI_PARENT);assert.equal(plan.inheritedChecks.nativeSql,undefined);assert.equal(plan.databaseBaselineEvidence,undefined);
  for(const k of ['runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','requirePublicProductCaptures','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','runDatabaseRehearsal'])assert.equal(plan[k],false);assert.equal(plan.runWorkflowStaticGate,true);assert.deepEqual(world.nativeDbLineageFailures(plan,proof),[]);
  assert.deepEqual(world.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'false',nativeDatabase:'true'}),{explicit:true,runDatabase:true,runTransport:false});for(const change of [{unitFiles:[]},{browserFiles:['e2e/site-nav.spec.ts']},{pendingFullDebt:[]},{deferredGroups:[]},{inheritedChecks:{}},{nativeWorldCommit:{...plan.nativeWorldCommit,publicGate:true}},{requirePublicProductCaptures:true},{runFullHermeticVitest:true}])assert.ok(world.nativeDbLineageFailures({...plan,...change},proof).length);
  const receipt=buildRepairReceipt(plan,{headSha:head,databaseResult:'success'});assert.equal(receipt.gate,'passed-scoped-only');assert.equal(receipt.runResults['database-contract'],'pending-deferred');assert.ok(receipt.pendingDebt.includes('database-contract'));assert.match(receipt.databaseObservation,/fresh separate.*both disposable pgTAP.*no DB inheritance accepted/);
});
test('failed Native World preserves authenticated historical resolution while accepting no current UI or DB evidence',()=>{
  const receipt=world.failedCollectorReceipt(world.failedCollectorPlan({headSha:head,reason:'World SQL mutated',intent:{classification:'intended',intended:true,parent:world.NATIVE_WORLD_PARENT}})),preserved=world.authenticateFailedNativeResolution(receipt,{headSha:head,intended:'true',exec:worldGitFixture({mutated:'supabase/drafts/native-world-reduction-commit.sql'}),api:worldApiFixture()});assert.equal(preserved.gate,'failed');assert.deepEqual(preserved.inheritedChecks,{});assert.equal(preserved.knownRegressionResolution.passed,433);assert.ok(!preserved.pendingDebt.includes(world.REGRESSION_DEBT));assert.ok(preserved.pendingDebt.includes('database-contract'));assert.equal(preserved.fullQualification,'pending');
});
test('current collector routes exact623 Solutions intent before the published page and native profiles',()=>{
  const source=readFileSync(fileURLToPath(new URL('./repair-collector-only.mjs',import.meta.url)),'utf8'),cli=source.slice(source.lastIndexOf('if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))'));
  const solutions=cli.indexOf('classifySolutionsIntent({headSha})'),pages=cli.indexOf('classifyPublicPagesIntent({headSha})'),native=cli.indexOf('classifyNativeDbIntent({ headSha })');
  assert.ok(solutions>=0&&solutions<pages&&pages<native);
  const exec=paths=>(_command,args)=>{if(args[0]==='-C')args=args.slice(2);if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'fixture-root':head;if(args[0]==='rev-list')return `${head} ${world.SOLUTIONS_PARENT}`;if(args[0]==='diff')return paths.join('\0')+'\0';throw new Error('Unexpected Solutions git command: '+args.join(' '));};
  assert.equal(world.classifySolutionsIntent({headSha:head,exec:exec(['nextjs/lib/unrelated.ts'])}).classification,'normal');
  assert.equal(world.classifySolutionsIntent({headSha:head,exec:exec(['nextjs/scripts/repair-collector-only.test.mjs'])}).classification,'intended');
  assert.equal(world.verifySolutionsSource({headSha:head,intent:{classification:'unavailable',intended:true,headSha:head,parent:world.SOLUTIONS_PARENT,reason:'unreadable'}}).eligible,false);
});
// Actual exact623 Repair and native World evidence, read only through authenticated gh api.
const solutionsEndpoints=['actions/runs/37413409860','actions/jobs/112106655290','actions/artifacts/11390745419','actions/artifacts/11390745419/zip','actions/runs/37413409719','actions/jobs/112106717073','actions/artifacts/11390495928','actions/artifacts/11390495928/zip'];
let solutionsEvidenceCache;
function solutionsApiFixture(){solutionsEvidenceCache??=Object.fromEntries(solutionsEndpoints.map(p=>[p,p.endsWith('/zip')?execFileSync('gh',['api','repos/0ssol1620-byte/tavonel-saas-foundation/'+p],{timeout:20000,maxBuffer:1024*1024}):JSON.parse(execFileSync('gh',['api','repos/0ssol1620-byte/tavonel-saas-foundation/'+p],{encoding:'utf8',timeout:20000}))]));return p=>{if(!Object.hasOwn(solutionsEvidenceCache,p))throw Error('Unexpected Solutions evidence '+p);const v=solutionsEvidenceCache[p];return Buffer.isBuffer(v)?Buffer.from(v):structuredClone(v);};}
test('actual623 evidence authenticates the historical71 resolution carried into the Solutions plan',()=>{
  const api=solutionsApiFixture(),evidence=world.verifySolutionsParentEvidence(Object.fromEntries([['repairRun',0],['repairJob',1],['repairArtifact',2],['repairArchive',3],['dbRun',4],['dbJob',5],['dbArtifact',6],['dbArchive',7]].map(([k,i])=>[k,api(solutionsEndpoints[i])])));
  assert.equal(evidence.eligible,true,evidence.reason);assert.equal(evidence.knownRegressionResolution.headSha,'8956734a6675ae79d5081e77f551e0cb49cf8a39');assert.equal(evidence.knownRegressionResolution.passed,433);assert.equal(evidence.knownRegressionResolution.catalogue.passed,13);assert.deepEqual(evidence.knownRegressionObservations,[{...world.KNOWN_REGRESSION}]);assert.equal(evidence.historicalUiFailure.gate,'failed');
  const plan=world.solutionsPagesPlan({headSha:head,repairAnchorSha:world.FULL_ANCHOR,groups:[],unitFiles:[],browserFiles:[],unknownPaths:[]},{eligible:true,source:{eligible:true,headSha:head},evidence});assert.deepEqual(plan.knownRegressionResolution,evidence.knownRegressionResolution);assert.deepEqual(plan.knownRegressionObservations,evidence.knownRegressionObservations);assert.deepEqual(plan.historicalUiFailure,evidence.historicalUiFailure);
});
test('failed Solutions admission keeps historical71 resolved and records the current failure separately',()=>{
  const intent={classification:'intended',intended:true,headSha:head,parent:world.SOLUTIONS_PARENT},reason='Solutions source identity changed: nextjs/app/solutions/solutions.module.css';
  const {plan,receipt}=world.failedSolutionsReceipt({headSha:head,reason,intent,api:solutionsApiFixture()});
  assert.deepEqual(plan.currentAdmission,{profile:'solutions-workflows',headSha:head,parent:world.SOLUTIONS_PARENT,status:'failed',reason});assert.ok(!plan.pendingQualificationDebt.includes(world.REGRESSION_DEBT));assert.ok(plan.pendingQualificationDebt.includes('solutions-pages-eligibility'));
  assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.gateFailures,[reason]);assert.deepEqual(receipt.currentAdmission,plan.currentAdmission);assert.deepEqual(receipt.inheritedChecks,{});assert.equal(receipt.fullQualification,'pending');
  assert.equal(receipt.knownRegressionResolution.passed,433);assert.equal(receipt.knownRegressionResolution.headSha,'8956734a6675ae79d5081e77f551e0cb49cf8a39');assert.match(receipt.knownRegressionResolution.status,/historical.*retained.*current Solutions admission failed/);assert.equal(receipt.knownRegressionObservations[0].failed,71);
  assert.ok(!receipt.pendingDebt.includes(world.REGRESSION_DEBT));assert.ok(!receipt.pendingQualificationDebt.includes(world.REGRESSION_DEBT));for(const debt of ['database-contract','solutions-pages','solutions-pages-eligibility','native-world-real-concurrency'])assert.ok(receipt.pendingDebt.includes(debt),debt);
  // Without authenticated evidence the resolution is still historical, never resurrected as current unresolved debt.
  const offline=world.failedSolutionsReceipt({headSha:head,reason,intent,api:()=>{throw Error('offline');}}).receipt;assert.equal(offline.knownRegressionResolution,undefined);assert.equal(offline.historicalRegressionResolution.sourceHead,'8956734a6675ae79d5081e77f551e0cb49cf8a39');assert.ok(!offline.pendingDebt.includes(world.REGRESSION_DEBT));assert.equal(offline.currentAdmission.status,'failed');assert.equal(offline.gate,'failed');
  // A Solutions-parent failure never borrows the failed424 browser history that belongs to the Explore repair.
  assert.equal(plan.historicalBrowserFailure,undefined);assert.equal(receipt.historicalBrowserFailure,undefined);
});
// Explore repair: one direct child of failed424; the five final UI owners, seven CI paths and the unchanged workflow blob.
test('Explore repair pins the five final UI identities, the eleven-source623 tree and the unchanged exact424 workflow',()=>{
  assert.equal(world.EXPLORE_REPAIR_PARENT,'424f5737752d723bcd81ad7d06b7d977880a1b02');
  assert.deepEqual(Object.fromEntries(Object.entries(world.EXPLORE_REPAIR_SOURCE_BLOBS).map(([p,v])=>[p,[v.after,v.bytes]])),{
    'nextjs/app/explore/page.tsx':['5c247a99e23015994b83ac2e3fa388a6c00ed750',7475],
    'nextjs/components/explore/explore-stage.tsx':['d149e38dc68bae082a52596740b14b0f071c17f6',24738],
    'nextjs/lib/solution-workflows.test.ts':['7df199503c8014f7ccf5f13df689dacbb4c5265a',11835],
    'nextjs/e2e/solutions-workflows.spec.ts':['7e2720289a104e34b192ce66017aacafef06ccd0',13183],
    'nextjs/e2e/explore.spec.ts':['961f4fdafd3e12bb790cebdd08560f607d40a64f',36447],
  });
  assert.deepEqual({...world.EXPLORE_REPAIR_PATCH},{bytes:23477,sha256:'d43e6db490097f1041a21cb649df7dbbdd624567671db8fdea645f78b3e3380b',filesChanged:5});
  // Updated Solutions owners start from their exact623-child (424) pins; the six others stay byte-identical.
  for(const [p,pin] of Object.entries(world.EXPLORE_REPAIR_SOURCE_BLOBS))if(Object.hasOwn(world.SOLUTIONS_SOURCE_BLOBS,p))assert.equal(pin.before,world.SOLUTIONS_SOURCE_BLOBS[p].after,p);
  assert.deepEqual([...world.EXPLORE_REPAIR_ADDED_OWNERS],['nextjs/app/explore/page.tsx','nextjs/components/explore/explore-stage.tsx','nextjs/e2e/explore.spec.ts']);
  assert.deepEqual([...world.EXPLORE_REPAIR_UNCHANGED_SOLUTIONS_SOURCES].sort(),['nextjs/app/solutions/[slug]/page.tsx','nextjs/app/solutions/page.tsx','nextjs/app/solutions/solution-workflow-proof.tsx','nextjs/app/solutions/solutions.module.css','nextjs/lib/solution-proof-sample.test.ts','nextjs/lib/solutions-hub.test.ts']);
  assert.equal(world.EXPLORE_REPAIR_TREE_SOURCES.length,11);assert.deepEqual([...world.EXPLORE_REPAIR_TREE_SOURCES],[...world.SOLUTIONS_CHANGED_SOURCES,...world.EXPLORE_REPAIR_ADDED_OWNERS].sort());
  assert.equal(world.EXPLORE_REPAIR_CONFIG_PATHS.length,7);assert.ok(!world.EXPLORE_REPAIR_CONFIG_PATHS.includes(world.EXPLORE_REPAIR_WORKFLOW_PATH));for(const p of world.EXPLORE_REPAIR_CONFIG_PATHS)assert.ok(world.SOLUTIONS_CONFIG_PATHS.includes(p),p);
  assert.ok(!world.EXPLORE_REPAIR_CONFIG_PATHS.includes('nextjs/scripts/repair-known-regression.test.mjs'));
  assert.deepEqual([world.EXPLORE_REPAIR_WORKFLOW_PATH,world.EXPLORE_REPAIR_WORKFLOW_BLOB],['.github/workflows/repair-scope.yml','0990f734a31660dd5a29164f5cb0068aaac91b6c']);
  assert.deepEqual([...world.EXPLORE_REPAIR_UNIT_FILES],['lib/solutions-hub.test.ts','lib/solution-proof-sample.test.ts','lib/solution-workflows.test.ts','lib/solutions-thumbnails.test.ts']);
  assert.deepEqual({...world.EXPLORE_REPAIR_FAILED_PARENT},{sourceHead:world.EXPLORE_REPAIR_PARENT,parent:world.SOLUTIONS_PARENT,profile:'solutions-workflows',scope:'browser',outcome:'failure',status:'historical failed424 browser evidence only; not inherited for the Explore repair head'});
});
test('current collector routes exact424 Explore repair intent before Solutions, published pages and native profiles',()=>{
  const source=readFileSync(fileURLToPath(new URL('./repair-collector-only.mjs',import.meta.url)),'utf8'),cli=source.slice(source.lastIndexOf('if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))'));
  const explore=cli.indexOf('classifyExploreRepairIntent({headSha})'),solutions=cli.indexOf('classifySolutionsIntent({headSha})'),pages=cli.indexOf('classifyPublicPagesIntent({headSha})'),native=cli.indexOf('classifyNativeDbIntent({ headSha })');
  assert.ok(explore>=0&&explore<solutions&&solutions<pages&&pages<native);
  const exec=({paths,parent=world.EXPLORE_REPAIR_PARENT,checkout=head,merge=false})=>(_command,args)=>{if(args[0]==='-C')args=args.slice(2);if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'fixture-root':checkout;if(args[0]==='rev-list')return `${head} ${parent}${merge?' '+'a'.repeat(40):''}`;if(args[0]==='diff')return paths.join('\0')+'\0';throw new Error('Unexpected Explore git command: '+args.join(' '));};
  const classify=options=>world.classifyExploreRepairIntent({headSha:head,exec:exec(options)});
  assert.equal(classify({paths:['nextjs/lib/unrelated.ts']}).classification,'normal');
  for(const p of ['nextjs/scripts/repair-collector-only.test.mjs','nextjs/e2e/explore.spec.ts','nextjs/app/solutions/page.tsx','.github/workflows/repair-scope.yml']){const intent=classify({paths:[p]});assert.equal(intent.classification,'intended',p);assert.equal(intent.profile,'explore-repair',p);assert.equal(intent.parent,world.EXPLORE_REPAIR_PARENT,p);}
  // The exact623 parent stays with the Solutions classifier; metadata failures on424 fail closed.
  assert.equal(classify({paths:['nextjs/e2e/explore.spec.ts'],parent:world.SOLUTIONS_PARENT}).classification,'normal');
  for(const options of [{paths:['nextjs/e2e/explore.spec.ts'],checkout:'f'.repeat(40)},{paths:['nextjs/e2e/explore.spec.ts'],merge:true}]){const intent=classify(options);assert.equal(intent.classification,'unavailable');assert.equal(intent.intended,true);}
  assert.equal(world.classifyExploreRepairIntent({headSha:undefined,exec:exec({paths:['nextjs/e2e/explore.spec.ts']})}).classification,'normal');
  for(const intent of [{classification:'unavailable',intended:true,headSha:head,parent:world.EXPLORE_REPAIR_PARENT,reason:'unreadable'},{classification:'intended',intended:true,headSha:head,parent:world.SOLUTIONS_PARENT,paths:[]}]){const value=world.verifyExploreRepairSource({headSha:head,intent});assert.equal(value.eligible,false);assert.match(value.reason,/exact direct child of424/);}
});
test('failed Explore repair admission keeps historical71 resolved, retains failed424 browser history and accepts no inheritance',()=>{
  const intent={classification:'intended',intended:true,headSha:head,parent:world.EXPLORE_REPAIR_PARENT},reason='Explore repair source identity changed: nextjs/e2e/explore.spec.ts';
  const {plan,receipt}=world.failedExploreRepairReceipt({headSha:head,reason,intent,api:solutionsApiFixture()});
  assert.deepEqual(plan.currentAdmission,{profile:'explore-repair',headSha:head,parent:world.EXPLORE_REPAIR_PARENT,status:'failed',reason});assert.ok(plan.pendingQualificationDebt.includes('explore-repair-eligibility'));assert.ok(!plan.pendingQualificationDebt.includes(world.REGRESSION_DEBT));
  assert.deepEqual(plan.historicalBrowserFailure,{...world.EXPLORE_REPAIR_FAILED_PARENT});
  assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.gateFailures,[reason]);assert.deepEqual(receipt.currentAdmission,plan.currentAdmission);assert.deepEqual(receipt.inheritedChecks,{});assert.equal(receipt.fullQualification,'pending');
  assert.deepEqual(receipt.historicalBrowserFailure,{...world.EXPLORE_REPAIR_FAILED_PARENT});assert.equal(receipt.historicalBrowserFailure.outcome,'failure');
  assert.equal(receipt.knownRegressionResolution.headSha,'8956734a6675ae79d5081e77f551e0cb49cf8a39');assert.match(receipt.knownRegressionResolution.status,/historical.*retained.*current Explore repair admission failed/);assert.equal(receipt.knownRegressionObservations[0].failed,71);
  assert.ok(!receipt.pendingDebt.includes(world.REGRESSION_DEBT));assert.ok(!receipt.pendingQualificationDebt.includes(world.REGRESSION_DEBT));for(const debt of ['database-contract','explore-repair','explore-repair-eligibility',...world.EXPLORE_REPAIR_PENDING_DEBT])assert.ok(receipt.pendingDebt.includes(debt),debt);
  assert.ok(!receipt.pendingDebt.includes('solutions-pages'));
  const offline=world.failedExploreRepairReceipt({headSha:head,reason,intent,api:()=>{throw Error('offline');}}).receipt;
  assert.equal(offline.knownRegressionResolution,undefined);assert.equal(offline.historicalRegressionResolution.sourceHead,'8956734a6675ae79d5081e77f551e0cb49cf8a39');assert.deepEqual(offline.historicalBrowserFailure,{...world.EXPLORE_REPAIR_FAILED_PARENT});assert.ok(!offline.pendingDebt.includes(world.REGRESSION_DEBT));assert.equal(offline.currentAdmission.profile,'explore-repair');assert.equal(offline.gate,'failed');
  // A different parent never receives the Explore failure shape.
  assert.equal(world.failedCollectorPlan({headSha:head,reason,intent:{...intent,parent:world.SOLUTIONS_PARENT}}).historicalBrowserFailure,undefined);
});
test('DB decision after a failed Explore admission without classifier outputs re-derives exact424 intent and removes only the re-added71 debt',()=>{
  // The unchanged DB workflow re-adds the71 debt after a failed classifier, then authenticates with the (absent) intended output.
  const db=readFileSync(resolve(process.cwd(),'../.github/workflows/db-rehearsal.yml'),'utf8');
  for(const line of ['INTENDED_RESULT: ${{ steps.scope.outputs.intended }}',"receipt.pendingDebt = [...new Set([...(receipt.pendingDebt ?? []), 'database-contract', 'hermetic-vitest-71-failures-triage'])];",'receipt = authenticateFailedNativeResolution(receipt, {headSha:env.REPAIR_HEAD_SHA,intended:env.INTENDED_RESULT});'])assert.ok(db.includes(line),line);
  const reason='Explore repair source identity changed: nextjs/e2e/explore.spec.ts',intent={classification:'intended',intended:true,headSha:head,parent:world.EXPLORE_REPAIR_PARENT};
  // runExploreRepairMode writes this receipt and exits before any classifier output exists.
  const written=world.failedExploreRepairReceipt({headSha:head,reason,intent,api:solutionsApiFixture()}).receipt;assert.ok(!written.pendingDebt.includes(world.REGRESSION_DEBT));
  const decision=intended=>{for(const missing of [undefined,''])assert.equal(world.nativeDbJobDecision({classifierResult:'failure',intended,eligible:missing,nativeDatabase:missing}).explicit,false);assert.notEqual(intended,'true');
    const receipt=structuredClone(written);receipt.pendingFullDebt=[...new Set([...(receipt.pendingFullDebt??[]),'PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'])];receipt.pendingDebt=[...new Set([...(receipt.pendingDebt??[]),'database-contract','hermetic-vitest-71-failures-triage'])];receipt.databaseObservation='not executed; inherited evidence unaccepted';receipt.inheritedChecks={};return receipt;};
  const exact=[...world.EXPLORE_REPAIR_CHANGED_SOURCES,...world.EXPLORE_REPAIR_CONFIG_PATHS].sort();
  const exec=({paths=exact,parent=world.EXPLORE_REPAIR_PARENT,checkout=head,merge=false,broken=false}={})=>(_command,args)=>{if(broken)throw Error('git unavailable');if(args[0]==='-C')args=args.slice(2);if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'fixture-root':checkout;if(args[0]==='rev-list')return `${head} ${parent}${merge?' '+'a'.repeat(40):''}`;if(args[0]==='diff')return paths.join('\0')+'\0';throw new Error('Unexpected Explore git command: '+args.join(' '));};
  const nativeCalls=[],nativeApi=p=>{nativeCalls.push(p);throw Error('native evidence must not be read for Explore');};
  for(const intended of [undefined,'']){
    const before=decision(intended);assert.ok(before.pendingDebt.includes(world.REGRESSION_DEBT));
    const resolved=world.authenticateFailedNativeResolution(structuredClone(before),{headSha:head,intended,exec:exec(),api:nativeApi,exploreApi:solutionsApiFixture()});
    // Exactly the independently resolved debt goes; gate, original failure, history, debts and pending qualification stay.
    assert.deepEqual(resolved,{...before,pendingDebt:before.pendingDebt.filter(d=>d!==world.REGRESSION_DEBT).sort()});
    assert.equal(resolved.gate,'failed');assert.deepEqual(resolved.gateFailures,[reason]);assert.deepEqual(resolved.currentAdmission,{profile:'explore-repair',headSha:head,parent:world.EXPLORE_REPAIR_PARENT,status:'failed',reason});assert.deepEqual(resolved.inheritedChecks,{});assert.equal(resolved.fullQualification,'pending');
    assert.deepEqual(resolved.historicalBrowserFailure,{...world.EXPLORE_REPAIR_FAILED_PARENT});assert.equal(resolved.knownRegressionResolution.headSha,'8956734a6675ae79d5081e77f551e0cb49cf8a39');assert.match(resolved.knownRegressionResolution.status,/current Explore repair admission failed/);
    for(const debt of ['database-contract','explore-repair','explore-repair-eligibility',...world.EXPLORE_REPAIR_PENDING_DEBT])assert.ok(resolved.pendingDebt.includes(debt),debt);assert.ok(!resolved.pendingDebt.includes(world.REGRESSION_DEBT));
  }
  assert.deepEqual(nativeCalls,[]);
  // Wrong head, wrong or extra parent, unrelated candidates, classifier errors and unavailable evidence keep the re-added debt.
  for(const [label,options,exploreApi] of [['wrong head',{checkout:'f'.repeat(40)}],['wrong parent',{parent:world.SOLUTIONS_PARENT}],['unrelated parent',{parent:'b'.repeat(40)}],['two parents',{merge:true}],['unrelated candidate',{paths:['nextjs/lib/unrelated.ts']}],['classifier error',{broken:true}],['unavailable evidence',{},()=>{throw Error('offline');}]]){
    const before=decision(undefined),evidenceCalls=[];
    const kept=world.authenticateFailedNativeResolution(structuredClone(before),{headSha:head,intended:undefined,exec:exec(options),api:nativeApi,exploreApi:exploreApi??(p=>{evidenceCalls.push(p);throw Error('Explore evidence must not be read: '+label);})});
    assert.deepEqual(kept,before,label);assert.ok(kept.pendingDebt.includes(world.REGRESSION_DEBT),label);assert.equal(kept.gate,'failed',label);assert.equal(kept.fullQualification,'pending',label);assert.deepEqual(evidenceCalls,[],label);
  }
  assert.deepEqual(nativeCalls,[]);
});
// Static checker scope: the workflow checker imports this exact helper; the old whole-runner substring failed454 on a legitimate declaration.
test('shared browser project map exclusion accepts the current runner and rejects an Explore row only inside that exact map',()=>{
  const runner=readFileSync(fileURLToPath(new URL('./run-repair-check.mjs',import.meta.url)),'utf8').replace(/\r\n/g,'\n'),checker=readFileSync(fileURLToPath(new URL('./verify-repair-workflows.mjs',import.meta.url)),'utf8');
  assert.ok(checker.includes("import { sharedBrowserProjectsMapExcludesExplore } from './repair-collector-only.mjs';"));assert.ok(checker.includes('assert(sharedBrowserProjectsMapExcludesExplore(runner)&&'));
  assert.ok(!checker.includes(`!runner.includes("['e2e/explore.spec.ts',")`),'the whole-runner negative substring is removed');
  for(const kept of ["runner.includes('export function planExploreRepairBrowserRuns(files,runDetailIntegrity)')","runner.includes('plan.exploreRepairPresentation ? planExploreRepairBrowserRuns(files, plan.runDetailIntegrity) : planBrowserRuns(files, plan.runDetailIntegrity)')"])assert.ok(checker.includes(kept),kept);
  // The legitimate separate Explore declaration lives outside the shared map and is accepted.
  assert.ok(runner.includes("export const EXPLORE_REPAIR_BROWSER_FILES=Object.freeze(['e2e/explore.spec.ts','e2e/solutions-workflows.spec.ts']);"));
  assert.equal(world.sharedBrowserProjectsMapExcludesExplore(runner),true);assert.equal(world.sharedBrowserProjectsMapExcludesExplore(runner.replaceAll('\n','\r\n')),true);
  const start=world.BROWSER_PROJECTS_MAP_START,first="  ['e2e/solutions-workflows.spec.ts', ['1440']],",last="  ['e2e/workspace-intake-layout.spec.ts', ['1440']],";
  assert.equal(start,'const browserProjectsByFile = new Map([');assert.ok(runner.includes(`${start}\n${first}\n`));assert.ok(runner.includes(`${last}\n]);\n`));
  const rows=world.browserProjectsMapRows(runner);assert.equal(rows[0],first);assert.equal(rows.at(-1),last);assert.ok(rows.every(row=>!/explore/i.test(row)));
  // An Explore row injected anywhere inside that exact map is rejected.
  for(const [label,source] of [['first row',runner.replace(`${start}\n`,`${start}\n  ['e2e/explore.spec.ts', ['1440']],\n`)],['last row',runner.replace(`${last}\n]);`,`${last}\n  ['e2e/explore.spec.ts', ['1440', '390', 'reduced-motion']],\n]);`)]]){assert.notEqual(source,runner,label);assert.equal(world.sharedBrowserProjectsMapExcludesExplore(source),false,label);}
  // Absent, duplicated, unterminated or non-row boundaries fail closed rather than passing silently.
  const failures=[
    ['absent start',runner.replace(start,'const browserProjects = new Map([')],
    ['duplicate start',runner+`\n${start}\n${first}\n]);\n`],
    ['second binding',runner+'\nbrowserProjectsByFile = new Map();\n'],
    ['unterminated',runner.replace(`${last}\n]);`,`${last}\n])`)],
    ['spread row',runner.replace(`${start}\n`,`${start}\n  ...exploreRows,\n`)],
    ['commented Explore row',runner.replace(`${start}\n`,`${start}\n  // ['e2e/explore.spec.ts', ['1440']],\n`)],
    ['empty map',runner.replace(/const browserProjectsByFile = new Map\(\[\n[\s\S]*?\n\]\);/,`${start}\n]);`)],
  ];
  for(const [label,source] of failures){assert.notEqual(source,runner,label);assert.throws(()=>world.sharedBrowserProjectsMapExcludesExplore(source),/Shared browser project map/,label);}
});
// Explore repair successor: one direct child of failed454; exactly the five corrective paths; the424 profile stays as published.
test('Explore repair successor pins exact454, its tree, the five corrective paths, the unchanged runner and both failures',()=>{
  assert.equal(world.EXPLORE_SUCCESSOR_PROFILE,'explore-repair-successor');assert.equal(world.EXPLORE_SUCCESSOR_PARENT,'4540cd47cc881b5d2339c70159bc657047149204');assert.equal(world.EXPLORE_SUCCESSOR_PARENT_TREE,'7cce3c9f266cf4715a02ebd7676c17b38a700a90');
  assert.deepEqual([...world.EXPLORE_SUCCESSOR_PATHS],['nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-known-regression.mjs','nextjs/scripts/repair-scope.test.mjs','nextjs/scripts/verify-repair-workflows.mjs']);
  // Each corrective path is already a424 and Solutions configuration path, so the424 and623 deltas keep their exact sets.
  for(const p of world.EXPLORE_SUCCESSOR_PATHS){assert.ok(world.EXPLORE_REPAIR_CONFIG_PATHS.includes(p),p);assert.ok(world.SOLUTIONS_CONFIG_PATHS.includes(p),p);assert.ok(!world.EXPLORE_REPAIR_TREE_SOURCES.includes(p),p);}
  for(const p of [world.EXPLORE_SUCCESSOR_RUNNER_PATH,world.EXPLORE_REPAIR_WORKFLOW_PATH,'nextjs/scripts/repair-scope-gate.mjs','nextjs/scripts/repair-known-regression.test.mjs',...world.EXPLORE_REPAIR_TREE_SOURCES])assert.ok(!world.EXPLORE_SUCCESSOR_PATHS.includes(p),p);
  assert.equal(new Set([...world.EXPLORE_REPAIR_TREE_SOURCES,...world.SOLUTIONS_CONFIG_PATHS]).size,20);
  assert.deepEqual([world.EXPLORE_SUCCESSOR_RUNNER_PATH,world.EXPLORE_SUCCESSOR_RUNNER_BLOB,world.EXPLORE_REPAIR_WORKFLOW_BLOB],['nextjs/scripts/run-repair-check.mjs','6cede7a8b0cb529409f24f4bfcae0b111df4c1ed','0990f734a31660dd5a29164f5cb0068aaac91b6c']);
  const f=world.EXPLORE_SUCCESSOR_FAILED_PARENT;
  assert.deepEqual([f.sourceHead,f.parent,f.profile,f.scope,f.runId,f.jobId,f.step,f.failedAt,f.outcome],[world.EXPLORE_SUCCESSOR_PARENT,world.EXPLORE_REPAIR_PARENT,'explore-repair','workflow-static',37461081048,112260519816,'Verify workflow and selector contracts','nextjs/scripts/verify-repair-workflows.mjs:307','failure']);
  // 454 ran no install, product or browser test; its capture error is downstream of the missing install and never evidence.
  assert.deepEqual([f.dependencyInstall,f.productTests,f.browserTests],['not executed','not executed','not executed']);assert.match(f.captureError,/missing node_modules.*not product or browser evidence/);assert.match(f.status,/no tested product or browser evidence; not inherited/);
  // The prior424 profile and its browser history are unchanged.
  assert.equal(world.EXPLORE_REPAIR_PARENT,'424f5737752d723bcd81ad7d06b7d977880a1b02');assert.deepEqual({...world.EXPLORE_REPAIR_FAILED_PARENT},{sourceHead:world.EXPLORE_REPAIR_PARENT,parent:world.SOLUTIONS_PARENT,profile:'solutions-workflows',scope:'browser',outcome:'failure',status:'historical failed424 browser evidence only; not inherited for the Explore repair head'});
});
const successorExec=({paths=[...world.EXPLORE_SUCCESSOR_PATHS],parent=world.EXPLORE_SUCCESSOR_PARENT,checkout=head,merge=false,broken=false}={})=>(_command,args)=>{if(broken)throw Error('git unavailable');if(args[0]==='-C')args=args.slice(2);if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'fixture-root':checkout;if(args[0]==='rev-list')return `${head} ${parent}${merge?' '+'a'.repeat(40):''}`;if(args[0]==='diff')return paths.join('\0')+'\0';throw new Error('Unexpected Explore successor git command: '+args.join(' '));};
test('collector routes the exact454 successor before exact424 and Solutions; neither Explore classifier claims the other parent',()=>{
  const source=readFileSync(fileURLToPath(new URL('./repair-collector-only.mjs',import.meta.url)),'utf8'),cli=source.slice(source.lastIndexOf('if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))'));
  const successor=cli.indexOf('classifyExploreSuccessorIntent({headSha})'),explore=cli.indexOf('classifyExploreRepairIntent({headSha})'),solutions=cli.indexOf('classifySolutionsIntent({headSha})');assert.ok(successor>=0&&successor<explore&&explore<solutions);
  const classify=options=>world.classifyExploreSuccessorIntent({headSha:head,exec:successorExec(options)});
  const accepted=classify();assert.equal(accepted.classification,'intended');assert.equal(accepted.profile,'explore-repair-successor');assert.equal(accepted.parent,world.EXPLORE_SUCCESSOR_PARENT);assert.deepEqual(accepted.paths,[...world.EXPLORE_SUCCESSOR_PATHS]);
  assert.equal(world.classifyExploreRepairIntent({headSha:head,exec:successorExec()}).classification,'normal','the424 classifier never claims a454 child');
  for(const parent of [world.EXPLORE_REPAIR_PARENT,world.SOLUTIONS_PARENT,'b'.repeat(40)])assert.equal(classify({parent}).classification,'normal',parent);
  assert.equal(classify({paths:['nextjs/lib/unrelated.ts']}).classification,'normal');assert.equal(classify({broken:true}).classification,'normal');assert.equal(world.classifyExploreSuccessorIntent({headSha:undefined,exec:successorExec()}).classification,'normal');
  for(const options of [{checkout:'f'.repeat(40)},{merge:true}]){const intent=classify(options);assert.equal(intent.classification,'unavailable',JSON.stringify(options));assert.equal(intent.intended,true);}
  // Source admission refuses anything short of the exact successor intent before reading git.
  for(const intent of [{classification:'unavailable',intended:true,headSha:head,parent:world.EXPLORE_SUCCESSOR_PARENT,reason:'unreadable'},{...accepted,profile:'explore-repair'},{...accepted,parent:world.EXPLORE_REPAIR_PARENT},{...accepted,headSha:'f'.repeat(40)},{...accepted,classification:'normal'}]){const value=world.verifyExploreSuccessorSource({headSha:head,intent,exec:()=>{throw Error('no git read expected');}});assert.equal(value.eligible,false);assert.match(value.reason,/exact direct child of454/);}
  let reads=0;const refused=world.verifyExploreSuccessorEligibility({headSha:head,intent:{...accepted,parent:world.EXPLORE_REPAIR_PARENT},exec:()=>{throw Error('no git read expected');},api:()=>{reads++;throw Error('no evidence read expected');}});assert.equal(refused.eligible,false);assert.equal(reads,0);
});
test('failed Explore repair successor admission keeps71 historical, both failures and every pending debt, and accepts no inheritance',()=>{
  const intent={classification:'intended',intended:true,headSha:head,parent:world.EXPLORE_SUCCESSOR_PARENT,profile:'explore-repair-successor'},reason='Explore repair successor must change exactly the five corrective selector/checker paths, with no other path.';
  const {plan,receipt}=world.failedExploreSuccessorReceipt({headSha:head,reason,intent,api:()=>{throw Error('offline');}});
  assert.deepEqual(plan.currentAdmission,{profile:'explore-repair-successor',headSha:head,parent:world.EXPLORE_SUCCESSOR_PARENT,status:'failed',reason});
  assert.deepEqual(plan.historicalBrowserFailure,{...world.EXPLORE_REPAIR_FAILED_PARENT});assert.deepEqual(plan.historicalStaticFailure,{...world.EXPLORE_SUCCESSOR_FAILED_PARENT});
  assert.ok(plan.pendingQualificationDebt.includes('explore-repair-successor-eligibility'));assert.ok(!plan.pendingQualificationDebt.includes(world.REGRESSION_DEBT));
  assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.gateFailures,[reason]);assert.deepEqual(receipt.currentAdmission,plan.currentAdmission);assert.deepEqual(receipt.inheritedChecks,{});assert.equal(receipt.fullQualification,'pending');
  assert.equal(receipt.knownRegressionResolution,undefined);assert.equal(receipt.historicalRegressionResolution.sourceHead,'8956734a6675ae79d5081e77f551e0cb49cf8a39');
  assert.deepEqual(receipt.historicalBrowserFailure,{...world.EXPLORE_REPAIR_FAILED_PARENT});assert.deepEqual(receipt.historicalStaticFailure,{...world.EXPLORE_SUCCESSOR_FAILED_PARENT});assert.equal(receipt.historicalStaticFailure.browserTests,'not executed');
  for(const debt of ['database-contract','explore-repair','explore-repair-successor-eligibility',...world.EXPLORE_REPAIR_PENDING_DEBT])assert.ok(receipt.pendingDebt.includes(debt),debt);assert.ok(!receipt.pendingDebt.includes(world.REGRESSION_DEBT));
  // Only the454 parent receives the454 static history; the424 and623 failure shapes are unchanged.
  assert.equal(world.failedCollectorPlan({headSha:head,reason,intent:{...intent,parent:world.EXPLORE_REPAIR_PARENT}}).historicalStaticFailure,undefined);
  assert.equal(world.failedCollectorPlan({headSha:head,reason,intent:{...intent,parent:world.SOLUTIONS_PARENT}}).historicalStaticFailure,undefined);
});
test('DB decision after a failed successor admission re-derives exact454 intent from the head only; wrong head, parent or paths stay conservative',()=>{
  const intent={classification:'intended',intended:true,headSha:head,parent:world.EXPLORE_SUCCESSOR_PARENT,profile:'explore-repair-successor'},reason='Explore repair successor seal changed: nextjs/scripts/verify-repair-workflows.mjs';
  const written=world.failedExploreSuccessorReceipt({headSha:head,reason,intent,api:()=>{throw Error('offline');}}).receipt;
  const before=structuredClone(written);before.pendingDebt=[...new Set([...(before.pendingDebt??[]),'database-contract',world.REGRESSION_DEBT])];before.databaseObservation='not executed; inherited evidence unaccepted';before.inheritedChecks={};
  const nativeCalls=[],nativeApi=p=>{nativeCalls.push(p);throw Error('native evidence must not be read for the successor');};
  // The exact successor is routed to its own resolution, which reads only actual623 evidence (offline here, so nothing changes).
  const routedCalls=[],routed=world.authenticateFailedNativeResolution(structuredClone(before),{headSha:head,intended:undefined,exec:successorExec(),api:nativeApi,exploreApi:p=>{routedCalls.push(p);throw Error('offline');}});
  assert.deepEqual(routed,before);assert.deepEqual(routedCalls,['actions/runs/37413409860']);
  for(const [label,options] of [['wrong head',{checkout:'f'.repeat(40)}],['wrong parent',{parent:world.SOLUTIONS_PARENT}],['unrelated parent',{parent:'b'.repeat(40)}],['two parents',{merge:true}],['wrong paths',{paths:['nextjs/lib/unrelated.ts']}],['classifier error',{broken:true}]]){
    const evidenceCalls=[],kept=world.authenticateFailedNativeResolution(structuredClone(before),{headSha:head,intended:undefined,exec:successorExec(options),api:nativeApi,exploreApi:p=>{evidenceCalls.push(p);throw Error('evidence must not be read: '+label);}});
    assert.deepEqual(kept,before,label);assert.ok(kept.pendingDebt.includes(world.REGRESSION_DEBT),label);assert.equal(kept.gate,'failed',label);assert.equal(kept.fullQualification,'pending',label);assert.deepEqual(evidenceCalls,[],label);
  }
  assert.deepEqual(nativeCalls,[]);
});

// Native World race over exact2bb: one direct child, exactly seven additions, seven in-place CI owner edits and four released-main
// overlay pairs (18 paths), PR 141 at the event head.
const race=await import('./repair-collector-only.mjs');
const raceHead='c'.repeat(40),raceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),workspaceBytes=p=>race.NATIVE_RACE_SUCCESSOR_PATHS.includes(p)?baselineBytes(p):raceC61Bytes(p);
// The c61 successor edits the helper and its test in place; the exact2bb increment is exercised with their immutable c61 bytes.
const raceC61Cache=new Map(),raceC61Bytes=p=>{if(!raceC61Cache.has(p))raceC61Cache.set(p,execFileSync('git',['-C',raceRoot,'show',`${race.NATIVE_RACE_SUCCESSOR_PARENT}:${p}`],{stdio:'pipe',maxBuffer:64*1024*1024}));return raceC61Cache.get(p);};
const raceBytes=p=>Object.hasOwn(race.NATIVE_RACE_ADDITIONS,p)&&race.NATIVE_RACE_SUCCESSOR_PATHS.includes(p)?raceC61Bytes(p):workspaceBytes(p);
const racePublished=[...race.EXPLORE_REPAIR_TREE_SOURCES,...race.SOLUTIONS_CONFIG_PATHS].sort();
const raceOverlay=p=>race.NATIVE_RACE_MAIN_OVERLAYS[p];
const raceRecord=p=>Object.hasOwn(race.NATIVE_RACE_ADDITIONS,p)?`:000000 100644 ${'0'.repeat(40)} ${'1'.repeat(40)} A`:
  Object.hasOwn(race.NATIVE_RACE_MAIN_OVERLAYS,p)?`:100644 100644 ${raceOverlay(p).preimage} ${raceOverlay(p).resolution} M`:`:100644 100644 ${race.NATIVE_RACE_PARENT_OWNER_BLOBS[p]} ${'2'.repeat(40)} M`;
const raceTree=(ref,p)=>{
  if(Object.hasOwn(race.NATIVE_RACE_ADDITIONS,p))return ref===race.NATIVE_RACE_PARENT?null:gitBlob(raceBytes(p));
  if(Object.hasOwn(race.NATIVE_RACE_MAIN_OVERLAYS,p))return ref===race.NATIVE_RACE_PARENT?raceOverlay(p).preimage:raceOverlay(p).resolution;
  if(Object.hasOwn(race.NATIVE_RACE_PARENT_OWNER_BLOBS,p))return ref===race.NATIVE_RACE_PARENT||!race.NATIVE_RACE_CONFIG_PATHS.includes(p)?race.NATIVE_RACE_PARENT_OWNER_BLOBS[p]:'9'.repeat(40);
  if(Object.hasOwn(race.EXPLORE_REPAIR_SOURCE_BLOBS,p))return race.EXPLORE_REPAIR_SOURCE_BLOBS[p].after;
  if(Object.hasOwn(race.SOLUTIONS_SOURCE_BLOBS,p))return race.SOLUTIONS_SOURCE_BLOBS[p].after;
  if(p===race.EXPLORE_SUCCESSOR_RUNNER_PATH)return race.EXPLORE_SUCCESSOR_RUNNER_BLOB;
  const deps={...race.PUBLIC_PAGES_DB_BLOBS,...race.NATIVE_DB_TRANSPORT_BLOBS,...race.NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(race.NATIVE_WORLD_SOURCE_BLOBS).map(([q,v])=>[q,v.after]))};
  if(Object.hasOwn(deps,p))return deps[p];
  throw Error('Unpinned native world race fixture leaf: '+p);
};
// Mocked git over actual workspace bytes: every ref, tree, range and leaf the race admission reads, and nothing else.
const raceExec=(o={})=>(_command,args,options={})=>{
  if(o.broken)throw Error('git unavailable');if(args[0]==='-C'){assert.equal(args[1],'fixture-root');args=args.slice(2);}
  const P=race.NATIVE_RACE_PARENT,G=race.EXPLORE_SUCCESSOR_PARENT,R=race.EXPLORE_REPAIR_PARENT,S=race.SOLUTIONS_PARENT,changed=[...race.NATIVE_RACE_CHANGED_PATHS];
  if(args[0]==='rev-parse'){if(args[1]==='--show-toplevel')return 'fixture-root';if(args[1]==='HEAD')return o.checkout??raceHead;const trees={[`${P}^{tree}`]:o.parentTree??race.NATIVE_RACE_PARENT_TREE,[`${G}^{tree}`]:race.EXPLORE_SUCCESSOR_PARENT_TREE,[`${S}^{tree}`]:race.SOLUTIONS_PARENT_TREE};assert.ok(Object.hasOwn(trees,args[1]),args[1]);return trees[args[1]];}
  if(args[0]==='rev-list'){const rows={[raceHead]:`${raceHead} ${o.parent??P}${o.merge?' '+'a'.repeat(40):''}`,[P]:`${P} ${o.grandparent??G}`,[G]:`${G} ${R}`,[R]:`${R} ${S}`,[S]:`${S} ${race.NATIVE_WORLD_PARENT}`};return rows[args.at(-1)];}
  if(args[0]==='merge-base'){if(o.ancestor===false)throw Error('not ancestor');return '';}
  if(args[0]==='diff'&&args[1]==='--cached')return o.staged??'';
  if(args[0]==='ls-files')return o.untracked??'';
  if(args[0]==='diff'&&args[1]==='--name-only'){const names={[`${o.parent??P}..${raceHead}`]:o.paths??changed,[`${G}..${P}`]:[...race.EXPLORE_SUCCESSOR_PATHS],[`${S}..${P}`]:racePublished,[`${S}..${raceHead}`]:o.cumulative??[...new Set([...racePublished,...changed])].sort()};assert.ok(Object.hasOwn(names,args.at(-1)),args.at(-1));return names[args.at(-1)].join('\0')+'\0';}
  if(args[0]==='diff'&&args[1]==='--raw')return args.at(-2)===P?(o.raw??changed.map(p=>[raceRecord(p),p])).map(([r,p])=>`${r}\0${p}\0`).join(''):'';
  if(args[0]==='ls-tree'){const [ref,,p]=args.slice(2),key=`${ref}:${p}`,blob=o.tree&&Object.hasOwn(o.tree,key)?o.tree[key]:raceTree(ref,p);return blob?`100644 blob ${blob}\t${p}`:'';}
  if(args[0]==='show'){const p=args[1].slice(raceHead.length+1);assert.equal(args[1].slice(0,raceHead.length),raceHead);const bytes=o.bytes?.[p]??raceBytes(p);return options.encoding==='buffer'?bytes:bytes.toString('utf8');}
  throw Error('Unexpected native world race git command: '+args.join(' '));
};
const raceSource=(o={})=>{const exec=raceExec(o);return race.verifyNativeRaceSource({headSha:raceHead,intent:race.classifyNativeRaceIntent({headSha:raceHead,exec}),exec});};
test('native world race pins exact2bb, the seven immutable additions, the eight owner preimages and the narrow owner set',()=>{
  assert.deepEqual([race.NATIVE_RACE_PROFILE,race.NATIVE_RACE_PARENT,race.NATIVE_RACE_PARENT_TREE],['native-world-race','2bbcc5b10f400cfc554294e3467491405ab757e7','b0ef9d53eb4f73270a5da12ecbb944c6b9c59230']);
  assert.deepEqual({...race.NATIVE_RACE_PR},{repository:'0ssol1620-byte/tavonel-saas-foundation',number:141,baseRef:'main',headRef:'codex/masterplan-checkpoint-2026-09-30'});
  // The seven additions are the exact immutable c61 bytes; the five the c61 successor does not edit are also the workspace bytes.
  assert.equal(Object.keys(race.NATIVE_RACE_ADDITIONS).length,7);for(const[p,digest]of Object.entries(race.NATIVE_RACE_ADDITIONS))assert.equal(createHash('sha256').update(raceBytes(p)).digest('hex'),digest,p);
  for(const[p,digest]of Object.entries(race.NATIVE_RACE_ADDITIONS))if(!race.NATIVE_RACE_SUCCESSOR_PATHS.includes(p))assert.equal(createHash('sha256').update(workspaceBytes(p)).digest('hex'),digest,p);
  assert.equal(Object.keys(race.NATIVE_RACE_PARENT_OWNER_BLOBS).length,8);assert.deepEqual([...race.NATIVE_RACE_UNCHANGED_OWNERS],['nextjs/scripts/repair-scope.test.mjs']);
  assert.equal(race.NATIVE_RACE_CHANGED_PATHS.length,18);for(const p of race.NATIVE_RACE_CONFIG_PATHS)assert.ok(Object.hasOwn(race.NATIVE_RACE_PARENT_OWNER_BLOBS,p),p);
  assert.deepEqual([...race.NATIVE_RACE_CHANGED_PATHS],[...Object.keys(race.NATIVE_RACE_ADDITIONS),...race.NATIVE_RACE_CONFIG_PATHS,...race.NATIVE_RACE_MAIN_OVERLAY_PATHS].sort());
  assert.equal(new Set(race.NATIVE_RACE_CHANGED_PATHS).size,18);assert.ok(!race.NATIVE_RACE_CHANGED_PATHS.some(p=>/product-left-column/.test(p)),'the main-only product-left-column change is excluded');
  // Four released-main overlay pairs, each the exact2bb preimage (the published852 public pin) and the exact main resolution blob.
  assert.deepEqual(Object.fromEntries(Object.entries(race.NATIVE_RACE_MAIN_OVERLAYS).map(([p,o])=>[p,{...o}])),{
    'nextjs/app/product/continuous-knowledge/page.tsx':{preimage:'5cca7928c2fa20390110a15dce951f0d07e5acab',resolution:'3503b577127930b52bfee8202f91267842e10af1',sha256:'f5cb8088ee7e1bbad3dd00caeb24dee566d111470ff11826d30f11a05f2b4885'},
    'nextjs/e2e/compiler-contract.spec.ts':{preimage:'1fd3e098e4a0ef574d55faee2ac7314e033e3007',resolution:'525182a048df8e2655aafbc86ae17a92b96c4e75',sha256:'893c378954795546063a8ccba5848686d6f705c8e092b4890b709309ac001d6e'},
    'nextjs/e2e/public-package-proof.spec.ts':{preimage:'7bcf63dbbe35e74dc0c822593c4664e8048eb295',resolution:'f728e78ef4be4ace1eca37ceedbd6768bb7ae15a',sha256:'88a06448bf0ac1ea71247229894256f9cef12934bb4009e6f814f976faf6eece'},
    'nextjs/lib/continuous-knowledge-page.test.ts':{preimage:'6b8e08cbf5aa463d3554c0deeaa929684c135f39',resolution:'247aea56b0e1e10fc1bf5a05d8ddf89f62d67abd',sha256:'7a73d3e7bffea75d05e9f98502c7f869a0ca47634c1888805813f1874b12ffd1'}});
  for(const[p,o]of Object.entries(race.NATIVE_RACE_MAIN_OVERLAYS)){
    assert.equal(race.PUBLIC_PAGES_SOURCE_BLOBS[p].after,o.preimage,p);assert.ok(!Object.hasOwn(race.NATIVE_RACE_ADDITIONS,p)&&!Object.hasOwn(race.NATIVE_RACE_PARENT_OWNER_BLOBS,p),p);
    // The workspace carries the raw main resolution bytes unchanged.
    assert.equal(gitBlob(raceBytes(p)),o.resolution,p);assert.equal(createHash('sha256').update(raceBytes(p)).digest('hex'),o.sha256,p);
  }
  assert.deepEqual([race.NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.pr,race.NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.mainCommit],[143,'2065e1c7eaf28d0d944fc066a1ca9633c0df70cd']);
  assert.match(race.NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.status,/^inherited PR143 released-main source evidence only; not executed, run or passed at the race candidate head$/);
  assert.equal(race.NATIVE_RACE_PARENT_OWNER_BLOBS['.github/workflows/repair-scope.yml'],race.EXPLORE_REPAIR_WORKFLOW_BLOB);assert.equal(race.NATIVE_RACE_PARENT_OWNER_BLOBS['.github/workflows/db-rehearsal.yml'],race.NATIVE_WORLD_SOURCE_BLOBS['.github/workflows/db-rehearsal.yml'].after);
  assert.deepEqual([...race.NATIVE_RACE_CONTRACT_SUITES],['scripts/db/native-world-race.test.mjs','scripts/db/native-world-race-ci.test.mjs']);assert.deepEqual([...race.NATIVE_RACE_WORKFLOW.cases],['grant_revoke','qualification_revoke','epoch','delete','same_replay','changed_replay','member_fk']);
});
test('native world race routes first and classifies only exact2bb children or race-owned additions; partial touches fail closed',()=>{
  const source=readFileSync(fileURLToPath(new URL('./repair-collector-only.mjs',import.meta.url)),'utf8'),cli=source.slice(source.lastIndexOf('if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))'));
  assert.ok(cli.indexOf('classifyNativeRaceIntent({headSha})')>=0&&cli.indexOf('classifyNativeRaceIntent({headSha})')<cli.indexOf('classifyExploreSuccessorIntent({headSha})'));
  const classify=o=>race.classifyNativeRaceIntent({headSha:raceHead,exec:raceExec(o)});
  const accepted=classify();assert.equal(accepted.classification,'intended');assert.equal(accepted.profile,'native-world-race');assert.equal(accepted.parent,race.NATIVE_RACE_PARENT);assert.deepEqual(accepted.paths,[...race.NATIVE_RACE_CHANGED_PATHS]);
  // A partial touch of one owner, one addition or one released-main overlay directly on2bb is still the race profile, never normal CI or public pages.
  for(const paths of [['nextjs/scripts/repair-scope.test.mjs'],['.github/workflows/native-world-race.yml'],...race.NATIVE_RACE_MAIN_OVERLAY_PATHS.map(p=>[p]),[...race.NATIVE_RACE_MAIN_OVERLAY_PATHS]]){const intent=classify({paths});assert.equal(intent.classification,'intended',paths.join());assert.equal(intent.profile,'native-world-race',paths.join());}
  // Overlay paths alone over another parent are not race-owned and stay with the existing classifiers.
  assert.equal(classify({parent:'b'.repeat(40),paths:[...race.NATIVE_RACE_MAIN_OVERLAY_PATHS]}).classification,'normal');
  assert.equal(classify({paths:['nextjs/lib/unrelated.ts']}).classification,'normal');
  // A race addition over any other parent is intended (and later refused); owners alone over another parent stay with the existing classifiers.
  const elsewhere=classify({parent:'b'.repeat(40),paths:['nextjs/scripts/db/native-world-race-ci.mjs']});assert.equal(elsewhere.classification,'intended');assert.equal(race.verifyNativeRaceSource({headSha:raceHead,intent:elsewhere,exec:()=>{throw Error('no git read expected');}}).eligible,false);
  assert.equal(classify({parent:race.EXPLORE_SUCCESSOR_PARENT,paths:['nextjs/scripts/repair-collector-only.mjs']}).classification,'normal');
  for(const o of [{merge:true},{checkout:'f'.repeat(40)}]){const intent=classify(o);assert.equal(intent.classification,'unavailable',JSON.stringify(o));assert.equal(intent.intended,true);assert.equal(intent.profile,'native-world-race');}
  assert.equal(classify({broken:true}).classification,'normal');assert.equal(race.classifyNativeRaceIntent({headSha:undefined,exec:raceExec()}).classification,'normal');
  // Neither Explore classifier claims a2bb child.
  assert.equal(world.classifyExploreSuccessorIntent({headSha:raceHead,exec:raceExec()}).classification,'normal');assert.equal(world.classifyExploreRepairIntent({headSha:raceHead,exec:raceExec()}).classification,'normal');
});
test('native world race source binds exact lineage, raw status/mode/preimage, cumulative623 delta, bytes and canonical seals',()=>{
  // Accepted only with the actual candidate bytes and the canonical CONFIG_SEAL/REPAIR_SEAL values for them.
  const accepted=raceSource();assert.equal(accepted.eligible,true,accepted.reason);assert.equal(accepted.parent,race.NATIVE_RACE_PARENT);assert.deepEqual(accepted.exactChangedPaths,[...race.NATIVE_RACE_CHANGED_PATHS]);assert.deepEqual(accepted.unchangedOwners,['nextjs/scripts/repair-scope.test.mjs']);
  const C=race.NATIVE_RACE_CHANGED_PATHS,records=C.map(p=>[raceRecord(p),p]),swap=(p,record)=>records.map(([r,q])=>[q===p?record:r,q]),addition='nextjs/scripts/db/native-world-race.mjs',owner='nextjs/scripts/repair-scope-gate.mjs';
  const refused=[
    ['extra path',{paths:[...C,'nextjs/lib/unrelated.ts'].sort()},/exactly the seven race files/],
    ['missing addition',{paths:C.filter(p=>p!==addition)},/exactly the seven race files/],
    ['unchanged owner edited',{paths:[...C,'nextjs/scripts/repair-scope.test.mjs'].sort()},/exactly the seven race files/],
    ['merge',{merge:true},/exact direct child of2bb/],
    ['wrong grandparent',{grandparent:'b'.repeat(40)},/Exact2bb commit parent\/tree changed/],
    ['wrong2bb tree',{parentTree:'b'.repeat(40)},/Exact2bb commit parent\/tree changed/],
    ['ancestry',{ancestor:false},/not ancestor/],
    ['cumulative extra',{cumulative:[...racePublished,...C,'docs/other.md'].sort()},/Cumulative623 race delta/],
    ['deleted addition',{raw:swap(addition,`:100644 000000 ${'1'.repeat(40)} ${'0'.repeat(40)} D`)},/new regular file absent at2bb/],
    ['executable addition',{raw:swap(addition,`:000000 100755 ${'0'.repeat(40)} ${'1'.repeat(40)} A`)},/new regular file absent at2bb/],
    ['owner wrong preimage',{raw:swap(owner,`:100644 100644 ${'b'.repeat(40)} ${'2'.repeat(40)} M`)},/in-place regular edit/],
    ['owner type change',{raw:swap(owner,`:100644 120000 ${race.NATIVE_RACE_PARENT_OWNER_BLOBS[owner]} ${'2'.repeat(40)} T`)},/in-place regular edit/],
    ['rename split',{raw:[...records,[`:100644 000000 ${'3'.repeat(40)} ${'0'.repeat(40)} D`,'docs/renamed.md']]},/malformed or incomplete/],
    ['addition bytes',{bytes:{[addition]:Buffer.concat([raceBytes(addition),Buffer.from('\n')])}},/Race file byte identity changed/],
  ];
  for(const[label,o,reason]of refused){const value=raceSource(o);assert.equal(value.eligible,false,label);assert.match(value.reason,reason,label);}
});
test('native world race source requires all four released-main overlay pairs together, exactly, as inherited source evidence only',()=>{
  // The accepted result reports every exact pair and its PR143 provenance as inherited source evidence, never as a run or pass here.
  const accepted=raceSource();assert.equal(accepted.eligible,true,accepted.reason);assert.equal(accepted.exactChangedPaths.length,18);
  assert.deepEqual(accepted.mainOverlays,race.nativeRaceMainOverlayEvidence());assert.match(accepted.mainOverlays.status,/not executed, run or passed at the race candidate head/);
  const C=race.NATIVE_RACE_CHANGED_PATHS,O=race.NATIVE_RACE_MAIN_OVERLAY_PATHS,P=race.NATIVE_RACE_PARENT,records=C.map(p=>[raceRecord(p),p]),swap=(p,record)=>records.map(([r,q])=>[q===p?record:r,q]);
  const PATHS=/carry exactly the four released-main overlays, with no other path/,PAIR=/Released-main overlay must be an in-place regular edit from its exact2bb preimage to its exact main resolution blob/;
  const refused=[
    // The former 14-path increment (no overlay) and any partial overlay set are refused before any raw record is read.
    ['the 14-path increment without overlays',{paths:C.filter(p=>!O.includes(p)),cumulative:[...new Set([...racePublished,...C.filter(p=>!O.includes(p))])].sort()},PATHS],
    ['overlays only, without the race increment',{paths:[...O]},PATHS],
    ['an extra non-overlay public source',{paths:[...C,'nextjs/components/public-package-proof.tsx'].sort()},PATHS],
    ['an extra released-main path',{paths:[...C,'nextjs/lib/product-left-column.test.ts'].sort()},PATHS],
    ['an extra overlay raw record',{raw:[...records,[`:100644 100644 ${'4'.repeat(40)} ${'5'.repeat(40)} M`,'nextjs/components/public-package-proof.tsx']]},/malformed or incomplete/],
  ];
  for(const p of O){
    const o=raceOverlay(p);
    refused.push(
      ['missing overlay '+p,{paths:C.filter(q=>q!==p)},PATHS],
      ['partial overlay set keeping only '+p,{paths:C.filter(q=>!O.includes(q)||q===p)},PATHS],
      ['changed preimage record '+p,{raw:swap(p,`:100644 100644 ${'b'.repeat(40)} ${o.resolution} M`)},PAIR],
      ['mutated resolution record '+p,{raw:swap(p,`:100644 100644 ${o.preimage} ${'b'.repeat(40)} M`)},PAIR],
      ['swapped pair '+p,{raw:swap(p,`:100644 100644 ${o.resolution} ${o.preimage} M`)},PAIR],
      ['executable overlay '+p,{raw:swap(p,`:100644 100755 ${o.preimage} ${o.resolution} M`)},PAIR],
      ['symlinked overlay '+p,{raw:swap(p,`:100644 120000 ${o.preimage} ${o.resolution} T`)},PAIR],
      ['overlay added instead of edited '+p,{raw:swap(p,`:000000 100644 ${'0'.repeat(40)} ${o.resolution} A`)},PAIR],
      ['deleted overlay '+p,{raw:swap(p,`:100644 000000 ${o.preimage} ${'0'.repeat(40)} D`)},PAIR],
      ['changed exact2bb preimage leaf '+p,{tree:{[`${P}:${p}`]:'b'.repeat(40)}},/Released-main overlay exact2bb preimage changed/],
      ['mutated resolution leaf '+p,{tree:{[`${raceHead}:${p}`]:'b'.repeat(40)}},/Released-main overlay resolution identity changed/],
      ['mutated resolution bytes '+p,{bytes:{[p]:Buffer.concat([raceBytes(p),Buffer.from('\n')])}},/Released-main overlay resolution identity changed/],
      ['2bb preimage bytes in place of the resolution '+p,{tree:{[`${raceHead}:${p}`]:o.preimage}},/Released-main overlay resolution identity changed/],
    );
  }
  for(const[label,o,reason]of refused){const value=raceSource(o);assert.equal(value.eligible,false,label);assert.match(value.reason,reason,label);}
});
test('native world race admits only same-repository PR 141 from the checkpoint branch at the exact event head',()=>{
  const env={GITHUB_REPOSITORY:'0ssol1620-byte/tavonel-saas-foundation',GITHUB_EVENT_NAME:'pull_request'},repo={full_name:'0ssol1620-byte/tavonel-saas-foundation',id:7};
  const event=()=>({number:141,repository:{...repo},pull_request:{number:141,base:{ref:'main',repo:{...repo}},head:{ref:'codex/masterplan-checkpoint-2026-09-30',sha:raceHead,repo:{...repo}}}});
  const ok=race.verifyNativeRaceEvent({headSha:raceHead,env,event:event()});assert.equal(ok.eligible,true,ok.reason);assert.deepEqual([ok.number,ok.headSha,ok.baseRef],[141,raceHead,'main']);
  const refused=[['dispatch',{...env,GITHUB_EVENT_NAME:'workflow_dispatch'},event()],['other repository',{...env,GITHUB_REPOSITORY:'fork/tavonel'},event()],['other PR',env,{...event(),number:142}],['fork head',env,(e=>{e.pull_request.head.repo={full_name:'fork/tavonel-saas-foundation',id:8};return e;})(event())],['same name other id',env,(e=>{e.pull_request.head.repo.id=8;return e;})(event())],['other base',env,(e=>{e.pull_request.base.ref='develop';return e;})(event())],['other head ref',env,(e=>{e.pull_request.head.ref='other';return e;})(event())],['stale head',env,(e=>{e.pull_request.head.sha='f'.repeat(40);return e;})(event())],['no payload',env,null]];
  for(const[label,e,payload]of refused)assert.equal(race.verifyNativeRaceEvent({headSha:raceHead,env:e,event:payload}).eligible,false,label);
});
const raceParent=(mutate=v=>v)=>{
  const e=race.NATIVE_RACE_PARENT_EVIDENCE,h=race.NATIVE_RACE_PARENT,done=(name,conclusion='success')=>({name,status:'completed',conclusion}),job=(id,run_id,name,conclusion,steps)=>({id,run_id,head_sha:h,name,status:'completed',conclusion,...(steps?{steps}:{})});
  return mutate({repairRun:{id:e.repairRunId,path:'.github/workflows/repair-scope.yml',head_sha:h,event:'pull_request',status:'completed',conclusion:'success',run_attempt:1},
    repairJob:job(e.repairJobId,e.repairRunId,'Repair scope validation','success',[...race.NATIVE_RACE_PARENT_REPAIR_STEPS.map(n=>done(n)),done('Run hermetic full Vitest for shared or unknown changes','skipped'),done('Run script contract suite for shared or unknown changes','skipped')]),
    dbRun:{id:e.dbRunId,path:'.github/workflows/db-rehearsal.yml',head_sha:h,event:'pull_request',status:'completed',conclusion:'success',run_attempt:1},
    collectorJob:job(e.collectorJobId,e.dbRunId,'Verify exact collector-only DB evidence reuse','success',[done('Independently verify unchanged DB source and prior evidence'),done('Require an explicit collector classifier decision')]),
    databaseJob:job(e.databaseJobId,e.dbRunId,'db-rehearsal','skipped'),authJob:job(e.authJobId,e.dbRunId,'Real local Auth journey','skipped'),transportJob:job(e.transportJobId,e.dbRunId,'Local Chromium signed-storage transport','skipped')});
};
test('native world race inherits exact2bb Repair evidence only and never reports a DB, Auth or transport run at2bb',()=>{
  assert.deepEqual({...race.NATIVE_RACE_PARENT_EVIDENCE},{repairRunId:37469420680,repairJobId:112288690913,dbRunId:37469420827,collectorJobId:112288690590,databaseJobId:112288823687,authJobId:112288692877,transportJobId:112288824132});
  const ok=race.verifyNativeRaceParentEvidence(raceParent());assert.equal(ok.eligible,true,ok.reason);
  assert.match(ok.repair.status,/inherited exact2bb parent evidence only; not executed at the race candidate head/);assert.match(ok.skippedAtParent.status,/no DB, Auth or transport execution at 2bb or the race candidate head/);
  assert.deepEqual([ok.skippedAtParent.database,ok.skippedAtParent.auth,ok.skippedAtParent.transport],[112288823687,112288692877,112288824132]);
  const refused=[['fresh DB claimed',v=>{v.databaseJob.conclusion='success';return v;}],['fresh transport claimed',v=>{v.transportJob.conclusion='success';return v;}],['Auth claimed',v=>{v.authJob.conclusion='success';return v;}],['other head',v=>{v.repairRun.head_sha='f'.repeat(40);return v;}],['failed Repair step',v=>{v.repairJob.steps[5].conclusion='failure';return v;}],['broad Vitest ran',v=>{v.repairJob.steps.find(s=>s.name.startsWith('Run hermetic')).conclusion='success';return v;}],['missing104 owner',v=>{v.repairJob.steps=v.repairJob.steps.filter(s=>s.name!=='Require exactly 104 named Solutions captures');return v;}],['failed classifier',v=>{v.collectorJob.conclusion='failure';return v;}]];
  for(const[label,mutate]of refused)assert.equal(race.verifyNativeRaceParentEvidence(raceParent(mutate)).eligible,false,label);
});
const raceFullDebt=['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'];
const raceProof=()=>({eligible:true,source:{eligible:true,profile:'native-world-race',headSha:raceHead,parent:race.NATIVE_RACE_PARENT,mainOverlays:race.nativeRaceMainOverlayEvidence()},event:{eligible:true,number:141,headSha:raceHead},
  evidence:{eligible:true,knownRegressionResolution:{debt:race.REGRESSION_DEBT,headSha:'8956734a6675ae79d5081e77f551e0cb49cf8a39',passed:433},knownRegressionObservations:[race.KNOWN_REGRESSION],historicalUiFailure:{sourceHead:'7d4bdac08041f282616ba85a25e8938a29230759'},pendingFullDebt:[...raceFullDebt],parentUi:{sourceHead:race.NATIVE_WORLD_UI_PARENT,status:'source'},storageTransport:{runId:37320682223,status:'source'},nativeSql:{runId:37413409719,realConcurrency:'UNRUN',status:'source'}},
  parentEvidence:race.verifyNativeRaceParentEvidence(raceParent())});
const raceNormal=()=>({schemaVersion:1,headSha:raceHead,repairAnchorSha:race.FULL_ANCHOR,groups:['shared-or-unknown'],unitFiles:['lib/a.test.ts'],browserFiles:['e2e/a.spec.ts'],unknownPaths:['nextjs/scripts/db/native-world-race.mjs'],runFullHermeticVitest:true,runScriptContracts:true,runDatabaseRehearsal:true,deferredGroups:['database-contract'],pendingQualificationDebt:['database-contract'],qualificationReasons:['normal']});
test('native world race plan is narrow: two contract suites, deferred hosted cases, inherited-only parents and every debt pending',()=>{
  const plan=race.nativeRacePlan(raceNormal(),raceProof());
  assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles,plan.unknownPaths,plan.deferredGroups],[['selector-config','workflow-static','native-world-race-contracts','native-world-race-hosted'],[],[],[],['native-world-race-hosted']]);
  for(const k of ['runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runDatabaseRehearsal','requireSolutionsCaptures','requirePublicProductCaptures'])assert.equal(plan[k],false,k);assert.equal(plan.runWorkflowStaticGate,true);
  assert.deepEqual(plan.nativeWorldRaceContractSuites,['scripts/db/native-world-race.test.mjs','scripts/db/native-world-race-ci.test.mjs']);assert.equal(plan.nativeWorldRaceWorkflow.cases.length,7);
  assert.equal(plan.databaseDisposition,'native-world-race-dedicated-workflow');assert.equal(plan.databaseBaselineEvidence,undefined);assert.match(plan.databaseRehearsalStatus,/not executed at exact2bb or this race head/);
  assert.deepEqual(plan.pendingQualificationDebt,[...race.EXPLORE_REPAIR_PENDING_DEBT]);assert.deepEqual(plan.pendingFullDebt,raceFullDebt);assert.equal(plan.fullQualification,'pending');
  for(const debt of ['native-world-real-concurrency','native-world-canonical-pinned-row-cross-session-fk','native-world-reservation-expiry-cross-session'])assert.ok(plan.pendingQualificationDebt.includes(debt),debt);
  for(const[name,evidence]of Object.entries(plan.inheritedChecks))assert.match(evidence.status,/not executed at (exact2bb or )?the race candidate head/,name);
  assert.deepEqual(plan.historicalStaticFailure,{...race.EXPLORE_SUCCESSOR_FAILED_PARENT});assert.equal(plan.exploreRepairPresentation,undefined);assert.equal(plan.solutionsPagesPresentation,undefined);
  // PR143 overlays are inherited source evidence only: no public owner, capture, group or inherited check represents a PR143 run or pass.
  assert.equal(plan.publicPagesPresentation,undefined);assert.equal(plan.requirePublicUiScreenshots,false);assert.equal(plan.requireHomePricingCaptures,false);
  assert.ok(!plan.groups.some(g=>/public|pr143|overlay/i.test(g)));assert.ok(!Object.keys(plan.inheritedChecks).some(k=>/public|pr143|overlay|main/i.test(k)));
  assert.match(plan.nativeWorldRacePresentation.source.mainOverlays.status,/not executed, run or passed at the race candidate head/);
  assert.match(plan.qualificationReasons.at(-1),/four PR143 released-main overlays are inherited source evidence only, and no PR143 test, capture or release check is run or passed at this head/);
  // The plan survives the JSON hand-off unchanged; any widening or debt loss is a lineage failure.
  const written=JSON.parse(JSON.stringify(plan));assert.deepEqual(race.nativeRaceLineageFailures(written,raceProof()),[]);
  for(const[key,value]of [['runFullHermeticVitest',true],['unknownPaths',['x']],['unitFiles',['lib/a.test.ts']],['pendingQualificationDebt',[]],['fullQualification','qualified'],['deferredGroups',[]],['databaseDisposition','inherited'],['inheritedChecks',{}]])assert.deepEqual(race.nativeRaceLineageFailures({...written,[key]:value},raceProof()),['Native World race plan changed: '+key],key);
  assert.match(race.nativeRaceLineageFailures(written,{eligible:false,reason:'seal'})[0],/unavailable: seal/);
  for(const proof of [{...raceProof(),event:{...raceProof().event,headSha:'f'.repeat(40)}},{...raceProof(),parentEvidence:{eligible:false}},{...raceProof(),source:{...raceProof().source,parent:race.EXPLORE_SUCCESSOR_PARENT}}])assert.throws(()=>race.nativeRacePlan(raceNormal(),proof),/Native World race plan requires/);
});
test('native world race receipt defers hosted cases, keeps every debt and records inheritance as not executed at the candidate head',()=>{
  const plan=JSON.parse(JSON.stringify(race.nativeRacePlan(raceNormal(),raceProof())));
  const passed=buildRepairReceipt(plan,{headSha:raceHead});
  assert.equal(passed.gate,'passed-scoped-only');assert.equal(passed.runResults['native-world-race-hosted'],'pending-deferred');assert.equal(passed.runResults['native-world-race-contracts'],'passed in this run');assert.equal(passed.fullQualification,'pending');
  for(const debt of [...race.EXPLORE_REPAIR_PENDING_DEBT,'native-world-race-hosted'])assert.ok(passed.pendingDebt.includes(debt),debt);
  assert.match(passed.databaseObservation,/^native-world-race-dedicated-workflow: no DB, Auth or transport ran at exact2bb or this head and none is inherited/);assert.deepEqual(passed.inheritedChecks,plan.inheritedChecks);
  // The overlays add no run result: only the plan's own groups are reported, and no PR143 evidence is recorded as passed in this run.
  assert.deepEqual(Object.keys(passed.runResults).sort(),[...plan.groups].sort());assert.ok(!Object.keys(passed.runResults).some(g=>/public|pr143|overlay/i.test(g)));
  const failed=buildRepairReceipt(plan,{headSha:raceHead,failures:['Native World race repair seal changed']});
  assert.equal(failed.gate,'failed');assert.match(failed.databaseObservation,/not accepted for current head/);for(const evidence of Object.values(failed.inheritedChecks))assert.equal(evidence.status,'not accepted for current head');
});
test('native world race DB disposition is explicit, re-derived from the head and never a rerun or DB inheritance',()=>{
  const ok=race.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'true',nativeDatabase:'false',nativeRace:'true'});
  assert.deepEqual(ok,{explicit:true,runDatabase:false,runTransport:false,disposition:'native-world-race-dedicated-workflow'});
  for(const bad of [{intended:'false',eligible:'false'},{intended:'true',eligible:'false'},{nativeDatabase:'true'},{nativeRace:'yes'},{classifierResult:'failure'},{nativeDatabase:undefined}])assert.deepEqual(race.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'true',nativeDatabase:'false',nativeRace:'true',...bad}),{explicit:false,runDatabase:false,runTransport:false},JSON.stringify(bad));
  // Other profiles keep their existing decisions without any race disposition.
  for(const nativeRace of [undefined,'','false']){assert.deepEqual(race.nativeDbJobDecision({classifierResult:'success',intended:'false',eligible:'false',nativeDatabase:'false',nativeRace}),{explicit:true,runDatabase:true,runTransport:true});assert.deepEqual(race.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'true',nativeDatabase:'false',nativeRace}),{explicit:true,runDatabase:false,runTransport:false});}
  const inherited=race.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'true',nativeDatabase:'false'});
  assert.equal(race.nativeRaceDecisionHolds({headSha:raceHead,nativeRace:'true',decision:ok,exec:raceExec()}),true);
  assert.equal(race.nativeRaceDecisionHolds({headSha:raceHead,nativeRace:'',decision:inherited,exec:raceExec()}),false,'a recognized race head is never generic inheritance');
  assert.equal(race.nativeRaceDecisionHolds({headSha:raceHead,nativeRace:'true',decision:ok,exec:raceExec({paths:['nextjs/lib/unrelated.ts']})}),false,'an unrelated head never carries the race disposition');
  assert.equal(race.nativeRaceDecisionHolds({headSha:raceHead,nativeRace:'',decision:inherited,exec:raceExec({paths:['nextjs/lib/unrelated.ts']})}),true);
});
test('failed native world race admission keeps71 historical, both failures and every debt; only exact2bb children get race history',()=>{
  const intent={classification:'intended',intended:true,headSha:raceHead,parent:race.NATIVE_RACE_PARENT,profile:'native-world-race'},reason='Native World race repair seal changed: nextjs/scripts/repair-collector-only.mjs';
  const {plan,receipt}=race.failedNativeRaceReceipt({headSha:raceHead,reason,intent,api:()=>{throw Error('offline');}});
  assert.deepEqual(plan.currentAdmission,{profile:'native-world-race',headSha:raceHead,parent:race.NATIVE_RACE_PARENT,status:'failed',reason});assert.ok(plan.pendingQualificationDebt.includes('native-world-race-eligibility'));assert.ok(!plan.pendingQualificationDebt.includes(race.REGRESSION_DEBT));
  assert.deepEqual(plan.historicalStaticFailure,{...race.EXPLORE_SUCCESSOR_FAILED_PARENT});assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.inheritedChecks,{});assert.equal(receipt.fullQualification,'pending');assert.equal(receipt.databaseObservation,'not executed; inherited evidence unaccepted');
  for(const debt of ['database-contract','native-world-race','native-world-race-eligibility',...race.EXPLORE_REPAIR_PENDING_DEBT])assert.ok(receipt.pendingDebt.includes(debt),debt);
  const elsewhere=race.failedCollectorPlan({headSha:raceHead,reason,intent:{...intent,parent:'b'.repeat(40)}});assert.equal(elsewhere.currentAdmission,undefined);assert.ok(elsewhere.pendingQualificationDebt.includes(race.REGRESSION_DEBT));
  // The DB failure path re-derives the exact race head and reads only actual623 evidence (offline here); other heads read nothing.
  const before=structuredClone(receipt),calls=[];assert.deepEqual(race.authenticateFailedNativeResolution(structuredClone(before),{headSha:raceHead,intended:undefined,exec:raceExec(),api:()=>{throw Error('native evidence must not be read');},exploreApi:p=>{calls.push(p);throw Error('offline');}}),before);assert.deepEqual(calls,['actions/runs/37413409860']);
  for(const o of [{parent:'b'.repeat(40)},{merge:true},{paths:['nextjs/lib/unrelated.ts']}]){const reads=[];assert.deepEqual(race.authenticateFailedNativeResolution(structuredClone(before),{headSha:raceHead,intended:undefined,exec:raceExec(o),api:p=>{reads.push(p);throw Error('no read');},exploreApi:p=>{reads.push(p);throw Error('no read');}}),before,JSON.stringify(o));assert.deepEqual(reads,[],JSON.stringify(o));}
});

// Native World race c61 successor: a mocked git over the actual c61 preimage bytes (git show c61) and the actual workspace successor bytes.
const raceKnown=await import('./repair-known-regression.mjs');
const succHead='5'.repeat(40),C61=race.NATIVE_RACE_SUCCESSOR_PARENT,SUCC=[...race.NATIVE_RACE_SUCCESSOR_PATHS];
const succHelper='nextjs/scripts/db/native-world-race-ci.mjs',succHelperTest='nextjs/scripts/db/native-world-race-ci.test.mjs',succCollectorTest='nextjs/scripts/repair-collector-only.test.mjs',succKnown='nextjs/scripts/repair-known-regression.mjs';
const succSha=b=>createHash('sha256').update(b).digest('hex');
const succBytes=(ref,p,o)=>ref===C61?(o.before?.[p]??(SUCC.includes(p)?raceC61Bytes(p):workspaceBytes(p))):(o.bytes?.[p]??workspaceBytes(p));
const succLeaf=(ref,p,o)=>{
  const key=`${ref}:${p}`;if(o.tree&&Object.hasOwn(o.tree,key))return o.tree[key];
  if(Object.hasOwn(race.NATIVE_RACE_MAIN_OVERLAYS,p))return race.NATIVE_RACE_MAIN_OVERLAYS[p].resolution;
  if(race.NATIVE_RACE_UNCHANGED_OWNERS.includes(p))return race.NATIVE_RACE_PARENT_OWNER_BLOBS[p];
  return gitBlob(succBytes(ref,p,o));
};
const succRecords=o=>SUCC.map(p=>[`:100644 100644 ${succLeaf(C61,p,o)} ${succLeaf(succHead,p,o)} M`,p]);
const succExec=(o={})=>(_command,args,options={})=>{
  if(args[0]==='-C'){assert.equal(args[1],'fixture-root');args=args.slice(2);}
  const R=race.NATIVE_RACE_PARENT,changed=[...race.NATIVE_RACE_CHANGED_PATHS];
  if(args[0]==='diff'&&args[1]==='--cached')return o.staged??'';
  if(args[0]==='ls-files')return o.untracked??'';
  if(args[0]==='rev-parse'){if(args[1]==='--show-toplevel')return 'fixture-root';if(args[1]==='HEAD')return o.checkout??succHead;const trees={[`${C61}^{tree}`]:o.c61Tree??race.NATIVE_RACE_SUCCESSOR_PARENT_TREE,[`${R}^{tree}`]:o.raceTree??race.NATIVE_RACE_PARENT_TREE};assert.ok(Object.hasOwn(trees,args[1]),args[1]);return trees[args[1]];}
  if(args[0]==='rev-list'){const rows={[succHead]:`${succHead} ${o.parent??C61}${o.merge?' '+'a'.repeat(40):''}`,[C61]:`${C61} ${o.c61Parent??R}`,[R]:`${R} ${race.EXPLORE_SUCCESSOR_PARENT}`};return rows[args.at(-1)];}
  if(args[0]==='merge-base'){if(o.ancestor===false)throw Error('not ancestor');return '';}
  if(args[0]==='diff'&&args[1]==='--name-only'){const names={[`${o.parent??C61}..${succHead}`]:o.paths??SUCC,[`${R}..${C61}`]:changed,[`${R}..${succHead}`]:o.cumulative??changed};assert.ok(Object.hasOwn(names,args.at(-1)),args.at(-1));return names[args.at(-1)].join('\0')+'\0';}
  if(args[0]==='diff'&&args[1]==='--raw')return args.at(-2)===C61?(o.raw??succRecords(o)).map(([r,p])=>`${r}\0${p}\0`).join(''):(o.dirty??'');
  if(args[0]==='ls-tree'){const [ref,,p]=args.slice(2),blob=succLeaf(ref,p,o);return blob?`100644 blob ${blob}\t${p}`:'';}
  if(args[0]==='show'){const ref=args[1].slice(0,40),p=args[1].slice(41);assert.ok([C61,succHead].includes(ref),ref);const bytes=succBytes(ref,p,o);return options.encoding==='buffer'?bytes:bytes.toString('utf8');}
  throw Error('Unexpected native world race successor git command: '+args.join(' '));
};
const succSource=(o={})=>{const exec=succExec(o);return race.verifyNativeRaceCandidateSource({headSha:succHead,intent:race.classifyNativeRaceIntent({headSha:succHead,exec}),exec});};
test('native world race successor pins exact c61, the six owners, historical c61 seals and the sealed final helper/test bytes',()=>{
  assert.deepEqual([C61,race.NATIVE_RACE_SUCCESSOR_PARENT_TREE,race.NATIVE_RACE_SUCCESSOR_KIND],['c61fe1a5ea7487a6819ee6f0a812a6adbd343767','4318378cbba223182cb3b64677d01e706460bc3b','exact-c61-successor']);
  assert.deepEqual(SUCC,[succHelper,succHelperTest,'nextjs/scripts/repair-collector-only.mjs',succCollectorTest,succKnown,'nextjs/scripts/verify-repair-workflows.mjs']);
  for(const p of SUCC)assert.ok(race.NATIVE_RACE_CHANGED_PATHS.includes(p),p);
  assert.deepEqual(SUCC.filter(p=>Object.hasOwn(race.NATIVE_RACE_ADDITIONS,p)),[succHelper,succHelperTest]);assert.deepEqual(SUCC.filter(p=>race.NATIVE_RACE_CONFIG_PATHS.includes(p)).length,4);
  assert.equal(race.NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS.length,12);for(const p of race.NATIVE_RACE_MAIN_OVERLAY_PATHS)assert.ok(race.NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS.includes(p),p);
  // The historical2bb pins stay: the c61 helper and test carry exactly their2bb addition digests.
  assert.equal(race.NATIVE_RACE_ADDITIONS[succHelper],'cc9eb2f07871835d6e83131f1b0437a46fc209e6285d0bf239c4bdca699d6268');assert.equal(race.NATIVE_RACE_ADDITIONS[succHelperTest],'112ec96d8460aa50d1ddd1e5e576bf2422882cd63ecdc004363565af13ac8f50');
  for(const p of [succHelper,succHelperTest])assert.equal(succSha(raceC61Bytes(p)),race.NATIVE_RACE_ADDITIONS[p],p);
  // The historical c61 seals bind the actual c61 collector-side owner bytes.
  assert.deepEqual(Object.keys(race.NATIVE_RACE_SUCCESSOR_PARENT_SEALS).sort(),SUCC.filter(p=>!Object.hasOwn(race.NATIVE_RACE_ADDITIONS,p)));
  for(const[p,d]of Object.entries(race.NATIVE_RACE_SUCCESSOR_PARENT_SEALS))assert.equal(raceKnown.repairSealHash(p,raceC61Bytes(p)),d,p);
  // The final helper/test pins are exactly the workspace bytes (written by the seal pass), and differ from the c61 bytes.
  assert.deepEqual(Object.keys(race.NATIVE_RACE_SUCCESSOR_FINAL_SHA256).sort(),[succHelper,succHelperTest]);
  for(const p of [succHelper,succHelperTest]){assert.equal(race.NATIVE_RACE_SUCCESSOR_FINAL_SHA256[p],succSha(workspaceBytes(p)),p);assert.notEqual(race.NATIVE_RACE_SUCCESSOR_FINAL_SHA256[p],race.NATIVE_RACE_ADDITIONS[p],p);}
  assert.deepEqual({...race.NATIVE_RACE_SUCCESSOR_PARENT_FAILURE},{sourceHead:C61,runId:37646273750,workflow:'.github/workflows/native-world-race.yml',sourceAdmission:'byte-qualified source admission passed',refusal:'candidate checkout status refused',hostedCases:'not executed',status:'historical c61 failure only; not test evidence and not executed at the successor head'});
});
test('native world race successor classification fails closed for every race or owner touch on c61 only',()=>{
  const classify=o=>race.classifyNativeRaceIntent({headSha:succHead,exec:succExec(o)});
  const accepted=classify();assert.equal(accepted.classification,'intended');assert.equal(accepted.profile,'native-world-race');assert.equal(accepted.parent,C61);assert.deepEqual(accepted.paths,SUCC);
  for(const paths of [['nextjs/scripts/repair-collector-only.mjs'],['nextjs/scripts/repair-scope.test.mjs'],['.github/workflows/db-rehearsal.yml'],[race.NATIVE_RACE_MAIN_OVERLAY_PATHS[0]]]){const intent=classify({paths});assert.equal(intent.classification,'intended',paths.join());assert.equal(intent.parent,C61,paths.join());}
  assert.equal(classify({paths:['nextjs/lib/unrelated.ts']}).classification,'normal');
  for(const o of [{merge:true},{checkout:'f'.repeat(40)}]){const intent=classify(o);assert.equal(intent.classification,'unavailable',JSON.stringify(o));assert.equal(intent.intended,true);}
  // Each verifier refuses the other's lineage; the router sends c61 children only to the successor proof.
  assert.match(race.verifyNativeRaceSource({headSha:succHead,intent:accepted,exec:()=>{throw Error('no git read expected');}}).reason,/exact direct child of2bb/);
  const raceIntent=race.classifyNativeRaceIntent({headSha:raceHead,exec:raceExec()});
  assert.match(race.verifyNativeRaceSuccessorSource({headSha:raceHead,intent:raceIntent,exec:()=>{throw Error('no git read expected');}}).reason,/exact direct child of c61/);
  const routed=race.verifyNativeRaceCandidateSource({headSha:raceHead,intent:raceIntent,exec:raceExec()});assert.equal(routed.eligible,true,routed.reason);assert.equal(routed.kind,undefined);assert.equal(routed.parent,race.NATIVE_RACE_PARENT);
});
test('native world race successor binds exact c61 lineage, the six-path and cumulative 18-path scope, preimages, overlays and seals',()=>{
  const accepted=succSource();assert.equal(accepted.eligible,true,accepted.reason);
  assert.deepEqual([accepted.kind,accepted.parent,accepted.parentTree,accepted.raceParent,accepted.raceParentTree],['exact-c61-successor',C61,race.NATIVE_RACE_SUCCESSOR_PARENT_TREE,race.NATIVE_RACE_PARENT,race.NATIVE_RACE_PARENT_TREE]);
  assert.deepEqual(accepted.exactChangedPaths,[...race.NATIVE_RACE_CHANGED_PATHS]);assert.deepEqual(accepted.successorChangedPaths,SUCC);assert.deepEqual(accepted.unchangedOwners,['nextjs/scripts/repair-scope.test.mjs']);
  assert.deepEqual(accepted.preimages,Object.fromEntries(SUCC.map(p=>[p,gitBlob(raceC61Bytes(p))])));assert.deepEqual(accepted.finalBlobs,Object.fromEntries(SUCC.map(p=>[p,gitBlob(workspaceBytes(p))])));
  assert.deepEqual(accepted.mainOverlays,race.nativeRaceMainOverlayEvidence());assert.deepEqual(accepted.parentFailure,{...race.NATIVE_RACE_SUCCESSOR_PARENT_FAILURE});
  const records=succRecords({}),swap=(p,make)=>records.map(([r,q])=>[q===p?make(gitBlob(raceC61Bytes(p)),gitBlob(workspaceBytes(p))):r,q]);
  const owner='nextjs/scripts/repair-collector-only.mjs',runner='nextjs/scripts/db/native-world-race.mjs',overlay=race.NATIVE_RACE_MAIN_OVERLAY_PATHS[0],LF=Buffer.from('\n'),plus=b=>Buffer.concat([b,LF]);
  const SIX=/must edit exactly the six CI owners over c61, with no other path/,EDIT=/in-place regular edit of its exact c61 blob/,OVERLAY=/Released-main overlay must stay unchanged at its exact main resolution/;
  const refused=[
    ['merge',{merge:true},/exact direct child of c61/],
    ['another checkout',{checkout:'f'.repeat(40)},/exact direct child of c61/],
    ['c61 detached from2bb',{c61Parent:'b'.repeat(40)},/Exact c61 commit parent\/tree changed/],
    ['changed c61 tree',{c61Tree:'b'.repeat(40)},/Exact c61 commit parent\/tree changed/],
    ['changed2bb tree',{raceTree:'b'.repeat(40)},/Exact2bb commit parent\/tree changed/],
    ['ancestry',{ancestor:false},/not ancestor/],
    ['extra path',{paths:[...SUCC,'nextjs/lib/unrelated.ts'].sort()},SIX],
    ['missing helper',{paths:SUCC.filter(p=>p!==succHelper)},SIX],
    ['missing known-regression seal owner',{paths:SUCC.filter(p=>p!==succKnown)},SIX],
    ['an unedited CI owner',{paths:[...SUCC,'nextjs/scripts/repair-scope-gate.mjs'].sort()},SIX],
    ['the historical repair-scope.test.mjs',{paths:[...SUCC,'nextjs/scripts/repair-scope.test.mjs'].sort()},SIX],
    ['an overlay edit',{paths:[...SUCC,overlay].sort()},SIX],
    ['an unedited race addition',{paths:[...SUCC,runner].sort()},SIX],
    ['cumulative2bb drift',{cumulative:[...race.NATIVE_RACE_CHANGED_PATHS,'docs/other.md'].sort()},/Cumulative2bb successor delta must remain exactly the 18/],
    ['cumulative2bb missing a race path',{cumulative:race.NATIVE_RACE_CHANGED_PATHS.filter(p=>p!==runner)},/Cumulative2bb successor delta must remain exactly the 18/],
    ['incomplete raw delta',{raw:records.slice(1)},/malformed or incomplete/],
    ['repeated raw path',{raw:[records[0],...records.slice(0,-1)]},EDIT],
    ['executable owner',{raw:swap(owner,(a,b)=>`:100644 100755 ${a} ${b} M`)},EDIT],
    ['symlinked helper',{raw:swap(succHelper,(a,b)=>`:100644 120000 ${a} ${b} T`)},EDIT],
    ['deleted test',{raw:swap(succHelperTest,a=>`:100644 000000 ${a} ${'0'.repeat(40)} D`)},EDIT],
    ['re-added owner',{raw:swap(owner,(a,b)=>`:000000 100644 ${'0'.repeat(40)} ${b} A`)},EDIT],
    ['unchanged blob reported as an edit',{raw:swap(owner,a=>`:100644 100644 ${a} ${a} M`)},EDIT],
    ['staged checkout',{staged:'x\0'},/staged changes/],
    ['untracked checkout',{untracked:'x\0'},/untracked files/],
    ['dirty tracked checkout',{dirty:`:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0${owner}\0`},/Tracked checkout/],
    ['raw preimage other than the c61 leaf',{tree:{[`${C61}:${owner}`]:'b'.repeat(40)},raw:records},/preimage or final leaf changed/],
    ['c61 collector preimage bytes',{before:{[owner]:plus(raceC61Bytes(owner))},tree:{[`${C61}:${owner}`]:race.NATIVE_RACE_SUCCESSOR_PREIMAGES[owner]}},/Exact c61 owner preimage bytes changed: nextjs\/scripts\/repair-collector-only\.mjs/],
    ['c61 known-regression preimage bytes',{before:{[succKnown]:plus(raceC61Bytes(succKnown))},tree:{[`${C61}:${succKnown}`]:race.NATIVE_RACE_SUCCESSOR_PREIMAGES[succKnown]}},/Exact c61 owner preimage bytes changed: nextjs\/scripts\/repair-known-regression\.mjs/],
    ['c61 helper preimage bytes',{before:{[succHelper]:plus(raceC61Bytes(succHelper))},tree:{[`${C61}:${succHelper}`]:race.NATIVE_RACE_SUCCESSOR_PREIMAGES[succHelper]}},/Exact c61 owner preimage bytes changed: nextjs\/scripts\/db\/native-world-race-ci\.mjs/],
    ['final helper bytes',{bytes:{[succHelper]:plus(workspaceBytes(succHelper))}},/final helper\/test bytes changed: nextjs\/scripts\/db\/native-world-race-ci\.mjs/],
    ['final helper test bytes',{bytes:{[succHelperTest]:plus(workspaceBytes(succHelperTest))}},/final helper\/test bytes changed: nextjs\/scripts\/db\/native-world-race-ci\.test\.mjs/],
    ['final collector test bytes',{bytes:{[succCollectorTest]:plus(workspaceBytes(succCollectorTest))}},/successor collector seal changed: nextjs\/scripts\/repair-collector-only\.test\.mjs/],
    ['final known-regression bytes',{bytes:{[succKnown]:plus(workspaceBytes(succKnown))}},/successor repair seal changed: nextjs\/scripts\/repair-known-regression\.mjs/],
    ['an unedited addition leaf',{tree:{[`${succHead}:${runner}`]:'b'.repeat(40)}},/Unchanged native World race path modified/],
    ['unedited addition bytes under its c61 leaf',{bytes:{[runner]:plus(workspaceBytes(runner))},tree:{[`${succHead}:${runner}`]:gitBlob(workspaceBytes(runner))}},/Race file byte identity changed/],
    ['an unedited CI owner leaf',{tree:{[`${succHead}:nextjs/scripts/repair-scope-gate.mjs`]:'b'.repeat(40)}},/Unchanged native World race path modified/],
    ['the historical repair-scope.test.mjs leaf',{tree:{[`${succHead}:nextjs/scripts/repair-scope.test.mjs`]:'b'.repeat(40)}},/Unchanged CI owner modified/],
    ['an overlay moved at both c61 and head',{tree:{[`${C61}:${overlay}`]:'b'.repeat(40),[`${succHead}:${overlay}`]:'b'.repeat(40)}},OVERLAY],
    ['mutated overlay bytes',{bytes:{[overlay]:plus(workspaceBytes(overlay))}},OVERLAY],
  ];
  for(const[label,o,reason]of refused){const value=succSource(o);assert.equal(value.eligible,false,label);assert.match(value.reason,reason,label);}
});
const succProof=(source={})=>({...raceProof(),source:{eligible:true,profile:'native-world-race',kind:'exact-c61-successor',headSha:raceHead,parent:C61,parentTree:race.NATIVE_RACE_SUCCESSOR_PARENT_TREE,raceParent:race.NATIVE_RACE_PARENT,mainOverlays:race.nativeRaceMainOverlayEvidence(),...source}});
test('native world race successor plan keeps the exact2bb selection and debt, adding only c61 provenance and history',()=>{
  const base=race.nativeRacePlan(raceNormal(),raceProof()),plan=race.nativeRacePlan(raceNormal(),succProof());
  assert.equal(base.nativeWorldRaceSuccessor,undefined);
  for(const k of ['groups','unitFiles','browserFiles','unknownPaths','deferredGroups','nativeWorldRaceContractSuites','nativeWorldRaceWorkflow','runFullHermeticVitest','runScriptContracts','runDatabaseRehearsal','runWorkflowStaticGate','databaseDisposition','databaseRehearsalStatus','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','inheritedChecks','parentSkippedJobs','knownRegressionResolution','historicalStaticFailure'])assert.deepEqual(plan[k],base[k],k);
  assert.deepEqual(plan.nativeWorldRaceSuccessor,{kind:'exact-c61-successor',parent:C61,parentTree:race.NATIVE_RACE_SUCCESSOR_PARENT_TREE,raceParent:race.NATIVE_RACE_PARENT,changedPaths:SUCC,historicalParentFailure:{...race.NATIVE_RACE_SUCCESSOR_PARENT_FAILURE},status:'exact c61 successor; c61 qualifies nothing and exact2bb Repair evidence stays inherited parent evidence only'});
  assert.match(plan.qualificationReasons.at(-1),/four PR143 released-main overlays are inherited source evidence only.*The exact c61 successor edits only six CI owners over c61; c61 run 37646273750 is historical failure only, and no hosted case ran at c61 or this head\.$/);
  const written=JSON.parse(JSON.stringify(plan));assert.deepEqual(race.nativeRaceLineageFailures(written,succProof()),[]);
  assert.deepEqual(race.nativeRaceLineageFailures({...written,nativeWorldRaceSuccessor:undefined},succProof()),['Native World race plan changed: nativeWorldRaceSuccessor']);
  assert.deepEqual(race.nativeRaceLineageFailures(JSON.parse(JSON.stringify(base)),succProof()),['Native World race plan changed: nativeWorldRacePresentation','Native World race plan changed: nativeWorldRaceSuccessor']);
  for(const source of [{parentTree:'b'.repeat(40)},{raceParent:race.EXPLORE_SUCCESSOR_PARENT},{parent:race.NATIVE_RACE_PARENT},{kind:'other'},{profile:'native-world'}])assert.throws(()=>race.nativeRacePlan(raceNormal(),succProof(source)),/Native World race plan requires/,JSON.stringify(source));
  assert.throws(()=>race.nativeRacePlan(raceNormal(),{...raceProof(),source:{...raceProof().source,parent:C61}}),/Native World race plan requires/);
});
test('failed native world race successor admission keeps race history, adds c61 history and every debt',()=>{
  const intent={classification:'intended',intended:true,headSha:succHead,parent:C61,profile:'native-world-race'},reason='Native World race successor repair seal changed: nextjs/scripts/repair-known-regression.mjs';
  const {plan,receipt}=race.failedNativeRaceReceipt({headSha:succHead,reason,intent,api:()=>{throw Error('offline');}});
  assert.deepEqual(plan.currentAdmission,{profile:'native-world-race',headSha:succHead,parent:C61,status:'failed',reason});assert.deepEqual(plan.historicalRaceParentFailure,{...race.NATIVE_RACE_SUCCESSOR_PARENT_FAILURE});
  assert.deepEqual(plan.historicalStaticFailure,{...race.EXPLORE_SUCCESSOR_FAILED_PARENT});assert.ok(!plan.pendingQualificationDebt.includes(race.REGRESSION_DEBT));
  assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.inheritedChecks,{});assert.equal(receipt.fullQualification,'pending');
  for(const debt of ['database-contract','native-world-race','native-world-race-eligibility',...race.EXPLORE_REPAIR_PENDING_DEBT])assert.ok(receipt.pendingDebt.includes(debt),debt);
  // An exact2bb child carries no c61 history.
  assert.equal(race.failedCollectorPlan({headSha:raceHead,reason,intent:{...intent,headSha:raceHead,parent:race.NATIVE_RACE_PARENT}}).historicalRaceParentFailure,undefined);
  // The DB failure path re-derives the exact c61 child from the head and reads only actual623 evidence (offline here); other parents read nothing.
  const before=structuredClone(receipt),calls=[];assert.deepEqual(race.authenticateFailedNativeResolution(structuredClone(before),{headSha:succHead,intended:undefined,exec:succExec(),api:()=>{throw Error('native evidence must not be read');},exploreApi:p=>{calls.push(p);throw Error('offline');}}),before);assert.deepEqual(calls,['actions/runs/37413409860']);
  const reads=[];assert.deepEqual(race.authenticateFailedNativeRaceResolution(structuredClone(before),{intent:{...intent,parent:'b'.repeat(40)},api:p=>{reads.push(p);throw Error('no read');}}),before);assert.deepEqual(reads,[]);
});

test('native world race successor real Git c61 child uses default classifier, shared eligibility, native admission and final-gate revalidation',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'c61-real-git-')),support=mkdtempSync(resolve(tmpdir(),'c61-final-support-')),previous=process.cwd();
  const git=(args,options={})=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe',...options});
  const sourceGit=args=>execFileSync('git',['-C',raceRoot,...args],{encoding:'utf8',stdio:'pipe'}).trim();
  const author={...process.env,GIT_AUTHOR_NAME:'c61 fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'c61 fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  try{
    git(['init','--quiet']);git(['config','core.autocrlf','false']);git(['config','core.filemode','true']);
    writeFileSync(resolve(root,'.git/objects/info/alternates'),sourceGit(['rev-parse','--path-format=absolute','--git-path','objects'])+'\n');
    const selected=[...new Set([...race.NATIVE_RACE_CHANGED_PATHS,...race.CONFIG_PATHS,...raceKnown.REPAIR_SEAL_PATHS,'nextjs/scripts/run-repair-check.mjs','nextjs/scripts/repair-test-report.mjs','nextjs/scripts/repair-scope.mjs'])];
    const blobs=Object.fromEntries(SUCC.map(p=>[p,git(['hash-object','-w','--no-filters','--stdin'],{input:workspaceBytes(p)}).trim()]));
    const commit=(paths=SUCC,parent=C61)=>{
      git(['read-tree',C61]);
      for(const p of paths)git(['update-index','--add','--cacheinfo',`100644,${blobs[p]},${p}`]);
      const tree=git(['write-tree']).trim(),head=git(['commit-tree',tree,'-p',parent],{input:'Exact c61 successor test fixture\n',env:author}).trim();
      git(['update-ref','HEAD',head]);
      const tracked=git(['ls-files','-z']).split('\0').filter(Boolean);
      git(['update-index','--skip-worktree','-z','--stdin'],{input:tracked.join('\0')+'\0'});
      git(['update-index','--no-skip-worktree','--',...selected]);
      for(const p of selected){mkdirSync(dirname(resolve(root,p)),{recursive:true});writeFileSync(resolve(root,p),git(['show',`${head}:${p}`],{encoding:'buffer'}));}
      return head;
    };
    const head=commit();process.chdir(root);
    const intent=race.classifyNativeRaceIntent({headSha:head});assert.equal(intent.classification,'intended');assert.equal(intent.parent,C61);
    const source=race.verifyNativeRaceCandidateSource({headSha:head});assert.equal(source.eligible,true,source.reason);
    const helper=await import('./db/native-world-race-ci.mjs');assert.equal(helper.admitRaceSource(head,{exec:execFileSync}).kind,race.NATIVE_RACE_SUCCESSOR_KIND);
    const historical=solutionsApiFixture(),parent=raceParent(),records=Object.values(parent),api=p=>records.find(r=>p===`actions/${p.includes('/jobs/')?'jobs':'runs'}/${r.id}`)??historical(p);
    const env={GITHUB_REPOSITORY:'0ssol1620-byte/tavonel-saas-foundation',GITHUB_EVENT_NAME:'pull_request'},repo={full_name:env.GITHUB_REPOSITORY,id:7};
    const event={number:141,repository:repo,pull_request:{number:141,base:{ref:'main',repo},head:{ref:'codex/masterplan-checkpoint-2026-09-30',sha:head,repo}}};
    const eligibility=()=>race.verifyNativeRaceEligibility({headSha:head,api,env,event});
    const proof=eligibility();assert.equal(proof.eligible,true,proof.reason);
    const plan=race.nativeRacePlan({...raceNormal(),headSha:head},proof);assert.equal(plan.runFullHermeticVitest,false);assert.equal(plan.runDatabaseRehearsal,false);
    // These are the independent calls used by the unchanged final scope gate, without injecting intent or source proof.
    assert.deepEqual(race.nativeRaceLineageFailures(JSON.parse(JSON.stringify(plan)),eligibility()),[]);
    assert.equal(race.nativeRaceDecisionHolds({headSha:head,nativeRace:'true',decision:race.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'true',nativeDatabase:'false',nativeRace:'true'})}),true);
    writeFileSync(resolve(root,succHelper),Buffer.concat([workspaceBytes(succHelper),Buffer.from('\n')]));
    assert.equal(eligibility().eligible,false);assert.ok(race.nativeRaceLineageFailures(plan,eligibility()).length>0);assert.throws(()=>helper.admitRaceSource(head,{exec:execFileSync}));
    writeFileSync(resolve(root,succHelper),workspaceBytes(succHelper));
    const staged=git(['hash-object','-w','--stdin'],{input:'staged mutation\n'}).trim();git(['update-index','--cacheinfo',`100644,${staged},${succHelper}`]);
    assert.match(race.verifyNativeRaceCandidateSource({headSha:head}).reason,/staged changes/);git(['update-index','--cacheinfo',`100644,${blobs[succHelper]},${succHelper}`]);
    writeFileSync(resolve(root,'untracked.txt'),'x');assert.match(race.verifyNativeRaceCandidateSource({headSha:head}).reason,/untracked files/);rmSync(resolve(root,'untracked.txt'));
    // Production workflow: run the actual collector plan CLI, keep its disk output through checks, then run the unchanged final gate.
    // Only historical gh reads are recorded API fixtures; every classifier, Git proof, selector and final-gate call is the default.
    const cache=Object.fromEntries([...solutionsEndpoints,...records.map(r=>`actions/${r.run_id?'jobs':'runs'}/${r.id}`)].map(p=>{
      const v=api(p);return[p,Buffer.isBuffer(v)?{buffer:v.toString('base64')}:{json:v}];
    }));
    writeFileSync(resolve(support,'api.json'),JSON.stringify(cache));
    const preload=resolve(support,'recorded-api.mjs');writeFileSync(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync(new URL('./api.json',import.meta.url))),actual=cp.execFileSync;
cp.execFileSync=(file,args,options)=>{if(file!=='gh')return actual(file,args,options);const p=args[1].replace('repos/0ssol1620-byte/tavonel-saas-foundation/',''),v=data[p];if(!v)throw Error('Unexpected recorded gh endpoint '+p);return v.buffer?Buffer.from(v.buffer,'base64'):JSON.stringify(v.json);};syncBuiltinESMExports();`);
    const base=race.NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.mainCommit,workflowEvent={...event,pull_request:{...event.pull_request,base:{...event.pull_request.base,sha:base}}};
    const eventPath=resolve(support,'event.json');writeFileSync(eventPath,JSON.stringify(workflowEvent));
    const workflowEnv={...process.env,...env,GITHUB_EVENT_PATH:eventPath,PR_BASE_SHA:base,PR_NUMBER:'141',REPAIR_ANCHOR_SHA:race.FULL_ANCHOR,REPAIR_HEAD_SHA:head,HEAD_SHA:head,GITHUB_OUTPUT:resolve(support,'outputs.txt')};
    for(const k of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT'])workflowEnv[k]='success';
    const cli=(name,args=[])=>spawnSync(process.execPath,['--import',pathToFileURL(preload).href,resolve(root,'nextjs/scripts/'+name),...args],{cwd:resolve(root,'nextjs'),env:{...workflowEnv,RUN_REPAIR_SCOPE:name==='repair-collector-only.mjs'?'1':'0'},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
    const planned=cli('repair-collector-only.mjs',['plan']);assert.equal(planned.status,0,planned.stderr);const planPath=resolve(root,'nextjs/repair-plan.json'),plannedBytes=readFileSync(planPath),diskPlan=JSON.parse(plannedBytes);
    assert.equal(diskPlan.headSha,head);assert.equal(diskPlan.nativeWorldRaceSuccessor.parent,C61);assert.equal(diskPlan.runFullHermeticVitest,false);assert.equal(diskPlan.runDatabaseRehearsal,false);
    assert.match(readFileSync(workflowEnv.GITHUB_OUTPUT,'utf8'),/native_race=true/);
    // Checks may read the plan, but initial/native source admission must still refuse it, including a caller-forged owner token.
    assert.match(race.verifyNativeRaceCandidateSource({headSha:head,checkoutOwner:Symbol('native race final-gate generated plan')}).reason,/untracked files/);
    assert.throws(()=>helper.admitRaceSource(head,{exec:execFileSync}),/untracked files/);
    const gated=cli('repair-scope-gate.mjs');assert.equal(gated.status,0,gated.stderr);
    const receiptPath=resolve(root,'nextjs/repair-receipt.json'),receipt=JSON.parse(readFileSync(receiptPath));assert.equal(receipt.gate,'passed-scoped-only');assert.equal(receipt.fullQualification,'pending');assert.match(receipt.databaseObservation,/no DB, Auth or transport ran/);rmSync(receiptPath);
    const refusal=(pattern)=>{const result=cli('repair-scope-gate.mjs');assert.equal(result.status,1,result.stdout);assert.match(result.stderr,pattern);};
    // A routing mutation cannot skip the protected proof: the import preflight qualifies the full disk bytes before runGate reads flags.
    writeFileSync(planPath,JSON.stringify({...diskPlan,nativeWorldRacePresentation:undefined,nativeWorldRaceSuccessor:undefined,groups:[]},null,2)+'\n');refusal(/independently recomputed current-head plan/);writeFileSync(planPath,plannedBytes);
    writeFileSync(planPath,Buffer.concat([plannedBytes,Buffer.from(' ')]));refusal(/independently recomputed current-head plan/);writeFileSync(planPath,plannedBytes);
    const extra=resolve(root,'nextjs/repair-plan-extra.json');writeFileSync(extra,'{}');refusal(/untracked files/);rmSync(extra);
    const linkTarget=resolve(support,'plan-target.json');writeFileSync(linkTarget,plannedBytes);rmSync(planPath);if(process.platform==='win32'){const junction=resolve(support,'empty-plan-link');mkdirSync(junction);symlinkSync(junction,planPath,'junction');}else symlinkSync(linkTarget,planPath,'file');refusal(/regular non-symlink owner output/);rmSync(planPath);writeFileSync(planPath,plannedBytes);
    writeFileSync(planPath,JSON.stringify({...diskPlan,headSha:'f'.repeat(40)},null,2)+'\n');refusal(/independently recomputed current-head plan/);rmSync(planPath);
    assert.equal(race.verifyNativeRaceCandidateSource({headSha:head}).eligible,true);
    const partial=commit([succHelper]);assert.equal(race.classifyNativeRaceIntent({headSha:partial}).intended,true);assert.match(race.verifyNativeRaceCandidateSource({headSha:partial}).reason,/six CI owners/);assert.throws(()=>helper.admitRaceSource(partial,{exec:execFileSync}));
    const wrong=commit(SUCC,race.NATIVE_RACE_PARENT);assert.equal(race.classifyNativeRaceIntent({headSha:wrong}).intended,true);assert.equal(race.verifyNativeRaceCandidateSource({headSha:wrong}).eligible,false);
  }finally{process.chdir(previous);rmSync(root,{recursive:true,force:true});rmSync(support,{recursive:true,force:true});}
});

// ---- Affected integration: verified-baseline descendants, planned from a fail-closed incremental map ----
const affectedHead='a'.repeat(40);
const affectedRaw=records=>records.map(([status,paths,modes=['100644','100644']])=>[`:${modes[0]} ${modes[1]} ${'1'.repeat(40)} ${'2'.repeat(40)} ${status}`,...paths].join('\0')+'\0').join('');
const affectedExec=({diff='',tree=AFFECTED_BASELINE.tree,ancestor=true,absent=[],head=affectedHead,untracked='',trackedPath='',worktreeDiff='',worktreeHash='',staged=''}={})=>(_command,args,options={})=>{
  if(args[0]==='-C'){assert.equal(args[1],'fixture-root');args=args.slice(2);}
  if(args[0]==='diff'&&args[1]==='--cached'){assert.deepEqual(args.slice(2),['--name-only','--no-relative','-z',head]);return staged;}
  if(args[0]==='rev-parse'&&args[1]==='--show-toplevel')return 'fixture-root\n';
  if(args[0]==='rev-parse'&&args[1]==='HEAD')return head+'\n';
  if(args[0]==='rev-parse'&&args[1]===`${AFFECTED_BASELINE.commit}^{tree}`)return tree+'\n';
  if(args[0]==='merge-base'){assert.deepEqual(args.slice(1),['--is-ancestor',AFFECTED_BASELINE.commit,affectedHead]);if(!ancestor){const e=Error('not ancestor');e.status=1;throw e;}return '';}
  if(args[0]==='diff'){if(args.includes('--raw')&&args.slice(-2).join(' ')===`${AFFECTED_BASELINE.commit} ${affectedHead}`)return options.encoding==='buffer'?Buffer.from(diff):diff;if(args.includes('--raw'))return options.encoding==='buffer'?Buffer.from(worktreeDiff):worktreeDiff;assert.deepEqual(args.slice(-2),[AFFECTED_BASELINE.commit,affectedHead]);return options.encoding==='buffer'?Buffer.from(diff):diff;}
  if(args[0]==='ls-files'&&args[1]==='--others')return untracked;
  if(args[0]==='ls-tree'&&trackedPath&&args.at(-1)===trackedPath)return `100644 blob ${'1'.repeat(40)}\t${trackedPath}\n`;
  if(args[0]==='hash-object'&&trackedPath)return worktreeHash;
  if(args[0]==='cat-file'){if(absent.includes(args[2].slice(41)))throw Error('missing');return '';}
  throw Error('Unexpected affected git command: '+args.join(' '));
};
const affectedNormal=()=>({schemaVersion:1,repository:'0ssol1620-byte/tavonel-saas-foundation',pullRequest:141,pullRequestBaseSha:'b'.repeat(40),repairAnchorSha:world.FULL_ANCHOR,headSha:affectedHead,
  selector:'foundation-repair-anchor-6401-v2',changedPaths:['nextjs/app/page.tsx'],groups:['unknown'],unitFiles:[],browserFiles:[],unknownPaths:['app/page.tsx'],broaderQualificationRequired:true,
  runFullHermeticVitest:true,qualificationReasons:['normal'],pendingQualificationDebt:['database-contract'],pendingFullDebt:['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair']});
const affectedProof=records=>{const map=buildAffectedMap({headSha:affectedHead,records});return {eligible:map.failures.length===0,profile:world.AFFECTED_PROFILE,headSha:affectedHead,baseline:{...AFFECTED_BASELINE},map};};
const affectedEdit=path=>({oldMode:'100644',newMode:'100644',status:'M',paths:[path]});
test('affected classification routes only verified-baseline descendants and leaves every other head to the exact classifiers',()=>{
  const classify=o=>world.classifyAffectedIntent({headSha:affectedHead,exec:affectedExec(o)});
  assert.deepEqual(classify(),{classification:'intended',intended:true,headSha:affectedHead,repoRoot:'fixture-root',profile:world.AFFECTED_PROFILE});
  assert.equal(classify({ancestor:false}).classification,'normal');
  assert.equal(classify({tree:'0'.repeat(40)}).classification,'unavailable');
  assert.equal(world.classifyAffectedIntent({headSha:AFFECTED_BASELINE.commit,exec:affectedExec()}).classification,'normal','the baseline itself stays with its exact profile');
  assert.equal(world.classifyAffectedIntent({headSha:affectedHead,exec:()=>{throw Error('no git');}}).classification,'unavailable');
  assert.equal(classify({untracked:'new-untracked.txt\0'}).classification,'unavailable','initial untracked paths fail closed');
  assert.equal(classify({head:'f'.repeat(40)}).classification,'unavailable','checkout HEAD mismatch fails closed');
  // Index-only drift: the worktree diff is clean, yet a staged blob differs from HEAD.
  const staged=classify({staged:'nextjs/lib/docs-content.ts\0'});
  assert.equal(staged.classification,'unavailable');assert.match(staged.reason,/staged changes: nextjs\/lib\/docs-content\.ts/);
  const source=readFileSync(fileURLToPath(new URL('./repair-collector-only.mjs',import.meta.url)),'utf8'),cli=source.slice(source.lastIndexOf('if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))'));
  assert.ok(cli.indexOf('classifyAffectedIntent({headSha})')>=0&&cli.indexOf('classifyAffectedIntent({headSha})')<cli.indexOf('classifyNativeRaceIntent({headSha})'),'affected routing precedes every exact profile');
});
test('affected source fails closed on unmapped, unsupported or absent-owner changes with no broad fallback',()=>{
  const verify=o=>world.verifyAffectedSource({headSha:affectedHead,intent:world.classifyAffectedIntent({headSha:affectedHead,exec:affectedExec(o)}),exec:affectedExec(o)});
  const clean=verify({diff:affectedRaw([['M',['nextjs/lib/docs-content.ts']]])});
  assert.equal(clean.eligible,true,clean.reason);assert.deepEqual(clean.map.groups,['docs']);assert.equal(clean.map.nativeEvidence.disposition,'historical-input-reuse');
  for(const [label,o,pattern] of [
    ['an unmapped toolchain path',{diff:affectedRaw([['M',['nextjs/next.config.ts']]])},/unmapped changed endpoint: nextjs\/next\.config\.ts/],
    ['a type change',{diff:affectedRaw([['T',['nextjs/lib/docs-content.ts'],['100644','120000']]])},/unsupported change status T/],
    ['a deleted owner suite',{diff:affectedRaw([['D',['nextjs/lib/dropbox-source-reconciliation.test.ts'],['100644','000000']]]),absent:['nextjs/lib/dropbox-source-reconciliation.test.ts']},/absent at head: lib\/dropbox-source-reconciliation\.test\.ts/],
    ['a renamed endpoint leaving owner scope',{diff:affectedRaw([['R100',['nextjs/lib/docs-content.ts','nextjs/lib/unowned.ts']]])},/unmapped changed endpoint: nextjs\/lib\/unowned\.ts/],
  ]){const r=verify(o);assert.equal(r.eligible,false,label);assert.match(r.reason,pattern,label);}
  const dirtyExec=affectedExec({diff:affectedRaw([['M',['nextjs/lib/docs-content.ts']]]),trackedPath:'nextjs/lib/docs-content.ts',worktreeDiff:`:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0nextjs/lib/docs-content.ts\0`,worktreeHash:'2'.repeat(40)});
  const dirtyIntent=world.classifyAffectedIntent({headSha:affectedHead,exec:dirtyExec});assert.equal(dirtyIntent.classification,'unavailable');
  assert.match(world.verifyAffectedSource({headSha:affectedHead,intent:{classification:'intended',profile:world.AFFECTED_PROFILE,headSha:affectedHead,repoRoot:'fixture-root'},exec:dirtyExec}).reason,/Tracked checkout content changed/);
  const plan=world.failedCollectorPlan({headSha:affectedHead,reason:'Affected map failed closed: x',intent:{profile:world.AFFECTED_PROFILE}});
  assert.equal(plan.currentAdmission.status,'failed');assert.ok(plan.pendingQualificationDebt.includes('affected-integration-eligibility'));
  assert.equal(plan.runFullHermeticVitest,false);assert.deepEqual(plan.unitFiles,[]);assert.deepEqual(plan.inheritedChecks,{});
});
test('affected plan keeps cumulative release debt separate, defers fresh native and DB runs and claims neither',()=>{
  const normal=affectedNormal(),proof=affectedProof([affectedEdit('nextjs/lib/docs-content.ts'),{oldMode:'000000',newMode:'100644',status:'A',paths:['supabase/tests/new_case.sql']}]);
  const plan=world.affectedPlan(normal,proof);
  assert.deepEqual(plan.groups,['database-contract','docs','native-world-race-fresh-run']);
  assert.deepEqual(plan.deferredGroups,['database-contract','native-world-race-fresh-run']);
  assert.deepEqual(plan.unitFiles,['lib/docs-content.test.ts','lib/docs-navigation.test.ts','lib/pgtap-fixtures.test.ts','lib/retrieval-docs-parity.test.ts']);
  assert.deepEqual(plan.browserFiles,['e2e/docs-reading-layout.spec.ts']);
  assert.equal(plan.runFullHermeticVitest,false);assert.equal(plan.runDatabaseRehearsal,false);assert.deepEqual(plan.inheritedChecks,{});
  assert.deepEqual(plan.pendingFullDebt,normal.pendingFullDebt);
  assert.deepEqual([plan.cumulativeRelease.anchor,plan.cumulativeRelease.groups,plan.cumulativeRelease.changedPaths,plan.cumulativeRelease.broaderQualificationRequired],[world.FULL_ANCHOR,['unknown'],['nextjs/app/page.tsx'],true]);
  assert.equal(plan.affectedIntegration.nativeEvidence.disposition,'fresh-seven-case-native-run-required');assert.equal(plan.affectedIntegration.nativeEvidence.freshRunClaimed,false);
  for(const debt of ['database-contract','native-world-race-fresh-run','native-world-real-concurrency'])assert.ok(plan.pendingQualificationDebt.includes(debt),debt);
  const receipt=buildRepairReceipt(plan,{headSha:affectedHead});
  assert.equal(receipt.gate,'passed-scoped-only');assert.equal(receipt.fullQualification,'pending');
  assert.equal(receipt.runResults['native-world-race-fresh-run'],'pending-deferred');assert.equal(receipt.runResults['database-contract'],'pending-deferred');
  assert.match(receipt.databaseObservation,/no fresh native run is executed or claimed by Repair/);
  const docsOnly=world.affectedPlan(normal,affectedProof([affectedEdit('nextjs/app/docs/page.tsx')]));
  assert.deepEqual(docsOnly.deferredGroups,[]);assert.deepEqual(docsOnly.affectedIntegration.databaseTests,[]);assert.equal(docsOnly.affectedIntegration.nativeEvidence.disposition,'historical-input-reuse');
  assert.throws(()=>world.affectedPlan(normal,affectedProof([affectedEdit('nextjs/next.config.ts')])),/clean fail-closed map/);
  assert.throws(()=>world.affectedPlan({...normal,headSha:'f'.repeat(40)},proof),/clean fail-closed map/);
});
test('affected final-gate lineage and DB decision re-derive from the head, never from plan flags',()=>{
  const plan=world.affectedPlan(affectedNormal(),affectedProof([affectedEdit('nextjs/app/docs/page.tsx')])),owned={eligible:true,headSha:affectedHead,generatedPlan:'owner-qualified'};
  assert.match(world.affectedLineageFailures(plan,{eligible:false,reason:'x'})[0],/source\/map unavailable: x/);
  assert.match(world.affectedLineageFailures(plan,{eligible:true,headSha:affectedHead})[0],/not qualified by the final-gate owner/);
  assert.deepEqual(world.affectedLineageFailures(plan,owned),[]);
  assert.match(world.affectedLineageFailures({...plan,affectedIntegration:undefined},owned)[0],/does not name the current head/);
  // Outside the final-gate owner, eligibility is the source proof alone and can never satisfy lineage.
  const proof=world.verifyAffectedEligibility({headSha:affectedHead,exec:affectedExec({diff:affectedRaw([['M',['nextjs/app/docs/page.tsx']]])})});
  assert.equal(proof.eligible,true,proof.reason);assert.equal(proof.generatedPlan,undefined);
  const normalDecision=world.nativeDbJobDecision({classifierResult:'success',intended:'false',eligible:'false',nativeDatabase:'false',nativeRace:''});
  assert.deepEqual([normalDecision.runDatabase,normalDecision.runTransport],[true,true]);
  assert.equal(world.nativeRaceDecisionHolds({headSha:affectedHead,nativeRace:'',decision:normalDecision,exec:affectedExec()}),true);
  const raced=world.nativeDbJobDecision({classifierResult:'success',intended:'true',eligible:'true',nativeDatabase:'false',nativeRace:'true'});
  assert.equal(world.nativeRaceDecisionHolds({headSha:affectedHead,nativeRace:'true',decision:raced,exec:affectedExec()}),false,'an affected head never takes the race disposition');
});
// The integrated PR 141 delta (43 paths): 26 reviewed product paths, the 15 CI-owner paths of this change and 2 SQL compatibility fixtures.
const AFFECTED_PRODUCT_PATHS=Object.freeze([
  'nextjs/lib/intake-triage.test.ts','nextjs/lib/acl-refresh-core.test.mjs','nextjs/lib/ask-route-limits.test.ts','supabase/tests/google_viewer_principal_boundary.sql',
  'nextjs/lib/billing-product-access.ts','nextjs/lib/billing-product-access.test.ts','README.md','nextjs/lib/docs-content.ts','nextjs/lib/docs-content.test.ts',
  'nextjs/app/docs/[section]/page.tsx','nextjs/components/world-studio-ultimate.tsx','nextjs/components/world-studio-ultimate.module.css','nextjs/app/workspace/page.tsx',
  'nextjs/e2e/world-lifecycle.spec.ts','quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts','quarantine-sidecar/foundation-cdr-worker/src/sanitize.test.ts',
  'nextjs/lib/connector-oauth-adapters.ts','nextjs/lib/connector-oauth-adapters.test.ts','nextjs/lib/connector-sync-page.ts','nextjs/lib/connector-sync-page.test.ts',
  'nextjs/lib/sync-worker.ts','nextjs/lib/sync-worker.test.ts','nextjs/lib/dropbox-source-reconciliation.ts','nextjs/lib/dropbox-source-reconciliation.test.ts',
  'supabase/migrations/20261007100000_dropbox_source_path_reconciliation.sql','supabase/tests/dropbox_source_reconciliation.sql',
]);
const AFFECTED_CI_OWNER_PATHS=Object.freeze([
  '.github/workflows/db-rehearsal.yml','.github/workflows/native-world-race.yml','.github/workflows/repair-scope.yml','AFFECTED-INTEGRATION-MANIFEST.md',
  'nextjs/scripts/db/dropbox-source-stream-race.mjs','nextjs/scripts/db/dropbox-source-stream-race.test.mjs','nextjs/scripts/db/native-world-race-ci.mjs',
  'nextjs/scripts/db/native-world-race-ci.test.mjs','nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-scope-gate.mjs',
  'nextjs/scripts/repair-scope.mjs','nextjs/scripts/repair-scope.test.mjs','nextjs/scripts/run-repair-check.mjs','nextjs/scripts/verify-repair-workflows.mjs',
]);
// Existing Dropbox dependency contracts edited for compatibility; neither product owner nor CI owner.
const AFFECTED_SQL_FIXTURE_PATHS=Object.freeze(['supabase/tests/connector_checkpoints.sql','supabase/tests/connector_sync_page_snapshots.sql']);
// CI owners carry their actual candidate bytes. Product and SQL fixture leaves are path-exact stand-ins (baseline bytes plus one line, or a marker when
// absent at the baseline): the map binds paths and owners, and the reviewed product bytes belong to the parallel product task.
const affectedLeafBytes=p=>{
  if(AFFECTED_CI_OWNER_PATHS.includes(p))return readFileSync(resolve(nativeRoot,p));
  let base;try{base=baselineBytes(p);}catch{return Buffer.from(`affected fixture stand-in for ${p}\n`);}
  return Buffer.concat([base,Buffer.from('\n')]);
};
// Every fixture commit is built in a private index as a direct child of the exact verified baseline and then checked out, so the
// tracked worktree is materialized and clean, exactly as a CI checkout of that head would be.
function affectedRealGitFixture(){
  const root=mkdtempSync(resolve(tmpdir(),'affected-real-git-')),B=AFFECTED_BASELINE.commit,index=resolve(root,'.git/affected-fixture-index'),written={};
  const git=(args,options={})=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe',maxBuffer:64*1024*1024,...options});
  const staging=args=>git(args,{env:{...process.env,GIT_INDEX_FILE:index}});
  const sourceGit=args=>execFileSync('git',['-C',nativeRoot,...args],{encoding:'utf8',stdio:'pipe'}).trim();
  const author={...process.env,GIT_AUTHOR_NAME:'affected fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'affected fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  try{
    git(['init','--quiet']);git(['config','core.autocrlf','false']);git(['config','core.eol','lf']);
    writeFileSync(resolve(root,'.git/objects/info/alternates'),sourceGit(['rev-parse','--path-format=absolute','--git-path','objects'])+'\n');
    // A shallow source checkout keeps its boundary, so ancestry walks stop at the baseline instead of a missing parent.
    try{writeFileSync(resolve(root,'.git/shallow'),readFileSync(sourceGit(['rev-parse','--path-format=absolute','--git-path','shallow'])));}catch{/* full history */}
  }catch(error){rmSync(root,{recursive:true,force:true});throw error;}
  const checkout=head=>{
    git(['-c','advice.detachedHead=false','checkout','--quiet','--force','--detach',head]);
    assert.equal(git(['rev-parse','HEAD']).trim(),head);
    assert.equal(git(['diff','--cached','--name-only','-z',head]),'','fixture index equals its commit');
    assert.equal(git(['ls-files','--others','--exclude-standard','-z']),'','fixture checkout has no untracked path');
    return head;
  };
  const put=(p,bytes,mode='100644')=>()=>{
    const blob=git(['hash-object','-w',mode==='100644'?`--path=${p}`:'--no-filters','--stdin'],{input:bytes}).trim();
    staging(['update-index','--add','--cacheinfo',`${mode},${blob},${p}`]);written[p]=blob;
  };
  const move=(from,to)=>()=>{const blob=git(['rev-parse',`${B}:${from}`]).trim();staging(['update-index','--force-remove','--',from]);staging(['update-index','--add','--cacheinfo',`100644,${blob},${to}`]);};
  const remove=p=>()=>staging(['update-index','--force-remove','--',p]);
  const commit=(...ops)=>{
    staging(['read-tree',B]);for(const op of ops)op();
    const tree=staging(['write-tree']).trim(),head=git(['commit-tree',tree,'-p',B],{input:'affected fixture\n',env:author}).trim();
    assert.equal(git(['rev-list','--parents','-n','1',head]).trim(),`${head} ${B}`,'fixture head is a direct child of the exact baseline');
    assert.equal(git(['rev-parse',`${head}^{tree}`]).trim(),tree);
    return checkout(head);
  };
  try{checkout(B);}catch(error){rmSync(root,{recursive:true,force:true});throw error;}
  return {root,B,git,put,move,remove,commit,checkout,written,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('affected real Git map covers the integrated 43-path delta and its rename, deletion, index-only and owner-output edges from clean checkouts',()=>{
  const previous=process.cwd();let fixture;
  try{
    fixture=affectedRealGitFixture();const {root,B,git,put,move,remove,commit,checkout,written}=fixture;
    process.chdir(root);
    const map=head=>{const intent=world.classifyAffectedIntent({headSha:head});assert.equal(intent.classification,'intended',intent.reason);return world.verifyAffectedSource({headSha:head,intent});};
    const all=[...AFFECTED_PRODUCT_PATHS,...AFFECTED_CI_OWNER_PATHS,...AFFECTED_SQL_FIXTURE_PATHS].sort(),leaves=paths=>paths.map(p=>put(p,affectedLeafBytes(p)));
    assert.equal(all.length,43);
    const integrated=commit(...leaves(all));
    // Exact target tree: the baseline child differs from the baseline in exactly the 43 written leaves.
    assert.deepEqual(git(['diff','--name-only','--no-renames','-z',B,integrated]).split('\0').filter(Boolean).sort(),all);
    for(const p of all)assert.equal(git(['rev-parse',`${integrated}:${p}`]).trim(),written[p],p);
    const full=map(integrated);
    assert.equal(full.eligible,true,full.reason);assert.deepEqual(full.map.changedPaths,all);
    assert.deepEqual(full.map.groups,['acl','billing-access-plan-gates','ci-selector','database-contract','docs','dropbox-connector','intake-triage','ocr-worker','repository-docs','workspace-lifecycle']);
    assert.deepEqual([full.map.databaseChanged,full.map.runSelectorContracts,full.map.runCdrWorkerChecks,full.map.nativeEvidence.disposition],[true,true,true,'fresh-seven-case-native-run-required']);
    assert.deepEqual(full.map.databaseTests,['supabase/tests/connector_checkpoints.sql','supabase/tests/connector_document_bindings.sql','supabase/tests/connector_source_suspensions.sql',
      'supabase/tests/connector_sync_page_snapshots.sql','supabase/tests/dropbox_source_reconciliation.sql','supabase/tests/foundation_jobs.sql','supabase/tests/google_viewer_principal_boundary.sql']);
    assert.deepEqual(Object.keys(full.map.databaseDependencyReasons),['supabase/tests/connector_checkpoints.sql','supabase/tests/connector_document_bindings.sql',
      'supabase/tests/connector_source_suspensions.sql','supabase/tests/connector_sync_page_snapshots.sql','supabase/tests/foundation_jobs.sql']);
    // A selected owner suite or dependency fixture missing at the head fails the whole map closed.
    assert.match(map(commit(...leaves(all.filter(p=>p!=='nextjs/lib/dropbox-source-reconciliation.test.ts')))).reason,/absent at head: lib\/dropbox-source-reconciliation\.test\.ts/);
    assert.match(map(commit(...leaves(all),remove('supabase/tests/connector_checkpoints.sql'))).reason,/selected database fixture is absent at head: supabase\/tests\/connector_checkpoints\.sql/);
    // Index-only drift: a staged blob while the worktree bytes still equal HEAD.
    checkout(integrated);
    const drift=git(['hash-object','-w','--stdin'],{input:'staged drift\n'}).trim();git(['update-index','--cacheinfo',`100644,${drift},nextjs/lib/docs-content.ts`]);
    assert.ok(readFileSync(resolve(root,'nextjs/lib/docs-content.ts')).equals(git(['show',`${integrated}:nextjs/lib/docs-content.ts`],{encoding:'buffer'})),'worktree bytes still equal HEAD');
    const staged=world.classifyAffectedIntent({headSha:integrated});
    assert.equal(staged.classification,'unavailable');assert.match(staged.reason,/staged changes: nextjs\/lib\/docs-content\.ts/);
    checkout(integrated);
    // Outside the final-gate owner, a generated plan is an untracked path like any other.
    writeFileSync(resolve(root,'nextjs/repair-plan.json'),'{}\n');
    assert.match(world.classifyAffectedIntent({headSha:integrated}).reason,/untracked paths: nextjs\/repair-plan\.json/);
    rmSync(resolve(root,'nextjs/repair-plan.json'));
    const docs=map(commit(put('nextjs/lib/docs-content.ts','export const docs = 1;\n'),move('nextjs/app/docs/page.tsx','nextjs/app/docs/moved/page.tsx')));
    assert.equal(docs.eligible,true,docs.reason);assert.deepEqual(docs.map.groups,['docs']);
    assert.ok(docs.map.entries.some(e=>/^R\d{3}$/.test(e.status)&&e.paths.join(' ')==='nextjs/app/docs/page.tsx nextjs/app/docs/moved/page.tsx'),'both rename endpoints are mapped');
    assert.equal(docs.map.nativeEvidence.disposition,'historical-input-reuse');
    const sql=map(commit(put('supabase/tests/affected_fixture.sql','select 1;\n'),put('.github/workflows/repair-scope.yml','name: x\n')));
    assert.equal(sql.eligible,true,sql.reason);assert.deepEqual(sql.map.groups,['ci-selector','database-contract']);
    assert.deepEqual([sql.map.databaseChanged,sql.map.runSelectorContracts,sql.map.nativeEvidence.disposition,sql.map.databaseTests],[true,true,'fresh-seven-case-native-run-required',[]]);
    assert.match(map(commit(put('nextjs/lib/docs-content.ts','docs-content.test.ts','120000'))).reason,/unsupported (?:change status T|file mode)/);
    assert.match(map(commit(put('nextjs/next.config.ts','export default {};\n'))).reason,/unmapped changed endpoint: nextjs\/next\.config\.ts/);
  }finally{process.chdir(previous);fixture?.cleanup();}
});
test('affected real Git plan and final gate qualify only the regular owner plan and refuse planted receipts, plan links and mismatches',t=>{
  const previous=process.cwd();let fixture,support;
  try{
    fixture=affectedRealGitFixture();const {root,B,git,put,commit}=fixture;
    // The unchanged cumulative selector needs the exact 6401 anchor history; a shallow archive without it cannot run this path.
    try{git(['cat-file','-e',`${world.FULL_ANCHOR}^{commit}`]);}catch{t.skip('unavailable: the 6401 full-anchor history required by the normal selector is absent from this checkout');return;}
    process.chdir(root);support=mkdtempSync(resolve(tmpdir(),'affected-final-support-'));
    // The CI-owner half of the integrated delta selects no unit or browser suite, so the final gate needs no fabricated report.
    const head=commit(...AFFECTED_CI_OWNER_PATHS.map(p=>put(p,affectedLeafBytes(p))));
    const eventPath=resolve(support,'event.json');writeFileSync(eventPath,JSON.stringify({number:141,pull_request:{number:141,base:{sha:B},head:{sha:head}}}));
    const env={...process.env,GITHUB_EVENT_PATH:eventPath,PR_BASE_SHA:B,PR_NUMBER:'141',REPAIR_ANCHOR_SHA:world.FULL_ANCHOR,REPAIR_HEAD_SHA:head,HEAD_SHA:head,GITHUB_OUTPUT:resolve(support,'outputs.txt')};
    for(const k of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT'])env[k]='success';
    const cli=(name,args=[])=>spawnSync(process.execPath,[resolve(root,'nextjs/scripts/'+name),...args],{cwd:resolve(root,'nextjs'),env:{...env,RUN_REPAIR_SCOPE:name==='repair-collector-only.mjs'?'1':'0'},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
    const planned=cli('repair-collector-only.mjs',['plan']);assert.equal(planned.status,0,planned.stderr);
    const planPath=resolve(root,'nextjs/repair-plan.json'),receiptPath=resolve(root,'nextjs/repair-receipt.json'),plannedBytes=readFileSync(planPath),plan=JSON.parse(plannedBytes);
    assert.equal(plan.selector,'affected-integration-v1');assert.equal(plan.headSha,head);assert.deepEqual(plan.affectedIntegration.changedPaths,[...AFFECTED_CI_OWNER_PATHS].sort());
    assert.deepEqual(plan.affectedIntegration.groups,['ci-selector','repository-docs']);
    assert.deepEqual([plan.unitFiles,plan.browserFiles,plan.runFullHermeticVitest,plan.runDatabaseRehearsal,plan.affectedIntegration.databaseTests],[[],[],false,false,[]]);
    assert.match(readFileSync(env.GITHUB_OUTPUT,'utf8'),/affected=true/);
    assert.match(world.classifyAffectedIntent({headSha:head}).reason,/untracked paths: nextjs\/repair-plan\.json/,'only the final-gate owner may see its plan');
    const gated=cli('repair-scope-gate.mjs');assert.equal(gated.status,0,gated.stderr+gated.stdout);
    const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
    assert.deepEqual([receipt.gate,receipt.fullQualification,receipt.executedChecks.affectedUnits,receipt.executedChecks.affectedBrowserReports,receipt.runResults['native-world-race-fresh-run']],
      ['passed-scoped-only','pending','none selected','none selected','pending-deferred']);
    rmSync(receiptPath);
    const refusal=pattern=>{const r=cli('repair-scope-gate.mjs');assert.equal(r.status,1,r.stdout);assert.match(r.stderr,pattern);};
    const link=(target,path,name)=>{if(process.platform==='win32'){const junction=resolve(support,name);mkdirSync(junction);symlinkSync(junction,path,'junction');}else symlinkSync(target,path,'file');};
    // A receipt in any form is refused before runGate can read plan flags or write through it.
    writeFileSync(receiptPath,'planted\n');refusal(/preexisting nextjs\/repair-receipt\.json/);assert.equal(readFileSync(receiptPath,'utf8'),'planted\n');rmSync(receiptPath);
    const receiptTarget=resolve(support,'receipt-target.json');writeFileSync(receiptTarget,'sentinel\n');link(receiptTarget,receiptPath,'receipt-junction');
    refusal(/preexisting nextjs\/repair-receipt\.json/);assert.equal(readFileSync(receiptTarget,'utf8'),'sentinel\n');rmSync(receiptPath);
    // The plan must be the regular owner output, byte-equal to the independent recomputation.
    const planTarget=resolve(support,'plan-target.json');writeFileSync(planTarget,plannedBytes);rmSync(planPath);link(planTarget,planPath,'plan-junction');
    refusal(/regular non-symlink owner output/);rmSync(planPath);
    writeFileSync(planPath,Buffer.concat([plannedBytes,Buffer.from(' ')]));refusal(/differs from the independently recomputed current-head plan/);
    writeFileSync(planPath,JSON.stringify({...plan,affectedIntegration:undefined,groups:[]},null,2)+'\n');refusal(/differs from the independently recomputed current-head plan/);
    writeFileSync(planPath,plannedBytes);const again=cli('repair-scope-gate.mjs');assert.equal(again.status,0,again.stderr);
  }finally{process.chdir(previous);fixture?.cleanup();if(support)rmSync(support,{recursive:true,force:true});}
});
