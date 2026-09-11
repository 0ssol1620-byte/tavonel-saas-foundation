import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import PublicPrimaryCta from "@/components/public-primary-cta";
import DesktopPrimaryNav from "@/components/site-nav/desktop-primary-nav";
import { FOOTER_GROUPS } from "@/lib/site-navigation";

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
 */
export function PublicSiteHeader({
  cta,
  mode,
  signedIn,
  stuck = true,
}: {
  cta?: { label: string; href: string };
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
      <MobilePrimaryNav />
      <span className="nav-actions">
        {cta ? <Link className="btn small" href={cta.href as Route}>{cta.label}</Link> : <PublicPrimaryCta />}
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
      </div>
    </footer>
  );
}

export function PublicSitePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="page public-page">
      <PublicSiteHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicSiteFooter />
    </div>
  );
}
