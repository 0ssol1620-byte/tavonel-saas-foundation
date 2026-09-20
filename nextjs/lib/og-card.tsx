/*
  T1-008 / G1-028 / G2-027 -- one card design, one file, a per-page title.

  Every sitemap page but three shared a single defect: the page declares
  `openGraph: { url: "/x" }`, and a `metadata.openGraph` object declared by a page *replaces* the
  one it inherits rather than merging into it, so the root `app/opengraph-image.tsx` reached `/`
  and nothing else. Seventeen trust, pricing and docs URLs unfurled as a bare line of text in
  Slack, LinkedIn and iMessage -- the places this product is actually passed around.

  The mechanism is Next's own file convention rather than a URL written into each page's metadata,
  for one reason that decides it: `mergeStaticMetadata` runs *after* the page's own metadata at
  the same route segment and fills `openGraph.images` when the page did not set it
  (`next/dist/lib/metadata/resolve-metadata.js`). So an `opengraph-image.tsx` beside a page.tsx
  wins without the page.tsx being touched -- which is what lets this land without a diff in five
  other lanes' files. Next also mirrors the image into `twitter:image` and lifts the card to
  `summary_large_image` on its own.

  What each of those files is allowed to be is the other half: three lines, re-exporting `alt`,
  `size` and `contentType` from here and calling `ogCard(...)` for its own title. No page gets its
  own layout, its own colours or its own second copy of the wordmark, because a share card that
  drifts per page is how a site ends up with fourteen different logos.

  No claim appears on a card that its page does not make. The title and the line under it are the
  page's own title and its own description, shortened by hand where a description does not fit --
  never a new sentence written for the card.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { BRAND_LINE } from "./site-navigation";
import mark from "./brand-mark.json";

export const alt = `TAVONEL share card — ${BRAND_LINE.descriptor}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#08090A";
const INK = "#EDEAE4";
const MID = "#9AA3A8";
const VERIFIED = "#7BE0BE";
const HAIRLINE = "rgba(237, 234, 228, 0.16)";

/*
  TRUST-09 / VIS-51. The entry card carries the product, not a description of it.

  `/` and `/ko` unfurled as a wordmark, a headline and a line of grey -- the same three text
  elements as the other twenty-nine cards, on the one URL that actually gets pasted into a channel
  by someone who has never seen the product. A share card is a screenshot slot, and this site was
  spending it on a sentence the link text already says.

  The frame is `/explore`'s evidence view at 1440: the filing page with the region the compiler
  read outlined on it, and beside it the passage that region produced. It is a crop of a real
  render (`reports/landing-0918/frames-2/verify-1440.png`, x 1450 y 530, 1244 x 910, resampled to
  660 x 483) and never a drawing of one -- the rule that the product UI is the marketing asset.

  It is read off disk into a data URI rather than fetched. Satori resolves `<img src>` before it
  lays out, so an absolute URL would make the card for `/` depend on the origin being up and on
  itself, which is exactly the moment a cold deploy cannot satisfy. A missing file throws here
  rather than unfurling a card with a hole in it.

  Nothing is written around the frame: no caption, no number, no second claim. The page's own two
  lines stay the only sentences on the card.
*/
const FRAME = { width: 660, height: 483, left: 556, top: 74 } as const;
const COLUMN = FRAME.left - 72 - 40; // the card's padding, then the gutter before the frame.

let frameUri: string | undefined;
function evidenceFrame(): string {
  frameUri ??= `data:image/png;base64,${readFileSync(
    join(process.cwd(), "public", "og", "evidence-frame.png"),
  ).toString("base64")}`;
  return frameUri;
}

/*
  BQ-008. One mark, one geometry, one place it is drawn.

  This was a 3x3 grid of cells with the middle one lit -- the nine-cell AI/ML mark BA-230 banned
  and `lib/brand-marks.test.ts` already refused in `components/logomark.tsx` and `app/icon.svg`.
  It was still shipping on twenty-nine share cards, which are the only place most readers meet
  the brand at all, so the site had two logos and the wrong one travelled.

  Decision A-06's paths, scaled 24 -> 48: verso with its corner cut, a shorter recto, one thread
  between them at -34.2 degrees. Stroke widths scale with it (1.9 -> 3.8, 1.6 -> 3.2).
  `brand-marks.test.ts` pins the arithmetic so this cannot drift from the nav mark again.
*/
export function OgLogomark({ size: px = 48 }: { size?: number }) {
  // LOCUS, the same two paths as components/logomark.tsx. One ink, fully solid.
  return (
    <svg width={px} height={px} viewBox={mark.viewBox} fill="none" stroke={INK} strokeLinecap="square">
      {mark.paths.map(path => <path key={path.d} d={path.d} strokeWidth={path.strokeWidth} />)}
    </svg>
  );
}

/**
 * The card for one page.
 *
 * `title` is the page's own name, not its `<title>`: the " — TAVONEL" suffix every page carries is
 * already said by the wordmark in the corner, and repeating it costs the line that has the least
 * room. `summary` is the sentence under it; pass the page's description, or a shortened form of it
 * when the full one runs past two lines at 28px.
 */
export function renderOgCard(title: string, summary: string, frame = false) {
  const column = frame ? COLUMN : 1000;
  return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: GROUND,
            padding: 72,
            fontFamily: "sans-serif",
            position: "relative",
          }}
        >
          {frame ? (
            /*
              Sixteen pixels off the right edge, and the passage inside it runs off its own bottom:
              a window on something still running rather than a screenshot centred in a mat. The
              root clips the overhang. Nothing rescales the crop -- the PNG is written at the exact
              size it is drawn at, so its text stays as sharp as the source render was.
            */
            <div
              style={{
                position: "absolute",
                left: FRAME.left,
                top: FRAME.top,
                display: "flex",
                overflow: "hidden",
                borderRadius: 10,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Satori is not a browser and
                  has no `next/image`: `<img>` is the only element it resolves a source from, and
                  the source here is a data URI it decodes in-process. */}
              <img src={evidenceFrame()} width={FRAME.width} height={FRAME.height} alt="" />
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <OgLogomark size={48} />
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 5, color: MID }}>TAVONEL</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24, width: column }}>
            {/*
              One flex line, wrapped by the renderer rather than broken by hand. The root card
              breaks its three lines itself because it is one fixed headline; these titles are
              two to five words and a hand break would be wrong for most of them.
            */}
            <div style={{ display: "flex", fontSize: frame ? 44 : title.length > 34 ? 48 : 68, lineHeight: 1.12, color: INK, letterSpacing: -1.5, maxWidth: column }}>
              {title}
            </div>
            <div style={{ display: "flex", width: 96, height: 3, background: VERIFIED }} />
            <div style={{ display: "flex", fontSize: frame ? 23 : 26, lineHeight: 1.5, color: MID, maxWidth: frame ? column : 940 }}>
              {summary}
            </div>
          </div>
        </div>
      ),
      size,
    );
}

/**
 * The same card as a Next `opengraph-image` default export, for the segments whose title is known
 * at author time. A dynamic segment calls `renderOgCard` directly with the record it resolves.
 */
export function ogCard(title: string, summary: string, frame = false) {
  return function OpengraphImage() {
    return renderOgCard(title, summary, frame);
  };
}
