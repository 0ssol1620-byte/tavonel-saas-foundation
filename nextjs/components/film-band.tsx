"use client";

/**
 * A compile cut, playing where the page needs it.
 *
 * One video element for every viewport and every visitor. An earlier version gave phones a still
 * and desktops the film, on the theory that a four-column frame is unreadable at 390px — which
 * is true of the *text* inside the columns and false of the thing the band is actually for. What
 * a first-time visitor takes from this band in three seconds is that four processes are running
 * at once on their documents, and that reads at any width.
 *
 * `prefers-reduced-motion` gets the film too, and that is a deliberate reading of the setting
 * rather than a shortcut. The guidance it encodes is about motion that provokes vestibular
 * symptoms: parallax, zoom, spin, large translations, things that move under the reader's eyes
 * while they are trying to read something else. These cuts have none of that — the camera never
 * moves, nothing scales, nothing flies, and the content is text appearing in four fixed panels.
 * Swapping them for a still does not protect anyone from motion sickness; it just removes the
 * only explanation of the product on the page. The setting is still honoured where it matters,
 * in `world-field` and in the page's own reveal animations.
 *
 * Not a link. The band used to wrap the video in an anchor to `/film-N`, which put a pointer
 * cursor and a navigation on the largest object on the page — a visitor who clicks to inspect
 * the frame gets thrown onto a bare canvas route instead. The films play in place; the routes
 * still exist for direct visits.
 *
 * Autoplay needs all three of `muted`, `playsInline` and `autoPlay` together: iOS Safari refuses
 * inline autoplay without `playsInline`, and every browser refuses it with sound. There is no
 * audio track in any of these files.
 */

import { useEffect, useRef } from "react";

export default function FilmBand({
  src,
  poster,
  label,
  priority = false,
}: {
  src: string;
  /*
    Required, because it is what fills the frame before the first bytes decode.

    Deleting the posters for cuts 2-4 as a bandwidth saving left bands showing nothing at all
    until their video was ready. The saving was real but taken from the wrong place: a poster
    costs nothing when it is not requested, so every cut keeps one and only the hero hands it
    to the `poster` attribute.
  */
  poster: string;
  label: string;
  /*
    The hero band is the one a visitor is already looking at.

    All three bands used `preload="auto"`, so a first visit opened three parallel downloads and
    the browser divided the connection between them — the top film, the only one on screen,
    finished last. Marking one band priority gives it `auto` and leaves the others on
    `metadata` until the observer's margin brings them near, which is early enough that they
    are running before they are read.
  */
  priority?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    /*
      Wanted vs. actually playing.

      A `pause` listener that always called play() fought the observer: scrolling a band off
      screen paused it, the pause event immediately restarted it, and every loop ran at once.
      The wanted flag is the only thing that may call play(). Visibility and decoder stalls
      still resume — but only a band that is supposed to be on.
    */
    let wanted = false;
    const resume = () => {
      if (wanted && video.paused) void video.play().catch(() => undefined);
    };

    /*
      The margin is a screen and a half, not 400px.

      Measured on a 1440x900 desktop, a 400px margin left the last cut paused at t=0 while the
      visitor was already reading the one above it — so the band they scrolled into was a black
      rectangle for the first moment. A band is woken while the one above it is still on screen;
      by the time it is read it has been running for seconds.
    */
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        wanted = entry.isIntersecting;
        if (wanted) {
          // A non-priority band holds at `metadata` until it is nearly on screen. Promoting it
          // here is what actually starts the download, and `load()` makes the element act on
          // the new value instead of waiting for the next navigation.
          if (video.preload !== "auto") {
            video.preload = "auto";
            video.load();
          }
          resume();
        } else video.pause();
      },
      { threshold: 0, rootMargin: "1400px 0px" },
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
  }, [src]);

  return (
    <div className="film-band">
      {/*
        The poster attribute is the hero's alone. A `poster` on a deferred band is fetched
        immediately even though the band is a screen away, competing with the film above it.
      */}
      <video
        ref={videoRef}
        className="film-band-video"
        muted
        loop
        playsInline
        autoPlay
        preload={priority ? "auto" : "metadata"}
        poster={priority ? poster : undefined}
        aria-label={label}
      >
        <source src={src} type="video/mp4" />
      </video>
    </div>
  );
}
