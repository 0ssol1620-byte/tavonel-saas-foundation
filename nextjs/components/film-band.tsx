"use client";

/**
 * A compile cut, playing where the page needs it.
 *
 * One video element for every viewport. An earlier version gave phones a still and desktops the
 * film, on the theory that a four-column frame is unreadable at 390px — which is true of the
 * *text* inside the columns and false of the thing the band is actually for. What a first-time
 * visitor takes from this band in three seconds is that four processes are running at once on
 * their documents, and that reads at any width. It cannot read from a static image at any width.
 *
 * Not a link. The band used to wrap the video in an anchor to `/film-N`, which put a pointer
 * cursor and a navigation on the largest object on the page — a visitor who clicks to inspect
 * the frame gets thrown onto a bare canvas route instead. The films play in place; the routes
 * still exist for direct visits.
 *
 * Autoplay needs all three of `muted`, `playsInline` and `autoPlay` together: iOS Safari refuses
 * inline autoplay without `playsInline`, and every browser refuses it with sound. There is no
 * audio track in any of these files.
 *
 * `play()` is called on every intersection rather than once, because a paused-by-scroll video
 * does not resume on its own and a browser can reject the first attempt while the tab is still
 * settling. The observer is the retry.
 */

import { useEffect, useRef, useState } from "react";

export default function FilmBand({
  src,
  poster,
  label,
}: {
  src: string;
  poster: string;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced) return;

    /*
      Wanted vs. actually playing.

      A `pause` listener that always called play() fought the observer: scrolling a band off
      screen paused it, the pause event immediately restarted it, and three 18s loops ran at
      once. The wanted flag is the only thing that may call play(). Visibility and decoder
      stalls still resume — but only a band that is supposed to be on.
    */
    let wanted = false;
    const resume = () => {
      if (wanted && video.paused) void video.play().catch(() => undefined);
    };

    // rootMargin pulls the load forward: a band that starts fetching only once it is half on
    // screen shows a poster for the first second of the thing it is supposed to be proving.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        wanted = entry.isIntersecting;
        if (wanted) resume();
        else video.pause();
      },
      { threshold: 0.15, rootMargin: "400px 0px" },
    );
    io.observe(video);

    const onVisible = () => { if (document.visibilityState === "visible") resume(); };
    document.addEventListener("visibilitychange", onVisible);
    video.addEventListener("stalled", resume);
    video.addEventListener("canplay", resume);

    return () => {
      wanted = false;
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      video.removeEventListener("stalled", resume);
      video.removeEventListener("canplay", resume);
    };
  }, [reduced, src]);

  if (reduced) {
    return (
      <div className="film-band">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt={label} className="film-band-video" />
      </div>
    );
  }

  return (
    <div className="film-band">
      <video
        ref={videoRef}
        className="film-band-video"
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        poster={poster}
        aria-label={label}
      >
        <source src={src} type="video/mp4" />
      </video>
    </div>
  );
}
