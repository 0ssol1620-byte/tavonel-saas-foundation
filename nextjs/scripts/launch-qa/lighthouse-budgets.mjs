import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3117";
const serverMode = process.env.QA_SERVER_MODE ?? "production";
/*
  Historical diagnosis before the 2026-09-09 entry-height fix (retained below).
  The entry now owns its height independently of the inert World backdrop, so switching
  to a phone/reduced-motion list cannot move its headline. The unchanged 0.1 ceiling now
  ENFORCES /explore as well; the former measure-only exception is removed below.

  Original baseline notes:

  `/pricing` is new here and is where a purchase decision happens; it passes every budget with
  room (CLS 0.0025, performance 0.97, measured 2026-09-09 against a production build).

  `/explore` is the heaviest public route on the site -- 721,106 bytes of served HTML against
  28,934 for the homepage -- and it had no ceiling of any kind. It is measured below but does not
  yet gate, and that is a deliberate half-measure with a name on it rather than a budget bent to
  fit: on the same production build it reports **cumulative-layout-shift 0.182** against the 0.1
  ceiling every other route clears. Everything else on it passes (performance 0.89, LCP 1910 ms,
  TBT 96 ms, a11y 0.98, SEO 1.0).

  The 0.182 is not a font swap -- the site's own face is `font-display: optional`, and the two
  shifts Lighthouse attributes to a web font score 0.0008 and 0.0002. It is one reflow of the
  entry `<h1>`, worth 0.181 by itself, and it does not reproduce in an unthrottled browser: the
  same page under Playwright at 412x823 measures a total CLS of 0.001. So it is a real defect that
  only appears under load, in the Explore stage's own layout, and finding it was the point of
  adding the route.

  Raising the ceiling to 0.19 to make this go green is the one thing that must not happen. Nor may
  the route quietly leave the list -- a number nobody prints is a number nobody fixes -- so it is
  measured on every run, its summary line is printed like any other, and it starts failing the
  build the day the shift is fixed and it is moved into `routes`.
*/
const routes = ["/", "/privacy", "/security", "/pricing", "/ko/pricing", "/ko/contact", "/explore"];
/*
  `/login` and `/auth/callback` are here because of a regression that nothing caught.

  Stage-A integration gave `lib/recipe-intent.ts` the six cookbook slugs from
  `lib/cookbook-content.ts`, which reads the documentation library and the capability manifest at
  module scope. Both sign-in pages are client components, so `next build` put 72 KB of docs source
  into both bundles for a six-string array: `/login` 112 -> 124 kB and `/auth/callback`
  110 -> 123 kB of first-load JS. `/login` is where a conversion happens, and this list watched
  neither route, so the build stayed green. The cause is now guarded statically by
  `nextjs/lib/client-route-weight.test.ts` (the import graph, which is what actually regressed);
  these two lines are the runtime half.

  They are measure-only rather than gating for one reason, stated rather than hidden: no
  Lighthouse run against these two routes exists yet on any build, so a ceiling for them would be
  a number nobody has measured. Their summary lines print on every run like the others, and they
  move into `routes` above with the first run that shows they clear the budgets -- which is the
  same discipline `/explore` is held to below, and not a ceiling bent to fit.

  `/ko` joined this list with the script ratchet below (UX-L0), and it joined here, not `routes`,
  because its first run did not clear: largest-contentful-paint median 3,093.6 ms against the
  3,000 ceiling (2026-10-17, BASELINE-L0.json; every other budget passed). That is an existing
  defect this list had never measured, not one the ratchet introduced. The script ratchet gates
  `/ko` already; the other budgets start gating it with the first run that shows the LCP cleared.
*/
const measureOnlyRoutes = ["/ko", "/login", "/auth/callback"];
const runsPerRoute = 3;
const maxAttemptsPerRoute = 6;
const budgets = {
  categories: { performance: 0.8, accessibility: 0.95, "best-practices": 0.9, seo: 0.9 },
  audits: { "largest-contentful-paint": 3_000, "cumulative-layout-shift": 0.1, "total-blocking-time": 300 },
};
/*
  Script ratchet for the two front doors (UX-L0, UX-PLAN-2026-10-17 §8.2 and §8.4).

  Until this, the live site had no script-byte gate: the 200,000-byte ratchet CLAUDE.md names
  lives in the core repository's apps/web/lighthouserc.json and never ran against this app. These
  two numbers were RE-DERIVED FROM MEASUREMENT, not carried over and not raised: Lighthouse 12.8.2
  resource-summary script transferSize (bytes on the wire -- compressed body plus response headers
  -- of every script request the page made) against a production `next build` served by
  `next start`, three runs per route, exactly as this script measures. The receipt, with every
  sample and the rule, is BASELINE-L0.json in the core repository's
  outputs/tavonel-research-replan-20261013/ux-program-20261017/.

  Rule: ratchet = the largest measured sample, rounded up to the next 1,024 bytes. The rounding is
  the only headroom; it absorbs HTTP framing noise, not new code. The run's median is what is
  compared, like every other audit here.

  A lane that adds script to / or /ko and lands over these reduces first. If a page is deliberately
  changed so that it must weigh more, the ratchet is re-derived from a new measurement recorded
  beside BASELINE-L0.json, and the commit says which of the two acts it is. It is never raised to
  make a run go green. A ratcheted route fails the run whatever its `enforced` flag says.
*/
const scriptRatchetBytes = { "/": 160_768, "/ko": 160_768 };

try {
  const health = await fetch(`${baseUrl}/api/healthz`);
  if (!health.ok) throw new Error(`health check returned HTTP ${health.status}`);
} catch (error) {
  process.stderr.write(`LIGHTHOUSE_TOOL_BLOCKER: ${baseUrl} is not serving a built TAVONEL app (${error instanceof Error ? error.message : error}).\n`);
  process.exit(2);
}

const directory = await mkdtemp(join(tmpdir(), "tavonel-lighthouse-"));
const failures = [];
const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
};

// resource-summary's script row. A report without one is an incomplete sample, never zero bytes.
const scriptTransferBytes = (report) =>
  report.audits?.["resource-summary"]?.details?.items?.find((item) => item.resourceType === "script")?.transferSize;

function completeReport(report) {
  return Object.keys(budgets.categories).every((name) => typeof report.categories?.[name]?.score === "number")
    && Object.keys(budgets.audits).every((name) => typeof report.audits?.[name]?.numericValue === "number")
    && typeof scriptTransferBytes(report) === "number";
}

try {
  for (const [index, route] of [...routes, ...measureOnlyRoutes].entries()) {
    const samples = [];
    for (let attempt = 0; attempt < maxAttemptsPerRoute && samples.length < runsPerRoute; attempt += 1) {
      const reportPath = join(directory, `report-${index}-${attempt}.json`);
      const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
      const result = spawnSync(command, [
        "dlx", "lighthouse@12.8.2", `${baseUrl}${route}`,
        "--quiet", "--output=json", `--output-path=${reportPath}`,
        "--only-categories=performance,accessibility,best-practices,seo",
        // Use the browser's throttled trace directly. Lantern 12.8 can re-time an already
        // painted RSC image at hydration completion under current Chrome and inflate LCP.
        "--throttling-method=devtools",
        "--chrome-flags=--headless --no-sandbox --disable-gpu",
      ], {
        encoding: "utf8",
        env: process.env,
        shell: process.platform === "win32",
        windowsHide: true,
      });
      if (result.error || result.status !== 0) {
        process.stderr.write(`LIGHTHOUSE_TOOL_BLOCKER: CLI failed for ${route} attempt ${attempt + 1}: ${result.error?.message ?? result.stderr}\n`);
        process.exitCode = 2;
        break;
      }
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      if (!completeReport(report)) {
        // Lighthouse can occasionally emit a syntactically valid report with a null performance
        // category / missing TBT even though the navigation itself completed (LCP and the other
        // categories are present). That is measurement-tool failure, not evidence that the
        // product missed a budget. Discard the incomplete sample and re-measure; if six attempts
        // cannot produce three complete samples, classify the gate as a tool blocker instead of
        // a product regression.
        process.stderr.write(`LIGHTHOUSE_INCOMPLETE_SAMPLE: ${route} attempt ${attempt + 1}; retrying.\n`);
        continue;
      }
      samples.push(report);
    }
    if (process.exitCode === 2) continue;
    if (samples.length !== runsPerRoute) {
      process.stderr.write(`LIGHTHOUSE_TOOL_BLOCKER: ${route} produced ${samples.length}/${runsPerRoute} complete reports after ${maxAttemptsPerRoute} attempts.\n`);
      process.exitCode = 2;
      continue;
    }

    /*
      A measure-only route reports the same numbers and the same misses; it just does not fail the
      build on them. The miss is printed as `over` on its summary line so a run that ignores it
      still says out loud which budget it is ignoring and by how much -- see the note beside
      `measureOnlyRoutes` for which routes are on that footing and what ends it. (/explore was,
      and is enforced above; the two sign-in routes are, until a run shows they clear.)
    */
    const enforced = !measureOnlyRoutes.includes(route);
    const scriptTransferSamples = samples.map(scriptTransferBytes);
    const summary = {
      route, runs: runsPerRoute, enforced, categories: {}, audits: {},
      scriptTransferBytes: median(scriptTransferSamples), scriptTransferSamples,
      scriptRatchetBytes: scriptRatchetBytes[route] ?? null,
      over: [],
    };
    if (summary.scriptRatchetBytes !== null && summary.scriptTransferBytes > summary.scriptRatchetBytes) {
      const miss = `${route} script-transfer-bytes ${summary.scriptTransferBytes} > ${summary.scriptRatchetBytes}`;
      summary.over.push(miss);
      failures.push(miss);
    }
    for (const [name, minimum] of Object.entries(budgets.categories)) {
      const score = median(samples.map((report) => report.categories[name].score));
      summary.categories[name] = score;
      if (score >= minimum) continue;
      const miss = `${route} ${name} ${score} < ${minimum}`;
      summary.over.push(miss);
      if (enforced) failures.push(miss);
    }
    for (const [name, maximum] of Object.entries(budgets.audits)) {
      const value = median(samples.map((report) => report.audits[name].numericValue));
      summary.audits[name] = value;
      if (value <= maximum) continue;
      const miss = `${route} ${name} ${value} > ${maximum}`;
      summary.over.push(miss);
      if (enforced) failures.push(miss);
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    // The script ratchet already went to `failures`; only the misses that really are ignored print here.
    const ignored = summary.over.filter((item) => !failures.includes(item));
    if (!enforced && ignored.length > 0) {
      process.stderr.write(`LIGHTHOUSE_MEASURED_NOT_ENFORCED:\n${ignored.map((item) => `- ${item}`).join("\n")}\n`);
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

if (process.exitCode === 2) process.exit(2);
if (failures.length > 0) {
  const classification = serverMode === "production"
    ? "LIGHTHOUSE_PRODUCT_FAILURE"
    : "LIGHTHOUSE_PROVISIONAL_DEV_FAILURE";
  process.stderr.write(`${classification}:\n${failures.map(item => `- ${item}`).join("\n")}\n`);
  process.exit(serverMode === "production" ? 1 : 2);
}
process.stdout.write("Lighthouse launch budgets passed.\n");
