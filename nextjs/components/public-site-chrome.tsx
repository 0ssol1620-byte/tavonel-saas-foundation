import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import { primaryCallToAction } from "@/lib/commercial-state";
import { FOOTER_GROUPS, PRIMARY_NAV } from "@/lib/site-navigation";

/**
 * The header and footer every public page wears.
 *
 * Server components, so the call to action can read commercial state directly: in pilot the
 * primary button says "Request access" and goes to contact, and there is no page left that can
 * quietly offer a checkout the deployment cannot honour.
 */

export function PublicSiteHeader({ cta }: { cta?: { label: string; href: string } }) {
  const action = cta ?? primaryCallToAction();
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
      <span className="nav-actions">
        <Link className="btn small" href={action.href as Route}>{action.label}</Link>
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

/** A whole public page, chrome included. Pages supply only their own content. */
export function PublicSitePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <PublicSiteHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicSiteFooter />
    </div>
  );
}
