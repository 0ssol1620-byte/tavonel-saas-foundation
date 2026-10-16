"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  CONSENT_ANCHOR_ATTRIBUTE,
  CONSENT_EDIT_EVENT,
  CONSENT_KEY,
  GA_ID,
  NAV_OPEN_EVENT,
  consentCopy,
  consentSurface,
  marketingEventPayload,
  publicPageLocation,
  readConsent,
  referralOrigin,
} from "@/lib/marketing-analytics";
import styles from "./marketing-consent.module.css";

/**
 * The reopen control, for the footer's standing link row (G1-033).
 *
 * `components/public-site-chrome.tsx` renders it beside the other legal links. It is a button and
 * not a link because it opens a choice rather than navigating, and it carries the anchor
 * attribute so the banner below knows a footer control exists on this page and does not draw a
 * second one over the page.
 *
 * It renders on every measured public page rather than only after a choice has been made: a
 * reader who has not answered yet sees the bar, and a reader who has sees one link where they
 * already look for privacy links. A control that appears and disappears from the footer is harder
 * to find than one that is always in it.
 */
export function MarketingConsentLink() {
  const pathname = usePathname();
  if (!publicPageLocation(pathname)) return null;
  return (
    <>
      {/*
        BQ-051. The separator belongs to the link, not to the row that holds it.

        The footer wrote `{" · "}<MarketingConsentLink />`, and this component returns null on an
        unmeasured path -- /404 and every workspace and auth route -- so the legal row rendered
        the security address running straight into the next label with no separator between them.
        Four separate review lenses reported the same run-on string. Owning the separator here
        means it cannot outlive the thing it separates -- and the label itself still comes from
        `consentCopy`, never from a word typed into this file.

        Release 2: the separator is its own aria-hidden span, between two items, so the footer can
        drop it where the legal row becomes a grid (no line may start with a stray dot).
      */}
      <span className="site-footer-legal-sep" aria-hidden="true">·</span>
      <span className="site-footer-legal-pair">
        <button
          type="button"
          className={styles.settings}
          {...{ [CONSENT_ANCHOR_ATTRIBUTE]: "" }}
          onClick={() => window.dispatchEvent(new CustomEvent(CONSENT_EDIT_EVENT))}
        >
          {consentCopy(pathname).settings}
        </button>
      </span>
    </>
  );
}

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  "ga-disable-G-XQ6Z2RJME7"?: boolean;
};
/**
 * Release 2 (orchestrator decision, 2026-10-15): the first-time prompt is not on the first paint.
 * It appears after the first scroll past `scrollPx` or `delayMs` after load, whichever comes first,
 * and at once when the footer's reopen control asks for it. Nothing loads before a
 * choice either way -- the vendor gate below reads `consent`, not this.
 */
export const CONSENT_REVEAL = { scrollPx: 200, delayMs: 8000 } as const;

/*
  Fix round 3 (judge gap 3). On a Home phone the revealed card is a bottom sheet that never opens
  over the hero film: at 8 s with no scroll the film fills the foot of a 360-430px first screen,
  which is exactly where the sheet sits. The sheet's zone is its 96px two-row cap plus the 8px
  inset; while the film is in that zone the prompt waits, and it shows as soon as a scroll moves
  the film out of it (the 200px scroll path is always clear). Desktop keeps the row under the
  header, which already clears the film.
*/
const PHONE_SHEET_ZONE_PX = 104;
const PHONE = "(max-width: 899.98px)";

/*
  Fix round 4 (M3). What the sheet keeps clear of is the frame AND the stage's reading line: at 430
  the sheet cleared the frame but covered the line under it, and on a phone in Fit the line now sits
  above the frame. The clear-of region runs from the higher top to the lower bottom of the two
  boxes; the sheet may show when that region ends above its zone or starts below the screen.
*/
export function homeSheetClear(boxes: readonly { top: number; bottom: number }[], viewportHeight: number): boolean {
  if (boxes.length === 0) return true;
  const top = Math.min(...boxes.map(box => box.top));
  const bottom = Math.max(...boxes.map(box => box.bottom));
  return bottom <= viewportHeight - PHONE_SHEET_ZONE_PX || top >= viewportHeight;
}

const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };

function disableAnalytics() {
  const win = window as AnalyticsWindow;
  win[`ga-disable-${GA_ID}`] = true;
}

export default function MarketingConsent() {
  const pathname = usePathname();
  const location = publicPageLocation(pathname);
  // The banner's own sentences in the language of the page. Behaviour is identical either way --
  // the same two choices, the same storage, the same vendor gate; only these strings differ.
  const copy = consentCopy(pathname);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  // BA-245: the phone menu is modal while it is open, and this banner is not drawn over it.
  const [navOpen, setNavOpen] = useState(false);
  // G1-033: whether this page renders the footer's reopen link. Read from the DOM rather than
  // passed down, because the footer is a server component several trees away and the only thing
  // this component needs to know about it is whether it is there.
  const [anchored, setAnchored] = useState(false);
  // Release 2: whether the first-time prompt may show yet (see CONSENT_REVEAL).
  const [revealed, setRevealed] = useState(false);
  // Fix round 3: whether a Home phone's bottom sheet is clear of the hero film (see PHONE_SHEET_ZONE_PX).
  const [filmClear, setFilmClear] = useState(true);

  /*
    The server and the first client render draw nothing: the prompt is a fixed card that reserves
    no document-flow space, so mounting it later shifts nothing.
  */
  useEffect(() => {
    try { setConsent(readConsent(window.localStorage)); } catch { /* storage denied: ask, do not collect */ }
    setReady(true);
    const sync = () => {
      try { setConsent(readConsent(window.localStorage)); } catch { setConsent(null); }
    };
    window.addEventListener("storage", sync);
    const onNav = (event: Event) => setNavOpen(Boolean((event as CustomEvent).detail?.open));
    window.addEventListener(NAV_OPEN_EVENT, onNav);
    const onEdit = () => { setEditing(true); setRevealed(true); };
    window.addEventListener(CONSENT_EDIT_EVENT, onEdit);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(NAV_OPEN_EVENT, onNav);
      window.removeEventListener(CONSENT_EDIT_EVENT, onEdit);
    };
  }, []);

  useEffect(() => {
    if (revealed) return;
    const reveal = () => setRevealed(true);
    const onScroll = () => { if (window.scrollY > CONSENT_REVEAL.scrollPx) reveal(); };
    const timer = window.setTimeout(reveal, CONSENT_REVEAL.delayMs);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // a restored scroll position already counts
    return () => { window.clearTimeout(timer); window.removeEventListener("scroll", onScroll); };
  }, [revealed]);

  useEffect(() => {
    const film = document.querySelector("[data-home-ia] #s1 .compile-film-viewport");
    if (!film) { setFilmClear(true); return; }
    const line = document.querySelector("[data-home-ia] #s1 [data-film-reading]");
    const phone = window.matchMedia(PHONE);
    const check = () => {
      const boxes = [film, line].flatMap(node => (node ? [node.getBoundingClientRect()] : []));
      setFilmClear(!phone.matches || homeSheetClear(boxes, window.innerHeight));
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    // A stage change or a Focus press moves the frame and the line without a scroll.
    const resize = new ResizeObserver(check);
    resize.observe(film.closest(".compile-film-sequence") ?? film);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); resize.disconnect(); };
  }, [pathname]);

  // Per navigation: a route with the site footer and a route without it are different answers,
  // and a client-side navigation between them changes nothing else this component watches.
  useEffect(() => {
    setAnchored(document.querySelector(`[${CONSENT_ANCHOR_ATTRIBUTE}]`) !== null);
  }, [pathname]);

  useEffect(() => {
    if (!ready || consent !== true || !location || window.location.hostname !== "tavonel.com") { disableAnalytics(); return; }
    const win = window as AnalyticsWindow;
    win[`ga-disable-${GA_ID}`] = false;
    if (!win.gtag) {
      win.dataLayer = [];
      // Google expects the arguments object, not an array, for queued gtag calls.
      // eslint-disable-next-line prefer-rest-params
      win.gtag = function () { win.dataLayer!.push(arguments); };
      win.gtag("consent", "default", denied);
      win.gtag("js", new Date());
    }
    win.gtag("consent", "update", { ...denied, analytics_storage: "granted" });
    win.gtag("config", GA_ID, {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: location, page_title: "TAVONEL", page_referrer: referralOrigin(document.referrer),
      cookie_expires: 60 * 60 * 24 * 180, cookie_update: false,
    });
    win.gtag("event", "page_view", { page_location: location, page_title: "TAVONEL" });
    if (!document.getElementById("tavonel-google-tag")) {
      const script = document.createElement("script");
      script.id = "tavonel-google-tag";
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
      document.head.appendChild(script);
    }
    // UX08: what reaches the vendor is decided by `marketingEventPayload` -- an allowlisted name and
    // the current page's canonical location, never a field of the incoming detail.
    const record = (event: Event) => {
      const payload = marketingEventPayload(consent, window.location.pathname, (event as CustomEvent)?.detail);
      if (payload) win.gtag?.("event", payload.name, payload.params);
    };
    window.addEventListener("tavonel:funnel", record);
    return () => { disableAnalytics(); window.removeEventListener("tavonel:funnel", record); };
  }, [consent, location, ready]);

  function choose(allowed: boolean) {
    if (!allowed) {
      disableAnalytics();
      // Clear only this property's analytics cookies, never authentication or other cookies.
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=")[0].trim();
        if (name !== "_ga" && name !== `_ga_${GA_ID.slice(2)}`) continue;
        for (const domain of ["", `; domain=${window.location.hostname}`, "; domain=.tavonel.com"]) {
          document.cookie = `${name}=; max-age=0; path=/${domain}; SameSite=Lax; Secure`;
        }
      }
    }
    try { window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ allowed, expires: Date.now() + 180 * 24 * 60 * 60 * 1000 })); } catch { /* this page choice still works */ }
    setConsent(allowed);
    setEditing(false);
    // On withdrawal unload the vendor runtime too: no subsequent cookieless pings.
    if (!allowed && document.getElementById("tavonel-google-tag")) window.location.reload();
  }

  const surface = consentSurface({ measured: Boolean(location), ready, consent, editing, navOpen });
  if (surface === "nothing") return null;
  if (surface === "prompt" && (!revealed || !filmClear)) return null;
  /*
    G1-033. After a choice the reopen control is the footer's, so this draws nothing -- unless the
    page has no footer to carry it, in which case the old floating pill is the only withdrawal
    path there is and it stays. Never both.
  */
  if (surface === "settings") {
    if (anchored) return null;
    return <button className={`${styles.settings} ${styles.floating}`} onClick={() => setEditing(true)}>{copy.settings}</button>;
  }
  // Escape closes the card as the refuse button does; reopened from the footer, it only closes.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (consent === null) choose(false);
    else setEditing(false);
  };
  return <section className={styles.panel} aria-label={copy.region} data-marketing-consent-panel="" onKeyDown={onKeyDown}>
    <div className={styles.inner}>
      <p>{copy.prompt} <a href="/privacy">{copy.privacy}</a></p>
      <div className={styles.actions}>
        <button onClick={() => choose(false)}>{copy.refuse}</button>
        <button onClick={() => choose(true)}>{copy.allow}</button>
      </div>
    </div>
  </section>;
}
