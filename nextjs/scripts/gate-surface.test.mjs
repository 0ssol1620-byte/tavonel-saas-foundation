import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GATE_SURFACE_RULES_PATH, gateSurfaceDigest, gateSurfaceOfCommit } from "./gate-surface.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const rules = JSON.parse(readFileSync(new URL("./gate-surface-rules.json", import.meta.url), "utf8"));
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const blob = (n) => String(n).padStart(40, "0");
const tree = (entries) => entries.map(([path, n]) => `100644 blob ${blob(n)}\t${path}`).join("\0") + "\0";
const base = [
  [GATE_SURFACE_RULES_PATH, 1],
  ["shared/scopedCustomerDataGate.ts", 2],
  ["nextjs/components/landing-v2/landing-page.tsx", 3],
  ["docs/policy/TERMS.md", 4],
  ["nextjs/app/benchmarks/gdp-pdf/page.tsx", 5],
  ["supabase/migrations/20260930070000_processing_qualification_stage.sql", 6],
];
const change = (path, n) => tree(base.map(([p, b]) => [p, p === path ? n : b]));
const before = gateSurfaceDigest(rules, tree(base));

test("a presentational change keeps the digest; a gate change, a policy change or a rules change moves it", () => {
  assert.match(before, DIGEST);
  assert.equal(gateSurfaceDigest(rules, change("nextjs/components/landing-v2/landing-page.tsx", 9)), before);
  assert.equal(gateSurfaceDigest(rules, change("nextjs/app/benchmarks/gdp-pdf/page.tsx", 9)), before);
  for (const path of ["shared/scopedCustomerDataGate.ts", "docs/policy/TERMS.md", GATE_SURFACE_RULES_PATH,
    "supabase/migrations/20260930070000_processing_qualification_stage.sql"]) {
    assert.notEqual(gateSurfaceDigest(rules, change(path, 9)), before, path);
  }
  // A new server path anywhere is surface by default; a route under a presentational folder too.
  assert.notEqual(gateSurfaceDigest(rules, tree([...base, ["nextjs/lib/new-upload-path.ts", 7]])), before);
  assert.notEqual(gateSurfaceDigest(rules, tree([...base, ["nextjs/app/benchmarks/x/route.ts", 7]])), before);
  assert.equal(gateSurfaceDigest(rules, tree([...base, ["nextjs/e2e/new.spec.ts", 7]])), before);
});

test("no rules file, foreign rules or a malformed tree yields null, which inherits nothing", () => {
  assert.equal(gateSurfaceDigest(rules, tree(base.slice(1))), null);
  assert.equal(gateSurfaceDigest({ ...rules, schemaVersion: "other" }, tree(base)), null);
  assert.equal(gateSurfaceDigest({ ...rules, presentational: "x" }, tree(base)), null);
  assert.equal(gateSurfaceDigest(rules, "no-tab-here\0"), null);
  assert.equal(gateSurfaceOfCommit(root, "0".repeat(40)), null);
  assert.equal(gateSurfaceOfCommit(root, "HEAD"), null);
});

test("PR #174's own changes are presentational; the gate's files are surface", () => {
  const presentational = rules.presentational.map((source) => new RegExp(source));
  const always = rules.alwaysSurface.map((source) => new RegExp(source));
  const inSurface = (path) => always.some((rule) => rule.test(path)) || !presentational.some((rule) => rule.test(path));
  for (const path of [
    "nextjs/app/benchmarks/gdp-pdf/page.tsx", "nextjs/app/wanted-sans-korean.css",
    "nextjs/components/landing-v2/specimen-strip.tsx", "nextjs/e2e/specimen-strip.spec.ts",
    "nextjs/lib/changelog.ts", "nextjs/lib/compiler-release.ts", "nextjs/lib/gdp-pdf-page-data.ts",
    "nextjs/lib/specimen-sources.json", "nextjs/lib/specimen-sources.ts", "nextjs/lib/brand-copy.test.ts",
    "nextjs/scripts/repair-scope.mjs", "nextjs/public/film/poster.avif",
  ]) assert.equal(inSurface(path), false, path);
  for (const path of [
    "shared/scopedCustomerDataGate.ts", "shared/uskcEnums.ts", "nextjs/lib/customer-data-admission.ts",
    "nextjs/lib/scoped-customer-data-gate-store.ts", "nextjs/lib/processing-workspace-grant.ts",
    "nextjs/lib/archive-expand.ts", "nextjs/app/api/access/bootstrap/route.ts", "nextjs/next.config.mjs",
    "nextjs/vercel.json", "nextjs/package.json", "pnpm-lock.yaml", "nextjs/public/policy/processing-terms-2026-09-30.json",
    "docs/policy/FOUNDER_PACKET_CA_2026-09-11.md", "supabase/migrations/20261027120000_release_gate_surface_continuity.sql",
    "supabase/tests/release_gate_surface_continuity.sql", "nextjs/scripts/gate-surface.mjs", GATE_SURFACE_RULES_PATH,
    "nextjs/app/workspace/page.tsx",
  ]) assert.equal(inSurface(path), true, path);
});

test("this checkout's HEAD has a surface digest, computed from blob ids", () => {
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const digest = gateSurfaceOfCommit(root, head);
  assert.match(digest, DIGEST);
  assert.equal(gateSurfaceOfCommit(root, head), digest);
});
