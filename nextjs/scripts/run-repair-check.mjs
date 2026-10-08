import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { playwrightReportContainsPath, readAndValidatePlaywrightReport, readAndValidateVitestReport } from './repair-test-report.mjs';

const repoRoot = realpathSync(process.cwd());
const readPlan = () => JSON.parse(readFileSync(resolve(repoRoot, 'repair-plan.json'), 'utf8'));
const registeredUnitTestPaths = new Set([
  'app/api/documents/[id]/progress/route.test.ts',
  'app/api/compile-jobs/route.test.ts',
  'components/compile-stage.test.tsx',
  'components/intake-triage-review.interaction.test.ts',
  'components/intake-triage-review.test.tsx',
  'components/landing-v2/hero-source-card.test.tsx',
  'components/explore/evidence-workbench.test.tsx',
]);
const asyncRouteUnitTestPath = 'app/api/compile-jobs/route.test.ts';
const nodeUnitTestPaths = new Set(['lib/acl-refresh-core.test.mjs']);

export function isInsideWorkspace(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function validateSelectedPath(value, kind, rootPath = repoRoot) {
  const safeSpelling = kind === 'unit' ? /^[A-Za-z0-9_./\[\]-]+$/ : /^[A-Za-z0-9_./-]+$/;
  if (typeof value !== 'string' || !value || !safeSpelling.test(value) || value.startsWith('/')) {
    throw new Error(`Rejected unsafe ${kind} path: ${JSON.stringify(value)}`);
  }
  const segments = value.split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Rejected traversal in ${kind} path: ${JSON.stringify(value)}`);
  }
  const pattern = kind === 'unit'
    ? /^lib\/(?:[A-Za-z0-9_\[\]-]+\/)*[A-Za-z0-9_.\[\]-]+\.test\.ts$/
    : /^e2e\/(?:[A-Za-z0-9_\[\]-]+\/)*[A-Za-z0-9_.\[\]-]+\.spec\.ts$/;
  const registeredUnit = kind === 'unit' && (registeredUnitTestPaths.has(value) || nodeUnitTestPaths.has(value));
  if (!(pattern.test(value) || registeredUnit)) throw new Error(`Unsupported ${kind} path: ${JSON.stringify(value)}`);

  const root = realpathSync(rootPath);
  const resolved = resolve(root, ...segments);
  if (!existsSync(resolved)) throw new Error(`Selected ${kind} file does not exist: ${value}`);
  const actual = realpathSync(resolved);
  if (!isInsideWorkspace(root, actual)) throw new Error(`Selected ${kind} path escapes the workspace: ${value}`);
  if (!statSync(actual).isFile()) throw new Error(`Selected ${kind} path is not a file: ${value}`);
  return value;
}

export function liveBrowserEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  delete env.PADDLE_SANDBOX;
  delete env.VERCEL_ENV;
  Object.assign(env, {
    COMMERCIAL_MODE: 'live',
    TAVONEL_BILLING_LAUNCH_APPROVED: 'true',
    PLAYWRIGHT_LOCAL_HTTP: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'foundation-browser-e2e-anon-key',
  });
  return env;
}

export function auditBrowserFiles(files) {
  return files.filter(file => file !== 'e2e/detail-integrity.spec.ts');
}

export function browserRunOutputDir(workspaceRoot, index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('Browser run index must be a non-negative integer.');
  return resolve(workspaceRoot, 'test-results', `repair-scope-playwright-${index + 1}`);
}

export const WORKSPACE_INTAKE_CAPTURE_NAMES = Object.freeze([
  'intake-mounted-review-1440x900', 'intake-mounted-review-390x844',
  'intake-mounted-receipt-1440x900', 'intake-mounted-receipt-390x844',
]);

export const HOME_PRICING_CAPTURE_BINDINGS = Object.freeze([
  ...['360', '390'].map(project => ({ name: `home-source-phone-${project}`, file: 'e2e/landing-hero-mobile.spec.ts', project, title: 'fits the original source page and preserves its route to the inspector', width: Number(project), height: 844 })),
  ...['1440', '390'].flatMap(project => ['visible', 'dismissed'].map(state => ({ name: `home-first-screen-${project}-consent-${state}`, file: 'e2e/premium-craft.spec.ts', project, title: 'the home first screen shows source evidence without colliding with public chrome', width: Number(project), height: project === '1440' ? 900 : 844 }))),
  ...['en', 'ko'].flatMap(locale => [390, 1440].map(width => ({ name: `pricing-overview-${locale}-${width}`, file: 'e2e/pricing-plan-overview.spec.ts', project: '1440', title: 'all plan prices fit in the compact phone comparison before detailed plan content', width, height: 844 }))),
].map(value => Object.freeze(value)));

function protectedCapturePath(root, path, kind, allowMissing = false) {
  const target = resolve(path);
  if (!isInsideWorkspace(root, target)) throw new Error('Capture path escaped the workspace.');
  const segments = relative(root, target).split(sep);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let entry;
    try { entry = lstatSync(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return null; throw error; }
    if (entry.isSymbolicLink()) throw new Error(`Capture path contains a symlink: ${current}`);
    const expectedDirectory = index !== segments.length - 1 || kind === 'directory';
    if (expectedDirectory ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Capture path is not a regular ${expectedDirectory ? 'directory' : 'file'}: ${current}`);
    if (!isInsideWorkspace(root, realpathSync(current))) throw new Error('Capture path ancestry escaped the workspace.');
  }
  return lstatSync(target);
}

export const MAX_MOUNTED_PNG_BYTES = 5 * 1024 * 1024;
export function validateMountedPngMetadata(entry) {
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size < 8 || entry.size > MAX_MOUNTED_PNG_BYTES) {
    throw new Error('Mounted PNG must be a bounded regular non-symlink file.');
  }
}

export function collectWorkspaceIntakeCaptures(workspaceRoot = repoRoot) {
  const suppliedRoot = resolve(workspaceRoot);
  if (lstatSync(suppliedRoot).isSymbolicLink() || !lstatSync(suppliedRoot).isDirectory()) throw new Error('Capture workspace root must be a non-symlink directory.');
  const root = realpathSync(suppliedRoot);
  const destination = resolve(root, 'test-results/repair-scope-intake-mounted');
  // Validate every destination ancestor and existing named leaf before any mutation.
  protectedCapturePath(root, destination, 'directory', true);
  for (const name of WORKSPACE_INTAKE_CAPTURE_NAMES) {
    for (const extension of ['png', 'json']) protectedCapturePath(root, resolve(destination, `${name}.${extension}`), 'file', true);
  }
  const attachments = new Map(WORKSPACE_INTAKE_CAPTURE_NAMES.map(name => [`${name}-geometry`, []]));
  const reports = resolve(root, 'node_modules/.cache/repair-scope-reports');
  protectedCapturePath(root, reports, 'directory');
  for (const file of readdirSync(reports).filter(name => /^playwright-[1-9][0-9]*\.json$/.test(name))) {
    const reportPath = resolve(reports, file);
    protectedCapturePath(root, reportPath, 'file');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const visit = suites => {
      for (const suite of suites ?? []) {
        for (const spec of suite.specs ?? []) {
          if (!playwrightReportContainsPath(spec.file ?? suite.file, 'e2e/workspace-intake-triage.spec.ts', root, report.config?.rootDir)) continue;
          readAndValidatePlaywrightReport(reportPath, ['e2e/workspace-intake-triage.spec.ts'], root);
          for (const test of spec.tests ?? []) {
            const last = test.results?.at(-1);
            if (test.projectName !== 'audit' || !['expected', 'flaky'].includes(test.status) || last?.status !== 'passed') continue;
            for (const attachment of last.attachments ?? []) {
              if (attachments.has(attachment.name)) attachments.get(attachment.name).push(attachment);
            }
          }
        }
        visit(suite.suites);
      }
    };
    visit(report.suites);
  }
  const prepared = [];
  for (const name of WORKSPACE_INTAKE_CAPTURE_NAMES) {
    const matches = attachments.get(`${name}-geometry`);
    if (matches.length !== 1) throw new Error(`Expected exactly one mounted geometry attachment for ${name}; found ${matches.length}.`);
    const attachment = matches[0];
    if (attachment.contentType !== 'application/json' || typeof attachment.path !== 'string') throw new Error(`Invalid mounted geometry attachment: ${name}`);
    const geometryPath = resolve(root, attachment.path);
    const geometryEntry = protectedCapturePath(root, geometryPath, 'file');
    if (geometryEntry.size > 64 * 1024) throw new Error(`Mounted geometry is oversized: ${name}`);
    const fromRoot = relative(root, geometryPath).replaceAll('\\', '/');
    if (!/^test-results\/repair-scope-playwright-[1-9][0-9]*\/workspace-intake-triage-[^/]+\/attachments\/[^/]+\.json$/.test(fromRoot)) throw new Error(`Mounted geometry attachment escaped its synthetic intake output: ${name}`);
    const geometry = JSON.parse(readFileSync(geometryPath, 'utf8'));
    const [width, height] = name.split('-').at(-1).split('x').map(Number);
    if (geometry.viewport?.width !== width || geometry.viewport?.height !== height) throw new Error(`Wrong mounted capture viewport: ${name}`);
    const screenshotPath = resolve(dirname(dirname(geometryPath)), `${name}.png`);
    validateMountedPngMetadata(protectedCapturePath(root, screenshotPath, 'file'));
    const png = readFileSync(screenshotPath);
    if (png.length > MAX_MOUNTED_PNG_BYTES || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Mounted screenshot is not a bounded PNG: ${name}`);
    // Copy only source-defined geometry fields, never the complete report or arbitrary attachments.
    const { viewport, clearBox, triageBox, inventoryBox, selectBox, labelTextBottom, escaped } = geometry;
    const box = value => {
      if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error(`Malformed mounted geometry: ${name}`);
      return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, value[key]]));
    };
    if (!Number.isFinite(labelTextBottom) || !Array.isArray(escaped) || escaped.length !== 0) throw new Error(`Invalid mounted geometry assertions: ${name}`);
    prepared.push({ name, png, json: JSON.stringify({ viewport: { width, height }, clearBox: box(clearBox), triageBox: box(triageBox), inventoryBox: box(inventoryBox), selectBox: box(selectBox), labelTextBottom, escaped: [] }, null, 2) + '\n' });
  }
  // Sources, signatures and report bindings all qualify before files are created or removed.
  protectedCapturePath(root, destination, 'directory', true);
  mkdirSync(destination, { recursive: true });
  const copied = [];
  for (const { name, png, json } of prepared) {
    for (const [extension, bytes] of [['png', png], ['json', json]]) {
      const target = resolve(destination, `${name}.${extension}`);
      protectedCapturePath(root, target, 'file', true);
      writeFileSync(target, bytes, { flag: 'wx' });
      copied.push(`${name}.${extension}`);
    }
  }
  return copied;
}

const browserProjectsByFile = new Map([
  ['e2e/solutions-workflows.spec.ts', ['1440']],
  ['e2e/public-package-proof.spec.ts', ['1440']],
  ['e2e/compiler-contract.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/contrast-zoom-audit.spec.ts', ['audit', 'audit-768', 'audit-1280']],
  ['e2e/docs-reading-layout.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/premium-craft.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/public-layout-balance.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/workspace-source-observation.spec.ts', ['1440']],
  ['e2e/failure-states-audit.spec.ts', ['audit']],
  ['e2e/site-nav.spec.ts', ['1440']],
  ['e2e/site-chrome-v2.spec.ts', ['1440', '390']],
  ['e2e/mobile-landing.spec.ts', ['360', '390', '768']],
  ['e2e/launch-qa-mobile-nav.spec.ts', ['launch-chromium']],
  ['e2e/landing-hero-mobile.spec.ts', ['360', '390']],
  ['e2e/pricing-plan-overview.spec.ts', ['1440', '390']],
  ['e2e/landing-hero-film-loading.spec.ts', ['390']],
  ['e2e/marketing-consent.spec.ts', ['1440', '390']],
  ['e2e/workspace-intake-triage.spec.ts', ['audit']],
  ['e2e/workspace-intake-layout.spec.ts', ['1440']],
  ['e2e/world-lifecycle.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/explore.spec.ts', ['1440']],
]);

const SOLUTIONS_ROUTES=['ai-ready-knowledge','document-intelligence','knowledge-graph','source-grounded-assistants','knowledge-operations'];
const SOLUTIONS_CAPTURE_TITLE='Solutions choices and proofs remain readable at ';
const SOLUTIONS_JOURNEY_TITLE='Solutions keyboard and evidence journeys at ';
export const SOLUTIONS_BROWSER_TITLES=Object.freeze([390,1440,1920].map(width=>SOLUTIONS_CAPTURE_TITLE+width).concat([390,1440,1920].map(width=>SOLUTIONS_JOURNEY_TITLE+width)));
// 'viewport' and 'journey' captures are page screenshots and must equal the width x 900 viewport; 'element' captures may only be narrower.
const solutionBinding=(name,width,kind='element')=>Object.freeze({name,file:'e2e/solutions-workflows.spec.ts',project:'1440',title:kind==='journey'?SOLUTIONS_JOURNEY_TITLE+width:SOLUTIONS_CAPTURE_TITLE+width,width,height:900,kind});
export const SOLUTIONS_CAPTURE_BINDINGS=Object.freeze([
 ...[390,1440,1920].flatMap(width=>[
   solutionBinding(`solutions-hub-${width}.png`,width,'viewport'),
   ...SOLUTIONS_ROUTES.map(slug=>solutionBinding(`solutions-${slug}-${width}.png`,width,'viewport')),
   ...SOLUTIONS_ROUTES.filter(slug=>width===390).map(slug=>solutionBinding(`solutions-${slug}-390-proof.png`,width)),
   ...['ai-ready-knowledge','knowledge-graph'].map(slug=>solutionBinding(`solutions-${slug}-${width}-preview-focus.png`,width)),
   ...['hub',...SOLUTIONS_ROUTES].flatMap(page=>['normal','hover','focus'].map(state=>solutionBinding(`solutions-${page}-${width}-cta-${state}.png`,width))),
   ...SOLUTIONS_ROUTES.map(slug=>solutionBinding(`solutions-${slug}-${width}-selected-evidence.png`,width,'journey')),
   ...['ai-ready-knowledge','knowledge-graph'].map(slug=>solutionBinding(`solutions-${slug}-${width}-package-destination.png`,width,'journey')),
 ]),
].flat().map(Object.freeze));
export const SOLUTIONS_CAPTURE_SET_COUNTS=Object.freeze({viewport:18,proof:5,preview:6,cta:54,evidence:15,package:6});
const solutionsCaptureCategory=name=>/-cta-(normal|hover|focus)\.png$/.test(name)?'cta':/-390-proof\.png$/.test(name)?'proof':/-preview-focus\.png$/.test(name)?'preview':/-selected-evidence\.png$/.test(name)?'evidence':/-package-destination\.png$/.test(name)?'package':/^solutions-[a-z-]+-(390|1440|1920)\.png$/.test(name)?'viewport':'unowned';
export function solutionsCaptureSetCounts(names){const counts=Object.fromEntries(Object.keys(SOLUTIONS_CAPTURE_SET_COUNTS).map(key=>[key,0]));for(const name of names){const kind=solutionsCaptureCategory(name);if(!Object.hasOwn(counts,kind))throw Error('Unowned Solutions capture name: '+name);counts[kind]+=1;}return counts;}
export function collectSolutionsWorkflowCaptures(workspaceRoot=repoRoot,plan=readPlan(),copy=true){
 const supplied=resolve(workspaceRoot),entry=lstatSync(supplied);if(entry.isSymbolicLink()||!entry.isDirectory())throw Error('Solutions workspace must be a regular directory.');const root=realpathSync(supplied),destination=resolve(root,'test-results/repair-scope-solutions'),names=SOLUTIONS_CAPTURE_BINDINGS.map(b=>b.name);if(SOLUTIONS_CAPTURE_BINDINGS.length!==104||new Set(names).size!==104||JSON.stringify(solutionsCaptureSetCounts(names))!==JSON.stringify(SOLUTIONS_CAPTURE_SET_COUNTS))throw Error('Solutions capture contract must contain104 unique names in the exact named set.');protectedCapturePath(root,destination,'directory',true);if(existsSync(destination)&&readdirSync(destination).some(n=>!names.includes(n)))throw Error('Unexpected Solutions capture destination file.');for(const name of names){const p=resolve(destination,name),exists=protectedCapturePath(root,p,'file',true);if(copy&&exists)throw Error('Solutions capture destination already exists.');if(!copy&&!exists)throw Error('Required Solutions capture missing: '+name);}
 // The Explore repair adds its own separate report after this one; Solutions stays report1 and the only capture owner.
 const explore=Boolean(plan.exploreRepairPresentation),runs=explore?planExploreRepairBrowserRuns(plan.browserFiles,plan.runDetailIntegrity):planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity);if(runs.length!==(explore?2:1)||runs[0].project!=='1440'||JSON.stringify(runs[0].files)!==JSON.stringify(['e2e/solutions-workflows.spec.ts']))throw Error('Solutions must execute exactly once in configured project1440.');const matches=new Map(SOLUTIONS_CAPTURE_BINDINGS.map(b=>[b.name,[]]));const reportPath=resolve(root,'node_modules/.cache/repair-scope-reports/playwright-1.json');protectedCapturePath(root,reportPath,'file');const report=JSON.parse(readFileSync(reportPath,'utf8'));const visit=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])for(const t of spec.tests??[]){const last=t.results?.at(-1);if(t.projectName!=='1440'||!SOLUTIONS_CAPTURE_BINDINGS.some(b=>b.title===spec.title)||!playwrightReportContainsPath(spec.file??suite.file,'e2e/solutions-workflows.spec.ts',root,report.config?.rootDir))continue;if(t.status!=='expected'||t.results.length!==1||last?.status!=='passed')throw Error('Solutions capture came from an unqualified browser outcome.');for(const a of last.attachments??[]){if(a.contentType==='image/png'){if(typeof a.path!=='string'||a.body!==undefined)throw Error('Solutions PNG must be file-backed.');const name=a.name,owner=SOLUTIONS_CAPTURE_BINDINGS.find(b=>b.name===name);if(!owner||owner.title!==spec.title)throw Error('Unowned Solutions PNG attachment: '+name);matches.get(name).push(a);}}}visit(suite.suites);}};visit(report.suites);
 const prepared=SOLUTIONS_CAPTURE_BINDINGS.map(b=>{const values=matches.get(b.name);if(values.length!==1)throw Error('Missing or duplicate exact Solutions capture: '+b.name);const a=values[0],p=resolve(root,a.path),fromRoot=relative(root,p).replaceAll('\\','/');if(!new RegExp(`^test-results/repair-scope-playwright-1/solutions-workflows-[^/]+/attachments/[^/]+\\.png$`).test(fromRoot))throw Error('Solutions capture escaped its exact spec output.');validateMountedPngMetadata(protectedCapturePath(root,p,'file'));const bytes=readFileSync(p);if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw Error('Solutions capture is not a valid PNG.');const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||height>32768||width>b.width||(b.kind!=='element'&&(width!==b.width||height!==b.height)))throw Error('Solutions capture dimensions mismatch: '+b.name);const target=resolve(destination,b.name);if(!copy&&!bytes.equals(readFileSync(target)))throw Error('Curated Solutions capture bytes changed: '+b.name);const file=statSync(p,{bigint:true});return{name:b.name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width,height,target,source:p,canonical:realpathSync.native(p),file:file.ino?`${file.dev}:${file.ino}`:null};});
  // Each expected name needs its own source file; equal pixels from distinct files stay valid.
  const sources=new Map();for(const x of prepared)for(const key of ['path:'+x.canonical,x.file&&'file:'+x.file].filter(Boolean)){if(sources.has(key))throw Error('Distinct Solutions captures share one source PNG: '+sources.get(key)+', '+x.name);sources.set(key,x.name);}
  if(copy){mkdirSync(destination,{recursive:true});for(const x of prepared){protectedCapturePath(root,x.target,'file',true);writeFileSync(x.target,readFileSync(x.source),{flag:'wx'});}}return prepared.map(({name,bytes,sha256,width,height})=>({name,bytes,sha256,width,height}));
}
export function readSolutionsWorkflowExecution(workspaceRoot,plan){const root=realpathSync(workspaceRoot),reportRoot=resolve(root,'node_modules/.cache/repair-scope-reports'),u=resolve(reportRoot,'vitest.json');protectedCapturePath(root,u,'file');const units=readAndValidateVitestReport(u,plan.unitFiles),ur=JSON.parse(readFileSync(u,'utf8'));if(units.failed||units.skipped||ur.numPendingTests||ur.numTodoTests||ur.testResults.length!==4||ur.numTotalTests!==33||ur.numPassedTests!==33||units.passed!==33)throw Error('Four Solutions unit owners must pass all33 cases without skips.');const runs=planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity);if(runs.length!==1||runs[0].project!=='1440'||JSON.stringify(runs[0].files)!==JSON.stringify(['e2e/solutions-workflows.spec.ts']))throw Error('Solutions must execute exactly once in configured project1440.');const run=runs[0],p=resolve(reportRoot,'playwright-1.json');protectedCapturePath(root,p,'file');const browser=readAndValidatePlaywrightReport(p,run.files,root,[run.project]),pr=JSON.parse(readFileSync(p,'utf8')),seen=[];const walk=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])for(const t of spec.tests??[]){if(!playwrightReportContainsPath(spec.file??suite.file,run.files[0],root,pr.config?.rootDir))continue;if(t.projectName!=='1440'||!SOLUTIONS_BROWSER_TITLES.includes(spec.title)||seen.includes(spec.title)||t.status!=='expected'||t.results.length!==1||t.results[0].status!=='passed')throw Error('Solutions browser report contains an unexpected, skipped, retried or failed case.');seen.push(spec.title);}walk(suite.suites);}};walk(pr.suites);if(JSON.stringify(seen.sort())!==JSON.stringify([...SOLUTIONS_BROWSER_TITLES].sort())||browser.failed||browser.flaky||browser.skipped||browser.passed!==6||pr.stats.expected!==6||pr.stats.skipped||pr.stats.unexpected||pr.stats.flaky)throw Error('All six Solutions browser cases must pass once in1440.');return{units,browser,captures:collectSolutionsWorkflowCaptures(root,plan,false)};}

/*
  Explore repair over exact424: e2e/explore.spec.ts is its own report owner, beside but never inside Solutions capture
  ownership. These are its nineteen cases at the final blob, each with the skip predicate written in its own body.
  Only configured project1440 runs: width 1440 is above NARROW_STAGE_MAX (820) and the project is not reduced-motion,
  so exactly the phone walk and the reduced-motion case skip. For context only, 390 would skip the seven desktop-only
  cases plus reduced-motion, and the reduced-motion project would skip only the phone walk; neither runs here.
*/
const EXPLORE_DESKTOP_ONLY='isNarrow(page)',EXPLORE_PHONE_ONLY='!isNarrow(page)',EXPLORE_REDUCED_MOTION_ONLY='testInfo.project.name !== "reduced-motion"';
export const EXPLORE_REPAIR_BROWSER_FILES=Object.freeze(['e2e/explore.spec.ts','e2e/solutions-workflows.spec.ts']);
export const EXPLORE_BROWSER_CASES=Object.freeze([
 ['the entry offers source evidence before graph navigation',null],
 ['Act 1 draws a curated composition of compiled objects',null],
 ['Act 1 offers the same composition as an accessible list',null],
 ['the list is reachable and operable from the keyboard alone',null],
 ["Act 3 names each object's state in words, not only in colour",null],
 ['a dialog keeps focus and gives it back',null],
 ['Act 2 opens an object onto the page region it was compiled from',EXPLORE_DESKTOP_ONLY],
 ['a reference render never presents itself as the acquired original',EXPLORE_DESKTOP_ONLY],
 ['an object with many regions is walked with previous and next',EXPLORE_DESKTOP_ONLY],
 ['a filing says how much of itself is in the World',EXPLORE_DESKTOP_ONLY],
 ['Act 3 reports the arriving filings with derived counts and claims no equivalence',null],
 ['Ask quotes the source and its citation lands in the Evidence act',EXPLORE_DESKTOP_ONLY],
 ['the technical drawer holds everything the stage keeps out of the way',null],
 ['the world is navigable from the keyboard and Escape steps back',EXPLORE_DESKTOP_ONLY],
 ['a phone walks World, Object, Source as steps rather than shrinking three panels',EXPLORE_PHONE_ONLY],
 ['reduced motion removes the transitions and none of the content',EXPLORE_REDUCED_MOTION_ONLY],
 ['the deep links land on the acts they name',null],
 ['a deep link lands on the exact region it names, not only on the act',EXPLORE_DESKTOP_ONLY],
 ['the closing action offers the reader their own sources',null],
].map(([title,skip])=>Object.freeze({title,skip})));
export const EXPLORE_1440_ALLOWED_SKIPS=Object.freeze([
 {title:'a phone walks World, Object, Source as steps rather than shrinking three panels',skip:EXPLORE_PHONE_ONLY,reason:'project1440 viewport width 1440 is above NARROW_STAGE_MAX 820'},
 {title:'reduced motion removes the transitions and none of the content',skip:EXPLORE_REDUCED_MOTION_ONLY,reason:'project1440 is not the reduced-motion project'},
].map(Object.freeze));
// The final deep-link cases: absent query and invalid act land on entry, a valid ID opens its exact region even against
// another act, and an unavailable ID is an explicit generic Evidence-act state with no stand-in source sheet.
export const EXPLORE_DEEP_LINK_CONTRACT=Object.freeze({
 'the deep links land on the acts they name':Object.freeze({required:Object.freeze(['["?act=world", "world"],','["?act=evidence", "evidence"],','["?act=change", "change_compare"],','["?act=constructor", "entry"],','["", "entry"],','for (const id of ["region-that-never-existed", "constructor"]) {','await page.goto(`/explore?evidence=${id}`);','await expect(page.locator(STAGE), id).toHaveAttribute("data-world-act", "evidence");',`const unavailable = page.locator('[role="alert"][data-evidence-unavailable]');`,'await expect(unavailable, id).toHaveCount(1);','await expect(unavailable, id).toBeVisible();','await expect(unavailable, id).toContainText("This passage is not available here");','await expect(unavailable, id).not.toContainText(id);','await expect(page.locator("[data-source-sheet]"), id).toHaveCount(0);','await expect(page.locator("[data-active-region]:visible"), id).toHaveCount(0);']),forbidden:Object.freeze(['["?evidence=region-that-never-existed", "entry"]','["?evidence=constructor", "entry"]'])}),
 'a deep link lands on the exact region it names, not only on the act':Object.freeze({required:Object.freeze(['expect(target, "NEXT must reach a different region, or the link proves nothing").not.toBe(opening);','await page.goto(`/explore?evidence=${target}`);','await page.goto(`/explore?act=change&evidence=${target}`);','await expect(sheet.locator("[data-active-region]")).toHaveAttribute("data-region-id", target!);']),forbidden:Object.freeze([])}),
});
export function exploreSpecInventory(source){
 const text=Buffer.isBuffer(source)?source.toString('utf8'):String(source);if(text.includes('\r'))throw Error('Explore spec must be LF-only.');
 if((text.match(/^const NARROW_STAGE_MAX = 820;$/gm)??[]).length!==1||(text.match(/^const isNarrow = \(page: Page\) => \(page\.viewportSize\(\)\?\.width \?\? 1440\) <= NARROW_STAGE_MAX;$/gm)??[]).length!==1)throw Error('Explore narrow breakpoint predicate changed.');
 if(/\btest\.(?:only|fixme|fail|slow|describe|beforeEach|afterEach|beforeAll|afterAll|use|setTimeout)\b/.test(text))throw Error('Explore spec gained a modifier, hook or group outside its exact case inventory.');
 const starts=[...text.matchAll(/^test\(("[^"\\\n]*"), async \((?:\{ page \}|\{ page \}, testInfo)\) => \{$/gm)];
 // Only bare test( calls count: member calls such as /AFFECTED|UNCHANGED/.test(word) are not cases.
 if(starts.length!==(text.match(/(?<![\w$.])test\(/g)??[]).length)throw Error('Explore spec declares a case outside the reviewed shape.');
 return starts.map((match,index)=>{const body=text.slice(match.index,starts[index+1]?.index??text.length),skips=[...body.matchAll(/^ {2}test\.skip\((.+)\);$/gm)].map(value=>value[1]);if(skips.length>1||skips.length!==(body.match(/test\.skip\(/g)??[]).length)throw Error('Explore case has an unbound skip: '+match[1]);return {title:JSON.parse(match[1]),skip:skips[0]??null,body};});
}
export function verifyExploreSpecSource(source){
 const cases=exploreSpecInventory(source);
 if(JSON.stringify(cases.map(c=>[c.title,c.skip]))!==JSON.stringify(EXPLORE_BROWSER_CASES.map(c=>[c.title,c.skip])))throw Error('Explore spec case identities, order or skip predicates changed.');
 for(const skip of EXPLORE_1440_ALLOWED_SKIPS)if(cases.find(c=>c.title===skip.title)?.skip!==skip.skip)throw Error('Explore 1440 skip is not bound to its own predicate: '+skip.title);
 for(const [title,contract] of Object.entries(EXPLORE_DEEP_LINK_CONTRACT)){const body=cases.find(c=>c.title===title).body;for(const line of contract.required)if(!body.includes(line))throw Error('Explore deep-link case lost a required check: '+line);for(const line of contract.forbidden)if(body.includes(line))throw Error('Explore deep-link case kept a superseded expectation: '+line);}
 return cases.map(({title,skip})=>({title,skip}));
}
// Two reports, never one combined run: Solutions first (report1, the existing capture source), then Explore (report2).
export function planExploreRepairBrowserRuns(files,runDetailIntegrity){
 const selected=[...new Set(files)].sort();
 if(runDetailIntegrity||files.length!==selected.length||JSON.stringify(selected)!==JSON.stringify(EXPLORE_REPAIR_BROWSER_FILES))throw Error('Explore repair runs exactly the Solutions and Explore specs, once each, without detail-integrity.');
 return [{kind:'project',project:'1440',files:['e2e/solutions-workflows.spec.ts']},{kind:'project',project:'1440',files:['e2e/explore.spec.ts']}];
}
export function readExploreRepairExecution(workspaceRoot,plan){
 const root=realpathSync(workspaceRoot),reportRoot=resolve(root,'node_modules/.cache/repair-scope-reports'),u=resolve(reportRoot,'vitest.json');protectedCapturePath(root,u,'file');
 const units=readAndValidateVitestReport(u,plan.unitFiles),ur=JSON.parse(readFileSync(u,'utf8'));
 if(units.failed||units.skipped||ur.numFailedTests||ur.numPendingTests||ur.numTodoTests||ur.testResults.length!==4||ur.numTotalTests!==34||ur.numPassedTests!==34||units.passed!==34)throw Error('Four Solutions unit owners must pass all34 cases without skips.');
 const runs=planExploreRepairBrowserRuns(plan.browserFiles,plan.runDetailIntegrity);
 const sp=resolve(reportRoot,'playwright-1.json');protectedCapturePath(root,sp,'file');
 const solutionsBrowser=readAndValidatePlaywrightReport(sp,runs[0].files,root,[runs[0].project]),sr=JSON.parse(readFileSync(sp,'utf8')),seen=[];
 const walkSolutions=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])for(const t of spec.tests??[]){if(!playwrightReportContainsPath(spec.file??suite.file,runs[0].files[0],root,sr.config?.rootDir))throw Error('Solutions report contains another spec.');if(t.projectName!=='1440'||!SOLUTIONS_BROWSER_TITLES.includes(spec.title)||seen.includes(spec.title)||t.status!=='expected'||t.results.length!==1||t.results[0].status!=='passed')throw Error('Solutions browser report contains an unexpected, skipped, retried or failed case.');seen.push(spec.title);}walkSolutions(suite.suites);}};walkSolutions(sr.suites);
 if(JSON.stringify(seen.sort())!==JSON.stringify([...SOLUTIONS_BROWSER_TITLES].sort())||solutionsBrowser.failed||solutionsBrowser.flaky||solutionsBrowser.skipped||solutionsBrowser.passed!==6||sr.stats.expected!==6||sr.stats.skipped||sr.stats.unexpected||sr.stats.flaky)throw Error('All six Solutions browser cases must pass once in1440.');
 const ep=resolve(reportRoot,'playwright-2.json');protectedCapturePath(root,ep,'file');
 const exploreBrowser=readAndValidatePlaywrightReport(ep,runs[1].files,root,[runs[1].project]),er=JSON.parse(readFileSync(ep,'utf8')),exploreCases=[];
 const walkExplore=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])for(const t of spec.tests??[]){
  if(!playwrightReportContainsPath(spec.file??suite.file,runs[1].files[0],root,er.config?.rootDir))throw Error('Explore report contains another spec.');
  const owned=EXPLORE_BROWSER_CASES.find(c=>c.title===spec.title),allowed=EXPLORE_1440_ALLOWED_SKIPS.find(s=>s.title===spec.title),results=t.results??[],annotations=[...(t.annotations??[]),...results.flatMap(r=>r.annotations??[])];
  if(!owned||t.projectName!=='1440'||exploreCases.some(c=>c.title===spec.title))throw Error('Unowned, duplicate or wrong-project Explore case: '+spec.title);
  // Explore owns no capture: one result, no attachment, no retry and no fixme/fail/slow modifier.
  if(results.length!==1||(results[0].attachments??[]).length||annotations.some(a=>['fixme','fail','slow'].includes(a?.type)))throw Error('Explore case must run once with no retry, attachment or modifier: '+spec.title);
  if(allowed?owned.skip!==allowed.skip||t.status!=='skipped'||results[0].status!=='skipped'||!annotations.some(a=>a?.type==='skip'):t.status!=='expected'||results[0].status!=='passed')throw Error('Unexpected Explore skip, failure or outcome: '+spec.title);
  exploreCases.push(allowed?{title:spec.title,outcome:'skipped',skip:allowed.skip,reason:allowed.reason}:{title:spec.title,outcome:'passed'});
 }walkExplore(suite.suites);}};walkExplore(er.suites);
 if(JSON.stringify(exploreCases.map(c=>c.title).sort())!==JSON.stringify(EXPLORE_BROWSER_CASES.map(c=>c.title).sort())||exploreBrowser.failed||exploreBrowser.flaky||exploreBrowser.passed!==17||exploreBrowser.skipped!==2||er.stats.expected!==17||er.stats.skipped!==2||er.stats.unexpected||er.stats.flaky)throw Error('All nineteen Explore cases must report once in1440: seventeen passed and only the two bound skips.');
 return{units,solutionsBrowser,exploreBrowser,exploreCases,captures:collectSolutionsWorkflowCaptures(root,plan,false)};
}

export function collectHomePricingCaptures(workspaceRoot = repoRoot, plan = readPlan()) {
  const supplied = resolve(workspaceRoot);
  if (lstatSync(supplied).isSymbolicLink() || !lstatSync(supplied).isDirectory()) throw Error('Capture workspace root must be a regular directory.');
  const root = realpathSync(supplied), destination = resolve(root, 'test-results/repair-scope-home-pricing');
  protectedCapturePath(root, destination, 'directory', true);
  for (const binding of HOME_PRICING_CAPTURE_BINDINGS) {
    if (protectedCapturePath(root, resolve(destination, binding.name + '.png'), 'file', true)) throw Error('Home/Pricing capture destination already exists: ' + binding.name);
  }
  const matches = new Map(HOME_PRICING_CAPTURE_BINDINGS.map(binding => [binding.name, []]));
  for (const [index, run] of planBrowserRuns(plan.browserFiles, plan.runDetailIntegrity).entries()) {
    const reportPath = resolve(root, `node_modules/.cache/repair-scope-reports/playwright-${index + 1}.json`);
    protectedCapturePath(root, reportPath, 'file');
    readAndValidatePlaywrightReport(reportPath, run.files, root, run.projects ?? [run.project]);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const visit = suites => { for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        if (!['expected', 'flaky'].includes(test.status) || last?.status !== 'passed') continue;
        for (const binding of HOME_PRICING_CAPTURE_BINDINGS) {
          if (test.projectName !== binding.project || spec.title !== binding.title || !playwrightReportContainsPath(spec.file ?? suite.file, binding.file, root, report.config?.rootDir)) continue;
          for (const attachment of last.attachments ?? []) if (attachment.name === binding.name) matches.get(binding.name).push(attachment);
        }
      }
      visit(suite.suites);
    } };
    visit(report.suites);
  }
  const prepared = HOME_PRICING_CAPTURE_BINDINGS.map(binding => {
    const values = matches.get(binding.name);
    if (values.length !== 1) throw Error(`Expected exactly one successful Home/Pricing attachment: ${binding.name}; found ${values.length}.`);
    const attachment = values[0];
    if (attachment.contentType !== 'image/png' || typeof attachment.path !== 'string' || attachment.body !== undefined) throw Error('Capture must be a file-backed PNG: ' + binding.name);
    const file = resolve(root, attachment.path), entry = protectedCapturePath(root, file, 'file');
    validateMountedPngMetadata(entry);
    const relativePath = relative(root, file).replaceAll('\\', '/'), stem = binding.file.slice(4, -8);
    const canonical = new RegExp(`^test-results/repair-scope-playwright-[1-9][0-9]*/${stem}-[^/]+/attachments/[^/]+\\.png$`);
    if (!canonical.test(relativePath)) throw Error('Capture escaped its canonical public spec output: ' + binding.name);
    const png = readFileSync(file);
    if (png.length < 24 || png.length > MAX_MOUNTED_PNG_BYTES || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.toString('ascii',12,16) !== 'IHDR' || png.readUInt32BE(16) !== binding.width || png.readUInt32BE(20) !== binding.height) throw Error('Capture PNG identity or viewport mismatch: ' + binding.name);
    return { name: binding.name, png };
  });
  // Validate all source files and destination ancestry before writing exact named copies.
  mkdirSync(destination, { recursive: true });
  for (const value of prepared) {
    const target = resolve(destination, value.name + '.png');
    protectedCapturePath(root, target, 'file', true);
    writeFileSync(target, value.png, { flag: 'wx' });
  }
  return prepared.map(value => value.name + '.png');
}

export const PUBLIC_PRODUCT_CAPTURE_BINDINGS = Object.freeze([
  ...['320px','360px','390px','768px','1440px','1440px-at-200-percent'].flatMap(profile=>['initial-canonical-open','content-scrolled'].map(state=>({name:`package-proof-${state}-${profile}`,file:'e2e/public-package-proof.spec.ts',project:'1440',title:'the actual sample package remains readable and keyboard usable at narrow widths and zoom',width:parseInt(profile),height:profile.endsWith('percent')?900:844,element:state==='initial-canonical-open'}))),
  ...['390','1440'].flatMap(project=>['default','expanded'].map(state=>({name:`continuous-knowledge-${state}-${project}`,attachmentName:`continuous-knowledge-${state}-${project}.png`,file:'e2e/compiler-contract.spec.ts',project,title:'keeps the summary first and supports keyboard reading and Change navigation',width:Number(project),fullPage:true,height:project==='390'?844:900}))),
].map(Object.freeze));

export function collectPublicProductCaptures(workspaceRoot=repoRoot,plan=readPlan(),copy=true) {
  const supplied=resolve(workspaceRoot),entry=lstatSync(supplied);if(entry.isSymbolicLink()||!entry.isDirectory())throw Error('Public product workspace must be a regular directory.');
  const root=realpathSync(supplied),destination=resolve(root,'test-results/repair-scope-public-product'),names=PUBLIC_PRODUCT_CAPTURE_BINDINGS.map(b=>b.name+'.png');
  protectedCapturePath(root,destination,'directory',true);
  if(existsSync(destination)&&readdirSync(destination).some(n=>!names.includes(n)))throw Error('Unexpected public product capture destination file.');
  for(const name of names){const exists=protectedCapturePath(root,resolve(destination,name),'file',true);if(copy&&exists)throw Error('Public product capture destination already exists.');if(!copy&&!exists)throw Error('Curated public product capture missing.');}
  const matches=new Map(PUBLIC_PRODUCT_CAPTURE_BINDINGS.map(b=>[b.name,[]]));
  for(const[index,run]of planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity).entries()){
    const path=resolve(root,`node_modules/.cache/repair-scope-reports/playwright-${index+1}.json`);protectedCapturePath(root,path,'file');
    const outcome=readAndValidatePlaywrightReport(path,run.files,root,[run.project]);if(outcome.failed||outcome.flaky)throw Error('Public product browser failures/flakes are not capture evidence.');
    const report=JSON.parse(readFileSync(path,'utf8'));
    const visit=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])for(const test of spec.tests??[]){const last=test.results?.at(-1);if(test.status!=='expected'||last?.status!=='passed')continue;for(const binding of PUBLIC_PRODUCT_CAPTURE_BINDINGS){if(binding.project!==test.projectName||binding.title!==spec.title||!playwrightReportContainsPath(spec.file??suite.file,binding.file,root,report.config?.rootDir))continue;for(const a of last.attachments??[])if(a.name===(binding.attachmentName??binding.name))matches.get(binding.name).push(a);}}visit(suite.suites);}};visit(report.suites);
  }
  const prepared=PUBLIC_PRODUCT_CAPTURE_BINDINGS.map(binding=>{
    const values=matches.get(binding.name);if(values.length!==1)throw Error('Missing or duplicate exact public product attachment: '+binding.name);
    const a=values[0];if(a.contentType!=='image/png'||typeof a.path!=='string'||a.body!==undefined)throw Error('Public product capture must be file-backed PNG.');
    const path=resolve(root,a.path),fromRoot=relative(root,path).replaceAll('\\','/'),stem=binding.file.slice(4,-8);
    if(!new RegExp(`^test-results/repair-scope-playwright-[1-9][0-9]*/${stem}-[^/]+/attachments/[^/]+\\.png$`).test(fromRoot))throw Error('Public product capture escaped its exact spec output.');
    validateMountedPngMetadata(protectedCapturePath(root,path,'file'));const bytes=readFileSync(path);
    if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw Error('Public product capture PNG header invalid.');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||height>32768||(binding.element?width>binding.width:width!==binding.width)||(binding.fullPage?height<binding.height:!binding.element&&height!==binding.height))throw Error('Public product capture dimensions mismatch: '+binding.name);
    const target=resolve(destination,binding.name+'.png');if(!copy&&!bytes.equals(readFileSync(target)))throw Error('Curated public product capture bytes changed.');return {target,bytes,name:binding.name+'.png'};
  });
  if(copy){protectedCapturePath(root,destination,'directory',true);mkdirSync(destination,{recursive:true});for(const p of prepared){protectedCapturePath(root,p.target,'file',true);writeFileSync(p.target,p.bytes,{flag:'wx'});}}
  return prepared.map(p=>p.name);
}

export const PUBLIC_PRODUCT_BROWSER_TITLES = Object.freeze({
  "e2e/compiler-contract.spec.ts": [
    "publishes the eight clauses, each with a state a reader can see",
    "grades no clause as qualified, because no receipt is published here",
    "draws the whole source-change flow, and says which half of it runs here",
    "leaves no orphan slot in the product surface grid",
    "lists the nine interchange standards without implying all nine are emitted",
    "never scrolls the document sideways, at any width",
    "is reachable from the product index and names itself in the tab",
    "leads with version comparison and keeps technical explanations optional",
    "keeps the summary first and supports keyboard reading and Change navigation"
  ],
  "e2e/public-package-proof.spec.ts": [
    "the actual sample package remains readable and keyboard usable at narrow widths and zoom"
  ]
});
export function readPublicProductExecution(workspaceRoot,plan) {
  const root=realpathSync(workspaceRoot),reportRoot=resolve(root,'node_modules/.cache/repair-scope-reports');
  const unitPath=resolve(reportRoot,'vitest.json');protectedCapturePath(root,unitPath,'file');const units=readAndValidateVitestReport(unitPath,plan.unitFiles);
  const unitReport=JSON.parse(readFileSync(unitPath,'utf8'));
  if(units.failed||units.skipped||unitReport.numPendingTests||unitReport.numTodoTests||unitReport.testResults.length!==4||unitReport.numTotalTests!==units.passed||unitReport.numPassedTests!==units.passed)throw Error('Four exact public product unit owners must all execute without skips.');
  const runs=planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity);if(runs.length!==3||runs.map(r=>r.project).join(',')!=='1440,390,reduced-motion')throw Error('Public product browser projects changed.');
  const browsers=runs.map((run,index)=>{
    const path=resolve(reportRoot,`playwright-${index+1}.json`);protectedCapturePath(root,path,'file');const outcome=readAndValidatePlaywrightReport(path,run.files,root,[run.project]),report=JSON.parse(readFileSync(path,'utf8')),seen=[];
    const visit=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])for(const test of spec.tests??[]){const file=run.files.find(f=>playwrightReportContainsPath(spec.file??suite.file,f,root,report.config?.rootDir));if(!file||test.projectName!==run.project||!PUBLIC_PRODUCT_BROWSER_TITLES[file].includes(spec.title))throw Error('Unowned public product browser case.');const key=file+'\0'+spec.title;if(seen.includes(key))throw Error('Duplicate public product browser case.');seen.push(key);const skip=run.project==='reduced-motion'&&spec.title==='keeps the summary first and supports keyboard reading and Change navigation';if(skip?test.status!=='skipped'||test.results.some(r=>r.status!=='skipped'):test.status!=='expected'||test.results.length!==1||test.results[0].status!=='passed')throw Error('Unexpected public product browser skip/retry/outcome.');}visit(suite.suites);}};visit(report.suites);
    const expected=run.files.flatMap(f=>PUBLIC_PRODUCT_BROWSER_TITLES[f].map(t=>f+'\0'+t));if(JSON.stringify(seen.sort())!==JSON.stringify(expected.sort())||outcome.flaky||outcome.failed||outcome.skipped!==(run.project==='reduced-motion'?1:0)||report.stats.expected!==outcome.passed||report.stats.skipped!==outcome.skipped||report.stats.unexpected||report.stats.flaky)throw Error('Incomplete public product browser report.');return {project:run.project,...outcome};
  });
  const captures=collectPublicProductCaptures(root,plan,false);return {units,browsers,captures};
}

export function planBrowserRuns(files, runDetailIntegrity) {
  const selected = [...new Set(files)].sort();
  const detailFile = 'e2e/detail-integrity.spec.ts';
  const hasDetail = selected.includes(detailFile);
  if (hasDetail && !runDetailIntegrity) throw new Error('detail-integrity was selected without its required browser gate.');

  const runs = [];
  if (runDetailIntegrity) runs.push({
    kind: 'detail-integrity',
    files: [detailFile],
    projects: ['1440', '390', '360', 'reduced-motion'],
    grep: 'API reference is scannable',
  });

  const filesByProject = new Map();
  for (const file of selected.filter(file => file !== detailFile)) {
    const projects = browserProjectsByFile.get(file);
    if (!projects) throw new Error(`No reviewed Playwright project mapping for ${file}`);
    for (const project of projects) {
      if (!filesByProject.has(project)) filesByProject.set(project, []);
      filesByProject.get(project).push(file);
    }
  }
  for (const project of ['audit', 'audit-768', 'audit-1280', '1440', '390', '360', '768', 'reduced-motion', 'launch-chromium']) {
    const projectFiles = filesByProject.get(project);
    if (projectFiles) runs.push({ kind: 'project', project, files: [...new Set(projectFiles)].sort() });
  }
  return runs;
}

// The final gate re-reads the reports this runner wrote for an affected plan; a step outcome alone is not accepted.
export function readAffectedExecution(workspaceRoot, plan) {
  const reportDir = resolve(workspaceRoot, 'node_modules/.cache/repair-scope-reports');
  const vitestFiles = plan.unitFiles.filter(file => !nodeUnitTestPaths.has(file));
  const units = vitestFiles.length ? readAndValidateVitestReport(resolve(reportDir, 'vitest.json'), vitestFiles) : null;
  const browsers = planBrowserRuns(plan.browserFiles, plan.runDetailIntegrity).map((planned, index) => ({
    project: planned.project ?? planned.kind, files: planned.files,
    ...readAndValidatePlaywrightReport(resolve(reportDir, `playwright-${index + 1}.json`), planned.files, workspaceRoot, planned.projects ?? [planned.project]),
  }));
  return { units, browsers };
}

export function requireUnitFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('The targeted unit plan selected no test files.');
  return files;
}

export function buildNodeTestArgs(files) {
  requireUnitFiles(files);
  const unsupported = files.filter(file => !nodeUnitTestPaths.has(file));
  if (unsupported.length) throw new Error('No reviewed Node test runner is registered for: ' + unsupported.join(', '));
  return ['--test', '--test-reporter=tap', ...files];
}

export function validateNodeTapReport(output, selectedFiles) {
  requireUnitFiles(selectedFiles);
  if (selectedFiles.some(file => !nodeUnitTestPaths.has(file))) throw new Error('Node TAP report selection contains an unregistered test file.');
  if (typeof output !== 'string' || !output.includes('TAP version 13')) throw new Error('Node TAP report is missing its protocol header.');
  const plan = [...output.matchAll(/^\s*1\.\.(\d+)\s*$/gm)].at(-1)?.[1];
  const count = pattern => Number(output.match(pattern)?.[1] ?? -1);
  const tests = count(/^# tests (\d+)$/m);
  const passed = count(/^# pass (\d+)$/m);
  const failed = count(/^# fail (\d+)$/m);
  const skipped = count(/^# skipped (\d+)$/m);
  const todo = count(/^# todo (\d+)$/m);
  if (plan === undefined || Number(plan) !== tests || tests < 1 || passed !== tests || failed !== 0 || skipped !== 0 || todo !== 0) {
    throw new Error('Node TAP report must show executed passing tests for every selected Node test file.');
  }
  return { files: selectedFiles.length, tests, passed, failed, skipped, todo };
}
export function buildUnitArgs(files, reportPath) {
  requireUnitFiles(files);
  if (files.some(file => file.endsWith('.mjs'))) throw new Error('Node test files must use the reviewed Node runner, not Vitest.');
  if (typeof reportPath !== 'string' || !reportPath) throw new Error('Vitest report path is required.');
  const args = ['exec', 'vitest', 'run'];
  if (files.includes(asyncRouteUnitTestPath)) args.push('--config', 'vitest.repair-scope.async.config.ts');
  else if (files.some(file => registeredUnitTestPaths.has(file))) args.push('--config', 'vitest.repair-scope.config.ts');
  args.push('--reporter=default', '--reporter=json', `--outputFile=${reportPath}`, ...files);
  return args;
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: repoRoot, env, shell: false, stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('close', code => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}`)));
  });
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* retry until the startup deadline */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  }
  throw new Error('Next server did not become ready within 120 seconds.');
}

async function runNodeUnit(files, reportPath) {
  const args = buildNodeTestArgs(files);
  const child = spawn(process.execPath, args, { cwd: repoRoot, env: process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', resolveExit);
  });
  writeFileSync(reportPath, output);
  const summary = validateNodeTapReport(output, files);
  console.log('Node TAP report: ' + summary.passed + ' passed, ' + summary.failed + ' failed across ' + summary.files + ' selected files.');
  if (exitCode !== 0) throw new Error('Node test runner exited with ' + exitCode + '.');
}

async function runUnit() {
  const plan = readPlan();
  const files = requireUnitFiles(plan.unitFiles.map(file => validateSelectedPath(file, 'unit')));
  const nodeFiles = files.filter(file => file.endsWith('.mjs'));
  const unregisteredNodeFiles = nodeFiles.filter(file => !nodeUnitTestPaths.has(file));
  if (unregisteredNodeFiles.length) throw new Error('Unregistered Node unit test files: ' + unregisteredNodeFiles.join(', '));
  const vitestFiles = files.filter(file => !nodeUnitTestPaths.has(file));
  const reportDir = resolve(repoRoot, 'node_modules/.cache/repair-scope-reports');
  mkdirSync(reportDir, { recursive: true });
  if (nodeFiles.length) {
    const nodeReportPath = resolve(reportDir, 'node-tap.txt');
    rmSync(nodeReportPath, { force: true });
    await runNodeUnit(nodeFiles, nodeReportPath);
  }
  if (!vitestFiles.length) return;
  const reportPath = resolve(reportDir, 'vitest.json');
  rmSync(reportPath, { force: true });
  let runError;
  try { await run('pnpm', buildUnitArgs(vitestFiles, reportPath)); }
  catch (error) { runError = error; }
  const summary = readAndValidateVitestReport(reportPath, vitestFiles);
  console.log('Vitest report: ' + summary.passed + ' passed, ' + summary.skipped + ' skipped, ' + summary.failed + ' failed across ' + summary.files + ' selected files.');
  if (runError) throw runError;
}
export async function runBrowserGroups(plannedRuns, { runGroup, readReport, onSummary = () => {} }) {
  const failures = [];
  const summaries = [];
  for (const [index, planned] of plannedRuns.entries()) {
    let runError;
    let reportError;
    try { await runGroup(planned, index); }
    catch (error) { runError = error; }
    try {
      const summary = await readReport(planned, index);
      onSummary(planned, summary);
      summaries.push(summary);
    } catch (error) { reportError = error; }
    if (runError || reportError) {
      failures.push(new AggregateError([runError, reportError].filter(Boolean),
        `Playwright group ${index + 1} (${planned.project ?? planned.kind}) failed.`));
    }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} selected Playwright group(s) failed.`);
  return summaries;
}

async function runBrowser() {
  const plan = readPlan();
  const files = plan.browserFiles.map(file => validateSelectedPath(file, 'browser'));
  const plannedRuns = plan.exploreRepairPresentation ? planExploreRepairBrowserRuns(files, plan.runDetailIntegrity) : planBrowserRuns(files, plan.runDetailIntegrity);
  if (plannedRuns.length === 0) return;
  const baseUrl = 'http://127.0.0.1:3117';
  const env = liveBrowserEnv();
  const nextCli = resolve(repoRoot, 'node_modules/next/dist/bin/next');
  if (!existsSync(nextCli)) throw new Error('Next CLI is missing; the gated build/install did not complete.');
  const server = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '3117'], {
    cwd: repoRoot, env, shell: false, stdio: 'inherit',
  });
  try {
    await waitForServer(server, `${baseUrl}/workspace`);
    const browserEnv = { ...env, PLAYWRIGHT_EXTERNAL_SERVER: '1', PLAYWRIGHT_BASE_URL: baseUrl };
    const reportPathFor = index => resolve(repoRoot, `node_modules/.cache/repair-scope-reports/playwright-${index + 1}.json`);
    await runBrowserGroups(plannedRuns, {
      runGroup: async (planned, index) => {
        const reportPath = reportPathFor(index);
        const outputDir = browserRunOutputDir(repoRoot, index);
        mkdirSync(dirname(reportPath), { recursive: true });
        rmSync(reportPath, { force: true });
        const args = ['exec', 'playwright', 'test', ...planned.files];
        args.push('--output', outputDir);
        args.push('--reporter=json');
        if (planned.grep) args.push('--grep', planned.grep);
        if (planned.projects) args.push(...planned.projects.map(project => `--project=${project}`));
        if (planned.project) args.push(`--project=${planned.project}`);
        await run('pnpm', args, { ...browserEnv, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath });
      },
      readReport: (planned, index) => readAndValidatePlaywrightReport(reportPathFor(index), planned.files, repoRoot, planned.projects ?? [planned.project]),
      onSummary: (planned, summary) => {
        console.log(`Playwright report ${planned.kind}${planned.project ? `/${planned.project}` : ''}: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.flaky} flaky, ${summary.failed} failed across ${summary.files} selected files.`);
      },
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (mode === 'unit') await runUnit();
  else if (mode === 'browser') await runBrowser();
  else if (mode === 'intake-captures') console.log(`Collected ${collectWorkspaceIntakeCaptures().length} exact synthetic mounted intake files.`);
  else if (mode === 'public-product-captures') console.log(`Collected ${collectPublicProductCaptures().length} exact public product PNGs.`);
  else if(mode==='solutions-captures'){const files=collectSolutionsWorkflowCaptures(repoRoot,readPlan(),true);console.log(`Collected ${files.length} exact named Solutions PNGs.`);}
  else if (mode === 'home-pricing-captures') console.log(`Collected ${collectHomePricingCaptures().length} exact public Home/Pricing PNGs.`);
  else throw new Error('Usage: node scripts/run-repair-check.mjs <unit|browser>');
}
