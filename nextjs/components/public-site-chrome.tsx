import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import DesktopPrimaryNav from "@/components/site-nav/desktop-primary-nav";
import { primaryCallToAction } from "@/lib/commercial-state";
import { FOOTER_GROUPS, FOOTER_LEGAL_ROW, type SiteLink } from "@/lib/site-navigation";

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
 */
export function PublicSiteHeader({
  cta,
  mode,
  signedIn,
  stuck = true,
}: {
  cta: SiteLink;
  mode?: { label: string; title: string };
  signedIn?: boolean;
  stuck?: boolean;
}) {
  return (
    <header className="nav" data-stuck={stuck ? 1 : 0}>
      <Link href="/" className="wordmark" aria-label="TAVONEL home">
        <Logomark />
        <b>TAVONEL</b>
      </Link>
      {mode ? (
        <span className="mode" title={mode.title}>
          <i aria-hidden="true" />
          {mode.label}
        </span>
      ) : null}
      <DesktopPrimaryNav />
      <MobilePrimaryNav cta={cta} />
      <span className="nav-actions">
        {/*
          BA-249: ghost, not filled. On /product and /developers the header's filled button and
          the hero's filled button were the same action, twice, in one viewport -- and a view with
          two filled primaries has none. The hero keeps the fill; the header keeps the action
          available on every scroll position, which is what it is for.
        */}
        <Link className="btn small ghost" href={cta.href as Route}>{cta.label}</Link>
        {signedIn ? null : <Link className="nav-signin" href="/login">Sign in</Link>}
      </span>
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className="site">
      <div className="shell">
        <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
        <div className="site-footer-groups">
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <p className="site-footer-title">{group.title}</p>
              {group.links.map((link) => (
                <Link key={link.href} href={link.href as Route}>{link.label}</Link>
              ))}
            </nav>
          ))}
        </div>
        <p className="fine">Knowledge compiled with a traceable path back to every source.</p>
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
        </p>
      </div>
    </footer>
  );
}

export function PublicSitePage({ children }: { children: React.ReactNode }) {
  /*
    The commercial posture, read once per page rather than fetched once per visitor.

    This module is also reached from two client components (`home-page-client`,
    `pricing-page-client`), each of which passes its own already-resolved `cta` and never renders
    `PublicSitePage`. That is why the call is here and not inside `PublicSiteHeader`: a client
    render of this function would inline the unprefixed flags as `undefined` and quietly return
    the closed posture.
  */
  return (
    <div className="page public-page">
      <PublicSiteHeader cta={primaryCallToAction()} />
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicSiteFooter />
    </div>
  );
}
