import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GATE_SURFACE_RULES_PATH, deploymentGateSurface, gateSurfaceDigest, gateSurfaceOfCommit,
} from "./gate-surface.mjs";
import {
  RELEASE_GATE_REPORT_SCHEMA,
  RELEASE_MAX_AGE_MS,
  checkReleaseGate,
  parseOptions,
  readReleaseRows,
  run,
} from "./release-gate-check.mjs";

// After the import above: the script registered the extensionless-import resolver.
const gate = await import("../../shared/scopedCustomerDataGate.ts");

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const NOW = new Date("2026-10-17T12:00:00.000Z");
const DAY = 86_400_000;
const at = (ms) => new Date(ms).toISOString();
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests-only-0123456789",
};

const evidenceFor = (facts, checkedAt) =>
  facts.map((precondition) => ({ precondition, satisfied: true, evidence: `receipt:${precondition}`, checkedAt }));

/** A stored production row whose digest the gate itself computed. */
function productionRow({ scope = "direct_upload", sha = SHA, evaluatedMs, recordedMs = evaluatedMs } = {}) {
  const evaluatedAt = at(evaluatedMs);
  const evidence = evidenceFor(gate.requiredReleaseEvidence(scope), at(evaluatedMs - DAY));
  const decision = gate.evaluateScopedRelease({ scope, releaseRevision: sha, evidence, now: evaluatedAt });
  assert.equal(decision.allowed, true);
  return {
    schema_version: gate.SCOPED_CUSTOMER_DATA_GATE_SCHEMA, stage: "production", scope, release_revision: sha,
    allowed: true, receipt_sha256: decision.receiptSha256, evidence, missing: [],
    evaluated_at: evaluatedAt, recorded_at: at(recordedMs),
    qualification_workspace_key: null, qualification_expires_at: null,
  };
}

function qualificationRow({ evaluatedMs, workspaceId = "pilot-969dc192daa24119" }) {
  const evaluatedAt = at(evaluatedMs);
  const expiresAt = at(evaluatedMs + 45 * 60_000);
  const facts = gate.requiredReleaseEvidence("direct_upload").filter((fact) => fact !== gate.QUALIFICATION_PENDING);
  const evidence = evidenceFor(facts, at(evaluatedMs - DAY));
  const decision = gate.evaluateQualificationRelease({
    releaseRevision: SHA, workspaceId, expiresAt, evidence, now: evaluatedAt,
  });
  assert.equal(decision.allowed, true);
  return {
    schema_version: gate.QUALIFICATION_GATE_SCHEMA, stage: "qualification", scope: "direct_upload",
    release_revision: SHA, allowed: true, receipt_sha256: decision.receiptSha256, evidence,
    missing: [gate.QUALIFICATION_PENDING], evaluated_at: evaluatedAt, recorded_at: evaluatedAt,
    qualification_workspace_key: workspaceId, qualification_expires_at: expiresAt,
  };
}

const check = (rows, extra = {}) =>
  checkReleaseGate({ rows, sha: SHA, scopes: ["direct_upload"], now: NOW, ...extra });

test("a verified production release for the SHA is ready and says when it expires", () => {
  const evaluatedMs = NOW.getTime() - 2 * DAY;
  const report = check([productionRow({ evaluatedMs })]);
  assert.equal(report.schemaVersion, RELEASE_GATE_REPORT_SCHEMA);
  assert.equal(report.releaseRevision, SHA);
  assert.equal(report.ready, true);
  assert.deepEqual(report.missingScopes, []);
  assert.deepEqual(report.expiringScopes, []);
  assert.deepEqual(report.scopes, [{
    scope: "direct_upload", status: "released", evaluatedAt: at(evaluatedMs),
    expiresAt: at(evaluatedMs + RELEASE_MAX_AGE_MS), remainingHours: 28 * 24,
  }]);
});

test("a scope without a row for this SHA is reported missing with the facts it needs", () => {
  const evaluatedMs = NOW.getTime() - DAY;
  const rows = [
    productionRow({ evaluatedMs }),
    // A connector release for another deployment says nothing about this one.
    productionRow({ scope: "connector", sha: OTHER_SHA, evaluatedMs }),
  ];
  const report = check(rows, { scopes: ["direct_upload", "connector"] });
  assert.equal(report.ready, false);
  assert.deepEqual(report.missingScopes, ["connector"]);
  const connector = report.scopes.find((entry) => entry.scope === "connector");
  assert.equal(connector.status, "missing");
  assert.equal(connector.code, "SCOPED_RELEASE_NOT_FOUND");
  assert.deepEqual(connector.requiredFacts, [...gate.requiredReleaseEvidence("connector")]);
  assert.equal(connector.requiredFacts.length, 17);

  const none = check([productionRow({ sha: OTHER_SHA, evaluatedMs })]);
  assert.deepEqual(none.missingScopes, ["direct_upload"]);
  assert.equal(none.scopes[0].requiredFacts.length, 12);
  assert.ok(none.scopes[0].requiredFacts.includes("founder_approval_receipt_recorded"));
});

test("a release inside the warning window is expiring, not ready; the window is configurable", () => {
  const evaluatedMs = NOW.getTime() - 25 * DAY;
  const report = check([productionRow({ evaluatedMs })], { warnDays: 7 });
  assert.equal(report.ready, false);
  assert.deepEqual(report.missingScopes, []);
  assert.deepEqual(report.expiringScopes, ["direct_upload"]);
  assert.equal(report.scopes[0].status, "expiring");
  assert.equal(report.scopes[0].remainingHours, 5 * 24);
  assert.equal(check([productionRow({ evaluatedMs })], { warnDays: 4 }).ready, true);
});

test("a release older than 30 days is expired and counts as missing", () => {
  const report = check([productionRow({ evaluatedMs: NOW.getTime() - 31 * DAY })]);
  assert.deepEqual(report.missingScopes, ["direct_upload"]);
  assert.equal(report.scopes[0].status, "expired");
  assert.equal(report.scopes[0].code, "SCOPED_RELEASE_STALE");
});

test("the expiry constant is the gate's: valid at exactly 30 days, stale one millisecond later", () => {
  const evaluatedMs = NOW.getTime() - 10 * DAY;
  const row = productionRow({ evaluatedMs });
  const subject = { scope: "direct_upload", releaseRevision: SHA, workspaceId: "" };
  assert.equal(gate.verifyStoredRelease(row, subject, evaluatedMs + RELEASE_MAX_AGE_MS).ok, true);
  assert.deepEqual(gate.verifyStoredRelease(row, subject, evaluatedMs + RELEASE_MAX_AGE_MS + 1),
    { ok: false, code: "SCOPED_RELEASE_STALE" });
});

test("a later refusal outranks an earlier release and names only known missing facts", () => {
  const evaluatedMs = NOW.getTime() - 3 * DAY;
  const refusal = {
    ...productionRow({ evaluatedMs }), allowed: false, receipt_sha256: null, evidence: [],
    missing: ["founder_approval_receipt_recorded", "not_a_fact\u001b[31m"],
    recorded_at: at(evaluatedMs + 60_000),
  };
  const report = check([productionRow({ evaluatedMs }), refusal]);
  assert.deepEqual(report.missingScopes, ["direct_upload"]);
  assert.deepEqual(report.scopes[0], {
    scope: "direct_upload", status: "refused", code: "SCOPED_RELEASE_REFUSED",
    missingFacts: ["founder_approval_receipt_recorded"],
  });
  // Recorded in the same instant, the refusal still wins (the gate orders `allowed.asc`).
  const tie = check([productionRow({ evaluatedMs }), { ...refusal, recorded_at: at(evaluatedMs) }]);
  assert.equal(tie.scopes[0].status, "refused");
});

test("a row whose digest does not verify is invalid, never released", () => {
  const row = { ...productionRow({ evaluatedMs: NOW.getTime() - DAY }), receipt_sha256: `sha256:${"0".repeat(64)}` };
  const report = check([row]);
  assert.deepEqual(report.missingScopes, ["direct_upload"]);
  assert.deepEqual(report.scopes[0], { scope: "direct_upload", status: "invalid", code: "SCOPED_RELEASE_INVALID" });
});

test("a qualification row is reported as qualification only, never as a release", () => {
  const evaluatedMs = NOW.getTime() - 10 * 60_000;
  const report = check([qualificationRow({ evaluatedMs })]);
  assert.equal(report.ready, false);
  assert.deepEqual(report.missingScopes, ["direct_upload"]);
  assert.equal(report.scopes[0].status, "qualification_only");
  assert.equal(report.scopes[0].workspaceKey, "pilot-969dc192daa24119");
  assert.deepEqual(report.scopes[0].missingFacts, [gate.QUALIFICATION_PENDING]);
  assert.equal(report.scopes[0].expiresAt, at(evaluatedMs + 45 * 60_000));
});

test("the report never carries evidence text, so a receipt string cannot leak through it", () => {
  const report = check([productionRow({ evaluatedMs: NOW.getTime() - DAY })], { scopes: ["direct_upload", "connector"] });
  assert.equal(JSON.stringify(report).includes("receipt:"), false);
});

test("options fail closed: SHA shape, scope names, warning window, unknown flags", () => {
  assert.deepEqual(parseOptions(["--sha", SHA]), { sha: SHA, scopes: ["direct_upload"], warnDays: 7 });
  assert.deepEqual(parseOptions(["--", "--sha", SHA, "--scope", "connector", "--scope", "connector", "--warn-days", "0"]),
    { sha: SHA, scopes: ["connector"], warnDays: 0 });
  assert.throws(() => parseOptions([]), /--sha/);
  assert.throws(() => parseOptions(["--sha", SHA.toUpperCase()]), /--sha/);
  assert.throws(() => parseOptions(["--sha", SHA.slice(1)]), /--sha/);
  assert.throws(() => parseOptions(["--sha", SHA, "--scope", "everything"]), /--scope/);
  assert.throws(() => parseOptions(["--sha", SHA, "--warn-days", "31"]), /--warn-days/);
  assert.throws(() => parseOptions(["--sha", SHA, "--warn-days", "1.5"]), /--warn-days/);
  assert.throws(() => parseOptions(["--sha", SHA, "--write"]), /Unknown option/);
  assert.throws(() => checkReleaseGate({ rows: [], sha: "HEAD", scopes: ["direct_upload"], now: NOW }), /--sha/);
});

/** Records every request the CLI path makes; answers with `respond`. */
function recordFetch(respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method ?? "GET").toUpperCase(), body: init.body });
    return respond(String(url));
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the CLI path makes exactly one GET per scope with the gate's query, and zero write calls", async () => {
  const row = productionRow({ evaluatedMs: NOW.getTime() - DAY });
  const fake = recordFetch((url) => json(url.includes("scope=eq.direct_upload") ? [row] : []));
  try {
    const report = await run(["--sha", SHA, "--scope", "direct_upload", "--scope", "connector"], ENV, NOW);
    assert.deepEqual(report.missingScopes, ["connector"]);
    assert.equal(report.scopes[0].status, "released");
  } finally {
    fake.restore();
  }
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, 0, "write calls");
  for (const call of fake.calls) {
    const url = new URL(call.url);
    assert.equal(call.body, undefined);
    assert.equal(url.pathname, "/rest/v1/customer_data_release_decisions");
    assert.equal(url.searchParams.get("select"), gate.RELEASE_COLUMNS);
    assert.equal(url.searchParams.get("release_revision"), `eq.${SHA}`);
    assert.equal(url.searchParams.get("order"), "recorded_at.desc,allowed.asc,evaluated_at.desc");
    assert.equal(url.searchParams.get("limit"), "1");
  }
});

test("a store failure aborts the check instead of reporting a missing release, still with zero writes", async () => {
  const failing = recordFetch(() => json({ message: "secret detail" }, 503));
  try {
    await assert.rejects(run(["--sha", SHA], ENV, NOW), (error) => {
      assert.match(error.message, /HTTP 503/);
      assert.equal(error.message.includes("secret detail"), false);
      return true;
    });
  } finally {
    failing.restore();
  }
  assert.equal(failing.calls.length, 1);
  assert.equal(failing.calls[0].method, "GET");

  const malformed = recordFetch(() => json({ rows: [] }));
  try {
    await assert.rejects(run(["--sha", SHA], ENV, NOW), /unexpected response body/);
  } finally {
    malformed.restore();
  }
  assert.equal(malformed.calls.every((call) => call.method === "GET"), true);
});

test("without store credentials nothing is requested", async () => {
  const fake = recordFetch(() => json([]));
  try {
    await assert.rejects(run(["--sha", SHA], {}, NOW), /SUPABASE_SERVICE_ROLE_KEY/);
    await assert.rejects(
      readReleaseRows({ url: "https://x.example", serviceRoleKey: "k".repeat(32) }, SHA, ["direct_upload"],
        async () => new Response("no", { status: 401 })),
      /HTTP 401/,
    );
  } finally {
    fake.restore();
  }
  assert.equal(fake.calls.length, 0);
});

test("the CLI exits 2 with no report when it cannot run", () => {
  const script = fileURLToPath(new URL("./release-gate-check.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, "--sha", SHA], {
    env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "" },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
});

// D-05 (docs/adr/0006): a production row recorded with a gate-surface digest covers equal-surface SHAs.
const SURFACE = `sha256:${"5".repeat(64)}`;
function surfacedRow({ sha = OTHER_SHA, evaluatedMs, surface = SURFACE }) {
  const evaluatedAt = at(evaluatedMs);
  const evidence = evidenceFor(gate.requiredReleaseEvidence("direct_upload"), at(evaluatedMs - DAY));
  const decision = gate.evaluateScopedRelease({ scope: "direct_upload", releaseRevision: sha, evidence, now: evaluatedAt,
    gateSurfaceSha256: surface });
  assert.equal(decision.allowed, true);
  return { ...productionRow({ sha, evaluatedMs }), receipt_sha256: decision.receiptSha256, evidence,
    gate_surface_sha256: surface };
}

test("a SHA whose gate surface equals a released one is released, and says which revision it inherits", () => {
  const evaluatedMs = NOW.getTime() - 2 * DAY;
  const asked = [];
  const report = check([surfacedRow({ evaluatedMs })], { gateSurfaceSha256: SURFACE,
    surfaceOfCommit: (revision) => { asked.push(revision); return SURFACE; } });
  assert.equal(report.ready, true);
  assert.equal(report.gateSurfaceSha256, SURFACE);
  assert.deepEqual(report.scopes, [{
    scope: "direct_upload", status: "released", evaluatedAt: at(evaluatedMs),
    expiresAt: at(evaluatedMs + RELEASE_MAX_AGE_MS), remainingHours: 28 * 24, inheritedFrom: OTHER_SHA,
  }]);
  // The inherited row's digest was recomputed from the revision the founder recorded.
  assert.deepEqual(asked, [OTHER_SHA]);
});

test("an inherited row whose digest is not its own revision's is a surface mismatch, never released", () => {
  const rows = [surfacedRow({ evaluatedMs: NOW.getTime() - 2 * DAY })];
  // A digest pasted from another build, and a recorded revision this checkout cannot hash.
  for (const recomputed of [`sha256:${"7".repeat(64)}`, null]) {
    const report = check(rows, { gateSurfaceSha256: SURFACE, surfaceOfCommit: () => recomputed });
    assert.equal(report.ready, false);
    assert.deepEqual(report.missingScopes, ["direct_upload"]);
    assert.deepEqual(report.scopes, [{
      scope: "direct_upload", status: "surface_mismatch", code: "SCOPED_RELEASE_SURFACE_MISMATCH",
      inheritedFrom: OTHER_SHA, recordedGateSurfaceSha256: SURFACE, recomputedGateSurfaceSha256: recomputed,
    }]);
  }
  // The default recomputes from this checkout's Git, where OTHER_SHA does not exist: not released.
  assert.equal(check(rows, { gateSurfaceSha256: SURFACE }).scopes[0].status, "surface_mismatch");
  // An exact-SHA release is not recomputed: its binding is the SHA itself.
  const exact = check([surfacedRow({ sha: SHA, evaluatedMs: NOW.getTime() - DAY })],
    { gateSurfaceSha256: SURFACE, surfaceOfCommit: () => { throw new Error("not called"); } });
  assert.equal(exact.scopes[0].status, "released");
});

test("a SHA whose gate surface changed, or is unknown, inherits nothing", () => {
  const rows = [surfacedRow({ evaluatedMs: NOW.getTime() - 2 * DAY })];
  for (const gateSurfaceSha256 of [`sha256:${"6".repeat(64)}`, null]) {
    const report = check(rows, { gateSurfaceSha256 });
    assert.equal(report.ready, false);
    assert.equal(report.scopes[0].status, "missing");
  }
});

test("an inherited release still expires 30 days after the founder's evaluation", () => {
  const report = check([surfacedRow({ evaluatedMs: NOW.getTime() - 31 * DAY })], { gateSurfaceSha256: SURFACE });
  assert.equal(report.scopes[0].status, "expired");
});

test("a later refusal naming the surface, or a later exact-SHA decision, outranks the inherited release", () => {
  const evaluatedMs = NOW.getTime() - 3 * DAY;
  const refusal = { ...surfacedRow({ evaluatedMs }), allowed: false, receipt_sha256: null, evidence: [],
    missing: ["founder_approval_receipt_recorded"], recorded_at: at(evaluatedMs + 60_000) };
  assert.equal(check([surfacedRow({ evaluatedMs }), refusal], { gateSurfaceSha256: SURFACE }).scopes[0].status, "refused");
  const exact = { ...productionRow({ evaluatedMs }), recorded_at: at(evaluatedMs + 60_000) };
  const report = check([surfacedRow({ evaluatedMs }), exact], { gateSurfaceSha256: SURFACE });
  assert.equal(report.scopes[0].status, "released");
  assert.equal("inheritedFrom" in report.scopes[0], false);
});

test("with a surface digest the CLI sends the gate's OR query, still GET only", async () => {
  const row = surfacedRow({ evaluatedMs: NOW.getTime() - DAY });
  const calls = [];
  const rows = await readReleaseRows({ url: "https://x.example", serviceRoleKey: "k".repeat(32) }, SHA, ["direct_upload"],
    async (_config, path, init) => { calls.push({ path, method: init.method }); return json([row]); }, SURFACE);
  assert.deepEqual(rows, [row]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  const url = new URL(`https://x.example${calls[0].path}`);
  assert.equal(url.searchParams.get("or"), `(release_revision.eq.${SHA},gate_surface_sha256.eq."${SURFACE}")`);
  assert.equal(url.searchParams.get("release_revision"), null);
});

// D-05 gate surface (scripts/gate-surface.mjs). Here so the lib/release-gate-check-script.test.ts wrapper runs it too.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const surfaceRules = JSON.parse(readFileSync(new URL("./gate-surface-rules.json", import.meta.url), "utf8"));
const SURFACE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const surfaceTree = (entries) =>
  entries.map(([path, n]) => `100644 blob ${String(n).padStart(40, "0")}\t${path}`).join("\0") + "\0";
const SURFACE_BASE = [
  [GATE_SURFACE_RULES_PATH, 1],
  ["shared/scopedCustomerDataGate.ts", 2],
  ["nextjs/components/landing-v2/landing-page.tsx", 3],
  ["docs/policy/TERMS.md", 4],
  ["nextjs/app/benchmarks/gdp-pdf/page.tsx", 5],
  ["supabase/migrations/20260930070000_processing_qualification_stage.sql", 6],
];
const surfaceChange = (path, n) => surfaceTree(SURFACE_BASE.map(([p, b]) => [p, p === path ? n : b]));
const inSurface = (path) => surfaceRules.alwaysSurface.some((source) => new RegExp(source).test(path)) ||
  !surfaceRules.presentational.some((source) => new RegExp(source).test(path));

test("gate surface: a presentational change keeps the digest; a gate, policy or rules change moves it", () => {
  const before = gateSurfaceDigest(surfaceRules, surfaceTree(SURFACE_BASE));
  assert.match(before, SURFACE_DIGEST);
  assert.equal(gateSurfaceDigest(surfaceRules, surfaceChange("nextjs/components/landing-v2/landing-page.tsx", 9)), before);
  assert.equal(gateSurfaceDigest(surfaceRules, surfaceChange("nextjs/app/benchmarks/gdp-pdf/page.tsx", 9)), before);
  for (const path of ["shared/scopedCustomerDataGate.ts", "docs/policy/TERMS.md", GATE_SURFACE_RULES_PATH,
    "supabase/migrations/20260930070000_processing_qualification_stage.sql"]) {
    assert.notEqual(gateSurfaceDigest(surfaceRules, surfaceChange(path, 9)), before, path);
  }
  // A new server path anywhere is surface by default, and so is a route under a presentational folder.
  assert.notEqual(gateSurfaceDigest(surfaceRules, surfaceTree([...SURFACE_BASE, ["nextjs/lib/new-upload-path.ts", 7]])), before);
  assert.notEqual(gateSurfaceDigest(surfaceRules, surfaceTree([...SURFACE_BASE, ["nextjs/app/benchmarks/x/route.ts", 7]])), before);
  assert.equal(gateSurfaceDigest(surfaceRules, surfaceTree([...SURFACE_BASE, ["nextjs/e2e/new.spec.ts", 7]])), before);
});

test("gate surface: no rules file, foreign rules or a malformed tree yields null, which inherits nothing", () => {
  assert.equal(gateSurfaceDigest(surfaceRules, surfaceTree(SURFACE_BASE.slice(1))), null);
  assert.equal(gateSurfaceDigest({ ...surfaceRules, schemaVersion: "other" }, surfaceTree(SURFACE_BASE)), null);
  assert.equal(gateSurfaceDigest({ ...surfaceRules, presentational: "x" }, surfaceTree(SURFACE_BASE)), null);
  assert.equal(gateSurfaceDigest(surfaceRules, "no-tab-here\0"), null);
  assert.equal(gateSurfaceOfCommit(repositoryRoot, "0".repeat(40)), null);
  assert.equal(gateSurfaceOfCommit(repositoryRoot, "HEAD"), null);
});

test("gate surface: PR #174's landing, benchmark and media changes are presentational; the gate's files are surface", () => {
  for (const path of [
    "nextjs/app/benchmarks/gdp-pdf/page.tsx", "nextjs/components/landing-v2/specimen-strip.tsx",
    "nextjs/components/landing-v2/specimen-strip.module.css", "nextjs/e2e/specimen-strip.spec.ts",
    "nextjs/lib/changelog.ts", "nextjs/lib/compiler-release.ts", "nextjs/lib/gdp-pdf-page-data.ts",
    "nextjs/lib/specimen-sources.json", "nextjs/lib/brand-copy.test.ts", "nextjs/scripts/repair-scope.mjs",
    "nextjs/public/film/poster.avif", "nextjs/public/proof-collection/specimens/nasa-sp-5079-p074.pdf",
    "nextjs/public/proof-collection/specimens/nasa-sp-5079-p074.run.json",
  ]) assert.equal(inSurface(path), false, path);
  // Consent, upload, source, key and account UI, any global CSS, the server-side specimen reader, content
  // and the clients customers download and run are surface: changing them needs a new founder release.
  for (const path of [
    "nextjs/components/processing-consent-panel.tsx", "nextjs/components/processing-consent-panel.module.css",
    "nextjs/components/workspace-ultimate-shell.tsx", "nextjs/components/world-studio-ultimate.tsx",
    "nextjs/components/developer-panel.tsx", "nextjs/components/founder-test-reset-panel.tsx",
    "nextjs/app/wanted-sans-korean.css", "nextjs/app/globals.css", "nextjs/lib/specimen-sources.ts",
    "nextjs/content/trust/provisions.ts", "nextjs/public/developer/tavonel-mcp.mjs",
    "nextjs/public/developer/tavonel-cli.mjs", "nextjs/public/llms.txt", "nextjs/public/icon.svg",
  ]) assert.equal(inSurface(path), true, path);
  for (const path of [
    "shared/scopedCustomerDataGate.ts", "shared/uskcEnums.ts", "nextjs/lib/customer-data-admission.ts",
    "nextjs/lib/scoped-customer-data-gate-store.ts", "nextjs/lib/processing-workspace-grant.ts",
    "nextjs/lib/archive-expand.ts", "nextjs/app/api/access/bootstrap/route.ts", "nextjs/next.config.mjs",
    "nextjs/vercel.json", "nextjs/package.json", "nextjs/pnpm-lock.yaml",
    "nextjs/public/policy/processing-terms-2026-09-30.json", "docs/policy/FOUNDER_PACKET_CA_2026-09-11.md",
    "supabase/migrations/20261027120000_release_gate_surface_continuity.sql",
    "supabase/tests/release_gate_surface_continuity.sql", "nextjs/scripts/gate-surface.mjs", GATE_SURFACE_RULES_PATH,
    "nextjs/app/workspace/page.tsx",
  ]) assert.equal(inSurface(path), true, path);
});

// A build without Git (the Vercel prebuild runs this suite) has no history to hash; the gate then reads
// the exact SHA only, so there is nothing to assert. With Git, HEAD must have a digest.
let checkoutHead = null;
try {
  checkoutHead = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch { /* no Git */ }
test("gate surface: this checkout's HEAD has a digest, computed from blob ids", { skip: checkoutHead === null }, () => {
  const head = checkoutHead;
  const digest = gateSurfaceOfCommit(repositoryRoot, head);
  assert.match(digest, SURFACE_DIGEST);
  assert.equal(gateSurfaceOfCommit(repositoryRoot, head), digest);
});

// Throwaway repositories, so a test never depends on (or dirties) this checkout. Paths go in through
// `update-index -z`, so a path holding LF or invalid UTF-8 exists as a real Git tree entry.
let gitBinary = true;
try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { gitBinary = false; }
const rulesSource = readFileSync(new URL("./gate-surface-rules.json", import.meta.url));
const scratchGit = (dir, args, input) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.protectNTFS=false",
  "-c", "user.name=gate-test", "-c", "user.email=gate-test@example.invalid", "-C", dir, ...args],
{ input, stdio: ["pipe", "pipe", "ignore"] }).toString("utf8").trim();
const blobId = (content) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
/** One commit whose tree is exactly `files` ([path (string or Buffer), content]); no working tree needed. */
function commitTree(dir, files) {
  const index = join(dir, ".git", `index-${Math.random().toString(16).slice(2)}`);
  const records = files.map(([path, content]) => Buffer.concat([
    Buffer.from(`100644 ${scratchGit(dir, ["hash-object", "-w", "--stdin"], content)}\t`), Buffer.from(path), Buffer.from([0]),
  ]));
  execFileSync("git", ["-c", "core.protectNTFS=false", "-C", dir, "update-index", "--add", "-z", "--index-info"],
    { input: Buffer.concat(records), env: { ...process.env, GIT_INDEX_FILE: index }, stdio: ["pipe", "ignore", "ignore"] });
  const tree = execFileSync("git", ["-C", dir, "write-tree"], { env: { ...process.env, GIT_INDEX_FILE: index } })
    .toString().trim();
  return scratchGit(dir, ["commit-tree", tree, "-m", "gate surface fixture"], "");
}
function withScratchRepo(body) {
  const dir = mkdtempSync(join(tmpdir(), "gate-surface-"));
  try {
    scratchGit(dir, ["init", "-q"]);
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Digest v1 as shipped in d8b3ec3c: raw lines joined with LF. Kept here only to prove the fixtures collide. */
function digestV1(rules, tree) {
  const keep = (path) => rules.alwaysSurface.some((source) => new RegExp(source).test(path)) ||
    !rules.presentational.some((source) => new RegExp(source).test(path));
  // A -z record is the v1 line itself: `mode type object<TAB>path`.
  const lines = tree.split("\0").filter(Boolean).filter((record) => keep(record.slice(record.indexOf("\t") + 1))).sort();
  return createHash("sha256").update(`tavonel.gate_surface.v1\n${lines.join("\n")}\n`).digest("hex");
}

test("gate surface: a path holding LF cannot stand in for the surface files it deletes or adds (R2 S1)", () => {
  const id = (c) => c.repeat(40);
  const tree = (entries) => entries.map(([o, p]) => `100644 blob ${o}\t${p}`).join("\0") + "\0";
  // Deletion: middleware.ts and the gate itself are gone; one LF path carries both of their v1 lines.
  const released = [[id("1"), GATE_SURFACE_RULES_PATH], [id("a"), "nextjs/middleware.ts"],
    [id("b"), "shared/scopedCustomerDataGate.ts"], [id("c"), "nextjs/lib/auth-guard.ts"]];
  const deleted = [released[0], released[3],
    [id("a"), `nextjs/middleware.ts\n100644 blob ${id("b")}\tshared/scopedCustomerDataGate.ts`]];
  // Addition: a planted LF path is later split into two real files, one of them a route that was never released.
  const planted = [[id("1"), GATE_SURFACE_RULES_PATH],
    [id("a"), `nextjs/lib/x.ts\n100644 blob ${id("e")}\tnextjs/app/api/evil/route.ts`]];
  const split = [[id("1"), GATE_SURFACE_RULES_PATH], [id("a"), "nextjs/lib/x.ts"], [id("e"), "nextjs/app/api/evil/route.ts"]];
  for (const [before, after] of [[released, deleted], [planted, split]]) {
    // The fixtures are the review's collision: digest v1 cannot tell the two trees apart.
    assert.equal(digestV1(surfaceRules, tree(before)), digestV1(surfaceRules, tree(after)));
    const a = gateSurfaceDigest(surfaceRules, tree(before));
    const b = gateSurfaceDigest(surfaceRules, tree(after));
    assert.match(a, SURFACE_DIGEST);
    assert.match(b, SURFACE_DIGEST);
    assert.notEqual(a, b);
  }
});

test("gate surface: the LF collision on real Git commits, and a path that is not UTF-8 (R2 S1)", { skip: !gitBinary }, () => {
  withScratchRepo((dir) => {
    const gateFile = "// gate\n";
    // Pick middleware bytes whose blob id sorts right before the gate's with no other line between them,
    // so the two v1 lines are neighbours, as the review's commits were.
    const between = (x, lo, hi) => lo < x && x < hi;
    let middleware = "";
    for (let k = 0; ; k += 1) {
      middleware = `export function middleware() { /* auth ${k} */ }\n`;
      const [m, g, r] = [blobId(middleware), blobId(gateFile), blobId(rulesSource)];
      if (m < g && !between(r, m, g)) break;
    }
    const files = [[GATE_SURFACE_RULES_PATH, rulesSource], ["nextjs/middleware.ts", middleware],
      ["shared/scopedCustomerDataGate.ts", gateFile]];
    const released = commitTree(dir, files);
    const deleted = commitTree(dir, [files[0],
      [`nextjs/middleware.ts\n100644 blob ${blobId(gateFile)}\tshared/scopedCustomerDataGate.ts`, middleware]]);
    const lsTree = (sha) => scratchGit(dir, ["ls-tree", "-r", "-z", "--full-tree", sha]) + "\0";
    assert.equal(digestV1(surfaceRules, lsTree(released)), digestV1(surfaceRules, lsTree(deleted)));
    const [a, b] = [gateSurfaceOfCommit(dir, released), gateSurfaceOfCommit(dir, deleted)];
    assert.match(a, SURFACE_DIGEST);
    assert.match(b, SURFACE_DIGEST);
    assert.notEqual(a, b);
    // Two different byte paths that a lossy decoder would both read as "nextjs/lib/x�.ts": no digest.
    const notUtf8 = commitTree(dir, [files[0], [Buffer.from([...Buffer.from("nextjs/lib/x"), 0xff, ...Buffer.from(".ts")]), "x\n"]]);
    assert.equal(gateSurfaceOfCommit(dir, notUtf8), null);
  });
});

test("gate surface: only a clean Vercel production build of HEAD claims a digest (R2 S6)", { skip: !gitBinary }, () => {
  withScratchRepo((dir) => {
    mkdirSync(join(dir, "nextjs", "scripts"), { recursive: true });
    writeFileSync(join(dir, GATE_SURFACE_RULES_PATH), rulesSource);
    writeFileSync(join(dir, "nextjs", "x.ts"), "export const x = 1;\n");
    scratchGit(dir, ["add", "-A"]);
    scratchGit(dir, ["commit", "-q", "-m", "fixture"]);
    const head = scratchGit(dir, ["rev-parse", "HEAD"]);
    const production = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: head };
    const digest = gateSurfaceOfCommit(dir, head);
    assert.match(digest, SURFACE_DIGEST);
    assert.equal(deploymentGateSurface(production, dir), digest);
    assert.equal(deploymentGateSurface({ ...production, VERCEL_GIT_COMMIT_SHA: head.toUpperCase() }, dir), digest);
    // Fail closed: a preview or local build, no claimed SHA, a SHA other than HEAD, or no Git claims nothing.
    for (const env of [
      { ...production, VERCEL_ENV: "preview" }, { ...production, VERCEL_ENV: undefined },
      { VERCEL_GIT_COMMIT_SHA: head }, { VERCEL_ENV: "production" }, { ...production, VERCEL_GIT_COMMIT_SHA: " " },
      { ...production, VERCEL_GIT_COMMIT_SHA: "0".repeat(40) },
    ]) assert.equal(deploymentGateSurface(env, dir), null, JSON.stringify(env));
    // The bytes being built are not HEAD's: an edited tracked file, then an untracked one.
    writeFileSync(join(dir, "nextjs", "x.ts"), "export const x = 2;\n");
    assert.equal(deploymentGateSurface(production, dir), null);
    scratchGit(dir, ["checkout", "--", "nextjs/x.ts"]);
    assert.equal(deploymentGateSurface(production, dir), digest);
    writeFileSync(join(dir, "nextjs", "untracked.ts"), "export const y = 1;\n");
    assert.equal(deploymentGateSurface(production, dir), null);
  });
  const noGit = mkdtempSync(join(tmpdir(), "gate-surface-"));
  try {
    assert.equal(deploymentGateSurface({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) }, noGit), null);
  } finally {
    rmSync(noGit, { recursive: true, force: true });
  }
});

test("gate surface: a refusal naming the surface also closes a rollback to the released SHA", () => {
  // The DB refuses a surface-less refusal of an inheriting SHA (refusal_requires_surface); this is what
  // the reader then sees for the released revision itself.
  const evaluatedMs = NOW.getTime() - 3 * DAY;
  const released = surfacedRow({ sha: SHA, evaluatedMs });
  const refusal = { ...surfacedRow({ sha: "c".repeat(40), evaluatedMs }), allowed: false, receipt_sha256: null,
    evidence: [], missing: ["founder_approval_receipt_recorded"], recorded_at: at(evaluatedMs + 60_000) };
  assert.equal(check([released], { gateSurfaceSha256: SURFACE }).scopes[0].status, "released");
  assert.equal(check([released, refusal], { gateSurfaceSha256: SURFACE }).scopes[0].status, "refused");
});

// Presentational code ships to the same origin as the consent and upload routes, so it must not be able to
// talk to them or to the server side on its own. A guardrail against the accident, not an import-graph proof.
const SHIPPED_CODE = /^nextjs\/(app|components|lib)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/;
const FORBIDDEN_IMPORT = /^node:|^(fs|child_process|http|https|net)$|server-only|supabase|^next\/(headers|server)$/;
const FORBIDDEN_CODE = [/\bfetch\s*\(/, /sendBeacon/, /XMLHttpRequest/, /new\s+(WebSocket|EventSource)\b/,
  /process\.env/, /document\.cookie/, /\.(requestSubmit|submit)\s*\(/, /^\s*["']use server["']/m];
// benchmarks and changelog pages are server components, so a presentational file must not import the gate,
// grant, admission, intake or release-store code either (R2 S3). shared/ is closed except for named
// pure-data modules a presentational file already reads.
const GATE_MODULE = /^shared\/|^nextjs\/lib\/(processing-workspace-grant|customer-data-|intake-|scoped-customer-data-gate-store|[^/]*-gate\b)/;
const PURE_SHARED = new Set(["shared/capabilityManifest"]);
/** The repository path an import names (`@/` is nextjs/), or null for a package. */
const importTarget = (from, specifier) => {
  if (specifier.startsWith("@/")) return posix.normalize(`nextjs/${specifier.slice(2)}`);
  return specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(from), specifier)) : null;
};
const importsGateModule = (from, specifier) => {
  const target = importTarget(from, specifier)?.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
  return target !== undefined && target !== null && GATE_MODULE.test(target) && !PURE_SHARED.has(target);
};
test("gate surface: presentational shipped code cannot reach the server side or the network itself", () => {
  const files = ["app", "components", "lib"]
    .flatMap((dir) => readdirSync(join(repositoryRoot, "nextjs", dir), { recursive: true })
      .map((entry) => `nextjs/${dir}/${String(entry).replaceAll("\\", "/")}`))
    .filter((path) => SHIPPED_CODE.test(path) && !inSurface(path) && !/\.(test|spec)\./.test(path));
  assert.ok(files.length > 20, `found ${files.length} presentational source files`);
  const violations = [];
  for (const path of files) {
    const source = readFileSync(join(repositoryRoot, path), "utf8");
    for (const [, specifier] of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) {
      if (FORBIDDEN_IMPORT.test(specifier) || importsGateModule(path, specifier)) {
        violations.push(`${path}: import ${specifier}`);
      }
    }
    for (const pattern of FORBIDDEN_CODE) if (pattern.test(source)) violations.push(`${path}: ${pattern}`);
  }
  assert.deepEqual(violations, []);
  // The check itself fails when it should.
  assert.equal(FORBIDDEN_CODE.some((pattern) => pattern.test('useEffect(() => { fetch("/api/access/processing-terms") })')), true);
  assert.equal(FORBIDDEN_IMPORT.test("@/lib/supabase-admin"), true);
  const page = "nextjs/app/changelog/page.tsx";
  for (const specifier of ["@/lib/processing-workspace-grant", "@/lib/customer-data-admission", "@/lib/intake-triage-stream",
    "@/lib/scoped-customer-data-gate-store", "@/lib/world-gate", "../../lib/processing-workspace-grant.ts",
    "../../../shared/scopedCustomerDataGate", "@/../shared/uskcEnums"]) {
    assert.equal(importsGateModule(page, specifier), true, specifier);
  }
  for (const specifier of ["@/lib/changelog", "@/lib/site-navigation", "next/link", "react",
    "../../../shared/capabilityManifest"]) {
    assert.equal(importsGateModule("nextjs/components/landing-v2/specimen-strip.tsx", specifier), false, specifier);
  }
});
