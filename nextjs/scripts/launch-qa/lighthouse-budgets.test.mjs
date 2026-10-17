import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
  The real launch gate, run end to end against a stand-in for Lighthouse (UX-L0, UX-PLAN-2026-10-17
  §8.2): a `pnpm` shim first on PATH answers `pnpm dlx lighthouse ...` by writing a report whose
  resource-summary script row the test chooses per route. Everything else -- the health check,
  sampling, medians, the ratchet and the exit code -- is the shipped script.
*/
const script = fileURLToPath(new URL("./lighthouse-budgets.mjs", import.meta.url));
const nextjsDir = fileURLToPath(new URL("../..", import.meta.url));

const fakeLighthouse = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const route = new URL(args.find((arg) => arg.startsWith("http"))).pathname;
const output = args.find((arg) => arg.startsWith("--output-path=")).slice("--output-path=".length);
const plan = JSON.parse(process.env.FAKE_SCRIPT_BYTES);
// A number is that route's script bytes; "missing" drops the script row; "slow-lcp" misses LCP.
const entry = route in plan ? plan[route] : 1000;
const items = entry === "missing"
  ? [{ resourceType: "image", transferSize: 10 }]
  : [{ resourceType: "script", transferSize: typeof entry === "number" ? entry : 1000 }];
writeFileSync(output, JSON.stringify({
  categories: { performance: { score: 1 }, accessibility: { score: 1 }, "best-practices": { score: 1 }, seo: { score: 1 } },
  audits: {
    "largest-contentful-paint": { numericValue: entry === "slow-lcp" ? 5000 : 1000 },
    "cumulative-layout-shift": { numericValue: 0 },
    "total-blocking-time": { numericValue: 0 },
    "resource-summary": { details: { items } },
  },
}));
`;

let shimDir;
let server;
let baseUrl;

beforeAll(async () => {
  shimDir = await mkdtemp(join(tmpdir(), "tavonel-lighthouse-shim-"));
  await writeFile(join(shimDir, "fake-lighthouse.mjs"), fakeLighthouse);
  await writeFile(join(shimDir, "pnpm.cmd"), `@node "%~dp0fake-lighthouse.mjs" %*\r\n`);
  await writeFile(join(shimDir, "pnpm"), `#!/bin/sh\nexec node "$(dirname "$0")/fake-lighthouse.mjs" "$@"\n`);
  await chmod(join(shimDir, "pnpm"), 0o755);
  server = createServer((request, response) => {
    response.writeHead(request.url === "/api/healthz" ? 200 : 404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(shimDir, { recursive: true, force: true });
});

function runGate(plan) {
  const env = { ...process.env, QA_BASE_URL: baseUrl, QA_SERVER_MODE: "production", FAKE_SCRIPT_BYTES: JSON.stringify(plan) };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${shimDir}${delimiter}${env[pathKey] ?? ""}`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: nextjsDir, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const summaries = stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
      resolve({ code, stdout, stderr, summaries });
    });
  });
}

describe("lighthouse-budgets script ratchet", { timeout: 180_000 }, () => {
  let ratchet;

  it("prints script transfer bytes for every route and passes under the ratchet", async () => {
    const run = await runGate({});
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("Lighthouse launch budgets passed.");
    const routes = run.summaries.map((summary) => summary.route);
    for (const route of ["/", "/ko", "/pricing", "/explore"]) expect(routes).toContain(route);
    for (const summary of run.summaries) {
      expect(summary.scriptTransferBytes).toBe(1000);
      expect(summary.scriptTransferSamples).toEqual([1000, 1000, 1000]);
    }
    ratchet = Object.fromEntries(run.summaries.filter((s) => s.scriptRatchetBytes !== null).map((s) => [s.route, s.scriptRatchetBytes]));
    expect(Object.keys(ratchet).sort()).toEqual(["/", "/ko"]);
    for (const value of Object.values(ratchet)) expect(Number.isInteger(value) && value > 0).toBe(true);
  });

  it("passes at exactly the ratchet", async () => {
    const run = await runGate({ "/": ratchet["/"], "/ko": ratchet["/ko"] });
    expect(run.code).toBe(0);
    expect(run.summaries.find((s) => s.route === "/").over).toEqual([]);
  });

  it("exits 1 when / or /ko is one byte over its ratchet", async () => {
    const run = await runGate({ "/": ratchet["/"] + 1, "/ko": ratchet["/ko"] + 1 });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("LIGHTHOUSE_PRODUCT_FAILURE");
    expect(run.stderr).toContain(`- / script-transfer-bytes ${ratchet["/"] + 1} > ${ratchet["/"]}`);
    expect(run.stderr).toContain(`- /ko script-transfer-bytes ${ratchet["/ko"] + 1} > ${ratchet["/ko"]}`);
    // /ko is measure-only for its other budgets; its ratchet miss must not be reported as ignored.
    expect(run.summaries.find((s) => s.route === "/ko").enforced).toBe(false);
    expect(run.stderr).not.toContain("LIGHTHOUSE_MEASURED_NOT_ENFORCED");
  });

  it("still reports a measure-only route's ordinary budget miss as not enforced", async () => {
    const run = await runGate({ "/ko": "slow-lcp" });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("LIGHTHOUSE_MEASURED_NOT_ENFORCED:\n- /ko largest-contentful-paint 5000 > 3000");
  });

  it("does not gate script bytes on routes without a ratchet", async () => {
    const run = await runGate({ "/explore": 10_000_000 });
    expect(run.code).toBe(0);
    expect(run.summaries.find((s) => s.route === "/explore")).toMatchObject({ scriptTransferBytes: 10_000_000, scriptRatchetBytes: null });
  });

  it("fails closed as a tool blocker when a report has no script row", async () => {
    const run = await runGate({ "/": "missing" });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("LIGHTHOUSE_TOOL_BLOCKER: / produced 0/3 complete reports");
    expect(run.stdout).not.toContain("Lighthouse launch budgets passed.");
  });
});
