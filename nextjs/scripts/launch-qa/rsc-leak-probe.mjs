#!/usr/bin/env node
/*
  RSC-leak probe (Phase 4 follow-ups (f), 2026-10-19).

  PR #157 found tavonel.com/benchmarks printing a scoring machine's absolute path, OS user name
  included, twice: once in the HTML and once in the RSC payload, where the raw campaign note was
  a React key. A page check reads what a browser shows; the key never shows. So this reads what
  the server sends instead: every prerendered HTML document and every RSC payload a production
  build writes under .next, and fails on anything shaped like a path on the machine that built it.

  What it looks for:
    - a drive-letter path, `C:/` or `D:\` and every other letter, either slash;
    - `/Users/` (macOS) and `/home/` (Linux);
    - the OS user name of the account running the probe, read from USER, USERNAME or LOGNAME at
      run time. It is never written here: a name in this file would be the leak it looks for, and
      the CI runner's account is not the author's.

  How it runs:
    node scripts/launch-qa/rsc-leak-probe.mjs              rm -rf .next, build with the fixture env, scan
    node scripts/launch-qa/rsc-leak-probe.mjs --reuse-build scan the .next an earlier step built
    --dir <path> scans another build directory (the fixture test uses it).

  The fixture env is the Playwright webServer's (playwright.config.ts): the test Supabase origin,
  its anon key name and PLAYWRIGHT_LOCAL_HTTP. Launch QA's product-qa job reuses the build its
  Playwright step just made with that env.

  Fails closed: no user name in the environment, no build directory, or a build with nothing to
  read is a failure, because a probe that read nothing has proved nothing.
*/
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const nextjsDir = fileURLToPath(new URL("../..", import.meta.url));

export const FIXTURE_ENV = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "foundation-browser-e2e-anon-key",
  PLAYWRIGHT_LOCAL_HTTP: "1",
});

/**
 * The OS user name from the environment, or null. Never a literal.
 * @param {Record<string, string | undefined>} [env]
 */
export function userNameFromEnv(env = process.env) {
  const name = [env.USER, env.USERNAME, env.LOGNAME].map((value) => value?.trim()).find(Boolean);
  return name || null;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The needles, with the user name matched as a whole name rather than inside a longer word.
 * @param {string | null} userName
 * @returns {Array<[string, RegExp]>}
 */
export function leakPatterns(userName) {
  if (!userName) throw new Error("rsc-leak-probe: no OS user name in USER, USERNAME or LOGNAME");
  return [
    ["a drive-letter path", /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/g],
    ["a macOS home path", /\/Users\//g],
    ["a Linux home path", /\/home\//g],
    ["the OS user name", new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(userName)}(?![A-Za-z0-9_-])`, "gi")],
  ];
}

/** Every prerendered HTML document and RSC payload under a build directory, `cache/` excluded. */
export function payloadFiles(buildDir) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (dir === buildDir && name === "cache") continue;
        walk(path);
      } else if (/\.(html|rsc)$/.test(name)) {
        found.push(path);
      }
    }
  };
  walk(buildDir);
  return found.sort();
}

/** Scan a build directory. Returns what was read and every hit, with a little context. */
export function scanBuild(buildDir, { userName }) {
  const patterns = leakPatterns(userName);
  const files = payloadFiles(buildDir);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [label, pattern] of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const at = match.index ?? 0;
        hits.push({
          file: relative(buildDir, file).split(sep).join("/"),
          label,
          context: text.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, " "),
        });
      }
    }
  }
  return { scanned: files.length, hits };
}

function build() {
  rmSync(join(nextjsDir, ".next"), { recursive: true, force: true });
  const next = join(nextjsDir, "node_modules", "next", "dist", "bin", "next");
  const result = spawnSync(process.execPath, [next, "build"], {
    cwd: nextjsDir,
    env: { ...process.env, ...FIXTURE_ENV },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`rsc-leak-probe: next build exited ${result.status}`);
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const dirFlag = argv.indexOf("--dir");
  const buildDir = resolve(dirFlag >= 0 ? argv[dirFlag + 1] ?? "" : join(nextjsDir, ".next"));
  const userName = userNameFromEnv(env);
  if (!userName) {
    console.error("rsc-leak-probe: FAIL, no OS user name in USER, USERNAME or LOGNAME to look for");
    return 1;
  }
  if (!argv.includes("--reuse-build") && dirFlag < 0) build();
  if (!existsSync(buildDir)) {
    console.error(`rsc-leak-probe: FAIL, no build directory at ${buildDir}`);
    return 1;
  }
  const { scanned, hits } = scanBuild(buildDir, { userName });
  for (const hit of hits) console.error(`rsc-leak-probe: ${hit.file}: ${hit.label}: …${hit.context}…`);
  console.log(JSON.stringify({ probe: "rsc-leak", scanned, hits: hits.length }));
  if (scanned === 0) {
    console.error("rsc-leak-probe: FAIL, no HTML or RSC payload under the build directory");
    return 1;
  }
  if (hits.length > 0) {
    console.error(`rsc-leak-probe: FAIL, ${hits.length} machine path or user name occurrence(s) in ${scanned} payloads`);
    return 1;
  }
  console.log(`rsc-leak-probe: PASS, ${scanned} HTML and RSC payloads carry no machine path and no OS user name`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
