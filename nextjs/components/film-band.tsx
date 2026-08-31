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
  priority = false,
}: {
  src: string;
  /*
    Required, because it is the entire cut for some visitors.

    Dropping the posters from cuts 2–4 to save 348KB of first-load bandwidth left the
    reduced-motion branch rendering `<img src={undefined}>` — a broken-image icon and an alt
    string where the film should be. The saving was real but it was taken from the wrong place:
    the cost of a poster is only paid when it is actually shown, so the fix is to keep every
    poster and hang it off the `<video>` for the hero alone.
  */
  poster: string;
  label: string;
  /*
    The hero band is the one a visitor is already looking at.

    All three bands used `preload="auto"`, so a first visit opened three parallel downloads and
    the browser divided the connection between them — the top film, the only one on screen,
    finished last. Marking one band priority gives it `auto` and leaves the others on
    `metadata` until the observer's 400px margin brings them near, which is early enough that
    they are running before they are read.
  */
  priority?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // SSR cannot read the motion preference. Start with the safe still so a
  // reduced-motion visitor never receives a late video-to-image replacement
  // that resets LCP; motion-enabled clients opt into video after hydration.
  const [reduced, setReduced] = useState(true);

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

    /*
      The margin is a screen and a half, not 400px.

      Measured on a 1440x900 desktop, a 400px margin left cut 4 paused at t=0 while the visitor
      was already reading cut 3 — so the band they scrolled into was a black rectangle for the
      first moment, which is the "video not showing" report. A band is woken while the one above
      it is still on screen; by the time it is read it has been running for seconds.
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
  }, [reduced, src]);

  if (priority) {
    return (
      <div className="film-band">
        {/* The hero is the LCP proof frame; motion continues in the later cuts. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt={label} className="film-band-video" fetchPriority="high" />
      </div>
    );
  }

  return (
    <div className="film-band">
      {/*
        The poster attribute is the hero's alone. A `poster` on a deferred band is fetched
        immediately even though the band is a screen away, which is the 348KB that was competing
        with the film above it. Those cuts still have posters — the reduced-motion branch needs
        them — they just are not requested before they are visible.
      */}
      <video
        ref={videoRef}
        className="film-band-video"
        muted
        loop
        playsInline
        autoPlay={!reduced}
        preload={priority ? "auto" : "metadata"}
        poster={priority || reduced ? poster : undefined}
        aria-label={label}
      >
        <source src={src} type="video/mp4" />
      </video>
    </div>
  );
}
