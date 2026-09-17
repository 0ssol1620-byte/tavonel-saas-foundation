import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import DesktopPrimaryNav from "@/components/site-nav/desktop-primary-nav";
import { deploymentStateLine, primaryCallToAction } from "@/lib/commercial-state";
import { MarketingConsentLink } from "@/components/marketing-consent";
import { BRAND_LINE, FOOTER_GROUPS, FOOTER_LEGAL_ROW, KO_CHROME, type SiteLink } from "@/lib/site-navigation";
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
    <header className={`nav ${chrome.header}`} data-stuck={stuck ? 1 : 0}>
      <Link href="/" className={`wordmark ${chrome.wordmark}`} aria-label="TAVONEL home">
        <Logomark />
        <b>TAVONEL</b>
      </Link>
      {/*
        BQ-058 / D10. One meaning, and it is a destination rather than a tooltip.

        This was a 9.5px monospace chip with an amber `--changed` dot and the whole explanation
        hidden in a `title` attribute -- unreadable, unreachable by touch or keyboard, and dressed
        as a live status indicator for a fact that is a policy. The dot is gone (a status light
        for something that never changes is the "glowing status dot" tell), the label is the same
        one string `deploymentStateLine()` emits at 12px in the page's own face, and the sentence
        that used to be the tooltip is a click away on /status, where the rest of what this
        deployment does and does not run belongs.
      */}
      {state ? (
        <Link className={chrome.state} href="/status">{state.label}</Link>
      ) : null}
      <DesktopPrimaryNav korean={korean} />
      <MobilePrimaryNav korean={korean} />
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

/**
 * G1-036 / BA-250 follow-through: the footer, once, for the two pages that hand-rolled their own.
 *
 * `home-page-client` and `pricing-page-client` each kept a copy of the groups and the tagline and
 * neither carried the legal row -- so the copyright, the Korean entry, the security inbox and the
 * consent-withdrawal link existed on every page except the two a visitor meets first. `onePath`
 * keeps the landing page's wider measure (`.one-path-wrap`); nothing else differs.
 */
export function PublicSiteFooter({ korean = false, onePath = false }: { korean?: boolean; onePath?: boolean } = {}) {
  return (
    <footer className={`${onePath ? "site one-path-footer" : "site"} ${chrome.footer}`}>
      <div className={onePath ? "one-path-wrap" : "shell"}>
        {/* BQ-131: the wordmark at the bottom of a page is where a reader goes home from. It was
            a bare <span> -- the one instance of the lockup on the site that was not a link. */}
        <Link href="/" className={`wordmark ${chrome.wordmark}`} aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>
        <div className={`site-footer-groups ${chrome.footerGroups}`}>
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
        {/* D8: the tagline is `BRAND_LINE.descriptor`, not a sixth copy of it. */}
        <p className="fine">{korean ? KO_CHROME.tagline : BRAND_LINE.descriptor}</p>
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
