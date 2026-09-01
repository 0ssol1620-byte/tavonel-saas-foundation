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

import { useEffect, useRef, useState } from "react";
import { requestLoad, settle } from "@/lib/film-queue";

export default function FilmBand({
  src,
  poster,
  label,
  index,
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
    Position in the page, counting from the top.

    The load queue admits bands in this order, so it must match the order they appear in rather
    than the order they happen to mount. The hero is 0.
  */
  index: number;
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
  /*
    Whether this band may fetch yet.

    `preload="metadata"` is a hint with no force behind it: measured on a cold connection,
    Chromium answered it by fetching cuts 3 and 4 in full — 994KB and 562KB of range-0 requests
    that finished before the hero's first frame. A hint cannot hold a download back, so the
    <source> is simply not rendered until the queue admits this band. No src, no request.
  */
  const [admitted, setAdmitted] = useState(priority);

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
      Near enough to matter, and in order.

      The margin stays generous so a band is running by the time it is scrolled to rather than
      showing a black rectangle on arrival. But being near is now only permission to *ask*: the
      queue admits bands in document order and holds each one until the films above it are
      playing. Measured cold, cuts 3 and 4 used to start downloading 1ms after the hero, from
      well below the fold, and the hero's first frame arrived at 6.5s.

      `wanted` is still set the moment the band is near, so playback resumes instantly for a
      band whose bytes have already arrived; only the fetch is sequenced.
    */
    let release: (() => void) | null = null;
    if (priority) release = requestLoad(index, () => { /* already rendered with its source */ });
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        wanted = entry.isIntersecting;
        if (wanted) {
          if (video.preload === "auto") {
            resume();
            return;
          }
          // Ask the queue rather than loading. It calls back when the bands above are playing.
          release ??= requestLoad(index, () => {
            setAdmitted(true);
            resume();
          });
        } else video.pause();
      },
      { threshold: 0, rootMargin: "1400px 0px" },
    );
    io.observe(video);

    /*
      First frame releases the next band — and so does failure.

      `playing` is the honest signal that this film has bytes on screen. If it never comes,
      `error` and a backstop timeout settle the band anyway: one cut that cannot decode must not
      leave the rest of the page unloaded.
    */
    const onPlaying = () => settle(index);
    const onError = () => settle(index);
    video.addEventListener("playing", onPlaying, { once: true });
    video.addEventListener("error", onError, { once: true });
    const backstop = window.setTimeout(() => settle(index), 8000);

    const onVisible = () => { if (document.visibilityState === "visible") resume(); };
    document.addEventListener("visibilitychange", onVisible);
    video.addEventListener("stalled", resume);
    video.addEventListener("canplay", resume);

    return () => {
      wanted = false;
      io.disconnect();
      release?.();
      window.clearTimeout(backstop);
      document.removeEventListener("visibilitychange", onVisible);
      video.removeEventListener("stalled", resume);
      video.removeEventListener("canplay", resume);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
    };
  }, [src, index, admitted]);

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
        preload={admitted ? "auto" : "none"}
        {...(priority || admitted ? { poster } : {})}
        aria-label={label}
      >
        {admitted ? <source src={src} type="video/mp4" /> : null}
      </video>
    </div>
  );
}
