import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILM_CAPTIONS, FILM_DURATION } from "./film-script";

const FILM_COMPONENTS = [
  "components/opening-film.tsx",
  "components/opening-film-2.tsx",
  "components/opening-film-3.tsx",
  "components/opening-film-4.tsx",
] as const;

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("opening film cut", () => {
  it("is a sendable cut with no spoken caption band", () => {
    expect(FILM_DURATION).toBeGreaterThan(5);
    expect(FILM_CAPTIONS).toHaveLength(0);
  });

  it("keeps every live canvas supersampled without changing scene coordinates", () => {
    for (const file of FILM_COMPONENTS) {
      const source = read(file);
      expect(source, `${file} must render at least 2x and cap at 3x`).toContain(
        "Math.min(3, Math.max(2, window.devicePixelRatio || 1))",
      );
    }
  });
});
