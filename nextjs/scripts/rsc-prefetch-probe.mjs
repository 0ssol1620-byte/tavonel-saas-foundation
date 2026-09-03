/**
 * Why RSC prefetches fail, measured rather than assumed.
 *
 * The launch cross-browser spec asserts an empty console and was flaky in Firefox on
 * "Failed to fetch RSC payload ... Falling back to browser navigation". The first reading was
 * contention in the local matrix. Running the same spec against a Preview, alone, failed on the
 * first attempt -- so that reading was wrong and this exists to replace it with the network.
 *
 * For each run it records every request Next issues as an RSC prefetch (the ones carrying the
 * `RSC` header), the status or the failure text, the timing, and the console errors that
 * arrived with them.
 *
 *   node scripts/rsc-prefetch-probe.mjs --base https://example.vercel.app --runs 20
 *   node scripts/rsc-prefetch-probe.mjs --base https://tavonel.com --runs 5 --browser firefox
 *
 * Writes JSONL to --out (default .rsc-probe.jsonl) and prints a summary.
 */
import { appendFileSync, writeFileSync } from "node:fs";
// `playwright` itself is not a direct dependency; @playwright/test re-exports the launchers.
import { firefox, chromium, webkit } from "@playwright/test";

const ROUTES = ["/", "/privacy", "/security", "/login"];

function parseArguments(values) {
  const options = { base: null, runs: 20, browser: "firefox", out: ".rsc-probe.jsonl", intercept: false, settleMs: 1500 };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--base") { options.base = values[++index]; continue; }
    if (name === "--runs") { options.runs = Number(values[++index]); continue; }
    if (name === "--browser") { options.browser = values[++index]; continue; }
    if (name === "--out") { options.out = values[++index]; continue; }
    if (name === "--intercept") { options.intercept = true; continue; }
    if (name === "--settle") { options.settleMs = Number(values[++index]); continue; }
  }
  return options;
}

const LAUNCHERS = { firefox, chromium, webkit };

async function probeOnce(browserType, base, run, intercept, settleMs) {
  const browser = await LAUNCHERS[browserType].launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  if (intercept) {
    /*
      The one thing the launch spec does that this probe did not.

      It stubs the third-party origins so a launch page never reaches Supabase or Paddle. The
      pattern matches neither the site nor its RSC payloads -- but installing any route handler
      turns on request interception for the whole context, and that is the variable being
      tested here.
    */
    await page.route(/^https:\/\/(?:.*\.)?(?:supabase\.co|paddle\.com)\//, route =>
      route.fulfill({ status: 204, body: "" }));
  }

  const prefetches = [];
  const consoleErrors = [];
  const failures = [];

  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", request => {
    const headers = request.headers();
    // Next marks a flight request with `RSC: 1`; a prefetch adds `Next-Router-Prefetch`.
    if (headers.rsc || headers["next-router-prefetch"]) {
      prefetches.push({
        url: request.url(),
        prefetch: Boolean(headers["next-router-prefetch"]),
        startedAt: Date.now(),
      });
    }
  });
  page.on("requestfailed", request => {
    failures.push({ url: request.url(), reason: request.failure()?.errorText ?? "unknown" });
  });
  page.on("response", async response => {
    const entry = prefetches.find(item => item.url === response.url() && item.status === undefined);
    if (!entry) return;
    entry.status = response.status();
    entry.contentType = response.headers()["content-type"] ?? null;
    entry.elapsedMs = Date.now() - entry.startedAt;
  });

  const routeResults = [];
  for (const route of ROUTES) {
    const startedAt = Date.now();
    let status = null;
    let error = null;
    try {
      const response = await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      status = response?.status() ?? null;
      /*
        How long the page is left alone before the next navigation.

        This is the variable that matters. The launch spec navigates on as soon as `main` is
        visible, which is well before the prefetches for the links on that page have finished,
        and a prefetch cancelled by navigating away is reported as "Failed to fetch RSC
        payload". At --settle 0 this probe does what the spec does.
      */
      if (settleMs > 0) await page.waitForTimeout(settleMs);
    } catch (cause) {
      error = String(cause?.message ?? cause);
    }
    routeResults.push({ route, status, error, elapsedMs: Date.now() - startedAt });
  }

  await browser.close();

  const rscFailures = consoleErrors.filter(message => message.includes("Failed to fetch RSC payload"));
  return {
    run,
    browser: browserType,
    base,
    intercept,
    settleMs,
    routes: routeResults,
    prefetches,
    requestFailures: failures,
    consoleErrors,
    rscFailureCount: rscFailures.length,
    rscFailureRoutes: rscFailures.map(message => {
      const match = message.match(/Failed to fetch RSC payload for (\S+?)\.\s/);
      return match ? match[1] : message;
    }),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.base || !LAUNCHERS[options.browser]) {
    process.stderr.write("usage: node scripts/rsc-prefetch-probe.mjs --base <url> [--runs 20] [--browser firefox|chromium|webkit] [--out file.jsonl]\n");
    process.exit(2);
  }
  writeFileSync(options.out, "");

  let runsWithRscFailure = 0;
  for (let run = 1; run <= options.runs; run += 1) {
    const result = await probeOnce(options.browser, options.base, run, options.intercept, options.settleMs);
    appendFileSync(options.out, JSON.stringify(result) + "\n");
    if (result.rscFailureCount > 0) runsWithRscFailure += 1;
    process.stdout.write(
      `run ${String(run).padStart(2, "0")}/${options.runs}  rsc-failures=${result.rscFailureCount}` +
      `  prefetches=${result.prefetches.length}` +
      `  non-200=${result.prefetches.filter(p => p.status !== undefined && p.status !== 200).length}` +
      `  request-failures=${result.requestFailures.length}\n`,
    );
  }

  process.stdout.write(
    `\n${options.browser} against ${options.base}\n` +
    `runs: ${options.runs}\n` +
    `runs with at least one RSC prefetch failure: ${runsWithRscFailure}\n` +
    `detail: ${options.out}\n`,
  );
}

await main();
