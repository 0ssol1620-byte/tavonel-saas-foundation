import { describe, expect, it } from "vitest";
import { FILM_CAPTIONS, FILM_DURATION } from "./film-script";

describe("opening film cut", () => {
  it("is a sendable cut with no spoken caption band", () => {
    expect(FILM_DURATION).toBeGreaterThan(5);
    expect(FILM_CAPTIONS).toHaveLength(0);
  });
});
