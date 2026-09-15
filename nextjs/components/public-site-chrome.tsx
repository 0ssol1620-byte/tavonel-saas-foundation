import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import DesktopPrimaryNav from "@/components/site-nav/desktop-primary-nav";
import { deploymentStateLine, primaryCallToAction } from "@/lib/commercial-state";
import { MarketingConsentLink } from "@/components/marketing-consent";
import { FOOTER_GROUPS, FOOTER_LEGAL_ROW, KO_CHROME, type SiteLink } from "@/lib/site-navigation";
import chrome from "./public-site-chrome.module.css";

/**
 * The header, once, for every public surface including the three that used to hand-roll one.
 *
 * The landing page needed a scroll-reactive `data-stuck` and its KNOWLEDGE COMPILER badge,
 * `/pricing` needed its own access label, and the policy pages had a two-link nav of their own --
 * so three files each kept a copy of the row, and a change to the navigation had to be made four
 * times or the site's structure changed as a visitor moved through it. Those three differences are
 * the three props below; everything else is this component.
 *
 * `signedIn` suppresses Sign in rather than the action beside it. A reader who is already
 * authenticated does not need the link, and offering both put the same destination in the row
 * twice on the landing page.
 *
 * BA-232: `cta` is required. It was optional, and the fallback was a client component that
 * painted a placeholder label and then replaced it once `/api/status` answered -- on every page
 * that took the fallback, which was every page but three. The caller resolves the action instead,
 * which every caller can: two of them are client components that already receive the commercial
 * state as a prop, and the rest reach this file through `PublicSitePage` below.
 *
 * G1-001 / G2-026: `mode` now falls back to `deploymentStateLine()` rather than to nothing.
 * What this deployment is -- a finished public World to read, and your own files arranged with
 * us rather than switched on by a checkout -- was stated on /pricing, /security, /status and
 * behind the /login click, and nowhere a visitor meets first. It is read off `activationPolicy`,
 * so it appears wherever the header does and removes itself on the day the gate opens.
 */
export function PublicSiteHeader({
  cta,
  mode,
  signedIn,
  stuck = true,
  korean = false,
}: {
  cta: SiteLink;
  mode?: { label: string; title: string };
  signedIn?: boolean;
  stuck?: boolean;
  /** G1-043: /ko is the site's one Korean URL, and it rendered an English header around it. */
  korean?: boolean;
}) {
  // G1-001 / G2-026: see the note above. A caller's own `mode` (the pilot badge) still wins.
  const english = deploymentStateLine();
  const state = mode ?? (english && korean ? { ...english, label: KO_CHROME.stateLine } : english);
  const ctaLabel = korean ? KO_CHROME.cta[cta.href] ?? cta.label : cta.label;
  return (
    <header className="nav" data-stuck={stuck ? 1 : 0}>
      <Link href="/" className="wordmark" aria-label="TAVONEL home">
        <Logomark />
        <b>TAVONEL</b>
      </Link>
      {state ? (
        <span className={`mode ${chrome.state}`} title={state.title}>
          <i aria-hidden="true" />
          {state.label}
        </span>
      ) : null}
      <DesktopPrimaryNav />
      {/*
        G1-043: the same action, with the label the header is showing beside it. The phone sheet
        still renders the object it is given and writes no label of its own.
      */}
      <MobilePrimaryNav cta={{ ...cta, label: ctaLabel }} />
      <span className="nav-actions">
        {/*
          BA-249: ghost, not filled. On /product and /developers the header's filled button and
          the hero's filled button were the same action, twice, in one viewport -- and a view with
          two filled primaries has none. The hero keeps the fill; the header keeps the action
          available on every scroll position, which is what it is for.
        */}
        <Link className="btn small ghost" href={cta.href as Route}>{ctaLabel}</Link>
        {signedIn ? null : <Link className="nav-signin" href="/login">{korean ? KO_CHROME.signIn : "Sign in"}</Link>}
      </span>
    </header>
  );
}

export function PublicSiteFooter({ korean = false }: { korean?: boolean } = {}) {
  return (
    <footer className="site">
      <div className="shell">
        <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
        <div className="site-footer-groups">
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <p className="site-footer-title">{korean ? KO_CHROME.footerGroups[group.title] ?? group.title : group.title}</p>
              {/* T1-014: the footer is always below the fold; prefetching every group wasted ~185KB on a cold home load. */}
              {group.links.map((link) => (
                <Link key={link.href} href={link.href as Route} prefetch={false}>{link.label}</Link>
              ))}
            </nav>
          ))}
        </div>
        <p className="fine">{korean ? KO_CHROME.tagline : "Knowledge compiled with a traceable path back to every source."}</p>
        {/*
          BA-250: the row a procurement reader looks for. Copyright, the Korean entry and the
          security inbox -- the last two are pages and an address this site already publishes, so
          nothing here is a new commitment. The legal entity and the governing jurisdiction are
          deliberately absent; see `FOOTER_LEGAL_ROW`.
        */}
        <p className="fine site-footer-legal">
          {FOOTER_LEGAL_ROW.copyright}
          {" · "}
          <Link href={FOOTER_LEGAL_ROW.language.href as Route} hrefLang="ko">
            {FOOTER_LEGAL_ROW.language.label}
          </Link>
          {" · "}
          <a href={`mailto:${FOOTER_LEGAL_ROW.security}`}>{FOOTER_LEGAL_ROW.security}</a>
          {/* G1-033 / G2-006: the consent-withdrawal path lives here after a choice, not in a floating pill. */}
          <MarketingConsentLink />
        </p>
      </div>
    </footer>
  );
}

export function PublicSitePage({ children, korean = false }: { children: React.ReactNode; korean?: boolean }) {
  /*
    The commercial posture, read once per page rather than fetched once per visitor.

    This module is also reached from two client components (`home-page-client`,
    `pricing-page-client`), each of which passes its own already-resolved `cta` and never renders
    `PublicSitePage`. That is why the call is here and not inside `PublicSiteHeader`: a client
    render of this function would inline the unprefixed flags as `undefined` and quietly return
    the closed posture.
  */
  return (
    <div className="page public-page" lang={korean ? "ko" : undefined}>
      <PublicSiteHeader cta={primaryCallToAction()} korean={korean} />
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicSiteFooter korean={korean} />
    </div>
  );
}
