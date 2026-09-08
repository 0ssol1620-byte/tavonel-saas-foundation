import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";

export const metadata: Metadata = {
  alternates: { canonical: "/trust" },
  openGraph: { url: "/trust" },
  title: "Trust Center — TAVONEL",
  description:
    "One index of everything TAVONEL publishes about how it handles documents: the data path, the processors, the legal terms, the reporting address, and the questions it has not answered yet.",
};

/*
  §49's "procurement accelerator", assembled rather than written.

  `/trust` was a 308 to `/security`, which is the right destination for one of the questions a
  security review asks and the wrong one for the other twelve: the answers are spread over five
  pages and a well-known file, and a reviewer who was sent to `/security` had no way to learn the
  other five existed. This page adds no statement about the product. Every row below points at a
  page that already says the thing, and the three that point nowhere say so in those words.

  §45 lists thirteen elements a Trust Center carries. Ten of them are published somewhere on this
  site today and three are not, so the page has two sections rather than one list with a hopeful
  tone: a reader who stops at a missing element should see that it is missing, not scroll looking
  for it. The absent three are absent because the work behind them has not been done -- there is
  no tested restore, no DPA to hand over and no written incident procedure -- and a Trust Center
  that phrases those as "coming soon" is worth less than one that phrases them as "no".
*/

const DESTINATIONS: Array<[string, string, Route]> = [
  ["Security", "The path a document takes, what holds its bytes, what never sees them, and which controls are enforced in this deployment right now.", "/security" as Route],
  ["Privacy notice", "What is collected, why it is processed, where it is stored, which processing happens outside Korea, and how to ask for access, export or deletion.", "/privacy" as Route],
  ["Subprocessors", "Every third-party service permitted to process account, document, billing or inquiry data, with the purpose and the data class for each one.", "/subprocessors" as Route],
  ["Service status", "Each component's configuration and activation state in the active deployment, with the scope of that statement written on the page.", "/status" as Route],
  ["Terms", "The agreement itself.", "/terms" as Route],
  ["Security contact", "security@tavonel.com for a vulnerability, privacy@tavonel.com for a data request, and the inquiry form for a security review.", "/contact" as Route],
];

/*
  The §17.1 questions, mapped to the page that answers each. The wording of each answer lives on
  that page and is asserted there by `lib/trust-page-answers.test.ts`; repeating it here would
  create a second copy to keep in step, and the copy on a summary page is the one that goes stale.
*/
const PUBLISHED: Array<[string, string, string]> = [
  ["Architecture and data flow", "Security", "The enforced boundary in order, and which component holds a document body at each step."],
  ["Data handling", "Privacy notice", "Categories collected, purposes, storage locations, international processing, and the optional website analytics you can decline or withdraw."],
  ["Retention and deletion", "Privacy notice", "Source material and derived artifacts are deleted on a verified request. No retention period in days is published: data remains until workspace deletion, a verified request, or a legal duty."],
  ["Encryption", "Security", "TLS in transit throughout; stored objects encrypted at rest by the storage provider. There is no customer-managed key."],
  ["Access control", "Security", "Workspace membership checked server-side on every request. There are no roles, no SSO and no seat model in this deployment."],
  ["Tenant isolation", "Security", "Workspace identity is derived server-side from the session, never from an identifier the browser supplies; storage prefixes, rows and signed capabilities are scoped to it."],
  ["Subprocessors", "Subprocessors", "Named service, purpose and data class, with a change notice commitment."],
  ["Content disarm and malware", "Security", "Quarantine, mandatory scanning and sanitization before anything downstream reads a document. Which sanitizer build is actually running is named there rather than assumed."],
  ["Vulnerability disclosure", "security.txt", "Reporting address and policy, served at the well-known path a scanner looks for."],
  ["Security contact", "Contact and security.txt", "The same address in both places."],
];

/*
  §45 asks for thirteen. Three have no answer, and each of the three is a question a reassuring
  sentence would answer badly -- "stored durably" is not a tested restore, and a reader who wanted
  one would have to find that out later.
*/
const NOT_PUBLISHED: Array<[string, string]> = [
  ["Backup and recovery", "Not yet published. This deployment states no recovery objective, no backup retention period and no tested restore. The absence of a number here is the state of it; ask before you depend on one."],
  ["Data processing agreement", "Not yet published. There is no DPA at a public URL to download. A processing review is arranged through privacy@tavonel.com, and what that review can commit to is not settled by this page."],
  ["Incident response process", "Not yet published. The reporting addresses are on the status page and in security.txt, and they are read. What is not written down is the procedure after that: no severity definitions, no notification window, no post-incident record format."],
];

export default function TrustCenterPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>TRUST CENTER</b><span />WHAT IS PUBLISHED, AND WHAT IS NOT</p>
              <h1 className="document-title">Everything we publish<br />about handling your documents.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                A security review asks the same thirteen things every time. Ten of them are
                answered on the pages below.<b> Three are not answered anywhere, and they are
                listed too</b> — a review that finds them here is faster than one that finds them
                after a pilot.
              </p>

              {/*
                The whole tile is the link, not the heading inside it.

                `a { color: inherit; text-decoration: none }` is global here, so a link wrapped
                around a heading in a tile renders as prose -- on an index whose entire job is to
                be seven destinations, that is the defect. Making the tile the anchor also gives a
                phone a target the size of the card rather than the size of two words.
              */}
              <p className="slate"><span />THE PAGES</p>
              <div className="tiles">
                {DESTINATIONS.map(([title, body, href]) => (
                  <Link className="tile trust-link" key={title} href={href}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </Link>
                ))}
                <a className="tile trust-link" key="security.txt" href="/.well-known/security.txt">
                  <h3>security.txt</h3>
                  <p>The machine-readable disclosure record: reporting address, policy and preferred languages, at the well-known path.</p>
                </a>
              </div>

              <p className="slate"><span />WHAT A REVIEW ASKS, AND WHERE IT IS ANSWERED</p>
              <div className="chain">
                {PUBLISHED.map(([question, where, detail]) => (
                  <article className="link" key={question}>
                    <span className="st">{where}</span>
                    <h2>{question}</h2>
                    <p>{detail}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />NOT ANSWERED ANYWHERE YET</p>
              <div className="tiles">
                {NOT_PUBLISHED.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <p className="fine">
                Nothing here is a summary of a document you cannot read. Each row points at the
                page that makes the statement, and that page is where the wording is maintained.
              </p>

              <div className="actions">
                <Link className="btn" href={"/security" as Route}>Start with the data path</Link>
                <Link className="btn ghost" href={"/contact" as Route}>Ask a security review question</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
