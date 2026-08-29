import { describe, expect, it } from "vitest";
import { AREAS, CHANGE, KEPT, REBUILT, WORLD, n } from "./demo-world";

describe("demo world figures", () => {
  it("splits the whole world into rebuilt, kept and held with nothing left over", () => {
    expect(REBUILT + KEPT + CHANGE.held).toBe(WORLD.facts);
  });

  it("rebuilds exactly the changed origins plus what the wavefront reached", () => {
    expect(REBUILT).toBe(42);
    expect(CHANGE.affected).toBe(CHANGE.levels.reduce((sum, level) => sum + level, 0));
  });

  it("keeps the per-area fact counts summing to the world total", () => {
    expect(AREAS.reduce((sum, area) => sum + area.facts, 0)).toBe(WORLD.facts);
  });

  it("changes fewer facts than the document it came from contains", () => {
    expect(CHANGE.changed + CHANGE.held).toBeLessThan(CHANGE.documentFacts);
    expect(CHANGE.documentFacts).toBeLessThan(WORLD.facts);
  });

  it("publishes the next version, not an arbitrary one", () => {
    expect(WORLD.versionAfter).toBe(WORLD.versionBefore + 1);
  });

  it("passes every check it claims to run", () => {
    expect(WORLD.checksPassed).toBe(WORLD.checksTotal);
  });

  it("formats identically regardless of the host locale", () => {
    expect(n(128_470)).toBe("128,470");
    expect(n(42)).toBe("42");
  });
});
