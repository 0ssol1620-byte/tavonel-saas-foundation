import assert from "node:assert/strict";
import { it } from "node:test";
import { verifyCdrIdentityRequest } from "../../../nextjs/lib/cdr-identity-request";
import { cdrAuthorization, IDENTITY_BROKER, PRIVATE_CDR_ORIGIN } from "./identity";
import { RetryableError } from "./errors";
const secret = "fixture-only-identity-secret-32-chars";
it("signs a bodyless request accepted by the actual server verifier", async () => {
  const now = new Date();
  const id = "11111111-1111-4111-8111-111111111111";
  const result = await cdrAuthorization(`${PRIVATE_CDR_ORIGIN}/v1/disarm`, secret, async (url, init) => {
    assert.equal(url, IDENTITY_BROKER); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "manual");
    assert.equal(verifyCdrIdentityRequest(new Headers(init?.headers), secret, now.getTime()), id);
    return Response.json({ audience: PRIVATE_CDR_ORIGIN, token: "fixture.identity.signature" });
  }, now, id);
  assert.equal(result, "Bearer fixture.identity.signature");
});
it("requires broker credentials for private service and refuses other destinations", async () => {
  const fetcher: typeof fetch = async () => { throw new Error("must not fetch"); };
  await assert.rejects(cdrAuthorization(`${PRIVATE_CDR_ORIGIN}/v1/disarm`, undefined, fetcher), /configuration/);
  await assert.rejects(cdrAuthorization("https://example.invalid/v1/disarm", secret, fetcher), /configuration/);
});
for (const body of [{ audience: "wrong", token: "fixture.identity.signature" }, { audience: PRIVATE_CDR_ORIGIN, token: "bad\r\nheader" }]) {
  it("refuses invalid broker response", async () => {
    await assert.rejects(cdrAuthorization(`${PRIVATE_CDR_ORIGIN}/v1/disarm`, secret, async () => Response.json(body)), RetryableError);
  });
}
it("refuses broker redirects without forwarding the signed request", async () => {
  let calls = 0;
  await assert.rejects(cdrAuthorization(`${PRIVATE_CDR_ORIGIN}/v1/disarm`, secret, async (_url, init) => {
    calls += 1;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://attacker.invalid/capture" } });
  }), RetryableError);
  assert.equal(calls, 1);
});
it("cancels oversized broker output", async () => {
  let canceled = false;
  await assert.rejects(cdrAuthorization(`${PRIVATE_CDR_ORIGIN}/v1/disarm`, secret, async () => new Response(new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(4096)); }, cancel() { canceled = true; },
  }))), RetryableError);
  assert.equal(canceled, true);
});
