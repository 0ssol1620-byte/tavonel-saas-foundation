import { ImageResponse } from "next/og";
import { OgLogomark } from "@/lib/og-card";

/**
 * BQ-062. The mark a phone puts on its home screen.
 *
 * There was none, so an iOS reader who saved the site got a screenshot of the page scaled into a
 * rounded square -- the one place a brand is looked at in isolation, and the site had nothing to
 * put there. Drawn from `OgLogomark`, which is decision A-06's geometry, so this is the same mark
 * as the nav, the favicon and every share card rather than a fourth drawing of it.
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
          background: "#08090A",
        }}
      >
        <OgLogomark size={124} />
      </div>
    ),
    size,
  );
}
