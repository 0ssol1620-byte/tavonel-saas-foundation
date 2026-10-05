import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTOR_BASE, FULL_ANCHOR, REGRESSION_DEBT, KNOWN_REGRESSION, verifyTrackedCheckout, verifyPriorEvidence, sealHash, withRegressionDebt } from './repair-collector-only.mjs';
import { buildUnitArgs, validateSelectedPath } from './run-repair-check.mjs';
import { validateVitestReport, validatePlaywrightReport, playwrightReportContainsPath } from './repair-test-report.mjs';

export const REPAIR_PARENT = '6a32dbbe2afeaa7d0c4c446becfe8994b913fcc1';
export const REPAIR_CONFIG_PATHS = Object.freeze([
  '.github/workflows/repair-scope.yml', 'nextjs/scripts/repair-collector-only.mjs',
  'nextjs/scripts/repair-scope.mjs', 'nextjs/scripts/repair-scope.test.mjs',
  'nextjs/scripts/repair-scope-gate.mjs', 'nextjs/scripts/verify-repair-workflows.mjs',
  'nextjs/scripts/repair-collector-only.test.mjs',
  'nextjs/scripts/repair-known-regression.mjs', 'nextjs/scripts/repair-known-regression.test.mjs',
]);
export const REPAIR_SEAL_PATHS = Object.freeze([
  ...REPAIR_CONFIG_PATHS, '.github/workflows/db-rehearsal.yml',
  'nextjs/scripts/run-repair-check.mjs',
]);
export const REPAIR_PARENT_BLOBS = Object.freeze({
  ".github/workflows/repair-scope.yml": "8a55cc2118dac8afa98e9b179c5bd72a513baef0",
  ".github/workflows/db-rehearsal.yml": "7cb726d57e1f75fcfc64cd180ee0313186a3e133",
  "nextjs/scripts/repair-collector-only.mjs": "48a24437810a1857fccdca43ac8e247cd54915b8",
  "nextjs/scripts/repair-collector-only.test.mjs": "29fa082b8308a10fe6b4dc7ec55099c9658f7859",
  "nextjs/scripts/repair-scope.mjs": "9cc2d96094675468671602da60943ffa5eb5c1c4",
  "nextjs/scripts/repair-scope.test.mjs": "c978599b44621801142cd81a5f3dfbb9802f27d0",
  "nextjs/scripts/repair-scope-gate.mjs": "661349149abbb129abbf38c037e06af3e5f2d1b7",
  "nextjs/scripts/verify-repair-workflows.mjs": "88d04559c7721be6be29d0616f021c797dcadc87",
  "nextjs/scripts/run-repair-check.mjs": "a591b0b1a975cf8162bcce6ea5ce47d427ca5089"
});
export const REPAIR_SOURCE_BLOBS = Object.freeze({
  "nextjs/app/workspace/google-drive-access/layout.tsx": {
    "before": null,
    "after": "433ef68521d84241ad4d6fa90b61aee53e420cc6",
    "sha256": "28367e714c8427e4fca3defdff8977c8874a819b227e21b2bcdfbc1ed013c9e7",
    "bytes": 471
  },
  "nextjs/lib/api-error-codes.ts": {
    "before": "d0176d03d13a77fededa51934b5b424f42f464fb",
    "after": "299c94d8b47c22f6406eaf15e51dd361e2998bae",
    "sha256": "9ea5f2668561faf8d54bd32e35473c63dc7afe22cc9473628d6cb36ae0872b22",
    "bytes": 78416
  },
  "nextjs/lib/ask-route-limits.test.ts": {
    "before": "f57d929554ffaef2d67e7d307a42531e7f2771a4",
    "after": "f79415dca57894381ce2156c316eb90de9158be9",
    "sha256": "7eaa4c18a30b4d030df6c9381ab9b9b3d73b5abec65bc94333f5831ee39d7995",
    "bytes": 14344
  },
  "nextjs/lib/collection-candidate-breakdown.test.ts": {
    "before": "c6c2270b51799b442569ad112b1545e18b393887",
    "after": "a68784f283fddc2deef9725c428da57b034dcb2f",
    "sha256": "7a277e3dfb344578470a376f746d5fa5e9f68ea99efccada7a4ef1e7c879fb13",
    "bytes": 8289
  },
  "nextjs/lib/consumer-context/consumer-context-parity.test.ts": {
    "before": "7bc436c72091a98b2732d3639c16f7477bfecfd6",
    "after": "b0f3488b4fef5028c21da77e2e762b94916dc5d1",
    "sha256": "3555c6326f5e154807f5819e08f6427c447582db5c0d198e4450a7813456dd69",
    "bytes": 125342
  },
  "nextjs/lib/corpus-batching.test.ts": {
    "before": "a25029db87bb177ca7066a421d64223628ac5892",
    "after": "a22d37a69a031075d7ad2422735e27e43bda614a",
    "sha256": "6a667cdae298059777df2fd2a84ba9f678071ebc7e834a88c1fbaaf2a5beaa25",
    "bytes": 19323
  },
  "nextjs/lib/derived-data-admission.test.ts": {
    "before": "424a26ec5cbd16cbab866987e689cd77aa43c34f",
    "after": "d43d18100af12055b3eb6676109fe9c16d4630e4",
    "sha256": "417bd9bb059a8a89089e552778fbe465da955a8efa4705c027aa877304fd252f",
    "bytes": 8580
  },
  "nextjs/lib/durable-compile-orchestration.test.ts": {
    "before": "b6530bd120d945fe9f71e475f312d91bf4c8690c",
    "after": "89f9c6edd2a98bbf8882d5b77dbc1126ed620cec",
    "sha256": "fcff427a6c7a6a8de9dc20d981f17e959ec2a53938ce6009dbdd68577f368170",
    "bytes": 6377
  },
  "nextjs/lib/export-route-authorization.test.ts": {
    "before": "bd151037e485648b8109d703d09e3f2efc7397cf",
    "after": "eb4b63bf2dc47972ef770fbbe189c5e89c9b3f35",
    "sha256": "e02c65a22d6906f1139e8c20b4abf788a5e83ebdd0ab923c7fa5c917bae961a8",
    "bytes": 5872
  },
  "nextjs/lib/job-worker-route.test.ts": {
    "before": "fd90e9532eea4541db80dea6792797db8eed199f",
    "after": "7fc392ad6c5975f29f8352b0ce2a255af7ba8232",
    "sha256": "cfc9c35082a657b4d8e3db23c17084c677a9552d4d278b36ecb59ced04d03b2f",
    "bytes": 8637
  },
  "nextjs/lib/openapi-response-shape.test.ts": {
    "before": "d8132b4289f6056662e673cdaa9da022cb8f6ead",
    "after": "6fa8dcb421fc9c335d4d3495404fca64f20172dd",
    "sha256": "0f198e7c56bd185f2f746d8b00646fb781c91cc995aebf1b6cdeb765f196524d",
    "bytes": 41304
  },
  "nextjs/lib/resources-hub.test.ts": {
    "before": "fd47ad5a06ccced2b5ea908d9e9ecc9cd388ed7d",
    "after": "d259cf7e95f7b6b3ddbdf571ab1cda955cbaa50b",
    "sha256": "1cb4315b31f08838394cf1b336135c487320b05d2ec2a682dd91fe9f6a207fbd",
    "bytes": 8399
  },
  "nextjs/lib/retrieval-compile-wiring.test.ts": {
    "before": "9b1b1bf3f56968e6998f08f3e2e832ef1c57e748",
    "after": "385004449b46fbae51757c0ad7801ada05a68fb1",
    "sha256": "381dc9008cae1622209c3b10099ce30c437dc06590cbb3008fb184d37ee289fd",
    "bytes": 23048
  },
  "nextjs/lib/security/route-classification.json": {
    "before": "7a670cd915a048fccaa1f420ff09294079397334",
    "after": "d93644e343fbbf494483d36895b7d0c33c333440",
    "sha256": "a487f0ba4e253c8d7247e0706515e2759830830a3d222b1ce2232e4d1dc3d224",
    "bytes": 23965
  },
  "nextjs/lib/synthetic-customer-journey.test.ts": {
    "before": "1dcaa83f79e59cbda62a149790df307715e73e52",
    "after": "28eb550c33b4083acf60204e57883f1489bd64bb",
    "sha256": "7ad15ce48a2d424d447a31e9827f87cb8e123875607b09836c283e04f20c39f7",
    "bytes": 20322
  },
  "nextjs/lib/world-discovery-routes.test.ts": {
    "before": "48252b8854c4a64e8702eff921408bf9b6852586",
    "after": "f696029eb8c68cc8a6f63d8abbdeed1be48ef005",
    "sha256": "fe1eb5e301dbdd508a007cf2485145d358033e2d5426f7d63a6165dd43152cde",
    "bytes": 15426
  },
  "nextjs/lib/world-source-access.test.ts": {
    "before": "f67dc81f3fc32a532b33e6826730881c5c5771fe",
    "after": "c42cb657f45295a3f92de4dbb3ca6b035694dc89",
    "sha256": "ac3455c39e628585b3e449f9c9b852b218e0764badaa16a1256bf32a080603fb",
    "bytes": 3733
  }
});
export const REPAIR_UNCHANGED_BLOBS = Object.freeze({
  'nextjs/lib/copy-trust-guard.test.ts': 'fe652cc6f5e918b92f5326a7c518c677bd8ec0c5',
  'nextjs/lib/page-metadata.test.ts': 'ac2034dd8d4800d65b7c8fde6beb754b0b3e59a7',
  'nextjs/lib/route-classification.test.ts': '5e59c5a185dde1cb3fd2fe6a6d5f95a57960e3fd',
  'nextjs/lib/api-error-codes.test.ts': '3ef4e339b5e5af6dec8cc35b88a33286a993de53',
  'nextjs/lib/openapi-completeness.test.ts': 'd8607fa23dd0e2c140156af36cb323871206d195',
  'nextjs/lib/production-route-surface.test.ts': '592494746e2b5745944c22cbdbdd428c64251d9a',
  'nextjs/vitest.config.ts': '91bb009bae9930952594c8fb8164b714a43e8686',
  'nextjs/scripts/repair-test-report.mjs': '1062af93c3a69dc16d6c89a3ff5f32bf65e6a6d2',
  'nextjs/package.json': '1c4612f4032f79dc4277a3db06c1b5e78902377c',
  'nextjs/e2e/workspace-intake-triage.spec.ts': '0d24a1c185cb05f931aa61413e8eb6da604c7113',
});
export const REPAIR_UNIT_FILES = Object.freeze([
  'lib/ask-route-limits.test.ts', 'lib/collection-candidate-breakdown.test.ts',
  'lib/consumer-context/consumer-context-parity.test.ts', 'lib/copy-trust-guard.test.ts',
  'lib/corpus-batching.test.ts', 'lib/derived-data-admission.test.ts',
  'lib/durable-compile-orchestration.test.ts', 'lib/export-route-authorization.test.ts',
  'lib/job-worker-route.test.ts', 'lib/openapi-response-shape.test.ts', 'lib/page-metadata.test.ts',
  'lib/resources-hub.test.ts', 'lib/retrieval-compile-wiring.test.ts', 'lib/route-classification.test.ts',
  'lib/synthetic-customer-journey.test.ts', 'lib/world-discovery-routes.test.ts', 'lib/world-source-access.test.ts',
]);
// The catalogue descriptions and route inventory changed. These existing readers
// supplement the 17-suite regression report; their counts are recorded separately.
export const REPAIR_CATALOGUE_FILES = Object.freeze([
  'lib/api-error-codes.test.ts', 'lib/openapi-completeness.test.ts', 'lib/production-route-surface.test.ts',
]);
export const EXPECTED_REPAIR_TESTS = 433;
// repair-seal:start
export const REPAIR_SEAL = Object.freeze({
  ".github/workflows/repair-scope.yml": "27a7c4732b77d27f931e1c033ee5db9317b60c2c5d460b4dcd14d4f0d59e75c1",
  "nextjs/scripts/repair-collector-only.mjs": "2e807c8834c19dadb48a4efb29d76babcf3c9d369690d1a25303e59b4e492b39",
  "nextjs/scripts/repair-scope.mjs": "620270844f9235c0907689a06b844cbb0a9bdcfcfbf0c0bc19e8bbca04d5776a",
  "nextjs/scripts/repair-scope.test.mjs": "ab5d1c9e8461e0afc3e7928be2b1f225eeabc58612ed3b100180b87566cac9d7",
  "nextjs/scripts/repair-scope-gate.mjs": "d4c8e8f32eaa4ee5194a9efffe56e6b9017a19f7df2a1d30df975fc02c568a0d",
  "nextjs/scripts/verify-repair-workflows.mjs": "8d97852224a5697ce3d2142a833779c75892fc1baf2309095493e03e9f00cff6",
  "nextjs/scripts/repair-collector-only.test.mjs": "2f469e28ca986cdefd3cd297d8811d5799bc51330a652c34ea96bc0a13a26ac0",
  "nextjs/scripts/repair-known-regression.mjs": "bb138736fb67050e15106a69b97527695ec56201ec6f762ecde1faace13935f9",
  "nextjs/scripts/repair-known-regression.test.mjs": "5738fd3f7b5f60135c551bcd8b39fbb728fb514a4bc718f0b3bdb3e3b70aac3f",
  ".github/workflows/db-rehearsal.yml": "65952869fb893636e93e13ff60e975da12cfb8e9a07d14585bcf0a5180aed9db",
  "nextjs/scripts/run-repair-check.mjs": "d60f9881f94ba0792955ca7238e6540e087c5c12ef222d1af9e9319d5d468c3f"
});
// repair-seal:end
export function repairSealHash(path, bytes) {
  if (path !== 'nextjs/scripts/repair-known-regression.mjs') return sealHash(path, bytes);
  const source = bytes.toString('utf8');
  const matches = [...source.matchAll(/^\/\/ repair-seal:start\n[\s\S]*?^\/\/ repair-seal:end$/gm)];
  if (matches.length !== 1 || [...source.matchAll(/^\/\/ repair-seal:start$/gm)].length !== 1 || [...source.matchAll(/^\/\/ repair-seal:end$/gm)].length !== 1) throw Error('Expected one exact regression seal declaration.');
  const declaration = /^\/\/ repair-seal:start\nexport const REPAIR_SEAL = Object\.freeze\((\{[\s\S]*\})\);\n\/\/ repair-seal:end$/.exec(matches[0][0]);
  if (!declaration) throw Error('Nonliteral regression seal declaration.');
  const values = JSON.parse(declaration[1]);
  if (REPAIR_SEAL_PATHS.some(key => !/^[a-f0-9]{64}$/.test(values[key] ?? ''))) throw Error('Invalid regression seal digest.');
  const block = bindings => '// repair-seal:start\nexport const REPAIR_SEAL = Object.freeze(' + JSON.stringify(bindings, null, 2) + ');\n// repair-seal:end';
  const ordered = Object.fromEntries(REPAIR_SEAL_PATHS.map(key => [key, values[key]]));
  if (block(ordered) !== matches[0][0]) throw Error('Regression seal keys or declaration changed.');
  const normalized = Object.fromEntries(REPAIR_SEAL_PATHS.map(key => [key, '0'.repeat(64)]));
  return createHash('sha256').update(source.replace(matches[0][0], block(normalized))).digest('hex');
}

export function classifyKnownRepairIntent({ headSha, exec = execFileSync }) {
  try {
    const git = args => exec('git', args, { encoding: 'utf8' }).trim();
    const repoRoot = git(['rev-parse', '--show-toplevel']);
    if (!/^[a-f0-9]{40}$/.test(headSha ?? '') || git(['rev-parse', 'HEAD']) !== headSha) throw Error('Unreadable or mismatched exact repair checkout.');
    const parents = git(['rev-list', '--parents', '-n', '1', headSha]).split(' ');
    if (parents[0] !== headSha || parents.some(sha => !/^[a-f0-9]{40}$/.test(sha))) throw Error('Unreadable repair parent metadata.');
    if (parents.length !== 2 || parents[1] !== REPAIR_PARENT) return { classification: 'normal', intended: false, reason: 'Outside the exact scoped-qualified 6a32 parent.' };
    const paths = git(['-C', repoRoot, 'diff', '--name-only', '--no-relative', '--no-renames', '-z', `${REPAIR_PARENT}..${headSha}`]).split('\0').filter(Boolean).sort();
    const allowed = [...Object.keys(REPAIR_SOURCE_BLOBS), ...REPAIR_CONFIG_PATHS];
    const attempted = paths.some(path => /^nextjs\/scripts\/repair-known-regression(?:\.test)?\.mjs$/.test(path));
    if (!attempted || paths.some(path => !allowed.includes(path))) return { classification: 'normal', intended: false, reason: 'Unrelated change uses normal full-anchor selection.' };
    return { classification: 'intended', intended: true, parent: REPAIR_PARENT, headSha, repoRoot, paths };
  } catch (error) { return { classification: 'unavailable', intended: null, reason: error.message }; }
}

export function verifyKnownRepairSource({ headSha, exec = execFileSync }) {
  const intent = classifyKnownRepairIntent({ headSha, exec });
  if (!intent.intended) return { eligible: false, reason: intent.reason };
  try {
    const git = (args, encoding = 'utf8') => exec('git', ['-C', intent.repoRoot, ...args], { encoding });
    const text = args => git(args).trim();
    const tree = (revision, path) => {
      const entry = text(['ls-tree', '--full-tree', revision, '--', path]);
      if (!entry) return null;
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match || match[2] !== path) throw Error('Not an exact regular repair source: ' + path);
      return match[1];
    };
    const expectedPaths = [...Object.keys(REPAIR_SOURCE_BLOBS), ...REPAIR_CONFIG_PATHS].sort();
    if (JSON.stringify(intent.paths) !== JSON.stringify(expectedPaths)) throw Error('Missing or extra source/configuration paths for the 17-file repair.');
    text(['merge-base', '--is-ancestor', FULL_ANCHOR, COLLECTOR_BASE]);
    text(['merge-base', '--is-ancestor', COLLECTOR_BASE, REPAIR_PARENT]);
    text(['merge-base', '--is-ancestor', REPAIR_PARENT, headSha]);
    verifyTrackedCheckout({ repoRoot: intent.repoRoot, headSha, exec });
    for (const [path, binding] of Object.entries(REPAIR_SOURCE_BLOBS)) {
      if (tree(REPAIR_PARENT, path) !== binding.before || tree(headSha, path) !== binding.after) throw Error('Repair preimage or final source blob mismatch: ' + path);
    }
    for (const [path, expected] of Object.entries(REPAIR_PARENT_BLOBS)) {
      if (tree(REPAIR_PARENT, path) !== expected) throw Error('Scoped-qualified parent configuration mismatch: ' + path);
      if (!REPAIR_CONFIG_PATHS.includes(path) && tree(headSha, path) !== expected) throw Error('Unchanged configured runner or DB source modified: ' + path);
    }
    for (const path of REPAIR_CONFIG_PATHS.filter(path => path.includes('repair-known-regression'))) if (tree(REPAIR_PARENT, path) !== null) throw Error('Unexpected profile preimage: ' + path);
    for (const [path, expected] of Object.entries(REPAIR_UNCHANGED_BLOBS)) if (tree(REPAIR_PARENT, path) !== expected || tree(headSha, path) !== expected) throw Error('Unchanged selected test, discovery, intake or report binding mismatch: ' + path);
    if (JSON.stringify(Object.keys(REPAIR_SEAL)) !== JSON.stringify(REPAIR_SEAL_PATHS)) throw Error('Repair seal ownership changed.');
    for (const [path, expected] of Object.entries(REPAIR_SEAL)) {
      if (!tree(headSha, path) || repairSealHash(path, git(['show', `${headSha}:${path}`], 'buffer')) !== expected) throw Error('Repair infrastructure seal mismatch: ' + path);
    }
    for (const [path, binding] of Object.entries(REPAIR_SOURCE_BLOBS)) {
      const bytes = git(['show', `${headSha}:${path}`], 'buffer');
      if (bytes.length !== binding.bytes || createHash('sha256').update(bytes).digest('hex') !== binding.sha256) throw Error('Repair final byte identity mismatch: ' + path);
    }
    return { eligible: true, headSha, parent: REPAIR_PARENT, base: COLLECTOR_BASE, fullAnchor: FULL_ANCHOR, exactChangedPaths: expectedPaths,
      finalSourceBlobs: Object.fromEntries(Object.entries(REPAIR_SOURCE_BLOBS).map(([path, value]) => [path, value.after])) };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

export const PARENT_ARTIFACTS = Object.freeze([
  { id: 11356883677, name: `repair-scope-141-${REPAIR_PARENT}`, digest: 'sha256:3006566f388165cde748654c97a2f38878d6201577a7994edc777b600f0b4589' },
  { id: 11357363321, name: `synthetic-mounted-intake-141-${REPAIR_PARENT}`, digest: 'sha256:7e5b18f858e7529eb0e0986e46834bcaceeb97a4dccb38109707af38cf584504' },
]);
export function verifyKnownRepairEvidence({ prior, parentRun, parentJob, dbRun, dbJobs, artifacts }) {
  try {
    const old = verifyPriorEvidence(prior);
    if (!old.eligible) throw Error(old.reason);
    const run = (value, id, path) => {
      if (value?.id !== id || value.head_sha !== REPAIR_PARENT || value.path !== path || value.event !== 'pull_request' || value.run_attempt !== 1 || value.status !== 'completed' || value.conclusion !== 'success') throw Error('Unqualified 6a32 parent run identity or result.');
    };
    run(parentRun, 37338211115, '.github/workflows/repair-scope.yml');
    run(dbRun, 37338211486, '.github/workflows/db-rehearsal.yml');
    const job = (value, id, runId, name, conclusion) => {
      if (value?.id !== id || value.run_id !== runId || value.head_sha !== REPAIR_PARENT || value.name !== name || value.status !== 'completed' || value.conclusion !== conclusion) throw Error('Unqualified 6a32 parent job identity or result.');
    };
    job(parentJob, 111858281578, parentRun.id, 'Repair scope validation', 'success');
    const step = (value, name, conclusion) => {
      const matches = value.steps?.filter(item => item.name === name) ?? [];
      if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== conclusion) throw Error('Unqualified 6a32 step: ' + name);
    };
    for (const name of ['Plan changes since the authenticated full-pass anchor', 'Verify workflow and selector contracts', 'Run selector regression tests', 'Run browser report and screenshot regressions', 'Scan repository secrets', 'Run TypeScript and lint checks', 'Build the isolated live-commerce test bundle after scoped checks', 'Run selected browser checks against one production server', 'Require the four synthetic mounted intake preflight capture pairs', 'Upload only the four named synthetic mounted intake preflight capture pairs', 'Fail closed on missing or failed scoped checks', 'Publish exact-head scope receipt']) step(parentJob, name, 'success');
    for (const name of ['Run the normal CDR worker unit suite and types for reviewed OCR safety', 'Run Foundation focused unit checks', 'Run hermetic full Vitest for shared or unknown changes', 'Run script contract suite for shared or unknown changes', 'Require screenshots for the exact paired public UI candidate']) step(parentJob, name, 'skipped');
    if (parentJob.steps.some(item => !['success', 'skipped'].includes(item.conclusion))) throw Error('Parent Repair contains an unrelated failed step.');
    const db = dbJobs?.jobs ?? [];
    const one = id => { const matches = db.filter(item => item.id === id); if (matches.length !== 1) throw Error('Missing or duplicate exact parent DB job.'); return matches[0]; };
    const classifier = one(111858284546);
    job(classifier, 111858284546, dbRun.id, 'Verify exact collector-only DB evidence reuse', 'success');
    for (const name of ['Independently verify unchanged DB source and prior evidence', 'Require an explicit collector classifier decision']) step(classifier, name, 'success');
    job(one(111858411905), 111858411905, dbRun.id, 'db-rehearsal', 'skipped');
    job(one(111858412530), 111858412530, dbRun.id, 'Local Chromium signed-storage transport', 'skipped');
    for (const expected of PARENT_ARTIFACTS) {
      const matches = artifacts?.filter(item => item.id === expected.id) ?? [];
      if (matches.length !== 1) throw Error('Missing or duplicate immutable parent artifact.');
      const value = matches[0];
      if (value.name !== expected.name || value.digest !== expected.digest || value.expired !== false || value.workflow_run?.id !== parentRun.id || value.workflow_run?.head_sha !== REPAIR_PARENT) throw Error('Parent receipt/capture artifact identity or digest mismatch.');
    }
    return { eligible: true, parentHead: REPAIR_PARENT, parentRunId: parentRun.id, parentJobId: parentJob.id,
      checks: { ...old.checks, intakeAuditAndCaptures: { sourceHead: REPAIR_PARENT, runId: parentRun.id, jobId: parentJob.id, scope: '5 intake audit tests, 0 skips and four required synthetic mounted pairs; root-reviewed logs', artifacts: PARENT_ARTIFACTS } },
      databaseLineage: { sourceHead: COLLECTOR_BASE, priorRunId: 37320682223, priorJobId: 111798647331, parentRunId: dbRun.id, parentClassifierJobId: classifier.id, parentDatabaseExecution: 'skipped; inherited f082 evidence', parentTransportExecution: 'skipped; inherited f082 evidence' },
      priorOverallRepair: 'f082 failed; only successful unaffected steps inherited', fullQualification: 'pending', knownRegressionObservation: KNOWN_REGRESSION };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

export function verifyKnownRepairEligibility({ headSha, exec = execFileSync, api = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/0ssol1620-byte/tavonel-saas-foundation/${endpoint}`], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 })) }) {
  const source = verifyKnownRepairSource({ headSha, exec });
  if (!source.eligible) return source;
  try {
    const prior = { repairRun: api('actions/runs/37320682454'), repairJob: api('actions/jobs/111798647893'), databaseRun: api('actions/runs/37320682223'), databaseJob: api('actions/jobs/111798647331'), transportJob: api('actions/jobs/111798647200') };
    const dbJobs = api('actions/runs/37338211486/jobs');
    const classifier = api('actions/jobs/111858284546');
    dbJobs.jobs = dbJobs.jobs?.map(job => job.id === classifier.id ? classifier : job);
    const evidence = verifyKnownRepairEvidence({ prior, parentRun: api('actions/runs/37338211115'), parentJob: api('actions/jobs/111858281578'), dbRun: api('actions/runs/37338211486'), dbJobs, artifacts: PARENT_ARTIFACTS.map(item => api(`actions/artifacts/${item.id}`)) });
    return evidence.eligible ? { eligible: true, source, evidence } : evidence;
  } catch (error) { return { eligible: false, reason: 'Targeted repair evidence unavailable: ' + error.message }; }
}

export function knownRepairPlan(normal, proof) {
  if (!proof?.eligible || proof.source.headSha !== normal.headSha || normal.repairAnchorSha !== FULL_ANCHOR) throw Error('Targeted plan requires exact source, parent and authenticated evidence.');
  return { ...withRegressionDebt(normal), source: 'exact 17-file repair over scoped-qualified 6a32; unaffected checks inherited explicitly',
    normalSelection: { groups: normal.groups, unitFiles: normal.unitFiles, browserFiles: normal.browserFiles, unknownPaths: normal.unknownPaths },
    groups: ['selector-config', 'workflow-static', 'known-unit-regression-repair'], unitFiles: [...REPAIR_UNIT_FILES], browserFiles: [], unknownPaths: [],
    catalogueFiles: [...REPAIR_CATALOGUE_FILES], runApiCatalogueChecks: true, expectedSelectedTestCount: EXPECTED_REPAIR_TESTS,
    runFullHermeticVitest: false, runScriptContracts: false, runCdrWorkerChecks: false, runDetailIntegrity: false,
    runWorkflowStaticGate: true, requireWorkspaceIntakeCapture: false, requirePublicUiScreenshots: false, runDatabaseRehearsal: false,
    deferredGroups: [], databaseRehearsalStatus: 'inherited-f082-via-qualified-6a32; not executed at current head', knownRegressionRepair: proof,
    inheritedChecks: Object.fromEntries(Object.entries(proof.evidence.checks).filter(([name]) => name !== 'units').map(([name, evidence]) => [name, { ...evidence, sourceHead: evidence.sourceHead ?? COLLECTOR_BASE, status: 'inherited-source-evidence; not executed at current head' }])),
    unaffectedUnitObservation: { ...KNOWN_REGRESSION, scope: '6407 passing tests in a cancelled e402 run; not executed at current head and not an overall pass' },
    fullQualification: 'pending', qualificationReasons: [...normal.qualificationReasons, 'Only the 71-failure debt may clear after all 433 selected tests and required catalogue checks pass; full release/native integration debt remains'],
  };
}

export function knownRepairLineageFailures(plan, verified) {
  if (!verified?.eligible) return ['targeted repair eligibility: ' + (verified?.reason ?? 'missing')];
  try {
    const expected = knownRepairPlan({ ...plan, qualificationReasons: [] }, verified);
    const fields = ['knownRegressionRepair', 'groups', 'unitFiles', 'browserFiles', 'catalogueFiles', 'unknownPaths', 'inheritedChecks', 'unaffectedUnitObservation', 'expectedSelectedTestCount', 'runFullHermeticVitest', 'runScriptContracts', 'runCdrWorkerChecks', 'runDetailIntegrity', 'runWorkflowStaticGate', 'requireWorkspaceIntakeCapture', 'requirePublicUiScreenshots', 'runDatabaseRehearsal', 'runApiCatalogueChecks', 'deferredGroups', 'databaseRehearsalStatus', 'fullQualification'];
    const failures = fields.filter(field => JSON.stringify(plan[field]) !== JSON.stringify(expected[field])).map(field => 'Targeted repair plan changed: ' + field);
    for (const debt of ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair']) if (!plan.pendingFullDebt?.includes(debt)) failures.push('Targeted repair release debt removed: ' + debt);
    for (const debt of ['database-contract', REGRESSION_DEBT]) if (!plan.pendingQualificationDebt?.includes(debt)) failures.push('Targeted repair debt prematurely removed: ' + debt);
    if (JSON.stringify(plan.knownRegressionObservations) !== JSON.stringify([KNOWN_REGRESSION])) failures.push('Cancelled e402 failure observation changed.');
    return failures;
  } catch (error) { return ['Targeted repair lineage invalid: ' + error.message]; }
}

export function validateKnownRepairReport(report, files, root, expectedCount) {
  if (!Array.isArray(report?.testResults) || report.testResults.length !== files.length) throw Error('Targeted report has extra, missing or duplicate files.');
  const expected = files.map(file => resolve(root, file)).sort();
  const actual = report.testResults.map(result => typeof result?.name === 'string' ? resolve(root, result.name) : '').sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Targeted report file identity escaped or differs from the exact selected files.');
  const summary = validateVitestReport(report, files);
  for (const [file, count] of [['lib/copy-trust-guard.test.ts', 24], ['lib/resources-hub.test.ts', 16]]) if (files.includes(file)) {
    const result = report.testResults.find(value => resolve(root, value.name) === resolve(root, file));
    if (result.assertionResults.length !== count || result.assertionResults.some(value => value.status !== 'passed')) throw Error(`All ${count} tests in ${file} must execute and pass.`);
  }
  if (summary.skipped !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0 || report.numPassedTests !== summary.passed || report.numTotalTests !== summary.passed) throw Error('Targeted report skips or total counts are inconsistent.');
  if (expectedCount !== undefined && summary.passed !== expectedCount) throw Error(`Expected ${expectedCount} executed targeted tests, got ${summary.passed}.`);
  return summary;
}

export function readKnownRepairExecution(root = process.cwd()) {
  const read = name => JSON.parse(readFileSync(resolve(root, 'node_modules/.cache/repair-scope-reports', name), 'utf8'));
  return { units: validateKnownRepairReport(read('vitest.json'), REPAIR_UNIT_FILES, root, EXPECTED_REPAIR_TESTS),
    catalogue: validateKnownRepairReport(read('known-repair-catalogue.json'), REPAIR_CATALOGUE_FILES, root) };
}

export function resolveKnownRepairDebt(receipt, plan, proof, execution) {
  if (receipt.gate !== 'passed-scoped-only' || receipt.gateFailures?.length || knownRepairLineageFailures(plan, proof).length) return receipt;
  if (execution?.units?.files !== REPAIR_UNIT_FILES.length || execution.units.passed !== EXPECTED_REPAIR_TESTS || execution.units.skipped !== 0 || execution.units.failed !== 0 || execution.catalogue?.files !== REPAIR_CATALOGUE_FILES.length || execution.catalogue.passed < REPAIR_CATALOGUE_FILES.length || execution.catalogue.skipped !== 0 || execution.catalogue.failed !== 0) throw Error('Cannot clear failure debt without all selected files and catalogue checks executing successfully.');
  const resolution = { debt: REGRESSION_DEBT, scope: '71 failures from the cancelled e402 report; repaired 17-suite selection only', headSha: plan.headSha, passed: execution.units.passed, files: execution.units.files, catalogue: execution.catalogue, fullQualification: 'pending' };
  return { ...receipt, pendingDebt: receipt.pendingDebt.filter(debt => debt !== REGRESSION_DEBT), pendingQualificationDebt: receipt.pendingQualificationDebt.filter(debt => debt !== REGRESSION_DEBT),
    resolvedQualificationDebt: [...(receipt.resolvedQualificationDebt ?? []), resolution], knownRegressionResolution: resolution,
    executedChecks: { ...receipt.executedChecks, units: { status: 'success', ...execution.units }, apiCatalogue: { status: 'success', ...execution.catalogue } }, fullQualification: 'pending' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] !== 'catalogue') throw Error('Usage: repair-known-regression.mjs catalogue');
  const plan = JSON.parse(readFileSync('repair-plan.json', 'utf8'));
  if (!plan.knownRegressionRepair?.eligible || JSON.stringify(plan.catalogueFiles) !== JSON.stringify(REPAIR_CATALOGUE_FILES)) throw Error('Unqualified catalogue selection.');
  const files = REPAIR_CATALOGUE_FILES.map(file => validateSelectedPath(file, 'unit'));
  const reportDir = resolve('node_modules/.cache/repair-scope-reports'); mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, 'known-repair-catalogue.json'); rmSync(reportPath, { force: true });
  const result = spawnSync('pnpm', buildUnitArgs(files, reportPath), { shell: false, stdio: 'inherit' });
  const summary = validateKnownRepairReport(JSON.parse(readFileSync(reportPath, 'utf8')), files, process.cwd());
  console.log('Separate API catalogue report: ' + JSON.stringify(summary));
  if (result.status !== 0 || result.error) throw Error('API catalogue checks failed.');
}

// Presentation/copy admission extends this verifier; the configured runners,
// Vitest discovery, capture collector and DB workflow are unchanged.
export const INTAKE_PARENT = '8956734a6675ae79d5081e77f551e0cb49cf8a39';
export const INTAKE_CONFIG_PATHS = Object.freeze([
  ".github/workflows/repair-scope.yml",
  "nextjs/scripts/repair-known-regression.mjs",
  "nextjs/scripts/repair-known-regression.test.mjs",
  "nextjs/scripts/repair-collector-only.mjs",
  "nextjs/scripts/repair-scope-gate.mjs",
  "nextjs/scripts/verify-repair-workflows.mjs",
  "nextjs/scripts/repair-scope.test.mjs",
  ".github/workflows/db-rehearsal.yml"
]);
export const INTAKE_SOURCE_BLOBS = Object.freeze({
  "nextjs/app/workspace/page.tsx": {
    "before": "e9df90d1ef58006e4268d703917fed84be1bd5e8",
    "after": "ef5ef3cf8a8b1ccabd33d60de84770cf7dfdb8da",
    "sha256": "0db9b9cfd0570817c5e3ee19f4dfbe0606c4c7ca39c11242a7dfd9cb905e6d66",
    "bytes": 199220
  },
  "nextjs/app/workspace-no1.css": {
    "before": "6ed67aece36305aeab741d036306016e627aacb0",
    "after": "af7a97aaa3dab8fc748cf7fdf9f3511c4e3926a0",
    "sha256": "6c0bf9a7ac312da15a585c6cbcff347bbf734f6f0a62afd0110c77bde9140528",
    "bytes": 53013
  },
  "nextjs/components/intake-triage-review.test.tsx": {
    "before": "be27ee739c48ea0286f4d5b71f0f414fa3b336c6",
    "after": "d1f13f33cd4457ce7b8c4211e1e75892a8f089eb",
    "sha256": "9e6c8bb8b5a09d92122382a934a1b7cfe14753e81e4672e352ed5fd31efc4707",
    "bytes": 3599
  },
  "nextjs/components/intake-triage-review.tsx": {
    "before": "a77d49c5cb58563de34523888b5523245b022ec5",
    "after": "2144d39f94178ed9d82b33f5b9dafbbf14989aa9",
    "sha256": "f64751121967323e9147efa22271bab32f4f6fa4433df2793badcfe6521f0832",
    "bytes": 21356
  },
  "nextjs/e2e/workspace-intake-triage.spec.ts": {
    "before": "0d24a1c185cb05f931aa61413e8eb6da604c7113",
    "after": "d5f6e38f6c60f5b476014b90678680b5df0b6204",
    "sha256": "5a8c1eb21cf102aea044d5f4e36897b004fa9eba535a253cc5d7e718206b406f",
    "bytes": 42361
  },
  "nextjs/lib/intake-triage-client.test.ts": {
    "before": "436177dc3c61d6b8e9019a859990daa1eb88da60",
    "after": "82f7fbf663dd7f5a2e8bca68340ec890803b2e1a",
    "sha256": "5a4307df5a1d016a5b869909100eb7294d05dc94afbb454547595142ab303ac2",
    "bytes": 11643
  },
  "nextjs/lib/intake-triage-copy.ts": {
    "before": null,
    "after": "66f5488c1e10644b8e7121fedb6136f68cfa2eb3",
    "sha256": "e78f9720bf3180730d4ddaddcb358509945d91d49c1b52be6726688746f081f4",
    "bytes": 1554
  },
  "nextjs/lib/preflight-report.test.ts": {
    "before": "181b6c444f54d2f9b07e3db8036c67f11c15458d",
    "after": "52e8e1633b80fc43a986925836d25121b28779d2",
    "sha256": "4d72e8ed0c4a20286abc4fba68968f38e744865306002d619fa443b895c00d94",
    "bytes": 13948
  },
  "nextjs/lib/preflight-report.ts": {
    "before": "22897323cbdb38816eb2d3dfdb6fbf0e08e28fef",
    "after": "bcbc6b3b1ed4005541de9425941055ef78d29572",
    "sha256": "d5e6725f5d6f17c3ad226a467fdaef795c12e6a25ae603ef3c39f8a19aebbe93",
    "bytes": 11464
  }
});
export const INTAKE_PARENT_BLOBS = Object.freeze({
  ".github/workflows/repair-scope.yml": "f44ad3beff074240510e0b4e2c138e718161d7ac",
  "nextjs/scripts/repair-known-regression.mjs": "5be6514f383a1da1aac017cafd1dc62d40b4bb17",
  "nextjs/scripts/repair-known-regression.test.mjs": "6f9250136b809a1039eb4a9829ac46c09e4a65df",
  "nextjs/scripts/repair-collector-only.mjs": "c31804999fde4e9ba6c86bac01034d21420f79bb",
  "nextjs/scripts/repair-scope-gate.mjs": "0c6ef6721a3acd0d568ddc2c462f5666f20babf7",
  "nextjs/scripts/verify-repair-workflows.mjs": "99f207d36823b127ad4204d9b1e12094156e8c9e",
  ".github/workflows/db-rehearsal.yml": "7cb726d57e1f75fcfc64cd180ee0313186a3e133",
  "nextjs/scripts/run-repair-check.mjs": "a591b0b1a975cf8162bcce6ea5ce47d427ca5089",
  "nextjs/scripts/repair-test-report.mjs": "1062af93c3a69dc16d6c89a3ff5f32bf65e6a6d2",
  "nextjs/scripts/repair-scope.mjs": "07b181b59bab2f636dafe9f1227b18e8113c452d",
  "nextjs/scripts/repair-scope.test.mjs": "092bc3df3f58b08c81064614ea95b87f94788a4d",
  "nextjs/scripts/repair-collector-only.test.mjs": "0d663692d93fa562c15260db4b9941e1fda7deb4",
  "nextjs/vitest.config.ts": "91bb009bae9930952594c8fb8164b714a43e8686",
  "nextjs/vitest.repair-scope.config.ts": "6ae26121a08e403d45a05387901ce59c41cc0f12",
  "nextjs/vitest.repair-scope.async.config.ts": "bc2b6ea23ab4a011c985490f36904ff827ef8c71",
  "nextjs/playwright.config.ts": "714b979d42627a61aa32610880bd7dcd248e1a0a",
  "nextjs/package.json": "1c4612f4032f79dc4277a3db06c1b5e78902377c",
  "nextjs/pnpm-lock.yaml": "58ead4e268de3717f1438eec9d1d59af9b119e1d",
  "nextjs/e2e/workspace-intake-layout.spec.ts": "a8fe356d750250e1dffca97fab39126a678ba029",
  "nextjs/components/intake-triage-review.interaction.test.ts": "4dd927224df839b7c9ef1624e0cbd47ad8bd3b04",
  "nextjs/lib/intake-triage-paid-flow.test.ts": "0b21721aa3d86fb3aa943833b7a83fd27f235cb6",
  "nextjs/lib/intake-triage-layout.test.ts": "c533f7e61aaf4fb0aed7524fd5960581bdb7e8c4",
  "nextjs/lib/workspace-mobile-layout.test.ts": "74d44e4d05140a750b4e4f9e2a3fb501ad935c7a",
  "nextjs/lib/workspace-intake.test.ts": "ffa9595ea0f7c3c06e5c0bc8f431080940d22caf",
  "nextjs/lib/workspace-compile-floor-and-ceiling.test.ts": "18af61c718dd57cf539a06b2f02af6c35fd6a41c",
  "nextjs/lib/copy-trust-guard.test.ts": "fe652cc6f5e918b92f5326a7c518c677bd8ec0c5"
});
export const INTAKE_UNIT_FILES = Object.freeze([
  'components/intake-triage-review.test.tsx', 'components/intake-triage-review.interaction.test.ts',
  'lib/intake-triage-client.test.ts', 'lib/intake-triage-paid-flow.test.ts',
  'lib/preflight-report.test.ts', 'lib/intake-triage-layout.test.ts',
  'lib/workspace-mobile-layout.test.ts', 'lib/workspace-intake.test.ts',
  'lib/workspace-compile-floor-and-ceiling.test.ts', 'lib/copy-trust-guard.test.ts',
]);
export const INTAKE_BROWSER_CASES = Object.freeze({
  'e2e/workspace-intake-triage.spec.ts': { project: 'audit', titles: [
    'disabled triage keeps review-only separate from upload or processing',
    'legacy fallback requires explicit maximum approval and ignores repeated activation before unmount',
    'exclude-all 409 leaves choices editable so the customer can retry',
    'successful PUT followed by seal failure keeps upload uncertainty visible across the workspace',
    'successful PUT followed by receipt failure keeps upload uncertainty visible across the workspace',
    'processing approval preparation preserves the earlier upload status across the workspace',
    'changing the selected source while staging is delayed ignores the old response',
    'Clear unmounts triage and ignores a delayed stage response',
  ] },
  'e2e/workspace-intake-layout.spec.ts': { project: '1440', titles: [
    'nested triage keeps the inventory edge, natural Clear height and usable source selectors',
  ] },
});
export const INTAKE_PARENT_ARTIFACT = Object.freeze({ id: 11361791741,
  name: `repair-scope-141-${INTAKE_PARENT}`,
  digest: 'sha256:87ce07d11e5bfca7b2629e81a3737bf722999dd2f7709286bce8b1926d6c0281',
});

export const INTAKE_GEOMETRY_PARENT = '8682045bce5ad550abe2ad7d5376130b95651972';
export const INTAKE_GEOMETRY_CONFIG_PATHS = Object.freeze([
  "nextjs/scripts/repair-known-regression.mjs",
  "nextjs/scripts/repair-known-regression.test.mjs",
  "nextjs/scripts/repair-scope-gate.mjs",
  "nextjs/scripts/repair-scope.test.mjs",
  "nextjs/scripts/repair-collector-only.mjs",
  ".github/workflows/db-rehearsal.yml"
]);
export const INTAKE_GEOMETRY_SOURCE_BLOBS = Object.freeze({
  "nextjs/e2e/workspace-intake-triage.spec.ts": {
    "before": "d5f6e38f6c60f5b476014b90678680b5df0b6204",
    "after": "72f68ba25ea4c01571d1752584638ade859115a7",
    "bytes": 44959,
    "sha256": "bd7305ca121be6a55c2e22f00da43f1264d877b3fc0d1baf63cae5181ca5e2dd"
  },
  "nextjs/lib/intake-triage-layout.test.ts": {
    "before": "c533f7e61aaf4fb0aed7524fd5960581bdb7e8c4",
    "after": "4baa34be94b4773e1acfbbb62ec330ea76ce2a9c",
    "bytes": 9252,
    "sha256": "fcc2bdcf216dd3b15d574d9e16e22ec5016ffad23202f59d10fec8c709eb8d6f"
  }
});
export const INTAKE_GEOMETRY_PARENT_BLOBS = Object.freeze({
  ".github/workflows/repair-scope.yml": "91d0b4dc9b05aa8f7228e1d74a64ecf9f6029f02",
  "nextjs/scripts/repair-collector-only.mjs": "7c5b822901e7255a6e3ed27de2390960ab9435bd",
  "nextjs/scripts/repair-scope.mjs": "07b181b59bab2f636dafe9f1227b18e8113c452d",
  "nextjs/scripts/repair-scope.test.mjs": "edb9b740ae9fc23044e90bdad50fde895e47c458",
  "nextjs/scripts/repair-scope-gate.mjs": "60613eb4e620200d18a39265b9c46f23bd72a409",
  "nextjs/scripts/verify-repair-workflows.mjs": "3b80ade16a2e70fe471d141090966baf883907e7",
  "nextjs/scripts/repair-collector-only.test.mjs": "0d663692d93fa562c15260db4b9941e1fda7deb4",
  "nextjs/scripts/repair-known-regression.mjs": "038ee2d7a1a476f08380429b2d685744b35ac661",
  "nextjs/scripts/repair-known-regression.test.mjs": "d5747304b02a6c47f336f32353f66be9ec29c58e",
  ".github/workflows/db-rehearsal.yml": "d036006ceae3df59eccbeea2a02019d1994f87e3",
  "nextjs/scripts/run-repair-check.mjs": "a591b0b1a975cf8162bcce6ea5ce47d427ca5089",
  "nextjs/vitest.config.ts": "91bb009bae9930952594c8fb8164b714a43e8686",
  "nextjs/vitest.repair-scope.config.ts": "6ae26121a08e403d45a05387901ce59c41cc0f12",
  "nextjs/vitest.repair-scope.async.config.ts": "bc2b6ea23ab4a011c985490f36904ff827ef8c71",
  "nextjs/playwright.config.ts": "714b979d42627a61aa32610880bd7dcd248e1a0a",
  "nextjs/scripts/repair-test-report.mjs": "1062af93c3a69dc16d6c89a3ff5f32bf65e6a6d2",
  "nextjs/package.json": "1c4612f4032f79dc4277a3db06c1b5e78902377c",
  "nextjs/pnpm-lock.yaml": "58ead4e268de3717f1438eec9d1d59af9b119e1d",
  "nextjs/e2e/workspace-intake-layout.spec.ts": "a8fe356d750250e1dffca97fab39126a678ba029",
  "nextjs/app/workspace/page.tsx": "ef5ef3cf8a8b1ccabd33d60de84770cf7dfdb8da",
  "nextjs/app/workspace-no1.css": "af7a97aaa3dab8fc748cf7fdf9f3511c4e3926a0",
  "nextjs/components/intake-triage-review.test.tsx": "d1f13f33cd4457ce7b8c4211e1e75892a8f089eb",
  "nextjs/components/intake-triage-review.tsx": "2144d39f94178ed9d82b33f5b9dafbbf14989aa9",
  "nextjs/lib/intake-triage-client.test.ts": "82f7fbf663dd7f5a2e8bca68340ec890803b2e1a",
  "nextjs/lib/intake-triage-copy.ts": "66f5488c1e10644b8e7121fedb6136f68cfa2eb3",
  "nextjs/lib/preflight-report.test.ts": "52e8e1633b80fc43a986925836d25121b28779d2",
  "nextjs/lib/preflight-report.ts": "bcbc6b3b1ed4005541de9425941055ef78d29572",
  "nextjs/components/intake-triage-review.interaction.test.ts": "4dd927224df839b7c9ef1624e0cbd47ad8bd3b04",
  "nextjs/lib/intake-triage-paid-flow.test.ts": "0b21721aa3d86fb3aa943833b7a83fd27f235cb6",
  "nextjs/lib/workspace-mobile-layout.test.ts": "74d44e4d05140a750b4e4f9e2a3fb501ad935c7a",
  "nextjs/lib/workspace-intake.test.ts": "ffa9595ea0f7c3c06e5c0bc8f431080940d22caf",
  "nextjs/lib/workspace-compile-floor-and-ceiling.test.ts": "18af61c718dd57cf539a06b2f02af6c35fd6a41c",
  "nextjs/lib/copy-trust-guard.test.ts": "fe652cc6f5e918b92f5326a7c518c677bd8ec0c5"
});
export const INTAKE_GEOMETRY_UNIT_FILES = Object.freeze(['lib/intake-triage-layout.test.ts']);
export const INTAKE_GEOMETRY_EXPECTED_TESTS = 4;
export const INTAKE_868_UNIT_COUNTS = Object.freeze({
  'components/intake-triage-review.test.tsx': 3, 'components/intake-triage-review.interaction.test.ts': 2,
  'lib/intake-triage-client.test.ts': 17, 'lib/intake-triage-paid-flow.test.ts': 4,
  'lib/preflight-report.test.ts': 24, 'lib/intake-triage-layout.test.ts': 2,
  'lib/workspace-mobile-layout.test.ts': 7, 'lib/workspace-intake.test.ts': 3,
  'lib/workspace-compile-floor-and-ceiling.test.ts': 7, 'lib/copy-trust-guard.test.ts': 24,
});
export const INTAKE_868_ARTIFACT = Object.freeze({ id: 11365195888,
  name: `repair-scope-141-${INTAKE_GEOMETRY_PARENT}`,
  digest: 'sha256:ceb1a12ce8b83362ff2b45775f2a564fc19a2e7cab82e1474514cc766cc82c3a',
});
function intakeSourceProfile(parent) {
  if (parent === INTAKE_PARENT) return { parent, sources: INTAKE_SOURCE_BLOBS, configs: INTAKE_CONFIG_PATHS, parentBlobs: INTAKE_PARENT_BLOBS };
  if (parent === INTAKE_GEOMETRY_PARENT) return { parent, sources: INTAKE_GEOMETRY_SOURCE_BLOBS, configs: INTAKE_GEOMETRY_CONFIG_PATHS, parentBlobs: INTAKE_GEOMETRY_PARENT_BLOBS };
  return null;
}
export function verifyIntakeGeometryParentEvidence({ historical, parentRun, parentJob, dbRun, dbJobs, artifact, archive, jobLog }) {
  try {
    if (!historical?.eligible || historical.parentHead !== INTAKE_PARENT) throw Error('Missing authenticated895 resolution lineage.');
    const run = (value, id, path, conclusion) => {
      if (value?.id !== id || value.head_sha !== INTAKE_GEOMETRY_PARENT || value.path !== path || value.event !== 'pull_request' || value.run_attempt !== 1 || value.status !== 'completed' || value.conclusion !== conclusion) throw Error('Unqualified868 run identity or result.');
    };
    run(parentRun, 37356109193, '.github/workflows/repair-scope.yml', 'failure');
    run(dbRun, 37356109344, '.github/workflows/db-rehearsal.yml', 'success');
    const job = (value, id, runId, name, conclusion) => {
      if (value?.id !== id || value.run_id !== runId || value.head_sha !== INTAKE_GEOMETRY_PARENT || value.name !== name || value.status !== 'completed' || value.conclusion !== conclusion) throw Error('Unqualified868 job identity or result.');
    };
    const step = (value, name, conclusion) => {
      const matches = value.steps?.filter(item => item.name === name) ?? [];
      if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== conclusion) throw Error('Unqualified868 step: ' + name);
    };
    job(parentJob, 111918797906, parentRun.id, 'Repair scope validation', 'failure');
    for (const name of ['Plan changes since the authenticated full-pass anchor', 'Verify workflow and selector contracts', 'Run selector regression tests', 'Run browser report and screenshot regressions', 'Scan repository secrets', 'Run TypeScript and lint checks', 'Run Foundation focused unit checks', 'Install Chromium for detail-integrity coverage', 'Build the isolated live-commerce test bundle after scoped checks', 'Publish exact-head scope receipt']) step(parentJob, name, 'success');
    for (const name of ['Require the four synthetic mounted intake preflight capture pairs', 'Fail closed on missing or failed scoped checks']) step(parentJob, name, 'failure');
    for (const name of ['Run the normal CDR worker unit suite and types for reviewed OCR safety', 'Run hermetic full Vitest for shared or unknown changes', 'Run script contract suite for shared or unknown changes', 'Run the exact repair API catalogue readers separately', 'Require screenshots for the exact paired public UI candidate']) step(parentJob, name, 'skipped');
    const one = id => { const matches = dbJobs?.jobs?.filter(value => value.id === id) ?? []; if (matches.length !== 1) throw Error('Missing or duplicate868 DB job.'); return matches[0]; };
    const classifier = one(111918798738);
    job(classifier, 111918798738, dbRun.id, 'Verify exact collector-only DB evidence reuse', 'success');
    for (const name of ['Independently verify unchanged DB source and prior evidence', 'Require an explicit collector classifier decision']) step(classifier, name, 'success');
    job(one(111918987680), 111918987680, dbRun.id, 'db-rehearsal', 'skipped');
    job(one(111918988074), 111918988074, dbRun.id, 'Local Chromium signed-storage transport', 'skipped');
    if (artifact?.id !== INTAKE_868_ARTIFACT.id || artifact.name !== INTAKE_868_ARTIFACT.name || artifact.digest !== INTAKE_868_ARTIFACT.digest || artifact.expired !== false || artifact.workflow_run?.id !== parentRun.id || artifact.workflow_run?.head_sha !== INTAKE_GEOMETRY_PARENT) throw Error('868 artifact identity or digest mismatch.');
    const receipt = readBoundIntakeReceipt(archive, INTAKE_868_ARTIFACT, 7954);
    if (receipt.headSha !== INTAKE_GEOMETRY_PARENT || receipt.completedHeadSha !== INTAKE_GEOMETRY_PARENT || receipt.repairAnchorSha !== FULL_ANCHOR || receipt.gate !== 'failed' || receipt.fullQualification !== 'pending' || JSON.stringify(receipt.knownRegressionResolution) !== JSON.stringify(historical.resolution) || receipt.pendingDebt.includes(REGRESSION_DEBT) || JSON.stringify(receipt.unitFiles) !== JSON.stringify(INTAKE_UNIT_FILES) || JSON.stringify(receipt.browserFiles) !== JSON.stringify(Object.keys(INTAKE_BROWSER_CASES)) || receipt.requireWorkspaceIntakeCapture !== true) throw Error('868 failed-scope receipt or historical resolution changed.');
    for (const name of ['secretScan', 'typesAndLint', 'workflowStatic', 'selectorContracts', 'units', 'browserBuild']) if (receipt.executedChecks?.[name] !== 'success') throw Error('868 successful unaffected check missing: ' + name);
    if (receipt.executedChecks.selectedBrowsers !== 'failure' || receipt.executedChecks.mountedCaptures !== 'failure' || !receipt.gateFailures?.some(value => value.startsWith('fresh intake execution evidence: Playwright report contains 1 failed test(s).'))) throw Error('868 failed browser/capture evidence changed.');
    if (typeof jobLog !== 'string') throw Error('868 authenticated unit log is missing.');
    const log = jobLog.replace(/\x1b\[[0-9;]*m/g, ''), counts = [...log.matchAll(/\s[✓√]\s+(\S+\.test\.tsx?)\s+\((\d+) tests?\)/g)].map(match => [match[1], Number(match[2])]);
    if (counts.length !== 10 || new Set(counts.map(([file]) => file)).size !== 10 || counts.some(([file, count]) => INTAKE_868_UNIT_COUNTS[file] !== count) || (log.match(/Vitest report: 93 passed, 0 skipped, 0 failed across 10 selected files\./g) ?? []).length !== 1) throw Error('868 actual unit counts, files or zero-skip report differ.');
    const unchanged = Object.fromEntries(counts.filter(([file]) => !INTAKE_GEOMETRY_UNIT_FILES.includes(file)));
    return { eligible: true, sourceHead: INTAKE_GEOMETRY_PARENT, runId: parentRun.id, jobId: parentJob.id, artifact: INTAKE_868_ARTIFACT,
      units: { files: 10, passed: 93, skipped: 0, failed: 0, counts: INTAKE_868_UNIT_COUNTS },
      unchangedUnits: { files: 9, passed: 91, skipped: 0, failed: 0, counts: unchanged },
      previousUiQualification: 'failed; browser and four-pair capture evidence is not inherited as success', failures: receipt.gateFailures,
      database: { runId: dbRun.id, classifierJobId: classifier.id, execution: 'DB and transport skipped; inherited historical source evidence only' }, fullQualification: 'pending' };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

export function classifyIntakePresentationIntent({ headSha, exec = execFileSync }) {
  try {
    const git = args => exec('git', args, { encoding: 'utf8' }).trim();
    const repoRoot = git(['rev-parse', '--show-toplevel']);
    if (!/^[a-f0-9]{40}$/.test(headSha ?? '') || git(['rev-parse', 'HEAD']) !== headSha) throw Error('Unreadable or mismatched exact intake checkout.');
    const parents = git(['rev-list', '--parents', '-n', '1', headSha]).split(' ');
    if (parents[0] !== headSha || parents.some(sha => !/^[a-f0-9]{40}$/.test(sha))) throw Error('Unreadable intake parent metadata.');
    const profile = parents.length === 2 ? intakeSourceProfile(parents[1]) : null;
    if (!profile) return { classification: 'normal', intended: false, reason: 'Outside the exact895/868 intake parents.' };
    if (profile.parent === INTAKE_GEOMETRY_PARENT && git(['rev-list', '--parents', '-n', '1', profile.parent]) !== `${INTAKE_GEOMETRY_PARENT} ${INTAKE_PARENT}`) throw Error('868 must be the exact direct895 child.');
    const paths = git(['-C', repoRoot, 'diff', '--name-only', '--no-relative', '--no-renames', '-z', `${profile.parent}..${headSha}`]).split('\0').filter(Boolean).sort();
    const allowed = [...Object.keys(profile.sources), ...profile.configs];
    const attempted = paths.some(path => /^nextjs\/scripts\/repair-known-regression(?:\.test)?\.mjs$/.test(path));
    if (!attempted || paths.some(path => !allowed.includes(path))) return { classification: 'normal', intended: false, reason: 'Unrelated change uses normal full-anchor selection.' };
    return { classification: 'intended', intended: true, parent: profile.parent, headSha, repoRoot, paths };
  } catch (error) { return { classification: 'unavailable', intended: null, reason: error.message }; }
}

export function verifyIntakePresentationSource({ headSha, exec = execFileSync }) {
  const intent = classifyIntakePresentationIntent({ headSha, exec });
  if (!intent.intended) return { eligible: false, reason: intent.reason };
  const profile = intakeSourceProfile(intent.parent);
  try {
    const git = (args, encoding = 'utf8') => exec('git', ['-C', intent.repoRoot, ...args], { encoding });
    const tree = (revision, path) => {
      const entry = git(['ls-tree', '--full-tree', revision, '--', path]).trim();
      if (!entry) return null;
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match || match[2] !== path) throw Error('Not an exact regular intake source: ' + path);
      return match[1];
    };
    const expected = [...Object.keys(profile.sources), ...profile.configs].sort();
    if (JSON.stringify(intent.paths) !== JSON.stringify(expected)) throw Error('Missing or extra source/configuration paths for the exact intake presentation/measurement source.');
    for (const [before, after] of [[FULL_ANCHOR, COLLECTOR_BASE], [COLLECTOR_BASE, REPAIR_PARENT], [REPAIR_PARENT, INTAKE_PARENT], [INTAKE_PARENT, profile.parent], [profile.parent, headSha]]) git(['merge-base', '--is-ancestor', before, after]);
    verifyTrackedCheckout({ repoRoot: intent.repoRoot, headSha, exec });
    for (const [path, binding] of Object.entries(profile.sources)) {
      if (tree(profile.parent, path) !== binding.before || tree(headSha, path) !== binding.after) throw Error('Intake preimage or final source blob mismatch: ' + path);
      const bytes = git(['show', `${headSha}:${path}`], 'buffer');
      if (bytes.length !== binding.bytes || createHash('sha256').update(bytes).digest('hex') !== binding.sha256) throw Error('Intake final byte identity mismatch: ' + path);
    }
    for (const [path, expectedBlob] of Object.entries(profile.parentBlobs)) {
      if (tree(profile.parent, path) !== expectedBlob) throw Error('Qualified 895 parent binding mismatch: ' + path);
      if (!profile.configs.includes(path) && tree(headSha, path) !== expectedBlob) throw Error('Unchanged intake discovery, runner, DB or selected test modified: ' + path);
    }
    for (const [path, digest] of Object.entries(REPAIR_SEAL)) if (!tree(headSha, path) || repairSealHash(path, git(['show', `${headSha}:${path}`], 'buffer')) !== digest) throw Error('Intake infrastructure seal mismatch: ' + path);
    return { eligible: true, headSha, parent: profile.parent, fullAnchor: FULL_ANCHOR, exactChangedPaths: expected,
      finalSourceBlobs: Object.fromEntries(Object.entries(profile.sources).map(([path, value]) => [path, value.after])) };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

// The archive is authenticated before decompression. Only the single bounded
// receipt entry from that immutable archive is accepted; there are no disk writes.
export function readIntakeParentReceipt(archive) { return readBoundIntakeReceipt(archive, INTAKE_PARENT_ARTIFACT, 8239); }
function readBoundIntakeReceipt(archive, artifact, sizeBytes) {
  if (!Buffer.isBuffer(archive) || archive.length !== sizeBytes || 'sha256:' + createHash('sha256').update(archive).digest('hex') !== artifact.digest) throw Error('Intake parent receipt archive digest or size mismatch.');
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50 || archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0 || archive.readUInt16LE(end + 8) !== 1 || archive.readUInt16LE(end + 10) !== 1 || archive.readUInt16LE(end + 20) !== 0) throw Error('Unexpected parent receipt archive directory.');
  const central = archive.readUInt32LE(end + 16);
  if (archive.readUInt32LE(central) !== 0x02014b50) throw Error('Missing parent receipt archive entry.');
  const nameLength = archive.readUInt16LE(central + 28), compressedSize = archive.readUInt32LE(central + 20), size = archive.readUInt32LE(central + 24), local = archive.readUInt32LE(central + 42);
  if (archive.subarray(central + 46, central + 46 + nameLength).toString('utf8') !== 'repair-receipt.json' || archive.readUInt16LE(central + 10) !== 8 || size > 256 * 1024 || archive.readUInt32LE(local) !== 0x04034b50 || archive.readUInt16LE(local + 8) !== 8) throw Error('Unexpected or oversized parent receipt entry.');
  const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
  if (start + compressedSize > central) throw Error('Parent receipt archive bounds escaped.');
  const bytes = inflateRawSync(archive.subarray(start, start + compressedSize), { maxOutputLength: 256 * 1024 });
  if (bytes.length !== size) throw Error('Parent receipt archive length mismatch.');
  return JSON.parse(bytes.toString('utf8'));
}

export function verifyIntakePresentationEvidence({ previous, parentRun, parentJob, dbRun, dbJobs, artifact, archive }) {
  try {
    const prior = verifyKnownRepairEvidence(previous);
    if (!prior.eligible) throw Error(prior.reason);
    const run = (value, id, path) => {
      if (value?.id !== id || value.head_sha !== INTAKE_PARENT || value.path !== path || value.event !== 'pull_request' || value.run_attempt !== 1 || value.status !== 'completed' || value.conclusion !== 'success') throw Error('Unqualified 895 parent run identity or result.');
    };
    run(parentRun, 37348563827, '.github/workflows/repair-scope.yml'); run(dbRun, 37348564163, '.github/workflows/db-rehearsal.yml');
    const job = (value, id, runId, name, conclusion) => {
      if (value?.id !== id || value.run_id !== runId || value.head_sha !== INTAKE_PARENT || value.name !== name || value.status !== 'completed' || value.conclusion !== conclusion) throw Error('Unqualified 895 parent job identity or result.');
    };
    const step = (value, name, conclusion) => {
      const matches = value.steps?.filter(item => item.name === name) ?? [];
      if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== conclusion) throw Error('Unqualified 895 parent step: ' + name);
    };
    job(parentJob, 111893311039, parentRun.id, 'Repair scope validation', 'success');
    for (const name of ['Plan changes since the authenticated full-pass anchor', 'Verify workflow and selector contracts', 'Run selector regression tests', 'Run browser report and screenshot regressions', 'Scan repository secrets', 'Run TypeScript and lint checks', 'Run Foundation focused unit checks', 'Run the exact repair API catalogue readers separately', 'Fail closed on missing or failed scoped checks', 'Publish exact-head scope receipt']) step(parentJob, name, 'success');
    for (const name of ['Run the normal CDR worker unit suite and types for reviewed OCR safety', 'Run hermetic full Vitest for shared or unknown changes', 'Run script contract suite for shared or unknown changes', 'Install Chromium for detail-integrity coverage', 'Build the isolated live-commerce test bundle after scoped checks', 'Run selected browser checks against one production server', 'Require the four synthetic mounted intake preflight capture pairs', 'Require screenshots for the exact paired public UI candidate']) step(parentJob, name, 'skipped');
    if (parentJob.steps.some(item => !['success', 'skipped'].includes(item.conclusion))) throw Error('895 parent Repair contains a failed step.');
    const one = id => { const matches = dbJobs?.jobs?.filter(value => value.id === id) ?? []; if (matches.length !== 1) throw Error('Missing or duplicate 895 DB job.'); return matches[0]; };
    const classifier = one(111893313963);
    job(classifier, 111893313963, dbRun.id, 'Verify exact collector-only DB evidence reuse', 'success');
    for (const name of ['Independently verify unchanged DB source and prior evidence', 'Require an explicit collector classifier decision']) step(classifier, name, 'success');
    job(one(111893442839), 111893442839, dbRun.id, 'db-rehearsal', 'skipped');
    job(one(111893443341), 111893443341, dbRun.id, 'Local Chromium signed-storage transport', 'skipped');
    if (artifact?.id !== INTAKE_PARENT_ARTIFACT.id || artifact.name !== INTAKE_PARENT_ARTIFACT.name || artifact.digest !== INTAKE_PARENT_ARTIFACT.digest || artifact.expired !== false || artifact.workflow_run?.id !== parentRun.id || artifact.workflow_run?.head_sha !== INTAKE_PARENT) throw Error('895 parent artifact identity or digest mismatch.');
    const receipt = readIntakeParentReceipt(archive), resolution = receipt.knownRegressionResolution;
    if (receipt.headSha !== INTAKE_PARENT || receipt.completedHeadSha !== INTAKE_PARENT || receipt.repairAnchorSha !== FULL_ANCHOR || receipt.gate !== 'passed-scoped-only' || receipt.gateFailures?.length || receipt.fullQualification !== 'pending' || receipt.pendingDebt.includes(REGRESSION_DEBT) || receipt.pendingQualificationDebt.includes(REGRESSION_DEBT)) throw Error('895 parent receipt is not scoped-qualified with resolved regression debt.');
    if (resolution?.headSha !== INTAKE_PARENT || resolution.debt !== REGRESSION_DEBT || resolution.files !== 17 || resolution.passed !== 433 || resolution.catalogue?.files !== 3 || resolution.catalogue.passed !== 13 || resolution.catalogue.skipped !== 0 || resolution.catalogue.failed !== 0 || JSON.stringify(receipt.resolvedQualificationDebt) !== JSON.stringify([resolution]) || JSON.stringify(receipt.knownRegressionObservations) !== JSON.stringify([KNOWN_REGRESSION])) throw Error('895 parent regression resolution or historical observation changed.');
    for (const [name, files, passed] of [['units', 17, 433], ['apiCatalogue', 3, 13]]) {
      const value = receipt.executedChecks[name];
      if (value?.status !== 'success' || value.files !== files || value.passed !== passed || value.skipped !== 0 || value.failed !== 0) throw Error('895 parent executed report mismatch: ' + name);
    }
    return { eligible: true, parentHead: INTAKE_PARENT, parentRunId: parentRun.id, parentJobId: parentJob.id,
      artifact: INTAKE_PARENT_ARTIFACT, resolution, resolvedQualificationDebt: receipt.resolvedQualificationDebt,
      pendingQualificationDebt: receipt.pendingQualificationDebt, pendingFullDebt: receipt.pendingFullDebt,
      checks: Object.fromEntries(Object.entries(prior.checks).filter(([name]) => !['units', 'intakeAuditAndCaptures'].includes(name))),
      databaseLineage: { ...prior.databaseLineage, qualified895RunId: dbRun.id, qualified895ClassifierJobId: classifier.id, executionAt895: 'DB and transport skipped; historical f082 evidence only' }, fullQualification: 'pending' };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

const intakeEvidenceApi = endpoint => {
  const bytes = execFileSync('gh', ['api', `repos/0ssol1620-byte/tavonel-saas-foundation/${endpoint}`], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  return endpoint.endsWith('/zip') ? bytes : endpoint.endsWith('/logs') ? bytes.toString('utf8') : JSON.parse(bytes.toString('utf8'));
};
export function verifyIntakePresentationHistoricalEvidence({ api = intakeEvidenceApi } = {}) {
  try {
    const prior = { repairRun: api('actions/runs/37320682454'), repairJob: api('actions/jobs/111798647893'), databaseRun: api('actions/runs/37320682223'), databaseJob: api('actions/jobs/111798647331'), transportJob: api('actions/jobs/111798647200') };
    const previousDbJobs = api('actions/runs/37338211486/jobs'), previousClassifier = api('actions/jobs/111858284546');
    previousDbJobs.jobs = previousDbJobs.jobs?.map(job => job.id === previousClassifier.id ? previousClassifier : job);
    const previous = { prior, parentRun: api('actions/runs/37338211115'), parentJob: api('actions/jobs/111858281578'), dbRun: api('actions/runs/37338211486'), dbJobs: previousDbJobs, artifacts: PARENT_ARTIFACTS.map(item => api(`actions/artifacts/${item.id}`)) };
    const dbJobs = api('actions/runs/37348564163/jobs'), classifier = api('actions/jobs/111893313963');
    dbJobs.jobs = dbJobs.jobs?.map(job => job.id === classifier.id ? classifier : job);
    const evidence = verifyIntakePresentationEvidence({ previous, parentRun: api('actions/runs/37348563827'), parentJob: api('actions/jobs/111893311039'), dbRun: api('actions/runs/37348564163'), dbJobs, artifact: api('actions/artifacts/11361791741'), archive: api('actions/artifacts/11361791741/zip') });
    return evidence;
  } catch (error) { return { eligible: false, reason: 'Intake presentation evidence unavailable: ' + error.message }; }
}
export function verifyIntakePresentationEligibility({ headSha, exec = execFileSync, api = intakeEvidenceApi }) {
  const source = verifyIntakePresentationSource({ headSha, exec });
  if (!source.eligible) return source;
  const evidence = verifyIntakePresentationHistoricalEvidence({ api });
  if (!evidence.eligible || source.parent !== INTAKE_GEOMETRY_PARENT) return evidence.eligible ? { eligible: true, source, evidence } : evidence;
  try {
    const dbJobs = api('actions/runs/37356109344/jobs'), classifier = api('actions/jobs/111918798738');
    dbJobs.jobs = dbJobs.jobs?.map(job => job.id === classifier.id ? classifier : job);
    const geometryParent = verifyIntakeGeometryParentEvidence({ historical: evidence, parentRun: api('actions/runs/37356109193'), parentJob: api('actions/jobs/111918797906'), dbRun: api('actions/runs/37356109344'), dbJobs, artifact: api('actions/artifacts/11365195888'), archive: api('actions/artifacts/11365195888/zip'), jobLog: api('actions/jobs/111918797906/logs') });
    return geometryParent.eligible ? { eligible: true, source, evidence: { ...evidence, geometryParent } } : geometryParent;
  } catch (error) { return { eligible: false, reason: '868 evidence unavailable: ' + error.message }; }
}

export function authenticateFailedIntakeResolution(receipt, { headSha, intendedResult, eligibleResult, exec = execFileSync, api = intakeEvidenceApi }) {
  if (intendedResult !== 'true' || eligibleResult !== 'false' || receipt?.gate !== 'failed' || receipt.headSha !== headSha || !intakeSourceProfile(receipt.collectorOnlyFailure?.intent?.parent)) return receipt;
  const intent = classifyIntakePresentationIntent({ headSha, exec });
  if (intent.classification !== 'intended' || !intakeSourceProfile(intent.parent)) return receipt;
  const evidence = verifyIntakePresentationHistoricalEvidence({ api });
  if (!evidence.eligible) return { ...receipt, historicalRegressionResolution: { sourceHead: INTAKE_PARENT, status: 'historical evidence unaccepted for current head: ' + evidence.reason } };
  const debt = values => [...new Set([...(values ?? []), ...evidence.pendingQualificationDebt, 'intake-presentation-eligibility'])].filter(value => value !== REGRESSION_DEBT);
  return { ...receipt, gate: 'failed', fullQualification: 'pending', inheritedChecks: {},
    databaseObservation: 'not executed; inherited evidence unaccepted',
    pendingDebt: debt(receipt.pendingDebt), pendingQualificationDebt: debt(receipt.pendingQualificationDebt),
    pendingFullDebt: [...new Set([...(receipt.pendingFullDebt ?? []), ...evidence.pendingFullDebt])],
    knownRegressionObservations: [KNOWN_REGRESSION], knownRegressionResolution: evidence.resolution,
    resolvedQualificationDebt: evidence.resolvedQualificationDebt,
    historicalRegressionResolution: { sourceHead: INTAKE_PARENT, artifact: INTAKE_PARENT_ARTIFACT, status: 'authenticated historical resolution retained; current head remains failed and unqualified' },
  };
}

export function intakePresentationPlan(normal, proof) {
  if (!proof?.eligible || proof.source.headSha !== normal.headSha || !intakeSourceProfile(proof.source.parent) || normal.repairAnchorSha !== FULL_ANCHOR) throw Error('Intake presentation plan requires exact source and qualified 895 evidence.');
  const geometry = proof.source.parent === INTAKE_GEOMETRY_PARENT;
  if (geometry && !proof.evidence.geometryParent?.eligible) throw Error('Missing authenticated868 partial-pass evidence.');
  const inherited = Object.fromEntries(Object.entries(proof.evidence.checks).map(([name, evidence]) => [name, { ...evidence, sourceHead: evidence.sourceHead ?? COLLECTOR_BASE, status: 'inherited-source-evidence; not executed at current head' }]));
  for (const [name, scope] of [['knownRegressionUnits', '433 passing tests across 17 files, zero skips'], ['apiCatalogue', '13 passing tests across 3 files, zero skips']]) inherited[name] = { sourceHead: INTAKE_PARENT, runId: proof.evidence.parentRunId, jobId: proof.evidence.parentJobId, artifact: INTAKE_PARENT_ARTIFACT, scope, status: 'historical qualified 895 evidence; not executed at current head' };
  if (geometry) inherited.unchangedIntakeUnits = { ...proof.evidence.geometryParent.unchangedUnits, sourceHead: INTAKE_GEOMETRY_PARENT, runId: proof.evidence.geometryParent.runId, jobId: proof.evidence.geometryParent.jobId, artifact: INTAKE_868_ARTIFACT, status: 'historical91 tests in9 unchanged files; not executed at current head' };
  return { ...normal, source: geometry ? 'exact two-test measurement correction over868; previous browser/capture qualification failed' : 'exact nine-file intake presentation/copy over qualified 895; prior regression resolution inherited',
    ...(geometry ? { expectedSelectedTestCount: INTAKE_GEOMETRY_EXPECTED_TESTS, geometryParentObservation: proof.evidence.geometryParent } : {}),
    normalSelection: { groups: normal.groups, unitFiles: normal.unitFiles, browserFiles: normal.browserFiles, unknownPaths: normal.unknownPaths },
    groups: ['selector-config', 'workflow-static', 'intake-presentation'], unitFiles: [...(geometry ? INTAKE_GEOMETRY_UNIT_FILES : INTAKE_UNIT_FILES)], browserFiles: Object.keys(INTAKE_BROWSER_CASES), unknownPaths: [],
    catalogueFiles: [], runApiCatalogueChecks: false, runFullHermeticVitest: false, runScriptContracts: false, runCdrWorkerChecks: false, runDetailIntegrity: false,
    runWorkflowStaticGate: true, requireWorkspaceIntakeCapture: true, requirePublicUiScreenshots: false, runDatabaseRehearsal: false, deferredGroups: [],
    databaseRehearsalStatus: geometry ? 'inherited-f082-via-6a32-895-and868-classifiers; not executed at current head' : 'inherited-f082-via-qualified-6a32-and-895; not executed at current head', intakePresentation: proof, inheritedChecks: inherited,
    knownRegressionObservations: [KNOWN_REGRESSION], knownRegressionResolution: proof.evidence.resolution, resolvedQualificationDebt: proof.evidence.resolvedQualificationDebt,
    pendingQualificationDebt: [...new Set([...(normal.pendingQualificationDebt ?? []), ...proof.evidence.pendingQualificationDebt])].filter(debt => debt !== REGRESSION_DEBT),
    pendingFullDebt: [...new Set([...(normal.pendingFullDebt ?? []), ...proof.evidence.pendingFullDebt])], fullQualification: 'pending',
    qualificationReasons: [...normal.qualificationReasons, geometry ? '868 passed93 units but failed browser/captures. Only91 tests in9 unchanged files are inherited; the changed4-test layout suite, both browser projects, build and4 captures run fresh. The895 regression resolution and full release/native integration limits remain historical.' : '895 resolved the 71-failure debt with 433 units and 13 catalogue tests; these are historical results, not a current rerun. Fresh intake units, both browser projects and four capture pairs are required; full release/native integration remains pending.'],
  };
}

export function intakePresentationLineageFailures(plan, proof) {
  if (!proof?.eligible) return ['intake presentation eligibility: ' + (proof?.reason ?? 'missing')];
  try {
    const expected = intakePresentationPlan({ ...plan, qualificationReasons: [] }, proof);
    const fields = ['intakePresentation', 'geometryParentObservation', 'expectedSelectedTestCount', 'groups', 'unitFiles', 'browserFiles', 'catalogueFiles', 'unknownPaths', 'inheritedChecks', 'knownRegressionObservations', 'knownRegressionResolution', 'resolvedQualificationDebt', 'runFullHermeticVitest', 'runScriptContracts', 'runCdrWorkerChecks', 'runDetailIntegrity', 'runWorkflowStaticGate', 'requireWorkspaceIntakeCapture', 'requirePublicUiScreenshots', 'runDatabaseRehearsal', 'runApiCatalogueChecks', 'deferredGroups', 'databaseRehearsalStatus', 'fullQualification'];
    const failures = fields.filter(field => JSON.stringify(plan[field]) !== JSON.stringify(expected[field])).map(field => 'Intake presentation plan changed: ' + field);
    for (const debt of proof.evidence.pendingFullDebt) if (!plan.pendingFullDebt?.includes(debt)) failures.push('Intake presentation full-release debt removed: ' + debt);
    for (const debt of proof.evidence.pendingQualificationDebt) if (!plan.pendingQualificationDebt?.includes(debt)) failures.push('Intake presentation DB debt removed: ' + debt);
    if (plan.pendingQualificationDebt?.includes(REGRESSION_DEBT) || plan.pendingDebt?.includes(REGRESSION_DEBT)) failures.push('Resolved 895 regression debt resurrected.');
    if (plan.knownRegressionRepair || plan.collectorOnly || plan.repairAnchorSha !== FULL_ANCHOR) failures.push('Intake presentation profile or full-pass anchor changed.');
    return failures;
  } catch (error) { return ['Intake presentation lineage invalid: ' + error.message]; }
}

export function validateIntakeBrowserReport(report, file, root) {
  const expected = INTAKE_BROWSER_CASES[file];
  if (!expected) throw Error('Unknown intake browser selection.');
  const summary = validatePlaywrightReport(report, [file], root), records = [];
  const visit = suites => { for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      if (!playwrightReportContainsPath(spec.file ?? suite.file, file, root, report.config?.rootDir)) throw Error('Intake browser report contains another file.');
      for (const test of spec.tests) records.push({ title: spec.title, test });
    }
    if (suite.suites) visit(suite.suites);
  } };
  visit(report.suites);
  if (records.length !== expected.titles.length || JSON.stringify(records.map(value => value.title).sort()) !== JSON.stringify([...expected.titles].sort())) throw Error('Intake browser report omitted or duplicated a required case.');
  for (const { test } of records) if (test.projectName !== expected.project || !['expected', 'flaky'].includes(test.status) || test.results.at(-1)?.status !== 'passed') throw Error('Intake browser case did not pass in its configured project.');
  if (summary.skipped !== 0 || report.stats.skipped !== 0 || summary.passed + summary.flaky !== records.length || report.stats.expected + report.stats.flaky !== records.length) throw Error('Intake browser skips or totals are inconsistent.');
  return { ...summary, executed: records.length, project: expected.project };
}
export function readIntakePresentationExecution(root = process.cwd(), parent = INTAKE_PARENT) {
  if (!intakeSourceProfile(parent)) throw Error('Unknown exact intake execution parent.');
  const geometry = parent === INTAKE_GEOMETRY_PARENT;
  const read = name => JSON.parse(readFileSync(resolve(root, 'node_modules/.cache/repair-scope-reports', name), 'utf8'));
  return { units: validateKnownRepairReport(read('vitest.json'), geometry ? INTAKE_GEOMETRY_UNIT_FILES : INTAKE_UNIT_FILES, root, geometry ? INTAKE_GEOMETRY_EXPECTED_TESTS : undefined),
    browsers: Object.keys(INTAKE_BROWSER_CASES).map((file, index) => validateIntakeBrowserReport(read(`playwright-${index + 1}.json`), file, root)) };
}
