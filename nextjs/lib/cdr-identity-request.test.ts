import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { CDR_IDENTITY_PATH, verifyCdrIdentityRequest } from "./cdr-identity-request";
import { CDR_IDENTITY_AUDIENCE } from "./cdr-workload-identity";
const secret = "fixture-only-identity-secret-32-chars";
const id = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-10T00:00:00.000Z";
const headers = () => new Headers({ "x-tavonel-identity-request-id": id, "x-tavonel-identity-timestamp": timestamp,
  "x-tavonel-identity-signature": createHmac("sha256", secret).update(
    `tavonel.cdr.identity.v1\nPOST\n${CDR_IDENTITY_PATH}\n${CDR_IDENTITY_AUDIENCE}\n${timestamp}\n${id}`).digest("base64url") });
it("accepts the bound request inside the timestamp window", () => {
  expect(verifyCdrIdentityRequest(headers(), secret, Date.parse(timestamp))).toBe(id);
});
it.each([-60001, 60001])("rejects timestamp drift %s", offset => {
  expect(verifyCdrIdentityRequest(headers(), secret, Date.parse(timestamp) + offset)).toBeNull();
});
it.each(["x-tavonel-identity-request-id", "x-tavonel-identity-timestamp", "x-tavonel-identity-signature"])("refuses changed %s", name => {
  const input = headers(); input.set(name, "invalid");
  expect(verifyCdrIdentityRequest(input, secret, Date.parse(timestamp))).toBeNull();
});
it("refuses missing or different secrets", () => {
  expect(verifyCdrIdentityRequest(headers(), undefined, Date.parse(timestamp))).toBeNull();
  expect(verifyCdrIdentityRequest(headers(), secret + "different", Date.parse(timestamp))).toBeNull();
});
