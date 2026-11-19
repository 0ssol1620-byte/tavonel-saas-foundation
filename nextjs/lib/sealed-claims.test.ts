import { describe, expect, it } from "vitest";
import { pageTokenKey, sealClaims, unsealClaims } from "./sealed-claims";

const key = pageTokenKey({ TAVONEL_REMOTE_MCP_SIGNING_SECRET: "s".repeat(40) })!;

describe("sealed claims", () => {
  it("round-trips under the same purpose and key", () => {
    const token = sealClaims("p", { a: 1, b: "x" }, key);
    expect(unsealClaims("p", token, key)).toEqual({ a: 1, b: "x" });
  });

  it("fails closed on the wrong purpose, a flipped byte and another key", () => {
    const token = sealClaims("p", { a: 1 }, key);
    expect(unsealClaims("q", token, key)).toBeNull();
    const raw = Buffer.from(token, "base64url");
    raw[raw.length - 1] ^= 1;
    expect(unsealClaims("p", raw.toString("base64url"), key)).toBeNull();
    const other = pageTokenKey({ TAVONEL_REMOTE_MCP_SIGNING_SECRET: "t".repeat(40) })!;
    expect(unsealClaims("p", token, other)).toBeNull();
    expect(unsealClaims("p", "not a token", key)).toBeNull();
  });

  it("refuses a short key to seal or open, and derives none from a short secret", () => {
    expect(() => sealClaims("p", {}, Buffer.alloc(8))).toThrow();
    expect(unsealClaims("p", sealClaims("p", { a: 1 }, key), Buffer.alloc(8))).toBeNull();
    expect(pageTokenKey({ TAVONEL_REMOTE_MCP_SIGNING_SECRET: "short" })).toBeNull();
    expect(pageTokenKey({})).toBeNull();
  });
});
