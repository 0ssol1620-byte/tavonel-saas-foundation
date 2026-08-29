import { describe, expect, it } from "vitest";
import { foundationPilotAccess, readFoundationPilotUserIds } from "./foundation-pilot";

const userId = "44444444-4444-4444-8444-444444444444";

describe("Foundation private-pilot allowlist", () => {
  it("fails closed when absent, malformed, or not matched", () => {
    expect(readFoundationPilotUserIds({})).toBeNull();
    expect(readFoundationPilotUserIds({ FOUNDATION_PILOT_USER_IDS: "not-a-uuid" })).toBeNull();
    expect(foundationPilotAccess(userId, {})).toBeNull();
    expect(foundationPilotAccess(userId, { FOUNDATION_PILOT_USER_IDS: "55555555-5555-4555-8555-555555555555" })).toBeNull();
  });

  it("grants only an exact case-insensitive UUID match", () => {
    const access = foundationPilotAccess(userId, { FOUNDATION_PILOT_USER_IDS: userId.toUpperCase() });
    expect(access?.membership).toEqual(expect.objectContaining({ userId, role: "owner" }));
    expect(access?.entitlement.status).toBe("active");
  });
});
