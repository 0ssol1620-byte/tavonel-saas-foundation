import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(process.cwd(), '..');
const ci = readFileSync(resolve(repo, '.github/workflows/ci.yml'), 'utf8');
const launch = readFileSync(resolve(repo, '.github/workflows/launch-qa.yml'), 'utf8');
const repair = readFileSync(resolve(repo, '.github/workflows/repair-scope.yml'), 'utf8');
const dbRehearsal = readFileSync(resolve(repo, '.github/workflows/db-rehearsal.yml'), 'utf8');
const runner = readFileSync(resolve(repo, 'nextjs/scripts/run-repair-check.mjs'), 'utf8');
const planner = readFileSync(resolve(repo, 'nextjs/scripts/repair-scope.mjs'), 'utf8');
const scopedVitest = readFileSync(resolve(repo, 'nextjs/vitest.repair-scope.config.ts'), 'utf8');
const asyncScopedVitest = readFileSync(resolve(repo, 'nextjs/vitest.repair-scope.async.config.ts'), 'utf8');
const globalVitest = readFileSync(resolve(repo, 'nextjs/vitest.config.ts'), 'utf8');
const reportValidator = readFileSync(resolve(repo, 'nextjs/scripts/repair-test-report.mjs'), 'utf8');
const collectorVerifier = readFileSync(resolve(repo, 'nextjs/scripts/repair-collector-only.mjs'), 'utf8');
const knownRepair = readFileSync(resolve(repo, 'nextjs/scripts/repair-known-regression.mjs'), 'utf8');
const repairFixture = JSON.parse(readFileSync(resolve(repo, 'nextjs/scripts/fixtures/current-foundation-residual-workflow-paths.json'), 'utf8'));
const branches = [
  'main',
  'codex/gate-acl-integration-20260927',
  'codex/gate-lifecycle-integration-20260927',
  'codex/operations-integration-20260830',
  'codex/site-truth-integration-20260924',
  'codex/tavonel-foundation-p0p2-integration',
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const conditionForStep = (workflow, name) => {
  const start = workflow.indexOf(`- name: ${name}`);
  assert(start >= 0, `Repair workflow step is missing: ${name}`);
  const next = workflow.indexOf('\n      - name:', start + 1);
  const step = workflow.slice(start, next < 0 ? undefined : next);
  const match = step.match(/\n        if: >-\r?\n((?:          .*\r?\n?)+)/);
  assert(match, `${name}: expected a folded prerequisite condition`);
  return match[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ');
};
assert(planner.includes("PUBLIC_UI_REPAIR_PREDECESSOR_SHA = '3a5be63e0901f9f1972f6793cac7891bf064af9e'") && planner.includes('PUBLIC_UI_REPAIR_BLOBS = Object.freeze('), 'public repair must bind the exact four-file predecessor/candidate stack');
assert(planner.includes('verifyPublicUiRepairScopeEvidence') && planner.includes('publicUiRepairVerification?.eligible && Object.hasOwn(PUBLIC_UI_REPAIR_BLOBS, path)'), 'public repair variants require a complete exact proof while original editorial pins remain unchanged');
for (const digest of ['58761db3c41e01580f5f015544ce6d17a3900768', 'ab36bbc3203687bd0eca10043207f6557aaec228', 'b3fbdaf6643fe3f5e781d76fd4f5bbf903694a43', 'e1cc943ced58cb6a0a24f9ca2ad79a818f670281']) assert(planner.includes(digest), 'public repair missing exact source binding: ' + digest);
assert(planner.includes("WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA = '3a5be63e0901f9f1972f6793cac7891bf064af9e'") && planner.includes('WORKSPACE_INTAKE_LAYOUT_BLOBS = Object.freeze('), 'workspace layout must bind the exact predecessor and all four reviewed source blobs');
assert(planner.includes('workspaceIntakeLayoutVerification?.eligible') && planner.includes('WORKSPACE_INTAKE_LAYOUT_TRIGGER_PATHS'), 'workspace layout admission and mounted-audit override must require a complete exact proof');
assert(runner.includes("['e2e/workspace-intake-layout.spec.ts', ['1440']]") && runner.includes("['e2e/workspace-intake-triage.spec.ts', ['audit']]"), 'isolated intake layout must use numeric 1440 while mounted intake stays in audit');
assert(runner.includes('readAndValidatePlaywrightReport(reportPath') && runner.includes('matches.length !== 1'), 'mounted collection must validate the report and reject duplicate/missing exact attachments');
const mountedUploadStart = repair.indexOf('- name: Upload only the four named synthetic mounted intake preflight capture pairs');
const mountedUpload = repair.slice(mountedUploadStart, repair.indexOf('- name: Require screenshots for the exact paired public UI candidate', mountedUploadStart));
assert(mountedUploadStart >= 0 && mountedUpload.includes('retention-days: 3') && mountedUpload.includes('if-no-files-found: error'), 'mounted capture upload must be bounded and required');
const mountedPaths = [...mountedUpload.matchAll(/^            (nextjs\/test-results\/[^\n]+)$/gm)].map(match => match[1]);
const mountedExpected = ['review-1440x900', 'review-390x844', 'receipt-1440x900', 'receipt-390x844'].flatMap(suffix => ['png', 'json'].map(extension => `nextjs/test-results/repair-scope-intake-mounted/intake-mounted-${suffix}.${extension}`));
assert(JSON.stringify(mountedPaths.sort()) === JSON.stringify(mountedExpected.sort()), 'upload must include only the four explicit mounted PNG/geometry pairs; no isolated images or reports');
assert(repair.includes('WORKSPACE_INTAKE_CAPTURE_RESULT: ${{ steps.workspace-intake-captures.outcome }}'), 'mounted capture gate must consume the actual step outcome without a success fallback');
const assertFullEvents = (workflow, name) => {
  assert(/pull_request:\n\s+types: \[ready_for_review\]/.test(workflow), `${name}: full PR run must be ready_for_review only`);
  assert(workflow.includes('workflow_dispatch:'), `${name}: manual full run is missing`);
  for (const branch of branches) assert(workflow.includes(`- ${branch}`), `${name}: missing actual integration branch ${branch}`);
};

assertFullEvents(ci, 'CI');
assertFullEvents(launch, 'Launch QA');
for (const job of ['  root:', '  nextjs:']) assert(ci.includes(job), `CI full job context changed: ${job.trim()}`);
for (const full of [
  'Browser QA (${{ matrix.browser }})', 'Product QA (widths + reduced motion + audit)',
  'Lighthouse budgets', 'Launch gate',
]) assert(launch.includes(full), `Launch QA full check context missing: ${full}`);
assert(launch.includes('needs: [preflight, browser-qa, product-qa, lighthouse]'), 'Launch gate final dependency set changed');
for (const result of ['needs.preflight.result', 'needs.browser-qa.result', 'needs.product-qa.result', 'needs.lighthouse.result']) {
  assert(launch.includes(result), `Launch gate no longer checks ${result}`);
}
assert(/pull_request:\n\s+types: \[opened, synchronize, reopened\]/.test(repair), 'repair event set changed');
assert(repair.includes('name: Repair scope validation'), 'repair check must remain distinct');
assert(repair.includes('run: node scripts/repair-collector-only.mjs plan'), 'Repair must independently verify collector eligibility before narrowing');
assert(dbRehearsal.includes('run: node nextjs/scripts/repair-collector-only.mjs eligibility') && dbRehearsal.includes('needs: [collector-only-eligibility]'), 'DB must independently verify source and prior evidence');
assert(dbRehearsal.includes("if: always() && needs.collector-only-eligibility.result == 'success' && needs.collector-only-eligibility.outputs.intended == 'false' && needs.collector-only-eligibility.outputs.eligible == 'false'"), 'DB may run normally only after an explicit unrelated/unknown decision; intended or missing eligibility must block expensive jobs');
assert(dbRehearsal.includes("if: always() && github.event_name == 'pull_request' && needs.collector-only-eligibility.result == 'success' && needs.collector-only-eligibility.outputs.intended == 'false' && needs.collector-only-eligibility.outputs.eligible == 'false'"), 'transport must use the same fail-fast classifier decision');
assert(dbRehearsal.includes('Require an explicit collector classifier decision') && dbRehearsal.includes('path: collector-only-failure-receipt.json'), 'classifier protocol failures must retain an explicit failed/unqualified receipt');
assert(dbRehearsal.includes('receipt.pendingFullDebt') && dbRehearsal.includes("receipt.databaseObservation = 'not executed; inherited evidence unaccepted'") && dbRehearsal.includes('receipt.inheritedChecks = {}'), 'failed or missing classifier outputs must preserve release debt and reject inheritance');
assert(collectorVerifier.includes('REGRESSION_DEBT') && collectorVerifier.includes('37330362300') && collectorVerifier.includes('failed: 71'), 'latest observed 71-failure debt must remain explicit');
assert(knownRepair.includes("REPAIR_PARENT = '6a32dbbe2afeaa7d0c4c446becfe8994b913fcc1'") && knownRepair.includes('REPAIR_SOURCE_BLOBS = Object.freeze(') && knownRepair.includes('REPAIR_SEAL = Object.freeze('), 'targeted repair must bind the exact qualified parent, source preimages and sealed configuration');
for (const file of ['lib/copy-trust-guard.test.ts', 'lib/page-metadata.test.ts', 'lib/resources-hub.test.ts', 'lib/route-classification.test.ts']) assert(knownRepair.includes(`'${file}'`), 'targeted repair omitted an actual regression suite: ' + file);
assert(knownRepair.includes('EXPECTED_REPAIR_TESTS = 433') && knownRepair.includes('readKnownRepairExecution') && knownRepair.includes('resolveKnownRepairDebt'), '71-failure debt may clear only after the exact 17-suite report, separately from full qualification');
assert(repair.includes('node --test scripts/repair-known-regression.test.mjs') && repair.includes("--test-name-pattern='targeted regression transitive'"), 'targeted repair must execute the new source/evidence tests and actual transitive selection regression');
assert(repair.includes("if: steps.plan.outputs.known_regression_repair == 'true'") && repair.includes('node scripts/repair-known-regression.mjs catalogue') && repair.includes('API_CATALOGUE_RESULT: ${{ steps.known-repair-catalogue.outcome }}') && repair.includes('TRANSITIVE_TEST_RESULT: ${{ steps.browser-report-tests.outcome }}'), 'catalogue and transitive selector outcomes must be required without expensive fallback');
assert(repair.includes('TARGETED_REPAIR_UNIT_RESULT: ${{ steps.targeted-vitest.outcome }}'), 'targeted repair must require the actual 17-suite outcome without a success fallback');
assert(collectorVerifier.includes('classifyKnownRepairIntent') && collectorVerifier.includes('verifyKnownRepairEligibility') && collectorVerifier.includes('repair.knownRepairPlan(normal, proof)'), 'both planning and independent DB classification must qualify the exact targeted source and evidence');
for (const workflow of [repair, dbRehearsal]) {
  assert(workflow.includes('actions: read') && workflow.includes('GH_TOKEN: ${{ github.token }}'), 'prior run evidence must use the read-only authenticated Actions API');
  assert(workflow.includes('fetch-depth: 0'), 'collector ancestry and complete source diff require full checkout history');
}
assert(repair.includes('node --test scripts/repair-collector-only.test.mjs') && repair.includes("--test-name-pattern='mounted|collector|report|browser project|browser groups|Playwright'"), 'collector-only must execute its selector/lineage and existing report/capture regressions');
assert(collectorVerifier.includes("'0d24a1c185cb05f931aa61413e8eb6da604c7113'") && collectorVerifier.includes("'9cc2d96094675468671602da60943ffa5eb5c1c4'") && collectorVerifier.includes("'c978599b44621801142cd81a5f3dfbb9802f27d0'"), 'collector-only must require all three immutable fix blobs');
assert(collectorVerifier.includes("'f082847ccd0eb5e65676f357d86a8025d143377b'") && collectorVerifier.includes('37320682454') && collectorVerifier.includes('111798647893') && collectorVerifier.includes('37320682223') && collectorVerifier.includes('111798647331'), 'collector-only must retain exact failed-Repair/successful-DB evidence lineage');
assert(repair.includes('PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}'), 'PR base must be retained separately');
assert(repair.includes('REPAIR_ANCHOR_SHA: 6401c3524b5294f3a395acede35e4632eb89c0fb'), 'authenticated full-pass repair anchor changed');
assert(planner.includes("export const AUDITED_REPAIR_ANCHOR_SHA = '6401c3524b5294f3a395acede35e4632eb89c0fb'"), 'selector anchor must match the authenticated full-pass SHA');
assert(planner.includes("runId: 37172599535"), 'successful 6401 database rehearsal must remain recorded as baseline evidence');
assert(planner.includes('latestMigrationReplayed: false'), 'baseline must not claim that the newest migration was replayed');
assert(planner.includes('baseline-pgtap-passed-latest-migration-not-replayed-37172599535'), 'database status must preserve the migration replay limitation');
assert(!planner.includes('migrationReapplyPassed: true'), 'latest migration replay cannot be reported as passed');
assert(planner.includes("selector: 'foundation-repair-anchor-6401-v2'"), 'selector policy version changed');
assert(planner.includes("GOOGLE_VIEWER_ACL_PREDECESSOR_SHA = '2ff7c521233064915123dfbccb7680716d39cc28'"), 'Google Viewer ACL scope must bind the exact PR #141 predecessor');
assert(planner.includes('GOOGLE_VIEWER_ACL_PREIMAGE_BLOBS = Object.freeze({') && planner.includes('GOOGLE_VIEWER_ACL_FINAL_BLOBS = Object.freeze({'), 'Google Viewer ACL selector must pin every exact preimage and candidate blob');
assert(planner.includes("GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA = '1e1d46ad428aa04081bef359d7dd8012d0d87834'") && planner.includes('GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS = Object.freeze({'), 'ACL refresh evidence must bind the exact published predecessor and every source blob');
assert(planner.includes('verifyGoogleDriveAclRefreshScopeEvidence') && planner.includes('GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS') && planner.includes('google-drive-acl-refresh'), 'ACL refresh selection must remain an exact, fail-closed group');
assert(planner.includes('GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path)') && planner.includes('googleDriveAclRefreshVerification?.eligible'), 'only qualified refresh evidence may authorize changed ACL boundary/capture blobs');
assert(planner.includes('GOOGLE_DRIVE_ACL_REFRESH_UNIT_TESTS') && planner.includes("'lib/acl-refresh-core.test.mjs'"), 'ACL refresh direct tests must be selected by the focused plan');
assert(planner.includes('GOOGLE_VIEWER_ACL_UNIT_TESTS = Object.freeze(['), 'Google Viewer ACL direct and helper test selection is missing');
assert(planner.includes('GOOGLE_VIEWER_ACL_WORKSPACE_OVERLAP_PATHS = new Set(['), 'ACL scope must account for the two exact workspace-progress overlaps');
assert(planner.includes('googleViewerAclVerification?.eligible') && planner.includes('WORKSPACE_SOURCE_ACL_VARIANT_BLOBS'), 'workspace overlap may accept ACL progress blobs only with exact ACL evidence');
assert(planner.includes('verifyGoogleViewerAclScopeEvidence') && planner.includes('googleViewerAclVerification?.eligible'), 'Google Viewer ACL scope must fail closed on missing or mismatched evidence');
assert(planner.includes('unregistered-draft-pending-disposable-pgtap') && planner.includes('supabase/drafts/google-viewer-principal-boundary.sql'), 'Google Viewer ACL SQL must remain an explicitly unregistered draft with database debt');
assert(planner.includes("'app/api/documents/[id]/progress/route.test.ts': '54e35fd493a56857cdf6393167017538e826aa2e'"), 'original workspace source proof must remain intact');
assert(planner.includes("'app/api/documents/[id]/progress/route.ts': 'c2ab73f10f2590eec7118fe85aa98bd6d023a305'"), 'original workspace route pin must remain intact');
assert(planner.includes("'app/api/documents/[id]/progress/route.test.ts': GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.test.ts']"), 'workspace proof must accept the exact ACL-overlapped progress test blob');
assert(planner.includes("'app/api/documents/[id]/progress/route.ts': GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.ts']"), 'workspace proof must accept the exact ACL-overlapped progress source blob');
assert(planner.includes("export const WORKSPACE_SOURCE_BROWSER_FILE = 'e2e/workspace-source-observation.spec.ts'"), 'workspace source browser path must remain exact');
assert(planner.includes('export const WORKSPACE_SOURCE_UNIT_FILES = Object.freeze(['), 'workspace source must expose its exact ten-unit selection');
assert(planner.includes("'lib/source-version-guard.test.ts'"), 'workspace source guard contract must remain selected');
assert(planner.includes('verifyWorkspaceSourceScopeEvidence'), 'workspace narrow scope must verify exact source blobs and path set');
assert(planner.includes('reviewedWorkspacePageBlobs') && planner.includes('reviewedWorkspaceBrowserBlob'), 'workspace exception must bind the reviewed page pair and E2E blob');
assert(planner.includes('globalConfigBase !== reviewedScopedConfigGlobalBlob') && planner.includes('globalConfigHead !== reviewedScopedConfigGlobalBlob'), 'workspace exception must fail closed if global Vitest config changes');
assert(runner.includes("args.push('--config', 'vitest.repair-scope.config.ts')"), 'out-of-default-include tests must use the repair-only Vitest config');
assert(runner.includes("args.push('--config', 'vitest.repair-scope.async.config.ts')") && runner.includes("'app/api/compile-jobs/route.test.ts'"), 'async compile-job route test must be runner-registered with its repair-only config');
assert(runner.includes("'app/api/documents/[id]/progress/route.test.ts'"), 'ACL progress-route unit path must remain supported by the repair runner');
assert(scopedVitest.includes('...inheritedIncludes') && scopedVitest.includes('components/compile-stage.test.tsx') && scopedVitest.includes('app/api/documents/**/route.test.ts'), 'repair-only config must inherit base settings and add only reviewed special test discovery');
assert(asyncScopedVitest.includes('...inheritedIncludes') && asyncScopedVitest.includes('components/compile-stage.test.tsx') && asyncScopedVitest.includes('app/api/documents/**/route.test.ts') && asyncScopedVitest.includes('app/api/compile-jobs/route.test.ts'), 'async repair config must inherit base settings and include only registered out-of-default routes');
assert(planner.includes('ASYNC_COMPILE_JOB_AUTHORITY_PATHS = Object.freeze([') && planner.includes('ASYNC_COMPILE_JOB_AUTHORITY_FINAL_BLOBS = Object.freeze({'), 'async authority scope must pin exact feature paths and final blobs');
assert(planner.includes("INTAKE_TRIAGE_PREDECESSOR_SHA = '8944cbfb0335f3120c71dc823b4106da5de4a6af'") && planner.includes('INTAKE_TRIAGE_SOURCE_BLOBS = Object.freeze({'), 'intake scope must pin the reviewed predecessor and exact source blobs');
assert(planner.includes('verifyIntakeTriageScopeEvidence') && planner.includes('intakeTriageVerification?.eligible'), 'intake scope must fail closed on candidate evidence mismatch');
assert(planner.includes('INTAKE_TRIAGE_UNIT_TESTS') && planner.includes('INTAKE_TRIAGE_BROWSER_FILE') && planner.includes("'lib/intake-triage-processing-quote.test.ts'") && planner.includes("'lib/intake-triage-paid-flow.test.ts'"), 'intake exact unit and browser selection must include the focused processing quote and paid flow regressions');
assert(globalVitest.includes('lib/**/*.test.ts'), 'focused intake lib tests must remain discoverable by the inherited Vitest config');
assert(planner.includes("INTAKE_TRIAGE_REPAIR_CONFIG_BLOB = '6ae26121a08e403d45a05387901ce59c41cc0f12'") && planner.includes('acceptedScopedConfigBlobs.push(INTAKE_TRIAGE_REPAIR_CONFIG_BLOB)'), 'intake evidence may authorize only the pinned repair-only Vitest config');
assert(planner.includes('googleViewerAclVerification?.eligible && intakeTriageVerification?.eligible') && planner.includes('...WORKSPACE_SOURCE_ACL_VARIANT_BLOBS'), 'workspace page, ACL routes and helper must compose only when both source proofs qualify');
assert(planner.includes('INTAKE_TRIAGE_TRIGGER_PATHS') && planner.includes('paths.some(path => INTAKE_TRIAGE_TRIGGER_PATHS.includes(path))'), 'intake scope must trigger only from distinctive triage feature paths');
assert(runner.includes('buildNodeTestArgs') && runner.includes('validateNodeTapReport') && runner.includes('--test-reporter=tap'), 'focused Node tests must run through the reviewed TAP-validated runner');
const aclBoundaryStage = dbRehearsal.indexOf('- name: Stage the reviewed ACL draft as a runner-local migration');
const aclRefreshStage = dbRehearsal.indexOf('- name: Stage the reviewed Google Drive ACL refresh after ACL boundary');
const refreshAsyncStage = dbRehearsal.indexOf('- name: Stage the reviewed async authority draft after ACL');
assert(aclBoundaryStage >= 0 && aclBoundaryStage < aclRefreshStage && aclRefreshStage < refreshAsyncStage, 'ACL refresh must be staged after the boundary and before the async successor');
const aclRefreshStep = dbRehearsal.slice(aclRefreshStage, refreshAsyncStage);
for (const digest of ['8aad3ffaf8d3062c764988029a1235db4e04ab181e0211524677f9f213e306bc', '04b75937e204db4da659352c6f9194c110018cd45715c72553ee0e2e41e8c4a8', 'ecc2b851051b7bbccaed09b231e44a9dcc4fabf6483f6b572fafe3488c1177e2']) {
  assert(aclRefreshStep.includes(digest), 'ACL refresh disposable staging checksum is missing: ' + digest);
}
assert(aclRefreshStep.includes('supabase/drafts/google-drive-acl-refresh/queue.sql') && aclRefreshStep.includes('supabase/drafts/google-drive-acl-refresh/tests/google_drive_acl_refresh_queue.sql') && aclRefreshStep.includes('sha256sum --check') && aclRefreshStep.includes('cmp --'), 'ACL refresh SQL and pgTAP must be exact-checked in the disposable chain');
assert(dbRehearsal.slice(refreshAsyncStage).includes('refresh_version') && dbRehearsal.slice(refreshAsyncStage).includes('order_version="$refresh_version"'), 'async migration must be ordered after the ephemeral ACL refresh migration when present');
assert(runner.includes('components/intake-triage-review.test.tsx') && runner.includes('components/intake-triage-review.interaction.test.ts'), 'repair runner must allow the exact intake component tests');
assert(scopedVitest.includes('components/intake-triage-review.test.tsx') && scopedVitest.includes('components/intake-triage-review.interaction.test.ts'), 'repair-only Vitest config must discover intake component tests');
assert(asyncScopedVitest.includes('components/intake-triage-review.test.tsx') && asyncScopedVitest.includes('components/intake-triage-review.interaction.test.ts'), 'async scoped Vitest config must preserve intake component discovery when scopes combine');
assert(planner.includes("'lib/compile-job-scheduling.test.ts'") && planner.includes("'lib/compile-job-migration.test.ts'") && planner.includes("'app/api/compile-jobs/route.test.ts'"), 'async authority scope must select scheduling, migration, and route regression tests');
assert(planner.includes("path.startsWith('supabase/') ? path : `nextjs/${path}`"), 'Supabase source and draft paths must resolve from repository root');
const aclStage = dbRehearsal.indexOf('- name: Stage the reviewed ACL draft as a runner-local migration');
const asyncStage = dbRehearsal.indexOf('- name: Stage the reviewed async authority draft after ACL');
assert(aclStage >= 0 && asyncStage > aclStage, 'async authority draft must stage after the ACL draft in the disposable database workflow');
assert(dbRehearsal.includes("supabase migration new compile_job_viewer_authority") && dbRehearsal.includes('[[ "$async_version" > "$order_version" ]]'), 'async draft staging must generate a unique strictly later migration version');
assert(dbRehearsal.includes('cp -- "$draft" "${generated[0]}"') && dbRehearsal.includes('cmp -- "$draft" "${generated[0]}"') && dbRehearsal.includes('sha256sum "$draft" "${generated[0]}"'), 'async migration staging must assert exact source copy and hashes');
assert(dbRehearsal.includes('supabase/drafts/compile-job-viewer-authority.sql') && !dbRehearsal.includes('supabase db push'), 'async SQL must stay a runner-local draft and never use remote push');
const intakeStage = dbRehearsal.indexOf('- name: Stage the reviewed intake triage draft after async authority');
const completedReadStage = dbRehearsal.indexOf('- name: Stage the exact completed-read producer draft after intake triage');
const completedReadChain = dbRehearsal.indexOf('- name: Read the head migration version out of the folder');
assert(completedReadStage > intakeStage && completedReadStage < completedReadChain, 'completed-read create-once draft must stage after intake and before the disposable chain reset');
const completedReadStep = dbRehearsal.slice(completedReadStage, completedReadChain);
for (const value of [
  'supabase/drafts/migrations/20261005130000_foundation_completed_read_proof.sql', 'supabase/drafts/tests/foundation_completed_read_proof.sql',
  'c92a5656175ebac658af6e1246160bff462edac34dfa6534a304797f572c8163', '3ef70e5c2d24aebaf67b06f89f86564e5b94d7154e8074dd2f8947693c129da1',
  'test "$intake_state" = ephemeral', 'test "${#existing[@]}" -eq 0', '[[ "$completed_read_version" > "$intake_version" ]]',
  '"$expected_migration_sha256" "$draft" "$expected_migration_sha256" "${generated[0]}"',
  '"$expected_test_sha256" "$test_source" "$expected_test_sha256" "$test_target"',
]) assert(completedReadStep.includes(value), 'completed-read staging is missing exact ordered/checksummed prerequisite: ' + value);
const completedReadReplay = dbRehearsal.slice(dbRehearsal.indexOf('- name: Apply the repair migrations a second time'), dbRehearsal.indexOf('- name: Race model-provider settlement'));
assert(!completedReadReplay.includes('completed_read_proof') && !completedReadReplay.includes('20261005') && !completedReadReplay.includes('2026*'), 'create-once completed-read draft must not enter the replay-safe loop');
assert((dbRehearsal.match(/supabase test db\n/g) ?? []).length === 2, 'disposable protocol must retain both pgTAP executions');
for (const result of ['steps.completed-read-draft.outcome', 'steps.pgtap-first.outcome', 'steps.pgtap-second.outcome']) assert(dbRehearsal.includes(result), 'completed-read final gate must require actual step outcome: ' + result);
assert(dbRehearsal.includes("if: always() && steps.completed-read-draft.outputs.state != 'absent'") && dbRehearsal.includes('run: node nextjs/scripts/repair-scope-gate.mjs database-draft'), 'completed-read rehearsal must fail closed on missing or skipped staging/pgTAP');
assert(planner.includes("COMPLETED_READ_PRODUCER_PREDECESSOR_SHA = '3a5be63e0901f9f1972f6793cac7891bf064af9e'") && planner.includes('COMPLETED_READ_PRODUCER_BLOBS = Object.freeze(') && planner.includes('verifyCompletedReadProducerScopeEvidence'), 'producer must bind all fifteen exact draft source files');
assert(planner.includes('completedReadProducerVerification?.eligible && Object.hasOwn(COMPLETED_READ_PRODUCER_BLOBS, path)'), 'OCR safety overrides may require only complete producer evidence');
for (const path of ['lib/api-error-codes.test.ts', 'lib/settle-route.test.ts', 'lib/completed-read-proof.test.ts']) assert(planner.includes(`'${path}'`), 'producer must select genuine Vitest tests: ' + path);
assert(globalVitest.includes('lib/**/*.test.ts') && runner.includes("const nodeUnitTestPaths = new Set(['lib/acl-refresh-core.test.mjs'])"), 'catalogue full-corpus scans, settle route and helper must remain on Vitest discovery, never Node placeholders');
assert((repair.match(/npm ci --ignore-scripts --no-audit --no-fund/g) ?? []).length === 1 && repair.includes('CDR_WORKER_RESULT: ${{ steps.cdr-worker.outcome }}'), 'producer must reuse one normal worker install/test/types step and its strict actual-outcome gate');
assert(intakeStage > asyncStage, 'intake triage draft must stage only after ACL and async authority');
assert(dbRehearsal.includes('supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql') && dbRehearsal.includes('supabase/drafts/tests/foundation_intake_triage_binding.sql'), 'intake rehearsal must source only the two reviewed drafts');
assert(dbRehearsal.includes('[[ "$intake_version" > "$async_version" ]]') && dbRehearsal.includes('existing=(supabase/migrations/*_foundation_intake_triage_v3.sql)'), 'intake migration staging must use a unique strictly later temporary version');
assert(dbRehearsal.includes('cmp --') && dbRehearsal.includes('expected_migration_sha256=') && dbRehearsal.includes('expected_test_sha256='), 'intake SQL and pgTAP copy must be exact hash-verified runner-local staging');
assert(dbRehearsal.includes('"$expected_migration_sha256" "$draft" "$expected_migration_sha256" "${generated[0]}"') && dbRehearsal.includes('"$expected_test_sha256" "$test_source" "$expected_test_sha256" "$test_target"'), 'both intake sha256sum checks must repeat the expected digest for the second file');
assert(dbRehearsal.indexOf('if [[ "$async_version" > "$now_version" ]]') < dbRehearsal.indexOf('while [[ ! "$now_version" > "$async_version" ]]'), 'intake staging must fail fast when the async version is in the future');
assert(dbRehearsal.includes('supabase/tests/foundation_intake_triage_binding.sql') && !dbRehearsal.includes('supabase db push'), 'intake pgTAP must run only in the disposable local database workflow');
assert(!globalVitest.includes('compile-stage.test.tsx') && !globalVitest.includes('workspace-source-observation'), 'global Vitest config must remain unchanged');
assert(planner.includes("browser: String(plan.runDetailIntegrity || plan.browserFiles.length > 0)"), 'no-browser plans must skip browser install/build');
assert(repairFixture.repairAnchorSha === '6401c3524b5294f3a395acede35e4632eb89c0fb', 'repair path fixture must use the authenticated full-pass anchor');
assert(repairFixture.reviewedFilmScope.unitTestPath === 'nextjs/lib/film-motion-control.test.ts', 'film motion control test mapping changed');
assert(repairFixture.reviewedFilmScope.browserTestPath === 'nextjs/e2e/landing-hero-mobile.spec.ts', 'film mobile browser mapping changed');
assert(repairFixture.reviewedLandingFilmContinuity.sourcePaths.join(',') === 'nextjs/app/landing-v2.css,nextjs/components/landing-v2/landing-page.tsx,nextjs/components/landing-v2/hero-film.tsx', 'landing film continuity scope must remain exact');
assert(repairFixture.reviewedLandingFilmContinuity.browserProjects.join(',') === '360,390', 'landing film E2E must run on phone projects');
assert(repairFixture.reviewedLandingFilmDisclosure.browserProjects.join(',') === '390', 'film loading E2E must use only the project its test executes');
assert(repairFixture.pairedPublicUiCaptureCandidate.paths.length === 12, 'paired screenshot candidate path set must remain exact');
assert(repairFixture.pairedPublicUiCaptureCandidate.requiredScreenshotCount === 6, 'paired UI capture requires exactly six images');
for (const sourcePath of repairFixture.reviewedLandingFilmContinuity.sourcePaths) {
  assert(planner.includes(`path === '${sourcePath.replace(/^nextjs\//, '')}'`), `missing exact landing film mapping: ${sourcePath}`);
}
assert(planner.includes("['merge-base', '--is-ancestor', repairAnchorSha, headSha]"), 'anchor ancestry must be checked first');
assert(planner.includes("['diff', '--name-only', '-z', `${repairAnchorSha}..${headSha}`]"), 'tree diff must use the audited anchor and NUL filenames');
assert(planner.includes('PR_BASE_SHA'), 'CLI must receive the PR base independently');
assert(repair.indexOf('Plan changes since the authenticated full-pass anchor') < repair.indexOf('pnpm install --frozen-lockfile'), 'planning must precede dependency installation');
assert(repair.indexOf('Verify workflow and selector contracts') < repair.indexOf('pnpm install --frozen-lockfile'), 'workflow verification must precede dependency installation');
assert(repair.indexOf('Run selector regression tests') < repair.indexOf('pnpm install --frozen-lockfile'), 'selector regression must precede dependency installation');
assert(repair.includes('node --test scripts/repair-scope.test.mjs'), 'report path and output-directory regressions must run before dependency installation');
assert(repair.indexOf('Run browser report and screenshot regressions') < repair.indexOf('pnpm install --frozen-lockfile'), 'browser report and screenshot regressions must precede dependency installation');
assert(repair.includes('node scripts/run-repair-check.mjs unit'), 'targeted Vitest must use the argv-safe runner');
assert(repair.includes("steps.plan.outputs.unit == 'true'"), 'empty affected-unit scope must skip targeted Vitest safely');
assert(conditionForStep(repair, 'Install Chromium for detail-integrity coverage').includes("steps.plan.outputs.browser == 'true'"), 'no-browser plans must skip browser installation');
assert(conditionForStep(repair, 'Build the isolated live-commerce test bundle after scoped checks').includes("steps.plan.outputs.browser == 'true'"), 'no-browser plans must skip the production browser build');
assert(runner.includes('export function planBrowserRuns(files, runDetailIntegrity)'), 'selected browser files need reviewed project routing');
assert(runner.includes('if (plannedRuns.length === 0) return;'), 'empty browser plans must not start a server');
assert(repair.includes('node scripts/run-repair-check.mjs browser'), 'browser selection must use the argv-safe runner');
assert(planner.includes('public_ui_capture: String(plan.requirePublicUiScreenshots)'), 'screenshot requirement must be scoped to the exact paired candidate');
assert(runner.includes("'e2e/landing-hero-film-loading.spec.ts', ['390']"), 'new phone loading spec project mapping changed');
assert(runner.includes("'e2e/site-nav.spec.ts', ['1440']"), 'site-nav screenshots must be captured once by the desktop project');
assert(repair.includes("find test-results/repair-scope-playwright-* -type f -name 'public-ui-*.png'"), 'public UI screenshot collection must stay within unique Playwright output directories from the nextjs working directory');
for (const screenshot of [
  'public-ui-desktop-1440x900-docs-mcp.png',
  'public-ui-desktop-1440x900-home.png',
  'public-ui-desktop-1440x900-pricing.png',
  'public-ui-mobile-390x844-docs-mcp.png',
  'public-ui-mobile-390x844-home.png',
  'public-ui-mobile-390x844-pricing.png',
]) assert(repair.includes(screenshot), `public UI screenshot allowlist is missing ${screenshot}`);
assert(repair.includes('screenshots[@]} != ${#expected[@]}'), 'public UI screenshot artifact must require exactly six images');
assert(repair.includes("steps.plan.outputs.public_ui_capture == 'true'"), 'only the exact paired candidate may require screenshots');
assert(repair.includes('path: nextjs/test-results/**/public-ui-*.png'), 'public UI artifact must upload only the bounded screenshot path');
assert(repair.includes('retention-days: 3'), 'public UI screenshots must expire after three days');
assert(
  conditionForStep(repair, 'Install Chromium for detail-integrity coverage') ===
    conditionForStep(repair, 'Build the isolated live-commerce test bundle after scoped checks'),
  'Chromium installation must wait for the same successful scoped prerequisites as the browser build',
);
assert(!repair.includes('${{ steps.plan.outputs.unit_files }}'), 'dynamic Vitest filenames must not enter a shell');
assert(!repair.includes('${{ steps.plan.outputs.browser_files }}'), 'dynamic browser filenames must not enter a shell');
assert(runner.includes('shell: false'), 'selected paths must be passed as process arguments');
assert(runner.includes("'--reporter=json'"), 'selected unit and browser runs must write machine-readable JSON reports');
assert(runner.includes("args.push('--output', outputDir)"), 'each Playwright invocation must use its own screenshot output directory');
assert(runner.includes("resolve(workspaceRoot, 'test-results', `repair-scope-playwright-${index + 1}`)"), 'Playwright output directories must remain uniquely numbered under test-results');
assert(runner.includes('readAndValidateVitestReport') && runner.includes('readAndValidatePlaywrightReport'), 'test success must be checked against per-file JSON results');
assert(reportValidator.includes('no executed passing test'), 'reports with skipped-only selected files must fail');
assert(reportValidator.includes('actual === selected') && reportValidator.includes('relative(root, absolute)'), 'JSON report paths must resolve to exact files beneath the workspace root');
const playwrightMatcherStart = reportValidator.indexOf('function playwrightReportContainsPath');
const playwrightMatcherEnd = reportValidator.indexOf('\n}', playwrightMatcherStart);
assert(playwrightMatcherStart >= 0 && playwrightMatcherEnd > playwrightMatcherStart, 'Playwright report matcher is missing');
assert(!reportValidator.slice(playwrightMatcherStart, playwrightMatcherEnd).includes('endsWith('), 'Playwright report matching must not accept suffix-only path identity');
assert(reportValidator.includes('report.config?.rootDir') && reportValidator.includes('resolveWorkspaceRoot(reportRootDir, workspaceRoot)'), 'relative Playwright report paths must resolve against validated JSON config.rootDir metadata');
assert(runner.includes('realpathSync(resolved)'), 'selected paths must be checked after symlink resolution');
assert(runner.includes("delete env.PADDLE_SANDBOX"), 'live browser runner must clear sandbox mode');
assert(runner.includes("delete env.VERCEL_ENV"), 'live browser runner must clear deployment mode');
assert(runner.includes("file !== 'e2e/detail-integrity.spec.ts'"), 'detail-integrity must not be repeated in audit');
assert(!repair.includes('skip-ci') && !repair.includes('skipdrafttests'), 'skip marker is forbidden');
console.log(`Workflow static gates pass. Full qualification still pending for exact CI/Launch runs at this head.`);
