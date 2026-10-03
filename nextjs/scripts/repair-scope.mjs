import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sha = value => /^[0-9a-f]{40}$/i.test(value ?? '');
export const AUDITED_REPAIR_ANCHOR_SHA = 'd2906acde291b77b73229623733736796f4fb8c8';
const baselineDebt = ['docs', 'openapi', 'alias-auth', 'response-fixtures', 'detail-integrity'];
const baselineVitest = [
  'lib/docs-content.test.ts', 'lib/docs-highlight.test.ts', 'lib/docs-navigation.test.ts',
  'lib/retrieval-docs-parity.test.ts', 'lib/openapi-compile-jobs.test.ts',
  'lib/openapi-completeness.test.ts', 'lib/openapi-contract.test.ts',
  'lib/openapi-response-shape.test.ts', 'lib/openapi-routes.test.ts',
  'lib/route-classification.test.ts', 'lib/production-route-surface.test.ts',
];
const baselineAuth = ['lib/connector-contract.test.ts', 'lib/connector-oauth-route.test.ts'];
const uploadTests = [
  'lib/api-error-codes.test.ts', 'lib/customer-data-admission-routes.test.ts',
  'lib/intake-approval-route.test.ts', 'lib/intake-approval.test.ts',
  'lib/upload-confirm-route.test.ts', 'lib/upload-release-route.test.ts',
];

export function normalizePath(raw) {
  // Brackets are allowed for literal Next route segments such as [id] and [...slug].
  // Other shell syntax, controls, backslashes, and non-ASCII path spellings fail closed.
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_./\[\]-]+$/.test(raw)) {
    throw new Error(`Unsupported changed path encoding: ${JSON.stringify(raw)}`);
  }
  const path = raw.startsWith('nextjs/') ? raw.slice('nextjs/'.length) : raw;
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe changed path: ${JSON.stringify(raw)}`);
  }
  return path;
}

export function parseNulPaths(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  if (!text) return [];
  if (!text.endsWith('\0')) throw new Error('Git filename output was not NUL terminated.');
  return text.slice(0, -1).split('\0');
}

export function collectChangedPaths({ repairAnchorSha, headSha, repoRoot, exec = execFileSync }) {
  if (!sha(repairAnchorSha) || !sha(headSha)) throw new Error('Repair scope requires exact anchor and head SHAs.');
  const options = { cwd: repoRoot, stdio: 'pipe', shell: false };
  exec('git', ['merge-base', '--is-ancestor', repairAnchorSha, headSha], options);
  const diff = exec('git', ['diff', '--name-only', '-z', `${repairAnchorSha}..${headSha}`], { ...options, encoding: null });
  return parseNulPaths(diff);
}

export function buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest, changedPaths }) {
  if (!sha(pullRequestBaseSha) || !sha(repairAnchorSha) || !sha(headSha)) {
    throw new Error('Repair scope requires exact PR base, audited anchor, and head SHAs.');
  }
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) throw new Error('Repair scope anchor is not the audited d290 anchor.');
  const paths = [...new Set(changedPaths.map(normalizePath))].sort();
  const groups = new Set(baselineDebt);
  const unitFiles = new Set([...baselineVitest, ...baselineAuth]);
  const browserFiles = new Set();
  const unknownPaths = [];
  const qualificationReasons = new Set(['selector/workflow qualification has not yet been rerun on this head']);
  let broader = false;
  let workflowConfigChanged = false;
  let selectorChanged = false;
  let migrationChanged = false;

  for (const path of paths) {
    let matched = false;
    if (/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/i.test(path)) {
      groups.add('workflow-static');
      workflowConfigChanged = true;
      matched = true;
    }
    if (/^scripts\/(?:repair-scope|repair-scope-gate|run-repair-check|verify-repair-workflows)(\.test)?\.mjs$|^scripts\/fixtures\/current-foundation-residual-workflow-paths\.json$/i.test(path)) {
      groups.add('selector-config');
      qualificationReasons.add('selector changed');
      selectorChanged = true;
      matched = true;
    }

    if (path === 'app/api/openapi/route.ts') {
      groups.add('openapi');
      for (const file of baselineVitest.filter(file => /openapi|docs|retrieval/.test(file))) unitFiles.add(file);
      matched = true;
    }
    if (path === 'lib/docs-content.ts') {
      groups.add('docs');
      for (const file of baselineVitest.filter(file => /docs|retrieval/.test(file))) unitFiles.add(file);
      matched = true;
    }
    if (/^app\/api\/v1\/uploads\/(approval(?:\/cancel)?|confirm|release)\/route\.ts$/i.test(path)) {
      groups.add('alias-auth'); groups.add('upload-intake');
      for (const file of [...baselineAuth, ...uploadTests]) unitFiles.add(file);
      matched = true;
    }
    // Known intake residuals have direct route, contract, and error-code suites.
    if (/^app\/api\/uploads\/(approval|confirm)\/route\.ts$/i.test(path)) {
      groups.add('upload-intake');
      for (const file of uploadTests) unitFiles.add(file);
      matched = true;
    }
    if (path === 'app/workspace/page.tsx') {
      groups.add('workspace-ui');
      browserFiles.add('e2e/failure-states-audit.spec.ts');
      matched = true;
    }
    if (/^e2e\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.spec\.ts$/i.test(path)) {
      groups.add('browser-regression');
      browserFiles.add(path);
      matched = true;
    }
    if (/^lib\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.ts$/i.test(path)) {
      groups.add('unit-regression');
      unitFiles.add(path);
      matched = true;
    }
    if (/^lib\/api-error-codes\.ts$/i.test(path)) {
      groups.add('api-error-contract'); unitFiles.add('lib/api-error-codes.test.ts'); matched = true;
    }
    if (/^lib\/(intake-approval|upload-confirm-route|upload-release-route)\.ts$/i.test(path)) {
      groups.add('upload-intake'); for (const file of uploadTests) unitFiles.add(file); matched = true;
    }
    if (/^supabase\/(migrations|tests)\/[A-Za-z0-9_.-]+\.sql$/i.test(path)) {
      groups.add('database-contract');
      unitFiles.add('lib/pgtap-fixtures.test.ts');
      migrationChanged ||= /^supabase\/migrations\//i.test(path);
      matched = true;
    }

    // Shared identity, billing, parser/schema, lockfile/toolchain, and unknown paths
    // require the hermetic broader unit run. Workflow edits only add release debt
    // and use the dedicated static checker; they do not fan out all 6k tests.
    if (/(^|\/)(auth|billing|middleware|session|entitlement)(\/|\.)|(^|\/)(auth|billing)[^/]*\.(ts|tsx)$/i.test(path)) {
      groups.add('shared-auth-billing'); broader = true; matched = true;
    }
    if (/(^|\/)(schema|schemas|parser|parsers|compiler)(\/|\.)|openapi\.(json|ya?ml)$/i.test(path)) {
      groups.add('schema-parser'); broader = true; matched = true;
    }
    if (/(^|\/)(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|tsconfig[^/]*\.json|vitest\.config\.[^/]+)$/i.test(path)) {
      groups.add('toolchain'); broader = true; matched = true;
    }
    if (!matched) { groups.add('unknown'); unknownPaths.push(path); broader = true; }
  }

  if (workflowConfigChanged) qualificationReasons.add('workflow config changed; full CI/Launch still required on ready_for_review');
  const plan = {
    schemaVersion: 1,
    repository: '0ssol1620-byte/tavonel-saas-foundation',
    pullRequest: Number(pullRequest),
    pullRequestBaseSha,
    repairAnchorSha,
    headSha,
    selector: 'foundation-phase1-2026-10-03',
    source: 'audited repair-anchor tree diff; PR base retained separately as qualification debt',
    changedPaths: paths,
    groups: [...groups].sort(),
    unknownPaths,
    unitFiles: broader ? [] : [...unitFiles].sort(),
    browserFiles: [...browserFiles].sort(),
    runDetailIntegrity: true,
    runWorkflowStaticGate: workflowConfigChanged || selectorChanged,
    runFullHermeticVitest: broader,
    runScriptContracts: broader,
    runDatabaseRehearsal: false,
    deferredGroups: groups.has('database-contract') ? ['database-contract'] : [],
    databaseRehearsalStatus: migrationChanged ? 'deferred-pending-full-qualification' : 'not-applicable',
    broaderQualificationRequired: broader || workflowConfigChanged,
    fullQualification: 'pending',
    qualificationReasons: [...qualificationReasons],
    pendingFullDebt: ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair'],
    bootstrap: {
      baseSha: 'd2906acde291b77b73229623733736796f4fb8c8',
      unit: { passed: 6230, failed: 6, skipped: 1 },
      check: 'passed', browser: { passed: 3 },
      productQA: { passed: 1071, skipped: 279, failed: 4 },
      fullBuild: 'not-run', lighthouse: 'not-run', testScripts: 'not-run',
      unresolvedDebtGroups: baselineDebt,
    },
  };
  return plan;
}

if (process.env.RUN_REPAIR_SCOPE === '1') {
  const pullRequestBaseSha = process.env.PR_BASE_SHA;
  const repairAnchorSha = process.env.REPAIR_ANCHOR_SHA;
  const headSha = process.env.REPAIR_HEAD_SHA;
  if (!sha(pullRequestBaseSha) || !sha(headSha)) throw new Error('Repair scope requires exact 40-character PR-base/head SHAs.');
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) throw new Error('Repair scope must use the audited d290 repair anchor.');
  const checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (checkoutHead !== headSha) throw new Error(`checkout SHA ${checkoutHead} does not equal PR head ${headSha}`);
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const changedPaths = collectChangedPaths({ repairAnchorSha, headSha, repoRoot });
  const plan = buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest: process.env.PR_NUMBER, changedPaths });
  writeFileSync('repair-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const values = {
      broader: String(plan.runFullHermeticVitest),
      browser: 'true',
      workflow_static: String(plan.runWorkflowStaticGate),
      selector_tests: String(plan.groups.includes('selector-config')),
      head: headSha,
      groups: plan.groups.join(', '),
    };
    for (const [key, value] of Object.entries(values)) writeFileSync(output, `${key}=${value}\n`, { flag: 'a' });
  }
  console.log(`Repair scope: ${plan.source}`);
  console.log(`Exact head ${headSha}; repair anchor ${repairAnchorSha}; PR base ${pullRequestBaseSha}; PR ${plan.pullRequest}`);
  console.log(`Groups: ${plan.groups.join(', ')}`);
  console.log(`Changed paths (${changedPaths.length}):\n${plan.changedPaths.map(p => `  ${p}`).join('\n')}`);
  console.log(`Broader suite: ${plan.runFullHermeticVitest}; full qualification: ${plan.fullQualification}`);
}
