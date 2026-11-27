import { ImageResponse } from "next/og";
import { OgLogomark } from "@/lib/og-card";

/**
 * BQ-062. The mark a phone puts on its home screen.
 *
 * Drawn from `OgLogomark`, the V34 blueprint mark's geometry (`lib/brand-mark.json`), so it is the
 * same mark as the nav, the favicon and every share card. iOS fills a transparent icon with black,
 * so the tile sits on the blueprint's paper, `#f7f8f4`.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f8f4",
        }}
      >
        <OgLogomark size={110} />
      </div>
    ),
    size,
  );
}
