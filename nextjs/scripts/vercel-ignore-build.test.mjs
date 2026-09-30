import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decide } from "./vercel-ignore-build.mjs";

const app = ["nextjs/app/page.tsx"];

test("production always builds, even on automation branches or docs-only commits", () => {
  assert.equal(decide({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "codex/x" }, ["docs/a.md"]).build, true);
  assert.equal(decide({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }, null).build, true);
});

test("automation branch previews skip unless the commit opts in", () => {
  for (const ref of ["codex/masterplan-checkpoint-2026-09-30", "dependabot/npm_and_yarn/x"]) {
    assert.equal(decide({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref }, app).build, false);
    assert.equal(decide({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_COMMIT_MESSAGE: "fix: y [preview]" }, app).build, true);
    assert.equal(decide({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_COMMIT_MESSAGE: "fix: y\n\nBody explains the [preview] token." }, app).build, false);
  }
});

test("other previews skip only known documentation-only commits", () => {
  const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "agent/launch-qa-overflow" };
  assert.equal(decide(env, ["docs/audit/X.md", "README.md"]).build, false);
  assert.equal(decide(env, ["docs/audit/X.md", ...app]).build, true);
  assert.equal(decide(env, ["nextjs/docs-helper.ts"]).build, true);
  assert.equal(decide(env, []).build, true);
  assert.equal(decide(env, null).build, true);
});

test("lookalike branch names are not treated as automation branches", () => {
  for (const ref of ["codexfoo/x", "feature/codex/x", "main"]) {
    assert.equal(decide({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref }, app).build, true);
  }
});

test("CLI exit codes follow Vercel's contract: 0 skips, 1 builds", () => {
  const script = fileURLToPath(new URL("./vercel-ignore-build.mjs", import.meta.url));
  const run = env => spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  assert.equal(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/x" }).status, 0);
  assert.equal(run({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }).status, 1);
});
