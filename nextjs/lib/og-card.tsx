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
import { ImageResponse } from "next/og";
import { BRAND_LINE } from "./site-navigation";

export const alt = `TAVONEL share card — ${BRAND_LINE.descriptor}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#08090A";
const INK = "#EDEAE4";
const MID = "#9AA3A8";
const VERIFIED = "#7BE0BE";

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
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={INK} strokeLinecap="square">
      <path d="M2.5 5.5H7.4L9.5 7.6V18.5H2.5Z" strokeWidth={1.9} opacity={0.66} />
      <path d="M14.5 8.2H21.5V18.5H14.5Z" strokeWidth={1.9} opacity={0.66} />
      <path d="M9.5 15.5L14.5 12.1" strokeWidth={1.6} />
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
export function renderOgCard(title: string, summary: string) {
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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <OgLogomark size={48} />
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 5, color: MID }}>TAVONEL</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/*
              One flex line, wrapped by the renderer rather than broken by hand. The root card
              breaks its three lines itself because it is one fixed headline; these titles are
              two to five words and a hand break would be wrong for most of them.
            */}
            <div style={{ display: "flex", fontSize: title.length > 34 ? 48 : 68, lineHeight: 1.12, color: INK, letterSpacing: -1.5, maxWidth: 1000 }}>
              {title}
            </div>
            <div style={{ display: "flex", width: 96, height: 3, background: VERIFIED }} />
            <div style={{ display: "flex", fontSize: 26, lineHeight: 1.5, color: MID, maxWidth: 940 }}>
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
export function ogCard(title: string, summary: string) {
  return function OpengraphImage() {
    return renderOgCard(title, summary);
  };
}
