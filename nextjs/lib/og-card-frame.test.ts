import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { renderOgCard } from "./og-card";
import { BRAND_LINE } from "./site-navigation";

/*
  TRUST-09 / VIS-51. The entry card renders with a real product frame on it.

  The card for `/` and `/ko` was three text elements, and the audit's point is that the one URL a
  stranger is handed spent its whole picture on a sentence. The frame is a crop of `/explore`'s
  evidence view, embedded as a data URI read off disk at render time.

  This suite exists because that embed is the part that fails silently. Satori resolves `<img src>`
  during layout: a missing file, a path that only resolves under `next dev`, or a payload Satori
  will not decode does not throw a type error and does not fail a lint -- it produces a card with a
  hole where the product was, and nobody sees it until it is in someone's Slack. So the check is
  the render itself, end to end, with the PNG header read back from the bytes.

  `OG_PREVIEW=<path> pnpm exec vitest run lib/og-card-frame` writes the rendered card out to look
  at. The assertions below are what runs in CI; the eye is what catches a clipped headline.
*/
const FRAME = resolve(import.meta.dirname, "../public/og/evidence-frame.png");

/** width and height out of a PNG's IHDR, which is always the first chunk. */
function pngHeader(bytes: Buffer) {
  expect(bytes.subarray(0, 8), "not a PNG").toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function render(frame: boolean) {
  const response = renderOgCard(BRAND_LINE.headline, BRAND_LINE.descriptor, frame);
  return Buffer.from(await response.arrayBuffer());
}

describe("the entry share card", () => {
  it("ships the evidence crop where the renderer reads it from", () => {
    // `process.cwd()` at render time is the package root, which is what `join` in og-card.tsx
    // resolves against. Under `next build` the file must also be traced, and it is because it
    // lives in `public/`.
    expect(resolve(process.cwd(), "public", "og", "evidence-frame.png")).toBe(FRAME);
    expect(pngHeader(readFileSync(FRAME))).toEqual({ width: 660, height: 483 });
    // A 4x growth here means someone re-cropped without re-quantising, and the data URI is read
    // into memory on every cold render of `/`.
    expect(statSync(FRAME).size).toBeLessThan(160_000);
  });

  it("renders a 1200x630 PNG with the frame embedded", async () => {
    const bytes = await render(true);
    if (process.env.OG_PREVIEW) writeFileSync(process.env.OG_PREVIEW, bytes);
    expect(pngHeader(bytes)).toEqual({ width: 1200, height: 630 });

    // The frame is a third of a megapixel of screenshot. If Satori had dropped the <img> -- the
    // way it silently does for a source it cannot decode -- the card would still be a valid PNG,
    // and this is the only assertion that would notice.
    const textOnly = await render(false);
    expect(bytes.byteLength).toBeGreaterThan(textOnly.byteLength * 2);
  });

  it("still renders the text-only card for every other page", async () => {
    expect(pngHeader(await render(false))).toEqual({ width: 1200, height: 630 });
  });
});
