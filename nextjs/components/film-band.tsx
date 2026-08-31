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
 * So the phone plays it too, `contain` keeps all four columns in frame rather than cropping two
 * of them off the sides, and tapping opens the cut full screen where the text is legible.
 *
 * Autoplay is safe here and needs all three of `muted`, `playsInline` and `autoPlay` together:
 * iOS Safari refuses inline autoplay without `playsInline`, and every browser refuses it with
 * sound. There is no audio track in any of these files.
 */

import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import CanvasTransitionLink from "@/components/canvas-transition-link";

export default function FilmBand({
  src,
  poster,
  href,
  label,
}: {
  src: string;
  poster: string;
  href: Route;
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
    // rootMargin pulls the load forward: a band that starts fetching only once it is half on
    // screen shows a poster for the first second of the thing it is supposed to be proving.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.25, rootMargin: "300px 0px" },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [reduced, src]);

  return (
    <div className="film-band">
      {reduced ? (
        <CanvasTransitionLink href={href} className="film-band-link">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poster} alt="" className="film-band-video" />
        </CanvasTransitionLink>
      ) : (
        <CanvasTransitionLink href={href} className="film-band-link" aria-label={`Open ${label}`}>
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
        </CanvasTransitionLink>
      )}
    </div>
  );
}
