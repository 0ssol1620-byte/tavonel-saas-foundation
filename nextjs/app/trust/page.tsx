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

  §45 lists thirteen elements a Trust Center carries. Twelve are published somewhere on this site
  today and one is not, so the page has two sections rather than one list with a hopeful tone: a
  reader who stops at a missing element should see that it is missing, not scroll looking for it.
  Two questions §45 does not name are on the page anyway, one in each section, because a buyer asks
  both: third-party certification and audit, which is an absence and joined the second list in the
  2026-09-11 audit remediation, and data residency, which has an answer and joined the first list.
  Fifteen rows in total, and the lede below counts them that way.

  What is still absent is absent because the work behind it has not been done -- no recovery
  objective, no external audit -- and a Trust Center that phrases those as "coming soon" is worth
  less than one that phrases them as "no".

  Two rows crossed the other way on 2026-09-11, and both crossings are the same correction in
  opposite directions from the usual one. The backup row asserted three absences at once, including
  "no tested restore", and a restore was performed and verified on 2026-09-10, so the row narrowed
  to the objectives rather than being deleted. Then the DPA and the incident procedure stopped
  being absent: the three numbers that were blocking the agreement -- 72 hours, 30 days, 30 days --
  were settled, and the DPA is now a labelled draft anyone can read, while the incident procedure
  has a customer-facing summary in the published list. A stated absence that is no longer absent is
  the same failure as a claim with no receipt, pointing the other way, and it is corrected the same
  way -- by making the sentence match what happened.

  Who settled them: not the founder, but the orchestrator under the founder's delegation -- see
  `docs/policy/DECISION_LOG_2026-09-11.md`, FD-06/07. That provenance stays in the log and is not
  printed on the page. The log's "Public wording of delegated values" section is the rule this
  page follows: a document still being reviewed is labelled "under review", a stated commitment
  carries no process label, and the founder's merge of the pull request that carries the log is
  the confirmation. No copy here attributes anything to the founder either, because no record of a
  founder statement exists.

  Neither new row claims more than happened. The DPA says it is a draft under review and not a
  signed agreement everywhere it appears; the incident row leads with the fact that nobody is on
  call rather than with the window, because that is the fact a buyer would otherwise find out
  during an incident.
*/

/*
  The served DPA, and the label that is not optional.

  The file is `nextjs/public/policy/TAVONEL_DPA_v1_2026-09-11.md` -- a static file rather than a
  route, because the document is the deliverable and rendering it as a page would invite it to
  drift from the text a reviewer downloads. The version and date are in the filename so that a
  copy someone saved can be identified later; a new version is a new file, not an edit to this one.

  The label says the two things a reader has to know -- it is a draft, and it is not a signed
  agreement -- and neither half may be dropped. What it is still waiting on (a delegated
  decision's confirmation, and a legal review nobody has commissioned) is provenance, and
  provenance lives in `docs/policy/DECISION_LOG_2026-09-11.md` rather than in customer copy.
*/
const DPA_URL = "/policy/TAVONEL_DPA_v1_2026-09-11.md";
// FD-06/07 in `docs/policy/DECISION_LOG_2026-09-11.md` settled the three numbers this document
// commits to; that log's "Public wording of delegated values" section is why the label below is
// customer wording and carries no process vocabulary. The provenance stays in the log.
const DPA_LABEL =
  "Draft v1 (2026-09-11) — under review; not a signed agreement";

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
  /*
    Two rows moved here from the not-published list on 2026-09-11, when the three numbers that were
    blocking them were settled as a delegated decision (orchestrator, under the founder's
    delegation -- `docs/policy/DECISION_LOG_2026-09-11.md`, FD-06/07), not by the founder. Neither
    is finished work and neither says it is: the DPA is labelled a draft under review wherever it
    appears, and the incident row leads with the absence of an on-call rotation rather than with
    the window.

    The incident answer is the customer-facing half of `docs/policy/INCIDENT_RESPONSE_RUNBOOK.md`.
    The runbook stays internal -- severity tiers, evidence preservation and the record format are
    an operating procedure, not a statement to a buyer -- and the two sentences a buyer is actually
    choosing between are here: who is reachable, and by when they will be told.
  */
  ["Data processing agreement", "DPA v1 draft", "Published for reading at a URL: the notification, sub-processor and deletion commitments are written down rather than described. It is a draft under review, it is not a signed agreement, and the clauses still open -- governing law, transfer mechanism, liability -- say so in place."],
  ["Incident response", "This page", "There is no on-call rotation: one person operates the service, and security@tavonel.com is an inbox that person reads. The commitment that follows from that is notification of an affected customer without undue delay and no later than 72 hours after becoming aware of a breach of their personal data. No tabletop exercise has been run yet."],
  ["Data residency", "Privacy notice", "The database is configured in Seoul, and no data residency is guaranteed. Several providers may process limited data through infrastructure outside Korea, and the object-storage location hint is best-effort rather than a promise. The subprocessors page names which provider handles which data class."],
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
  §45 asks for thirteen, and this list is the ones with no answer. Two more left it on 2026-09-11.

  "Backup and recovery" was one row asserting three absences, and one of the three stopped being
  true on 2026-09-10, when a database restore was performed and checked. Deleting the row would
  have been wrong in the other direction: the recovery objectives are still unset, and that is the
  half a buyer is really asking about. So the row narrowed to the objectives and points at the
  security page for the drill, rather than keeping a sentence that is now half false.

  The certification row answers a question §45 does not list. A procurement reader looks for SOC 2,
  ISO 27001 or a penetration-test report before anything else, and this page's own inventory named
  that question in neither section -- so a reader could read all thirteen rows and still not learn
  that the answer is no. It stays a plain absence: no badge, and nothing has been commissioned.

  What it gained is one sentence of sequencing, and the distinction is worth stating because it is
  the one this block exists to hold. "An external penetration test is planned after the first
  paying customer" names an order of events with no date in it and nothing scheduled; a date, a
  quarter or "under way" would be the commitment this row refuses. SOC 2 carries no timing at all,
  because none has been chosen. `lib/trust-page-answers.test.ts` fails on a date appearing here.
*/
const NOT_PUBLISHED: Array<[string, string, Route | null]> = [
  ["Recovery objectives", "Not yet published. This deployment states no recovery point objective, no recovery time objective and no backup retention period. One restore has been performed and checked, and the security page carries its date, its scope and what it does not commit to. The absence of a target is the state of it; ask before you depend on one.", "/security" as Route],
  ["Third-party certification and audit", "Not published, because there is nothing to publish. No SOC 2 report, no ISO 27001 certificate and no independent penetration-test report exists for this deployment, and no such review has been commissioned. That is why no badge appears anywhere on this site. An external penetration test is planned after the first paying customer; SOC 2 timing is not set. What does exist is on the security page: the controls this deployment enforces, checked by us.", "/security" as Route],
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
              {/*
                The count in this sentence has to reconcile with the two arrays above, because a
                reader who counts the rows is exactly the reader this page is for. Fifteen rows:
                twelve of §45's thirteen answered, one of them not, and two questions the checklist
                never names -- where the data sits, which is answered, and whether anyone outside
                this company has audited it, which is not. The residency row was added on
                2026-09-11 and was for one commit uncounted here.
              */}
              <p className="lede">
                A security review asks the same thirteen things every time. Twelve of them are
                answered on the pages below, including a data processing agreement you can read
                now — as a draft, labelled as one.<b> One is not answered: this deployment sets no
                recovery objective. Two more rows answer what the checklist never asks — where your
                data sits, which is answered, and whether anyone outside this company has audited
                it, which is not. Both absences are listed</b> — a review that finds them here is
                faster than one that finds them after a pilot.
              </p>
              {/*
                B04. Five hubs -- this one, Evidence, Benchmarks, Reproducibility, Research --
                answer five different questions, and were reachable from one another with nothing
                saying which was which, so a reader looking for one of the five read parts of
                three. Each now opens with the same shaped line: what this page answers, and which
                page answers the next thing.
              */}
              <p className="fine">
                <b>This page answers one question:</b> what is published about security and
                compliance, and what has no answer yet. How a citation stays bound to its source is
                on <Link href={"/evidence" as Route}>Evidence</Link>; what a result has to carry
                before it is published as a number is on <Link href={"/benchmarks" as Route}>Benchmarks</Link>;
                the frozen fixtures you can rerun are on <Link href={"/reproducibility" as Route}>Reproducibility</Link>;
                the open problems and the experiments that failed are on <Link href={"/research" as Route}>Research</Link>.
              </p>

              {/*
                BA-072, from the copy-sources-trustcase lane. CROSS-LANE -> copy-commerce-legal:
                this paragraph is the one edit that lane's /trust needs, and it is two lines.

                The same sentence -- ending on "no customer has given it" -- was printed on
                /benchmarks, /evidence and /reproducibility, so three pages volunteered to a
                reader who had not asked, and to no legal requirement, that we have no customers;
                /reproducibility ended its hero paragraph on it. Removing it from three pages and
                adding it nowhere would lose a policy worth publishing, so it lives here once,
                written as the policy it is, with no count of who has met it.

                `trust-page-answers.test.ts` holds it to this one home in both directions: it
                fails if this paragraph goes, and it fails if any of the three gets it back.
              */}
              <p className="fine">
                Customer names, figures and logos appear on this site only with that
                customer&rsquo;s written sign-off on the exact wording.
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
                {/*
                  A plain anchor, not a `Link`: the DPA is a served file rather than a route, so
                  typed routing does not apply and a client-side navigation would be wrong.

                  The label travels with the link everywhere it appears, which is the whole
                  discipline of publishing an unsigned document: a reader who sees the URL without
                  the label has been handed a contract, and a reader who sees both has been handed
                  a draft. `lib/trust-page-answers.test.ts` fails if the two are ever separated.
                */}
                <a className="tile trust-link" key="dpa" href={DPA_URL}>
                  <h3>Data processing agreement</h3>
                  <p>{DPA_LABEL}. Breach notification within 72 hours of becoming aware, sub-processor changes notified 30 days in advance with a right to object, and deletion completed within 30 days of a verified request. The clauses still open say so in place.</p>
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
                {NOT_PUBLISHED.map(([title, body, href]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                    {href ? <p className="fine"><Link href={href}>What is on record instead</Link></p> : null}
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
