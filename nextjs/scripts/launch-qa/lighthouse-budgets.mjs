import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3117";
const serverMode = process.env.QA_SERVER_MODE ?? "production";
const routes = ["/", "/privacy", "/security"];
const runsPerRoute = 3;
const maxAttemptsPerRoute = 6;
const budgets = {
  categories: { performance: 0.8, accessibility: 0.95, "best-practices": 0.9, seo: 0.9 },
  audits: { "largest-contentful-paint": 3_000, "cumulative-layout-shift": 0.1, "total-blocking-time": 300 },
};

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

function completeReport(report) {
  return Object.keys(budgets.categories).every((name) => typeof report.categories?.[name]?.score === "number")
    && Object.keys(budgets.audits).every((name) => typeof report.audits?.[name]?.numericValue === "number");
}

try {
  for (const [index, route] of routes.entries()) {
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

    const summary = { route, runs: runsPerRoute, categories: {}, audits: {} };
    for (const [name, minimum] of Object.entries(budgets.categories)) {
      const score = median(samples.map((report) => report.categories[name].score));
      summary.categories[name] = score;
      if (score < minimum) failures.push(`${route} ${name} ${score} < ${minimum}`);
    }
    for (const [name, maximum] of Object.entries(budgets.audits)) {
      const value = median(samples.map((report) => report.audits[name].numericValue));
      summary.audits[name] = value;
      if (value > maximum) failures.push(`${route} ${name} ${value} > ${maximum}`);
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
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
