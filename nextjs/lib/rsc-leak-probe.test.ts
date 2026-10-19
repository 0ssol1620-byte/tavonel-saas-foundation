import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { leakPatterns, payloadFiles, scanBuild, userNameFromEnv } from "../scripts/launch-qa/rsc-leak-probe.mjs";

/*
  The RSC-leak probe (Phase 4 follow-ups (f)), against planted build directories.

  Failing first: each case plants the leak and asserts the probe fails on it before the clean
  tree is asserted to pass, so a probe that stopped matching shows up red instead of quietly
  green. The CLI runs end to end with `--dir`, which is how Launch QA's exit code is decided.

  It lives under lib/ for the same reason `launch-qa-script-ratchet.test.ts` does: vitest.config.ts
  is a locked discovery frame whose lib glob already matches it.
*/
const script = fileURLToPath(new URL("../scripts/launch-qa/rsc-leak-probe.mjs", import.meta.url));
const BACKSLASH = String.fromCharCode(92);
const USER = "probe-fixture-user";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function plantBuild(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rsc-leak-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const CLEAN = {
  "server/app/benchmarks.html": "<html><body><p>A scoring-machine path is shown as [local path removed].</p></body></html>",
  "server/app/benchmarks.rsc": '1:I["123",[],"default"]\n0:["$","p",null,{"children":"https://tavonel.com/developer/channel.json"}]\n',
  "server/app/docs/mcp.html": '<pre><code>"args": ["/absolute/path/to/tavonel-mcp.mjs"]</code></pre><p>%APPDATA%' + BACKSLASH + "Claude</p>",
  "server/app/docs/mcp.segments/_tree.segment.rsc": '0:{"buildId":"abc","tree":{"segment":"docs"}}',
};

function runCli(dir: string, env: Record<string, string | undefined>) {
  const result = spawnSync(process.execPath, [script, "--dir", dir], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("the RSC-leak probe", () => {
  it.each([
    ["a Windows path with a forward slash", "server/app/benchmarks.rsc", '0:["$","li","C:/Users/someone/box_results/",{}]', "a drive-letter path"],
    ["a Windows path, JSON-escaped", "server/app/benchmarks.rsc", `0:["$","li","D:${BACKSLASH}${BACKSLASH}CodexProjects${BACKSLASH}${BACKSLASH}x",{}]`, "a drive-letter path"],
    ["a macOS home", "server/app/guide.html", "<p>/Users/someone/notes</p>", "a macOS home path"],
    ["a Linux home", "server/app/guide.html", "<p>/home/ci/work</p>", "a Linux home path"],
    ["the user name alone", "server/app/ko/guide.html", `<p>recorded by ${USER.toUpperCase()}</p>`, "the OS user name"],
  ])("fails on %s, and passes once it is gone", (_name, file, leak, label) => {
    const leaky = plantBuild({ ...CLEAN, [file]: leak });
    const found = scanBuild(leaky, { userName: USER });
    expect(found.hits.map((hit) => hit.label)).toContain(label);
    expect(found.hits[0].file).toBe(file);
    expect(runCli(leaky, { USER }).code).toBe(1);

    const clean = plantBuild(CLEAN);
    expect(scanBuild(clean, { userName: USER })).toEqual({ scanned: 4, hits: [] });
    expect(runCli(clean, { USER }).code).toBe(0);
  });

  it("reads HTML and RSC payloads, segment payloads included, and leaves the build cache alone", () => {
    const root = plantBuild({ ...CLEAN, "cache/fetch-cache/x.html": "C:/Users/someone", "server/app/page.js": "/home/x", "server/app/x.meta": "/home/x" });
    expect(payloadFiles(root).map((path: string) => path.slice(root.length + 1).split(BACKSLASH).join("/"))).toEqual([
      "server/app/benchmarks.html",
      "server/app/benchmarks.rsc",
      "server/app/docs/mcp.html",
      "server/app/docs/mcp.segments/_tree.segment.rsc",
    ]);
    expect(scanBuild(root, { userName: USER }).hits).toEqual([]);
  });

  it("matches the user name as a name, not inside a longer word", () => {
    const [, , , [, pattern]] = leakPatterns("runner");
    expect("built by runner on CI".match(pattern)).toHaveLength(1);
    expect("/home/runner/work".match(pattern)).toHaveLength(1);
    expect("a frontrunners' race".match(pattern)).toBeNull();
  });

  it("fails closed: no user name to look for, no build, or nothing to read", () => {
    expect(userNameFromEnv({})).toBeNull();
    expect(userNameFromEnv({ USERNAME: " someone " })).toBe("someone");
    expect(() => leakPatterns(null)).toThrow("no OS user name");
    const clean = plantBuild(CLEAN);
    // Empty rather than absent: Windows (libuv) copies USERNAME into a child that lacks it.
    const nameless = { USER: "", USERNAME: "", LOGNAME: "" };
    expect(runCli(clean, nameless).out).toContain("no OS user name in USER, USERNAME or LOGNAME");
    expect(runCli(clean, nameless).code).toBe(1);
    expect(runCli(join(clean, "missing"), { USER }).code).toBe(1);
    const empty = plantBuild({ "server/app/page.js": "" });
    const run = runCli(empty, { USER });
    expect(run.code).toBe(1);
    expect(run.out).toContain("no HTML or RSC payload");
  });

  it("names no user and no machine of its own", () => {
    const source = readFileSync(script, "utf8");
    expect(source).not.toContain(userInfo().username);
    // GitHub-hosted runners run as `runner`: the CI name must not be in the prose either, or CI scans its own source.
    expect(source).not.toMatch(/runner/i);
    expect(source).toContain("env.USER, env.USERNAME, env.LOGNAME");
  });
});
