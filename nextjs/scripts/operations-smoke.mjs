import { appendFile } from "node:fs/promises";

const origin = (process.env.TAVONEL_ORIGIN || "https://tavonel.com").replace(/\/$/, "");
const checks = [
  ["home", "/", 200],
  ["health", "/api/healthz", 200],
  ["ready", "/api/readyz", 200],
  ["status", "/status", 200],
  ["privacy", "/privacy", 200],
  ["terms", "/terms", 200],
  ["refunds", "/refunds", 200],
  ["sitemap", "/sitemap.xml", 200],
];

const failed = [];
for (const [name, path, expected] of checks) {
  try {
    const response = await fetch(`${origin}${path}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "TAVONEL-operations-smoke/1.0" },
    });
    const ok = response.status === expected;
    if (!ok) failed.push(name);
    console.log(JSON.stringify({ name, path, status: response.status, ok }));
  } catch (error) {
    failed.push(name);
    console.error(JSON.stringify({ name, path, ok: false, error: error instanceof Error ? error.message : "request_failed" }));
  }
}

// The workflow's `if: failure()` step pages the on-call destination with these
// names, so a red run says what broke rather than only that something did.
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `failed=${failed.join(",")}\n`, "utf8");
}
process.exitCode = failed.length > 0 ? 1 : 0;
