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
  assert.ok(db.includes("if: always() && needs.collector-only-eligibility.result == 'success' && needs.collector-only-eligibility.outputs.intended == 'false' && needs.collector-only-eligibility.outputs.eligible == 'false'"));
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
  const script = db.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/)[1].replace(/^          /gm, '');
  const root = mkdtempSync(resolve(tmpdir(), 'repair-collector-protocol-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    for (const [result, intended, eligible, expected] of [['success', 'false', 'false', 0], ['success', 'true', 'true', 0], ['success', '', '', 1], ['failure', 'true', 'false', 1], ['success', 'true', 'false', 1]]) {
      const run = spawnSync(process.execPath, ['--input-type=module'], { cwd: root, input: script, env: { ...process.env, CLASSIFIER_RESULT: result, INTENDED_RESULT: intended, ELIGIBLE_RESULT: eligible, REPAIR_HEAD_SHA: head }, encoding: 'utf8' });
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
