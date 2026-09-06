/**
 * The link preview.
 *
 * A private pilot spreads by someone pasting the URL into Slack or a message, and until now that
 * produced a text-only card. Drawing it here rather than committing a PNG means the card cannot
 * drift away from the page it previews -- there is no second copy of the wording to forget.
 *
 * Deliberately quiet: the logomark, the line the whole site hangs off, and the honest mode tag.
 * No claim appears here that the page itself does not make.
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
  return <div style={{ width: 22, height: 22, borderRadius: 2, background: lit ? VERIFIED : "#3A4245" }} />;
}

export default function OpengraphImage() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", width: 74, gap: 4 }}>
            <Cell /><Cell /><Cell />
            <Cell /><Cell lit /><Cell />
            <Cell /><Cell /><Cell />
          </div>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 6, color: INK }}>TAVONEL</div>
        </div>

        {/*
          The share card carries the same headline as the hero (RESOLVED A-2).

          Broken across three lines by hand at 56px rather than left to wrap: the content box is
          1,056px wide after the 72px padding, and the headline is longer than the one it
          replaces, so an unbroken line would wrap wherever it ran out of room rather than where
          the sentence does.
        */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 56, lineHeight: 1.1, color: INK, letterSpacing: -1.5 }}>
            Your AI needs more
          </div>
          <div style={{ display: "flex", fontSize: 56, lineHeight: 1.1, color: INK, letterSpacing: -1.5 }}>
            than searchable files.
          </div>
          <div style={{ display: "flex", fontSize: 56, lineHeight: 1.1, color: VERIFIED, letterSpacing: -1.5 }}>
            It needs a current, traceable world.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 24, lineHeight: 1.5, color: MID, maxWidth: 940 }}>
          TAVONEL compiles your own sources into that world, and every compiled fact stays
          traceable to its exact source location.
        </div>
      </div>
    ),
    size,
  );
}
