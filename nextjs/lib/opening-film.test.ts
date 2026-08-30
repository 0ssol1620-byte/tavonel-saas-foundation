import { describe, expect, it } from "vitest";
import { CHANGE, KEPT, REBUILT, WORLD, n } from "./demo-world";
import { FILM_CAPTIONS, FILM_DURATION } from "./film-script";

describe("opening film copy", () => {
  it("is a sendable cut, not a void intro", () => {
    expect(FILM_DURATION).toBeGreaterThan(5);
    expect(FILM_CAPTIONS[0]?.at).toBe(0);
    expect(FILM_CAPTIONS[0]?.kicker).toBe("EXAMPLE");
    expect(FILM_CAPTIONS[0]?.line).toMatch(/mess/i);
  });

  it("prints the same figures the landing prints", () => {
    const text = FILM_CAPTIONS.map((c) => `${c.line} ${c.sub ?? ""}`).join(" ");
    expect(text).toContain(n(WORLD.facts));
    expect(text).toContain(String(CHANGE.changed));
    expect(text).toContain(String(REBUILT));
    expect(text).toContain(n(KEPT));
  });

  it("ends on the compile, not the category name", () => {
    const last = FILM_CAPTIONS[FILM_CAPTIONS.length - 1];
    expect(last?.line.toLowerCase()).toContain("compiled");
    expect(last?.line.toLowerCase()).not.toContain("knowledge compiler");
  });
});
