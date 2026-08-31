import HomePageClient from "@/components/home-page-client";
import FilmBand from "@/components/film-band";

/**
 * The hero cut, rendered from the server so its markup is in the initial HTML.
 *
 * This used to be a bare <video> written out here by hand, which made it the only band on the
 * page without `FilmBand`'s playback logic — no observer, no resume on visibility change or
 * decoder stall. The other three cuts are restarted every time they are scrolled back to, so a
 * dropped frame there is invisible; the hero is on screen from load, crosses its loop point
 * with nobody touching it, and had nothing to restart it. It froze, and reads as a video that
 * never played.
 *
 * It also carried inline `aspectRatio: 1280 / 800` and `width/height` attributes describing a
 * resolution the master no longer has — the cuts are 1440x900 — so the reserved box was the
 * wrong shape and the inline styles overrode the stylesheet's viewport-fitting rules.
 *
 * `FilmBand` is a client component; rendering it here still emits its markup server-side, which
 * is what the preload hint and LCP need.
 */
function HeroProofFrame() {
  return (
    <FilmBand
      src="/film/compile-cut.mp4"
      poster="/film/poster-1.webp"
      label="Cut 1 — a drive compiles into a world"
      priority
    />
  );
}

export default function HomePage() {
  return <HomePageClient heroProof={<HeroProofFrame />} />;
}
