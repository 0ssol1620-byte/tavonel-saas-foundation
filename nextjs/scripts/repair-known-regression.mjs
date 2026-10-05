import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTOR_BASE, FULL_ANCHOR, REGRESSION_DEBT, KNOWN_REGRESSION, verifyTrackedCheckout, verifyPriorEvidence, sealHash, withRegressionDebt } from './repair-collector-only.mjs';
import { buildUnitArgs, validateSelectedPath } from './run-repair-check.mjs';
import { validateVitestReport } from './repair-test-report.mjs';

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
  ".github/workflows/repair-scope.yml": "443c7ea67311fe0f1d1e4c014c9eca7e48dfe18df3f8af3791436020e9306bca",
  "nextjs/scripts/repair-collector-only.mjs": "d6b1aad9bcf656e1f124f8708e0becb38ca8f14bdf0758ddd63325cffb02d945",
  "nextjs/scripts/repair-scope.mjs": "620270844f9235c0907689a06b844cbb0a9bdcfcfbf0c0bc19e8bbca04d5776a",
  "nextjs/scripts/repair-scope.test.mjs": "beaa7bba1aba188dd69fd4ea72450688c3b82056bee639748af56c91ece7b898",
  "nextjs/scripts/repair-scope-gate.mjs": "fac917e37fc7bbd826e6fbef2091452403b90d2b95035b22654697c9abbf32d7",
  "nextjs/scripts/verify-repair-workflows.mjs": "b580f26535af3d45d9d955d40bbefae0302ebd7af4e99b3d98148fe717d61ba3",
  "nextjs/scripts/repair-collector-only.test.mjs": "2f469e28ca986cdefd3cd297d8811d5799bc51330a652c34ea96bc0a13a26ac0",
  "nextjs/scripts/repair-known-regression.mjs": "4e4e993e17b98ef3ea587fd08a11b3eceddc07b51f633d5751cf63908ce0a28e",
  "nextjs/scripts/repair-known-regression.test.mjs": "19f409304fc13e3a157bd9e5706085758bc4f481a52fc02d47ca5fdf2fe40650",
  ".github/workflows/db-rehearsal.yml": "bf3de8c724ea76991921caa14900c1aacab2047404cb549b14fcdde306ec8fed",
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
