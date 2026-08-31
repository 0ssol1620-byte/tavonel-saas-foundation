"use client";

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
      <div className="film-band-desk">
        {reduced ? (
          <CanvasTransitionLink href={href} className="film-band-link">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={poster} alt="" />
            <span>Open {label}</span>
          </CanvasTransitionLink>
        ) : (
          <>
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
            <CanvasTransitionLink href={href} className="film-band-open">
              Open {label}
            </CanvasTransitionLink>
          </>
        )}
      </div>
      <CanvasTransitionLink href={href} className="film-band-phone">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt="" />
        <span>Open {label}</span>
      </CanvasTransitionLink>
    </div>
  );
}
