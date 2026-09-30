import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDisposableAuthStack } from "./real-auth-ci-contract.mjs";
const env = { CI: "true", GITHUB_ACTIONS: "true" };
const status = { API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres", ANON_KEY: "synthetic".repeat(8), SERVICE_ROLE_KEY: "synthetic".repeat(8) };
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
