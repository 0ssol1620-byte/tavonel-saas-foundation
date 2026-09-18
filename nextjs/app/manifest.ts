import type { MetadataRoute } from "next";
import { BRAND_LINE } from "@/lib/site-navigation";

/**
 * BQ-062. What the site is called when it is not in a browser tab.
 *
 * There was no manifest at all, so an installed or pinned TAVONEL took its name from the
 * document title of whichever page was open and its colour from the browser default: a white
 * chrome around a near-black page, and a different name every time.
 *
 * `description` is `BRAND_LINE.descriptor` rather than a sentence written here -- an install
 * prompt is a public surface and it says what every other public surface says.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TAVONEL",
    short_name: "TAVONEL",
    description: BRAND_LINE.descriptor,
    start_url: "/",
    display: "standalone",
    background_color: "#08090A",
    theme_color: "#08090A",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
