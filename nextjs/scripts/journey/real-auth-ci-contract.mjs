/** Fail-closed configuration for the existing disposable GitHub runner Supabase stack. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
/** Source texts the updated fixture was compiled from (local-core.integration.test.ts); versionKey is sha256(text). */
export const UPDATED_SOURCE_TEXTS = Object.freeze({
  "synthetic-policy": "The synthetic company's payment terms are 45 days.",
  "synthetic-board": "The synthetic board approved the payment policy.",
});
/** Current immutable source objects for a candidate, refusing any object whose bytes do not hash to its bound versionKey. */
export function currentSourceObjects(artifact, workspace, texts = UPDATED_SOURCE_TEXTS) {
  const bindings = artifact?.sourceDocuments ?? [];
  assert.deepEqual(bindings.map(item => item.documentId).sort(), Object.keys(texts).sort(), "Every bound source needs its exact input text");
  return bindings.map(({ documentId, versionKey }) => {
    const body = texts[documentId];
    assert.equal(versionKey, createHash("sha256").update(body).digest("hex"), `${documentId} bytes must hash to the bound versionKey`);
    return { key: `immutable/${workspace}/${workspace}/${documentId}/${versionKey}/sanitized.pdf`, body };
  });
}
/** GoTrue v2.196.0 parseJWTClaims returns Forbidden/bad_jwt for expired claims. */
export function validateExpiredProviderJwt(response) {
  assert.equal(response.status, 403, "GoTrue rejects expired JWT claims as forbidden");
  assert.equal(response.body?.error_code, "bad_jwt", "Require provider JWT validation failure");
  assert.match(response.body?.msg ?? "", /token is expired/i, "Require actual expiry, not another refusal");
}
/** Next owns /auth/callback; only the versioned provider API belongs to GoTrue. */
export function authGatewayService(requestTarget, bucket) {
  const pathname = requestTarget.split("?")[0];
  if (pathname === `/${bucket}` || pathname.startsWith(`/${bucket}/`)) return "s3";
  if (pathname.startsWith("/auth/v1/") || pathname.startsWith("/rest/v1/")) return "supabase";
  return "next";
}
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
