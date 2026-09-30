import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { authGatewayService, currentSourceObjects, validateDisposableAuthStack, validateExpiredProviderJwt } from "./real-auth-ci-contract.mjs";
const fixture = name => JSON.parse(readFileSync(path.join(import.meta.dirname, "real-auth-fixtures", `${name}.json`), "utf8")).artifact;
test("hydrated publication stores only hash-bound current sources of the updated fixture", () => {
  const updated = fixture("updated"), workspace = "pilot-a111111111114111";
  const objects = currentSourceObjects(updated, workspace);
  assert.deepEqual(objects.map(item => item.key).sort(), updated.sourceDocuments.map(item => `immutable/${workspace}/${workspace}/${item.documentId}/${item.versionKey}/sanitized.pdf`).sort());
  // The initial revision binds the 30-day policy, which is not the current source.
  assert.throws(() => currentSourceObjects(fixture("initial"), workspace), /synthetic-policy bytes must hash/);
  assert.throws(() => currentSourceObjects(updated, workspace, { "synthetic-policy": "altered", "synthetic-board": "altered" }));
  assert.throws(() => currentSourceObjects({ sourceDocuments: [] }, workspace));
});
// The journey imports the reviewed TypeScript driver directly; fail here, before the optimized build, if this Node cannot.
// The journey is hosted-only, so the requirement binds on GitHub Actions; elsewhere the skip names the runtime.
test("the reviewed button driver loads in this Node runtime without a bundler", {
  skip: process.env.GITHUB_ACTIONS !== "true" && !process.features.typescript && `journey is hosted-only; ${process.version} cannot strip TypeScript`,
}, async () => {
  const driver = await import(new URL("../../e2e/support/workspace-review-actions.ts", import.meta.url).href);
  assert.equal(typeof driver.acceptEvidenceThroughUi, "function");
  assert.equal(typeof driver.activateCandidateThroughUi, "function");
});
test("requires the actual GoTrue expiry rejection and refuses success or unrelated errors", () => {
  const expired = { status: 403, body: { error_code: "bad_jwt", msg: "invalid JWT: token has invalid claims: token is expired" } };
  validateExpiredProviderJwt(expired);
  for (const invalid of [{ ...expired, status: 200 }, { ...expired, status: 500 }, { ...expired, body: { error_code: "session_not_found", msg: "Session missing" } }, { ...expired, body: { error_code: "bad_jwt", msg: "Invalid signature" } }]) assert.throws(() => validateExpiredProviderJwt(invalid));
});
const env = { CI: "true", GITHUB_ACTIONS: "true" };
const status = { API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres", ANON_KEY: "synthetic".repeat(8), SERVICE_ROLE_KEY: "synthetic".repeat(8) };

test("Next callback is never captured by the versioned GoTrue API route", () => {
  for (const target of ["/auth/callback", "/auth/callback?error_code=access_denied", "/auth/callback?code=synthetic", "/auth/v10/token", "/auth/v1", "/workspace", "/api/access/bootstrap", "/_next/static/runtime.js"]) {
    assert.equal(authGatewayService(target,"fixture-bucket"),"next",target);
  }
  for (const target of ["/auth/v1/token?grant_type=password", "/auth/v1/token?grant_type=refresh_token", "/auth/v1/user", "/auth/v1/logout?scope=global", "/auth/v1/admin/users", "/rest/v1/rpc/transition_foundation_world_atomic"]) {
    assert.equal(authGatewayService(target,"fixture-bucket"),"supabase",target);
  }
  assert.equal(authGatewayService("/fixture-bucket/immutable/candidate-world.json","fixture-bucket"),"s3");
  assert.equal(authGatewayService("/fixture-bucket?list-type=2","fixture-bucket"),"s3");
  assert.equal(authGatewayService("/fixture-bucket-other/object","fixture-bucket"),"next");
});
test("accepts only the disposable CI default local API/database pair", () => { assert.equal(validateDisposableAuthStack(status, env).api, status.API_URL); });
test("refuses ordinary workstation and non-GitHub CI execution", () => {
  assert.throws(() => validateDisposableAuthStack(status, {}));
  assert.throws(() => validateDisposableAuthStack(status, { CI: "true" }));
});
test("refuses external API, alternate local ports and remote database", () => {
  for (const patch of [{ API_URL: "https://production.invalid" }, { API_URL: "http://127.0.0.1:54323" }, { DB_URL: "postgresql://postgres:synthetic@production.invalid:54322/postgres" }, { DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54323/postgres" }]) {
    assert.throws(() => validateDisposableAuthStack({ ...status, ...patch }, env));
  }
});
test("requires actual local stack keys and refuses path routing to another API", () => {
  assert.throws(() => validateDisposableAuthStack({ ...status, SERVICE_ROLE_KEY: "" }, env));
  assert.throws(() => validateDisposableAuthStack({ ...status, API_URL: `${status.API_URL}/remote` }, env));
});
