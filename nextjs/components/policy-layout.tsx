import Link from "next/link";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import Logomark from "@/components/logomark";
import { PublicSiteHeader } from "@/components/public-site-chrome";
import { primaryCallToAction } from "@/lib/commercial-state";

export default function PolicyLayout({
  label,
  title,
  intro,
  children,
}: {
  label: string;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      {/*
        The site's header, not a two-link one of its own.

        `/privacy`, `/terms`, `/refunds`, `/subprocessors` and `/status` are pages a reader lands
        on from a search result or a contract, and the nav here offered them two links and no way
        back into the product -- the fourth chrome `site-navigation.ts` describes, still standing.
        The two destinations it did carry, Service status and Contact, moved into the legal footer
        below so nothing on these pages became harder to reach.
      */}
      {/* BA-232 (nav-global CROSS-LANE 1): the header's action is resolved here now. The
          placeholder-then-replace client fallback that used to supply it is gone. */}
      <PublicSiteHeader cta={primaryCallToAction()} />
      <main id="main" tabIndex={-1}>
        <section className="scene doc policy-page">
          <div className="shell"><div className="body">
            <div className="stack"><p className="slate"><b>PUBLIC RECORD</b><span />{label}</p><h1 className="document-title">{title}</h1></div>
            <div className="stack"><p className="lede">{intro}</p><div className="policy-copy">{children}</div></div>
          </div></div>
        </section>
      </main>
      <footer className="site"><div className="shell"><span className="wordmark"><Logomark /><b>TAVONEL</b></span><nav className="site-links" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/refunds">Refunds</Link><Link href="/subprocessors">Subprocessors</Link><Link href="/security">Security</Link><Link href="/status">Service status</Link><Link href="/contact">Contact</Link></nav><LegalOperatorDisclosure compact /><p className="fine">Questions about this record: <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a></p></div></footer>
    </div>
  );
}
