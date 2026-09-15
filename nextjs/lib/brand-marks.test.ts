import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  The logomark, pinned to decision A-06 (BA-230).

  The nine-cell dot grid is the single most common AI/ML mark in circulation, and it kept coming
  back because nothing in the repository said what the mark is. A-06 does: verso page x 2.5-9.5
  with a corner cut, a shorter recto page x 14.5-21.5, one thread at -34.2 degrees between them,
  strokes 1.9 and 1.6. These assertions are that specification, so a redraw that loses it fails
  here rather than in a screenshot review.
*/
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const mark = read("components/logomark.tsx");
const favicon = read("app/icon.svg");

describe("the logomark", () => {
  it("is not a dot grid", () => {
    // Nine <rect> cells with the middle one filled. Never again, in either file.
    expect(mark.match(/<rect/g)).toBeNull();
    expect(favicon.match(/<rect/g)?.length ?? 0).toBeLessThanOrEqual(1); // the favicon's ground
    expect(mark).not.toContain("row === 1 && col === 1");
  });

  it("draws A-06's two pages at the specified x extents", () => {
    expect(mark).toContain("M2.5 5.5H7.4L9.5 7.6V18.5H2.5Z"); // verso, corner cut
    expect(mark).toContain("M14.5 8.2H21.5V18.5H14.5Z"); // recto, shorter
    expect(mark).toContain("strokeWidth={1.9}");
  });

  it("crosses the thread between them at -34.2 degrees", () => {
    const thread = mark.match(/M9\.5 (\d+(?:\.\d+)?)L14\.5 (\d+(?:\.\d+)?)/);
    expect(thread).not.toBeNull();
    const from = Number(thread![1]);
    const to = Number(thread![2]);
    // SVG y grows downward, so a -34.2 degree thread rises to the right.
    const degrees = (Math.atan2(to - from, 14.5 - 9.5) * 180) / Math.PI;
    expect(degrees).toBeGreaterThan(-35.2);
    expect(degrees).toBeLessThan(-33.2);
    expect(mark).toContain("strokeWidth={1.6}");
  });

  it("carries no state colour, because it is a brand mark and not a state", () => {
    expect(mark).not.toContain("--verified");
    expect(mark).toContain('stroke="currentColor"');
    expect(favicon).not.toContain("#7BE0BE");
    expect(favicon).not.toContain("#7be0be");
  });

  it("keeps the favicon the same mark as the nav", () => {
    // Same three paths, scaled 24 -> 32 (x 4/3). A favicon that drifts is a second logo.
    for (const [nav, tab] of [
      [2.5, 3.3],
      [9.5, 12.7],
      [14.5, 19.3],
      [21.5, 28.7],
    ] as const) {
      expect(Math.abs(nav * (32 / 24) - tab), `${nav} -> ${tab}`).toBeLessThan(0.15);
      expect(favicon).toContain(String(tab));
    }
  });
});
