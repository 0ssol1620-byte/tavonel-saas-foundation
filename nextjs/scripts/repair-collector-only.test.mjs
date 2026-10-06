import { gunzipSync } from 'node:zlib';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildRepairReceipt } from './repair-scope-gate.mjs';
import { isInsideWorkspace, planBrowserRuns, WORKSPACE_INTAKE_CAPTURE_NAMES } from './run-repair-check.mjs';

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
function published28dBytes(p){if(p==='nextjs/lib/db-rehearsal-workflow.test.ts')return published852Bytes(p);if(!Object.hasOwn(published28dBlobs,p))return readFileSync(resolve(nativeRoot,p));const b=published28dCache[p]?Buffer.from(published28dCache[p],'base64'):execFileSync('git',['show',published28d+':'+p],{stdio:'pipe'});assert.equal(gitBlob(b),published28dBlobs[p],'Original28d fixture byte identity: '+p);return b;}
const nativeModuleRoot=mkdtempSync(resolve(tmpdir(),'repair-native28d-module-'));after(()=>rmSync(nativeModuleRoot,{recursive:true,force:true}));
writeFileSync(resolve(nativeModuleRoot,'repair-collector-only.mjs'),published28dBytes('nextjs/scripts/repair-collector-only.mjs'));
let nativeKnownSource=published28dBytes('nextjs/scripts/repair-known-regression.mjs').toString();for(const name of ['run-repair-check.mjs','repair-test-report.mjs'])nativeKnownSource=nativeKnownSource.replace('./'+name,pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)),name)).href);writeFileSync(resolve(nativeModuleRoot,'repair-known-regression.mjs'),nativeKnownSource);
const native=await import(pathToFileURL(resolve(nativeModuleRoot,'repair-collector-only.mjs')).href);
const nativeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

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
function historical852Bytes(p,{cache=published852Cache,show=q=>execFileSync('git',['show',published852+':'+q],{stdio:'pipe'}),current=q=>readFileSync(resolve(nativeRoot,q))}={}){if(!Object.hasOwn(published852Blobs,p)){if(published852Sealed.includes(p))throw Error('Sealed852 fixture lacks an exact pin: '+p);return current(p);}const b=cache[p]?Buffer.from(cache[p],'base64'):show(p);assert.equal(gitBlob(b),published852Blobs[p],'Original852 fixture byte identity: '+p);return b;}
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
      const bytes = readFileSync(resolve(process.cwd(), '..', path));
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
    if(args[0]==='ls-tree'){const parent=args[2]===world.NATIVE_WORLD_PARENT,pin=sources[p];let oid=pin?pin[parent?'before':'after']:parent?world.NATIVE_WORLD_PARENT_CONFIG_BLOBS[p]??dependencies[p]:configs.includes(p)||world.CONFIG_PATHS.includes(p)||worldRepairPaths.includes(p)?gitBlob(readFileSync(resolve(nativeRoot,p))):dependencies[p];if(options.badBlob===p)oid='f'.repeat(40);return oid?`${options.unsafe===p?'120000':'100644'} blob ${oid}\t${p}`:'';}
    if(args[0]==='show'){const p=args[1].slice(41),b=readFileSync(resolve(nativeRoot,p));return options.mutated===p?Buffer.concat([b,Buffer.from('\n')]):b;}throw Error('Unexpected World Git query '+args.join(' '));
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
});
