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
/*
  BA-160. The fourth element is where the row's own label points.

  Every row names the page that answers it -- "Security", "Privacy notice", "security.txt" -- and
  not one of them was clickable, on an index whose entire reason to exist is to be a set of
  destinations. The tiles above became anchors for exactly this reason (see the note there); these
  rows now do the same. A row answered by this page itself carries `null` and stays an `article`,
  because a link to where you already are is worse than no link.
*/
const PUBLISHED: Array<[string, string, string, string | null]> = [
  ["Architecture and data flow", "Security", "The enforced boundary in order, and which component holds a document body at each step.", "/security"],
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
  ["Data processing agreement", "DPA v1 draft", "Published for reading at a URL: the notification, sub-processor and deletion commitments are written down rather than described. It is a draft under review, it is not a signed agreement, and the clauses still open -- governing law, transfer mechanism, liability -- say so in place.", DPA_URL],
  /*
    BA-144. The FD identifiers and the delegated-decision provenance this row used to carry were
    already gone before this lane started; what was left was the order. The row opened on "There is
    no on-call rotation", so the first thing a procurement reader learned about incident response
    was a staffing gap.

    It now opens with who is reachable and how directly, and the staffing fact follows in the same
    breath -- which is the order `trust-page-answers.test.ts` requires, and it requires it for a
    reason: a 72-hour window read without the staffing behind it looks like a staffed process.

    The audit's proposed sentence was not used. "One team operates the service" claims a team this
    company does not have, and "Severity handling and the post-incident record follow a written
    internal procedure, summarised here" claims to publish a summary of a runbook that stays
    internal -- the same test bans the word for that reason. The absence of a tabletop exercise
    stays too: this is the page that is the right place to state it once.
  */
  ["Incident response", "This page", "One person operates the service and reads security@tavonel.com directly. There is no on-call rotation and no triage tier in front of that inbox. An affected customer is notified without undue delay and no later than 72 hours after we become aware of a breach of their personal data. No tabletop exercise has been run yet.", null],
  ["Data residency", "Privacy notice", "The database is configured in Seoul, and no data residency is guaranteed. Several providers may process limited data through infrastructure outside Korea, and the object-storage location hint is best-effort rather than a promise. The subprocessors page names which provider handles which data class.", "/privacy"],
  ["Data handling", "Privacy notice", "Categories collected, purposes, storage locations, international processing, and the optional website analytics you can decline or withdraw.", "/privacy"],
  ["Retention and deletion", "Privacy notice", "Source material and derived artifacts are deleted on a verified request. No retention period in days is published: data remains until workspace deletion, a verified request, or a legal duty.", "/privacy"],
  ["Encryption", "Security", "TLS in transit throughout; stored objects encrypted at rest by the storage provider. There is no customer-managed key.", "/security"],
  ["Access control", "Security", "Workspace membership checked server-side on every request. There are no roles, no SSO and no seat model in this deployment.", "/security"],
  ["Tenant isolation", "Security", "Workspace identity is derived server-side from the session, never from an identifier the browser supplies; storage prefixes, rows and signed capabilities are scoped to it.", "/security"],
  ["Subprocessors", "Subprocessors", "Named service, purpose and data class, with a change notice commitment.", "/subprocessors"],
  ["Content disarm and malware", "Security", "Quarantine, mandatory scanning and sanitization before anything downstream reads a document. Which sanitizer build is actually running is named there rather than assumed.", "/security"],
  ["Vulnerability disclosure", "security.txt", "Reporting address and policy, served at the well-known path a scanner looks for.", "/.well-known/security.txt"],
  ["Security contact", "Contact and security.txt", "The same address in both places.", "/contact"],
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
  /*
    BA-150. Both rows start with the fact that is on record and then state what is not committed.

    Nothing was deleted to do it: every absence these two rows carried is still in them, in the
    same words. What changed is the order, because three of the four tiles on this page opened with
    "Not yet published" and a reader scanning the section met the same non-answer three times
    before meeting a single thing that is true.
  */
  ["Recovery objectives", "One database restore is on record: it was performed and checked, and the security page carries its date, its scope and what it does not commit to. No recovery point objective, no recovery time objective and no backup retention period is published for this deployment. The absence of a target is the state of it; ask before you depend on one.", "/security" as Route],
  ["Third-party certification and audit", "What exists is on the security page: the controls this deployment enforces, checked by us. No SOC 2 report, no ISO 27001 certificate and no independent penetration-test report exists for this deployment, and no such review has been commissioned — which is why no badge appears anywhere on this site. An external penetration test is planned after the first paying customer; SOC 2 timing is not set.", "/security" as Route],
];

export default function TrustCenterPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              {/*
                BA-150. The eyebrow named this page's two sections. It now names the page's
                subject, which is what a procurement reader scanning for it is looking for.

                BA-176: the trailing space before the break has to be a string literal. JSX drops
                the whitespace at the end of a text line, so the accessible name and the document
                outline both read "publishabout" without it.
              */}
              <p className="slate"><b>TRUST CENTER</b><span />SECURITY AND COMPLIANCE</p>
              <h1 className="document-title">{"Everything we publish "}<br />about handling your documents.</h1>
            </div>
            <div className="stack">
              {/*
                BA-164 and BA-150. Two things were wrong with this sentence and both were counting.

                "The same thirteen things every time" states a universal thirteen-item security
                review that does not exist -- the thirteen is §45's internal list, so the sentence
                asserted an unverifiable fact as given and leaked the shape of an internal spec.
                And building the lede out of "twelve... one... two more" made the reader do
                arithmetic to find out what is published, with the bold weight landing on the two
                absences.

                So the count is gone from the copy, and what remains is checkable against the page
                itself: the rows below, and the two that are named as unpublished. The absences are
                still here, in the same paragraph, unbolded and after what is provided.
                `lib/trust-page-answers.test.ts` holds this page and /pricing to the same two
                absences instead of to a shared number.
              */}
              <p className="lede">
                A security review asks for the same set of evidence every time. Those answers are
                published on the pages below, in the wording the answering page maintains, including
                a data processing agreement you can read now — as a draft, labelled as one. Two are
                not published: this deployment sets no recovery objective, and nobody outside this
                company has audited it. Both are listed below with what stands in their place, so a
                review reaches its decision here.
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
                {/*
                  BA-160. Each row is the anchor, for the same reason the tiles above are: the row
                  already displays the name of the page that answers it, and a displayed
                  destination that does not navigate is the defect on an index page. A row answered
                  by this page carries no href and stays an `article`.

                  The DPA is a served file rather than a route, so it takes a plain anchor, and the
                  label travels with it in the `where` column exactly as it does on the tile.
                */}
                {PUBLISHED.map(([question, where, detail, href]) => {
                  const inside = <><span className="st">{where}</span><h2>{question}</h2><p>{detail}</p></>;
                  if (!href) return <article className="link" key={question}>{inside}</article>;
                  if (href.startsWith("/policy/") || href.startsWith("/.well-known/")) {
                    return <a className="link trust-link" key={question} href={href}>{inside}</a>;
                  }
                  return <Link className="link trust-link" key={question} href={href as Route}>{inside}</Link>;
                })}
              </div>

              {/* BA-150. The section label states its subject rather than declaring a hole. */}
              <p className="slate"><span />WHAT IS NOT PUBLISHED YET</p>
              <div className="tiles">
                {NOT_PUBLISHED.map(([title, body, href]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                    {href ? <p className="fine"><Link href={href}>What is on record instead</Link></p> : null}
                  </article>
                ))}
              </div>

              {/*
                BA-173. The first sentence answered an accusation nobody made ("nothing here is a
                summary of a document you cannot read") in 11px mono at the foot of the page, which
                is the tone `public-copy-purge.test.ts` exists to remove. What is left is the
                maintenance rule, which is a fact a reviewer can use.
              */}
              <p className="fine">
                Each row points at the page that makes the statement, and that page is where the
                wording is maintained.
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
