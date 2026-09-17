import Link from "next/link";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import Logomark from "@/components/logomark";
import PolicyJumpIndex, { IndexedPolicyBody } from "@/components/policy-jump-index";
import { PublicSiteHeader } from "@/components/public-site-chrome";
import { primaryCallToAction } from "@/lib/commercial-state";

export default function PolicyLayout({
  title,
  effective,
  lastUpdated,
  intro,
  children,
  closing,
}: {
  title: string;
  effective?: string;
  lastUpdated?: string;
  intro: React.ReactNode;
  children: React.ReactNode;
  /** One extra ghost action, for a page that has a second obvious next step. */
  closing?: React.ReactNode;
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
          <div className="shell"><div className="body"><IndexedPolicyBody>
            <div className="stack">
              <h1 className="document-title">{title}</h1>
              {effective ? (
                <p className="fine">Effective {effective}{lastUpdated ? <> &middot; Last updated {lastUpdated}</> : null}</p>
              ) : null}
            </div>
            <div className="stack">
              <p className="lede">{intro}</p>
              {/*
                G2-040 / G2-041. The index is read from the rendered `<h2>`s, so the five pages
                using this layout declare nothing and cannot fall out of step with it.

                BQ-108: it sits after the lede rather than in the title column. In the title
                column it was the first thing under the H1 at every width the two columns
                collapse at -- a reader met the table of contents before the sentence saying what
                the document is. The lede is one paragraph; the index reads as a way into the
                document once you know what document it is.
              */}
              <PolicyJumpIndex />
              <div className="policy-copy">{children}</div>
              {/*
                BA-159. A reader who arrives on a policy page from a search result or from a
                contract had no way onward from it: no button, no next step, and the header's
                navigation is the only product link on the page. One ghost action closes each
                document, back to the index that sent most readers here.
              */}
              <div className="actions">
                <Link className="btn ghost" href="/trust">Back to the Trust Center</Link>
                {closing}
              </div>
            </div>
          </IndexedPolicyBody></div></div>
        </section>
      </main>
      <footer className="site"><div className="shell"><span className="wordmark"><Logomark /><b>TAVONEL</b></span><nav className="site-links" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/refunds">Refunds</Link><Link href="/subprocessors">Subprocessors</Link><Link href="/security">Security</Link><Link href="/status">Service status</Link><Link href="/contact">Contact</Link></nav><LegalOperatorDisclosure compact /><p className="fine">Questions about this policy: <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a></p></div></footer>
    </div>
  );
}
