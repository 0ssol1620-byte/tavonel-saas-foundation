import HomePageClient from "@/components/home-page-client";

function HeroProofFrame() {
  return (
    <div className="film-band" style={{ aspectRatio: "1280 / 800" }}>
      <video
        className="film-band-video"
        width={1280}
        height={800}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        poster="/film/poster-1.webp"
        aria-label="Cut 1 — a drive compiles into a world"
        style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1280 / 800", objectFit: "contain" }}
      >
        <source src="/film/compile-cut.mp4" type="video/mp4" />
      </video>
    </div>
  );
}

export default function HomePage() {
  return <HomePageClient heroProof={<HeroProofFrame />} />;
}