import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaddleSignature } from "./paddle-webhook";

describe("Next.js Paddle webhook verification", () => {
  it("accepts only an exact, current raw-body HMAC", () => {
    const secret = "test-only-paddle-signing-secret-at-least-32";
    const timestamp = 1_900_000_000;
    const body = '{"event_id":"evt_test"}';
    const hash = createHmac("sha256", secret).update(`${timestamp}:${body}`).digest("hex");
    expect(verifyPaddleSignature(body, `ts=${timestamp};h1=${hash}`, secret, timestamp * 1000)).toBe(true);
    expect(verifyPaddleSignature(`${body} `, `ts=${timestamp};h1=${hash}`, secret, timestamp * 1000)).toBe(false);
  });
});
