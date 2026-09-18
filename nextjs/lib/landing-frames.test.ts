import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LANDING_FRAMES, type LandingFrame } from "./landing-frames";

/*
  The three product frames on the landing page (`/` and `/ko`), checked as a record rather than as
  pictures.

  They replaced an interactive proof block, which means they are now the page's evidence. Two
  things can go wrong with evidence made of screenshots and both are checked here: a caption that
  quietly states a result the frame does not itself display, and a declared size that does not
  match the bytes -- the second of which costs layout shift on the one image a phone reader waits
  for. §35 bars invented figures, so no alt text or caption on this page may carry a digit at all;
  the `captured` date is a field rather than prose for exactly that reason.

  The pixel check is skipped while a file is absent, so the suite is green before the assets land
  and starts measuring the moment one does. That is deliberate: an assertion that cannot run is
  worse than one that says why it did not.

  It is red as written on 2026-09-18, and correctly: the six captures that landed disagree with
  every declared size, and the three desktop frames disagree with each other (2720, 2720 and 2560
  wide for three frames the page lays out identically). That is a capture to redo or a record to
  correct, not a number to copy into `landing-frames.ts` -- freezing 2560 there would ship the
  defect with a green suite behind it.
*/
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

/** `width x height` from a WebP container, or `null` if the bytes are not one. */
function webpSize(file: string): { width: number; height: number } | null {
  const bytes = readFileSync(file);
  if (bytes.length < 30) return null;
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("latin1", 12, 16);
  // Lossy: the 3-byte sync code follows the frame tag, and the two 14-bit dimensions follow that.
  if (chunk === "VP8 ") {
    if (bytes.toString("hex", 23, 26) !== "9d012a") return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  // Lossless: a 0x2f signature, then (width-1) and (height-1) as 14 bits each, little-endian.
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  // Extended: the canvas size is two 24-bit little-endian (size-1) fields in the VP8X chunk.
  if (chunk === "VP8X") {
    const read24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    return { width: read24(24) + 1, height: read24(27) + 1 };
  }
  return null;
}

const frames = Object.entries(LANDING_FRAMES) as Array<[string, LandingFrame]>;
const sources = frames.flatMap(([name, frame]) => [
  [`${name} desktop`, frame.desktop] as const,
  [`${name} phone`, frame.phone] as const,
]);

describe("the landing frames", () => {
  it("covers the three steps the page names", () => {
    expect(frames.map(([name]) => name)).toEqual(["compile", "verify", "recompile"]);
  });

  it.each(frames)("%s opens the live /explore view it is a screenshot of", (_name, frame) => {
    expect(frame.href).toMatch(/^\/explore(\?|$)/);
    expect(frame.captured, "the capture date is a field, not a sentence").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(frame.captured)), `${frame.captured} is not a date`).toBe(false);
  });

  /*
    §35, applied where it is easiest to break: a caption under a screenshot is where "1,247
    objects" gets typed. Neither language may carry a digit in the text a reader or a screen
    reader receives -- a frame that needs to state a figure needs a receipt, not a caption.
  */
  it.each(frames)("%s describes the frame without stating a figure", (_name, frame) => {
    for (const [field, value] of [
      ["alt", frame.alt],
      ["caption", frame.caption],
      ["ko.alt", frame.ko.alt],
      ["ko.caption", frame.ko.caption],
    ] as const) {
      expect(value.trim().length, `${field} is empty`).toBeGreaterThan(0);
      expect(/\d/.test(value), `${field} states a figure: ${value}`).toBe(false);
    }
  });

  it.each(sources)("%s is a sized WebP under /landing", (_label, source) => {
    expect(source.src).toMatch(/^\/landing\/.+\.webp$/);
    expect(source.width).toBeGreaterThan(0);
    expect(source.height).toBeGreaterThan(0);
  });

  /*
    The declared size is what the browser reserves before the bytes arrive, so a file whose real
    dimensions differ is layout shift on the frames a reader scrolls straight into. Skipped, named
    and visible while the capture has not landed yet.
  */
  for (const [label, source] of sources) {
    const file = join(PUBLIC, source.src);
    it.skipIf(!existsSync(file))(`${label} declares the size its bytes actually are`, () => {
      const measured = webpSize(file);
      expect(measured, `${source.src} is not a readable WebP`).not.toBeNull();
      expect(`${measured!.width}x${measured!.height}`).toBe(`${source.width}x${source.height}`);
    });
  }
});
