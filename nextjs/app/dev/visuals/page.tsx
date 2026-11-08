import type { Metadata } from "next";
import VisualsPreview from "./visuals-preview";

/* W1-L7 asset preview. Gated by app/dev/layout.tsx: 404 on VERCEL_ENV=production, noindex elsewhere. */
export const metadata: Metadata = {
  title: "Visuals preview (internal)",
  description: "Internal preview of the W1-L7 product captures and explanatory diagrams at desktop and phone widths.",
  alternates: { canonical: "/dev/visuals" },
  openGraph: { url: "/dev/visuals" },
};

export default function Page() {
  return <VisualsPreview />;
}
