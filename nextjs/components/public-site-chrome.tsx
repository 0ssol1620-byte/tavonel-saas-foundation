import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import PublicPrimaryCta from "@/components/public-primary-cta";
import { FOOTER_GROUPS, PRIMARY_NAV } from "@/lib/site-navigation";

export function PublicSiteHeader({ cta }: { cta?: { label: string; href: string } }) {
  return (
    <header className="nav" data-stuck={1}>
      <Link href="/" className="wordmark" aria-label="TAVONEL home">
        <Logomark />
        <b>TAVONEL</b>
      </Link>
      <nav aria-label="Sections">
        {PRIMARY_NAV.map((link) => (
          <Link key={link.href} href={link.href as Route}>{link.label}</Link>
        ))}
      </nav>
      <MobilePrimaryNav />
      <span className="nav-actions">
        {cta ? <Link className="btn small" href={cta.href as Route}>{cta.label}</Link> : <PublicPrimaryCta />}
        <Link className="nav-signin" href="/login">Sign in</Link>
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
