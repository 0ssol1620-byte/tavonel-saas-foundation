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

export const alt = "TAVONEL — compile your own sources into a current, traceable world";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#08090A";
const INK = "#EDEAE4";
const MID = "#9AA3A8";
const VERIFIED = "#7BE0BE";

function Cell({ lit }: { lit?: boolean }) {
  return <div style={{ width: 16, height: 16, borderRadius: 2, background: lit ? VERIFIED : "#3A4245" }} />;
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
            <div style={{ display: "flex", flexWrap: "wrap", width: 54, gap: 3 }}>
              <Cell /><Cell /><Cell />
              <Cell /><Cell lit /><Cell />
              <Cell /><Cell /><Cell />
            </div>
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
