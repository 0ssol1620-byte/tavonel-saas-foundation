import { existsSync, readFileSync } from "node:fs";
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
const shareCard = read("lib/og-card.tsx");

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
    /*
      chrome-15. Faithful to the nav is not the same as sized for the tile.

      Drawn at 24 -> 32 into a filled rounded tile the glyph covered 79% of the width and 54% of
      the height and read as a blob at 16px. The scale is a transform about the tile centre, so
      the coordinates above are untouched and this stays one mark -- and it is pinned here so it
      cannot quietly go back to 1.
    */
    const scale = Number(favicon.match(/translate\(16 16\) scale\(([\d.]+)\)/)?.[1]);
    expect(scale, "the glyph is scaled to the tile").toBeGreaterThan(1.1);
    // The mark is 25.4 wide; anything past 1.26 puts it through the tile edge.
    expect(scale * 25.4, "and stays inside the tile").toBeLessThan(32);
  });

  /*
    BQ-008. The guard above pinned two of the three files that drew a mark, and the third was the
    one most readers actually saw.

    `lib/og-card.tsx` and `app/opengraph-image.tsx` each drew the banned nine-cell grid, on
    twenty-nine share cards; `app/icon.tsx` drew a fourth mark again -- the retired cream tile
    with a blue/teal T -- and shipped it as `/icon` beside `app/icon.svg`. Three marks, one
    brand. The assertions follow the files rather than the pictures: a second drawing has to go
    somewhere, and these are the somewheres.
  */
  it("draws the same mark on the share cards, from the same geometry", () => {
    expect(shareCard.match(/<rect/g)).toBeNull();
    expect(shareCard).not.toContain("Cell lit");
    expect(shareCard).toContain("M2.5 5.5H7.4L9.5 7.6V18.5H2.5Z");
    expect(shareCard).toContain("M14.5 8.2H21.5V18.5H14.5Z");
    expect(shareCard).toContain("M9.5 15.5L14.5 12.1");
    // The root card is the same `ogCard` as the other twenty-nine, not a second drawing.
    expect(read("app/opengraph-image.tsx")).toContain("ogCard(BRAND_LINE.headline");
    expect(read("app/opengraph-image.tsx")).not.toContain("ImageResponse");
  });

  it("draws both copies in one ink, above the 3:1 a graphical object needs", () => {
    // BQ-131. `--text-mid` is #9AA3A8; the two pages were 0.66 of `--text-lo` (2.95:1 at 20px)
    // in the nav and #C8CED2 in the tab -- one mark, two greys, one of them under the floor.
    expect(mark).not.toContain("opacity={0.66}");
    expect(mark.match(/opacity=\{0\.8\}/g)).toHaveLength(2);
    // The share-card copy -- twenty-nine cards, the apple icon and the root OG card -- kept 0.66
    // when the other two moved. One number, and this is the third place it is pinned.
    expect(shareCard).not.toContain("opacity={0.66}");
    expect(shareCard.match(/opacity=\{0\.8\}/g)).toHaveLength(2);
    expect(read("app/one-path.css")).toContain(".wordmark .logomark { color: var(--text-mid); }");
    expect(favicon).toContain('stroke="#9AA3A8"');
    expect(favicon).not.toContain("#C8CED2");
  });

  it("ships exactly one favicon source", () => {
    // `app/icon.tsx` drew the retired cream/teal tile and Next served it as `/icon` alongside
    // `app/icon.svg`. Two icon files at one route segment is two brands on one tab.
    expect(existsSync(join(process.cwd(), "app/icon.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "app/icon.svg"))).toBe(true);
  });
});
