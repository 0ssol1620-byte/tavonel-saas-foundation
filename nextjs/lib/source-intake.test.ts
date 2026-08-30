import { describe, expect, it } from "vitest";
import { deterministicSourceDocumentId, validSourceIdempotencyKey } from "./source-intake";

describe("connector source intake identity", () => {
  it("derives a stable tenant-bound UUID without storing the source key", async () => {
    const key = "a".repeat(64);
    const first = await deterministicSourceDocumentId("pilot-1234567890abcdef", key);
    const replay = await deterministicSourceDocumentId("pilot-1234567890abcdef", key);
    const otherTenant = await deterministicSourceDocumentId("pilot-fedcba0987654321", key);
    expect(first).toBe(replay);
    expect(first).not.toBe(otherTenant);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("accepts only a lowercase full SHA-256", () => {
    expect(validSourceIdempotencyKey("a".repeat(64))).toBe(true);
    expect(validSourceIdempotencyKey("A".repeat(64))).toBe(false);
    expect(validSourceIdempotencyKey("a".repeat(63))).toBe(false);
  });
});
