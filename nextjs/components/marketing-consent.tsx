"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  CONSENT_ANCHOR_ATTRIBUTE,
  CONSENT_EDIT_EVENT,
  CONSENT_KEY,
  GA_ID,
  MARKETING_EVENTS,
  NAV_OPEN_EVENT,
  consentCopy,
  consentSurface,
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
    <button
      type="button"
      className={styles.settings}
      {...{ [CONSENT_ANCHOR_ATTRIBUTE]: "" }}
      onClick={() => window.dispatchEvent(new CustomEvent(CONSENT_EDIT_EVENT))}
    >
      {consentCopy(pathname).settings}
    </button>
  );
}

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  "ga-disable-G-XQ6Z2RJME7"?: boolean;
};
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

  useEffect(() => {
    try { setConsent(readConsent(window.localStorage)); } catch { /* storage denied: ask, do not collect */ }
    setReady(true);
    const sync = () => {
      try { setConsent(readConsent(window.localStorage)); } catch { setConsent(null); }
    };
    window.addEventListener("storage", sync);
    const onNav = (event: Event) => setNavOpen(Boolean((event as CustomEvent).detail?.open));
    window.addEventListener(NAV_OPEN_EVENT, onNav);
    const onEdit = () => setEditing(true);
    window.addEventListener(CONSENT_EDIT_EVENT, onEdit);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(NAV_OPEN_EVENT, onNav);
      window.removeEventListener(CONSENT_EDIT_EVENT, onEdit);
    };
  }, []);

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
    const record = (event: Event) => {
      const name: unknown = (event as CustomEvent)?.detail?.event;
      if (typeof name === "string" && MARKETING_EVENTS.has(name) && publicPageLocation(window.location.pathname)) {
        win.gtag?.("event", name, { page_location: location, page_title: "TAVONEL" });
      }
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
  /*
    G1-033. After a choice the reopen control is the footer's, so this draws nothing -- unless the
    page has no footer to carry it, in which case the old floating pill is the only withdrawal
    path there is and it stays. Never both.
  */
  if (surface === "settings") {
    if (anchored) return null;
    return <button className={`${styles.settings} ${styles.floating}`} onClick={() => setEditing(true)}>{copy.settings}</button>;
  }
  return <section className={styles.panel} aria-label={copy.region}>
    <p>{copy.prompt} <a href="/privacy">{copy.privacy}</a></p>
    <div className={styles.actions}>
      <button onClick={() => choose(false)}>{copy.refuse}</button>
      <button onClick={() => choose(true)}>{copy.allow}</button>
    </div>
  </section>;
}
