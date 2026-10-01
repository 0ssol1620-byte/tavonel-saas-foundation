import { describe, expect, it } from "vitest";
import { databaseInstantMicros } from "./database-instant";

describe("databaseInstantMicros", () => {
  it("keeps the microseconds that Date.parse drops", () => {
    const a = databaseInstantMicros("2026-10-01T10:16:36.700733+00:00");
    const b = databaseInstantMicros("2026-10-01T10:16:36.700412+00:00");
    expect(Date.parse("2026-10-01T10:16:36.700733+00:00")).toBe(Date.parse("2026-10-01T10:16:36.700412+00:00"));
    expect(a).not.toBeNull();
    expect(a! - b!).toBe(321n);
  });

  it("treats the same instant in different serializations as equal", () => {
    const expected = databaseInstantMicros("2026-10-01T10:16:36.7+00:00");
    for (const value of ["2026-10-01T10:16:36.700000+00:00", "2026-10-01 10:16:36.7Z", "2026-10-01T19:16:36.7+09:00", "2026-10-01T05:46:36.7-0430", "2026-10-01T10:16:36.7+00"]) {
      expect(databaseInstantMicros(value), value).toBe(expected);
    }
    expect(databaseInstantMicros("2026-10-01T10:16:36+00:00")).toBe(databaseInstantMicros("2026-10-01T10:16:36.000000Z"));
    expect(databaseInstantMicros("1969-12-31T23:59:59.999999Z")).toBe(-1n);
  });

  it.each([
    undefined, null, 1790849755736, "", "2026-10-01", "2026-10-01T10:16:36", "2026-10-01T10:16:36.1234567Z",
    "2026-02-30T00:00:00Z", "2026-10-01T24:00:00Z", "2026-10-01T10:60:00Z", "2026-10-01T10:16:36.7+0", "2026-10-01T10:16:36.7+16:00",
    "2026-10-01T10:16:36.7+05:60", " 2026-10-01T10:16:36Z", "2026-10-01T10:16:36Z ",
  ])("returns null for %j", value => {
    expect(databaseInstantMicros(value)).toBeNull();
  });
});
