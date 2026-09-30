/** Fail-closed configuration for the existing disposable GitHub runner Supabase stack. */
import assert from "node:assert/strict";
export function validateDisposableAuthStack(status, env) {
  assert.equal(env.CI, "true", "Real Auth qualification is restricted to disposable CI");
  assert.equal(env.GITHUB_ACTIONS, "true", "Use the existing disposable GitHub runner workflow");
  const api = new URL(status.API_URL);
  assert.equal(api.origin, "http://127.0.0.1:54321", "Only the freshly started default local CLI API is accepted");
  assert.equal(api.pathname, "/");
  const database = new URL(status.DB_URL);
  assert.equal(database.protocol, "postgresql:");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "54322");
  assert.equal(database.pathname, "/postgres");
  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"]) assert.ok(typeof status[key] === "string" && status[key].length >= 32, `Missing local ${key}`);
  return { api: api.origin, db: status.DB_URL, anon: status.ANON_KEY, service: status.SERVICE_ROLE_KEY };
}
