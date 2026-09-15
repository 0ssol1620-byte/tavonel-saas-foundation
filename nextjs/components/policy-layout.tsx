import Link from "next/link";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import Logomark from "@/components/logomark";
import { PublicSiteHeader } from "@/components/public-site-chrome";
import { primaryCallToAction } from "@/lib/commercial-state";

/*
  BA-174. The eyebrow group was PUBLIC RECORD, which is a registry's word for a filing and not a
  company's word for its own terms. It is LEGAL by default, and /status passes its own.

  BA-167. Effective and last-updated are a labelled pair under the H1 rather than a date buried in
  an intro sentence, because four documents shared one effective date that was older than their
  contents. Each page passes its own.
*/
export default function PolicyLayout({
  group = "LEGAL",
  label,
  title,
  effective,
  lastUpdated,
  intro,
  children,
  closing,
}: {
  group?: string;
  label: string;
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
          <div className="shell"><div className="body">
            <div className="stack">
              <p className="slate"><b>{group}</b><span />{label}</p>
              <h1 className="document-title">{title}</h1>
              {effective ? (
                <p className="fine">Effective {effective}{lastUpdated ? <> &middot; Last updated {lastUpdated}</> : null}</p>
              ) : null}
            </div>
            <div className="stack">
              <p className="lede">{intro}</p>
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
          </div></div>
        </section>
      </main>
      <footer className="site"><div className="shell"><span className="wordmark"><Logomark /><b>TAVONEL</b></span><nav className="site-links" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/refunds">Refunds</Link><Link href="/subprocessors">Subprocessors</Link><Link href="/security">Security</Link><Link href="/status">Service status</Link><Link href="/contact">Contact</Link></nav><LegalOperatorDisclosure compact /><p className="fine">Questions about this policy: <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a></p></div></footer>
    </div>
  );
}
