import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3117";
const serverMode = process.env.QA_SERVER_MODE ?? "production";
const routes = ["/", "/privacy", "/security"];
const runsPerRoute = 3;
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
try {
  for (const [index, route] of routes.entries()) {
    const samples = [];
    for (let run = 0; run < runsPerRoute; run += 1) {
      const reportPath = join(directory, `report-${index}-${run}.json`);
      const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
      const result = spawnSync(command, [
        "dlx", "lighthouse@12.8.2", `${baseUrl}${route}`,
        "--quiet", "--output=json", `--output-path=${reportPath}`,
        "--only-categories=performance,accessibility,best-practices,seo",
        "--chrome-flags=--headless --no-sandbox --disable-gpu",
      ], {
        encoding: "utf8",
        env: process.env,
        shell: process.platform === "win32",
        windowsHide: true,
      });
      if (result.error || result.status !== 0) {
        process.stderr.write(`LIGHTHOUSE_TOOL_BLOCKER: CLI failed for ${route} run ${run + 1}: ${result.error?.message ?? result.stderr}\n`);
        process.exitCode = 2;
        break;
      }
      samples.push(JSON.parse(await readFile(reportPath, "utf8")));
    }
    if (samples.length !== runsPerRoute) continue;

    const summary = { route, runs: runsPerRoute, categories: {}, audits: {} };
    for (const [name, minimum] of Object.entries(budgets.categories)) {
      const values = samples.map((report) => report.categories[name]?.score);
      const score = values.every((value) => typeof value === "number") ? median(values) : undefined;
      summary.categories[name] = score;
      if (typeof score !== "number" || score < minimum) failures.push(`${route} ${name} ${score ?? "missing"} < ${minimum}`);
    }
    for (const [name, maximum] of Object.entries(budgets.audits)) {
      const values = samples.map((report) => report.audits[name]?.numericValue);
      const value = values.every((item) => typeof item === "number") ? median(values) : undefined;
      summary.audits[name] = value;
      if (typeof value !== "number" || value > maximum) failures.push(`${route} ${name} ${value ?? "missing"} > ${maximum}`);
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
