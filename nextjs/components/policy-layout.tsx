import Link from "next/link";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import PolicyJumpIndex, { IndexedPolicyBody } from "@/components/policy-jump-index";
import { PublicSitePage } from "@/components/public-site-chrome";

type PolicyDocumentProps = {
  title: string;
  effective?: string;
  lastUpdated?: string;
  intro: React.ReactNode;
  children: React.ReactNode;
  /** One extra ghost action, for a page that has a second obvious next step. */
  closing?: React.ReactNode;
};

/**
 * The document itself, without a chrome around it.
 *
 * chrome-05 / pages-23: `/status` used this layout for its two-column reading composition and
 * inherited the legal chrome with it -- a seven-link row ending in "Questions about this policy",
 * on a page that is not a policy and that every other route links to from the Trust group. It
 * renders this inside `PublicSitePage` now and gets the site footer, BRAND_LINE and the five
 * groups like every other public route. The four real policies use `PolicyLayout` below, which
 * is this document in the same frame, closed by the policy contact line and the operator disclosure.
 */
export function PolicyDocument({
  title,
  effective,
  lastUpdated,
  intro,
  children,
  closing,
}: PolicyDocumentProps) {
  return (
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
  );
}

export default function PolicyLayout({ children, ...document }: PolicyDocumentProps) {
  /*
    WO-CI-21 (D1): `/privacy`, `/terms`, `/refunds` and `/subprocessors` render inside the V34 frame
    through `PublicSitePage`, as /status does, so their header, container edge and footer are the
    site's. That page root declares T5; this component no longer declares a second one.

    The legal footer this replaced was a second chrome: a wordmark and a seven-link row (Privacy,
    Terms, Refunds, Subprocessors, Security, Service status, Contact), every one of which the V34
    footer carries in its groups or its legal row (`lib/v34/nav.ts`). Its two lines that are not
    navigation -- where to send a question about the policy, and the operator disclosure -- now close
    the document itself, so nothing a reader could find on these pages before is gone.
  */
  return (
    <PublicSitePage template="T5">
      <PolicyDocument {...document}>
        {children}
        <p className="fine">Questions about this policy: <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a></p>
        <LegalOperatorDisclosure compact />
      </PolicyDocument>
    </PublicSitePage>
  );
}
