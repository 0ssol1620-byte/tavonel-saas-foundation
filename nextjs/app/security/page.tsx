import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrustNext } from "@/components/trust-next";
import { BOUNDARY } from "@/lib/evidence-record";
import { activationPolicy } from "@/lib/activation-policy";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/security" },
  openGraph: { url: "/security" },
  title: "Security — TAVONEL",
  description:
    "The path a document takes through TAVONEL: what holds its bytes, what never sees them, and who decides what becomes active.",
};

/**
 * The question a buyer asks second, answered by describing controls rather than absences.
 *
 * The architecture on this page has not changed. Three kinds of sentence came off it.
 *
 * "This page holds no certification and claims none" and "Nothing on this page is a
 * demonstration, an audit result or a compliance claim" were written to prevent a
 * misreading nobody was making. They spent the reader's attention denying a claim the page
 * never made. The page simply does not claim a certification, which is what not having one
 * looks like.
 *
 * The dated internal qualification note ("opened only after the recorded 2026-08-29
 * full-sequence qualification") is release-engineering provenance. It belongs in the release
 * record, not in the answer to "where do my documents go".
 *
 * The GPU vendor's product name was in the data path. A customer's security review cares that
 * analysis is isolated, bounded and given no outbound network — not which supplier's hardware
 * it runs on. The legal disclosure of that supplier stays on /subprocessors, where a
 * subprocessor belongs.
 */

const CAPABILITY_LABELS = {
  customerIntake: "Customer document intake",
  cdr: "Content disarm and reconstruction",
  ocrGpu: "Isolated GPU document reading",
  candidatePromotion: "Candidate promotion into a live world",
  customerData: "Compiling customer data",
} as const;

const PATH = [
  ["The browser", "Holds a short-lived, narrowly scoped upload capability, issued only after the server has checked who you are, what you are entitled to, and what quota is left. It never holds a service key, a webhook secret, storage credentials or a signing credential."],
  ["Object storage", "Tenant-scoped quarantine holds the bytes. This is the only place a document body exists."],
  ["The application", "Coordinates contracts and never proxies a document body. A large file does not pass through a request handler."],
  ["The database", "Stores metadata and immutable proof references. It never stores document bytes."],
] as const;

const CONTROLS = [
  ["Tenant isolation", "Workspace identity is derived server-side from an authenticated session, never from an identifier the browser supplies. Storage prefixes, database rows and signed capabilities are all scoped to it."],
  ["Encryption and secrets", "Transport is TLS throughout, and stored objects are encrypted at rest by the storage provider. Authentication, billing, storage and disarm credentials are server-side secrets; the browser may hold a provider's own publishable token and nothing else."],
  ["AI training", "Your documents are not used to train shared models. Models read your sources to compile your world, and for nothing else."],
  ["Retention and deletion", "Source material, derived artifacts and compiled packages can be deleted on request, and that request is carried out by a person rather than by a self-service control. Which parts of it happen the moment you act, which wait on a provider backup schedule, and where no number is published yet, are set out step by step in the privacy notice."],
  ["Reliability", "A control opens only after the one before it is qualified, so a partial failure stops the pipeline rather than emitting an incomplete world. There is no best-effort path that publishes anyway."],
  /*
    O01. "No tested restore" was true when it was written and stopped being true on 2026-09-10.

    Written from the execution record of that day: the production database was restored from
    its 2026-09-08 16:33:31 UTC backup into a separate temporary project in the same region,
    the catalog of the original and the restored copy was compared object by object, all 431
    matched, and the temporary project was deleted afterwards. The record's own caution
    travels with it -- a database restore is not a service disaster-recovery exercise -- and
    so does the scope: the document bytes live in object storage and were not part of it.

    What this row deliberately does not do is turn one drill into a recovery objective. The
    RPO and RTO targets are a commitment the founder makes, they are not made, and they stay
    in the unanswered block below until they are.
  */
  ["Backup and restore", "One restore has been performed and checked. On 2026-09-10 the production database was restored from its backup of 2026-09-08 16:33:31 UTC into a separate temporary project in the same region; the catalog of the original and the restored copy was compared object by object and all 431 matched; the temporary project was deleted when the check finished. That drill covered the database. It did not cover the document bytes in object storage, a full service recovery, or a run through the customer-facing application, and one drill is a demonstration rather than a practice. The catalog-fingerprint receipt (approved-db-catalog-receipt-20260910.json) is kept with the execution record and is not published at a URL; ask for it."],
  /*
    §17.1 asks "who can access it" and "audit", and this page answered neither.

    Written from `lib/developer-store.ts`, which posts an append-only row to
    `foundation_developer_audit_events` for each key act with the workspace, the action, the
    target and the actor -- a user id, or a key id when a key acted. Nothing broader is claimed:
    there is no published customer-facing audit export and no SSO or role model in this
    deployment, and a security page is the last place to imply either.
  */
  ["Access and audit", "Access is a workspace membership checked server-side on every request; there are no roles, no SSO and no seat model in this deployment, so the account that owns a workspace is the account that reaches it. Creating, rotating and revoking a developer key writes an append-only audit row naming the workspace, the action, the target and whether a person or a key acted."],
  /*
    I03. The audit asked whether a permission on a source propagates into the objects, the
    excerpts, the answers and the exports derived from it. It does, and the grain of it is
    narrower than the phrase suggests.

    Written from `lib/connector-source-access.ts`: `checkConnectorSourceAccess` is called on
    the answer path, the source-byte read, the export signing and candidate promotion, and it
    returns a denial when the check itself cannot be completed rather than allowing on error.
    What it reads is a (source_id, workspace_key) suspension row, so the decision is made per
    workspace and not per person -- worth saying out loud, because a buyer reading
    \"source-level access control\" will assume per-member unless told otherwise. The
    two-users-with-different-permissions case the audit wants tested is not a state this
    deployment can be put into: a workspace has one member.
  */
  ["Source-level access", "A suspended or unreachable source is refused on the same requests that would otherwise use it: an answer, a source-byte read, an export and a promotion each re-check it, and a check that cannot complete counts as a refusal rather than a pass. The grain of that decision is the workspace, not the person — a source is reachable for the whole workspace or for none of it, and a workspace has exactly one member here. Per-member source permissions arrive with membership, which this deployment does not have."],
  /*
    §17.1 asks two more questions this page did not answer: which model providers see a document,
    and what a model is allowed to do with it.

    Written from `lib/generator-adapter.ts`, which is a contract with no implementation -- its own
    STATUS note records that no concrete adapter and no calling route exist -- and from
    /subprocessors, which lists every service permitted to process any class of data. Neither
    names a model API, because there is not one. The sentence is about this deployment rather than
    about the product, because wiring a provider is a decision that will change the answer.
  */
  ["Model providers", "No third-party model API receives your documents in this deployment: no such integration is wired, and document reading runs on GPU workers TAVONEL operates. Every service permitted to process any class of data is named on the subprocessors page, and a new one is recorded there before it processes anything."],
  /*
    S08. Scanning a file for malware and defending against instructions written inside it are
    two different problems, and this page answered only the first.

    Written from what is wired rather than from what is intended. The answer route replies on
    the excerpt path: citations are assembled from evidence records, so there is no
    model-composed sentence for a document to steer. `lib/generator-adapter.ts` is the seam
    where that would change and carries no implementation. `lib/prompt-injection.test.ts`
    exercises the nine injection classes against the contract and holds that the answer path
    exposes no write tool at all.

    The honest shape of this is a fact plus a gate, not a defence. The reason an instruction
    inside a document cannot rewrite an answer today is that no model writes the answer, and
    that reason stops holding the day a generator is wired -- so the gate is named here, where
    a reader deciding whether to trust it can hold us to it later.
  */
  ["Instructions written inside a document", "No model writes prose from your documents in this deployment. An answer is assembled from evidence excerpts and the source locations they came from, so a sentence hidden inside a document has no model output to redirect, and the answer path offers it no write tool to reach. That is a statement about what is wired today and not a defence that survives wiring a generation model: the generator seam is a contract with nothing behind it, and the injection classes are re-run against a real generator, with the result written on this page, before one of them answers a request."],
  /*
    Where the data physically is, which /privacy answered and this page did not.

    It belongs in the controls rather than in the unanswered block below, because it is answered:
    the answer is a configured region and no guarantee. The two halves have to stay together --
    "the database is in Seoul" alone reads as residency, and a buyer who needs residency would
    plan around a promise nobody made. The provider list and the per-provider data class stay on
    /subprocessors, which is the page that maintains them.
  */
  ["Where the data is", "The database is configured in Seoul. No data residency is guaranteed: Vercel, Cloudflare, RunPod, Resend, Google and Paddle may process limited data through global infrastructure or support systems outside Korea, and the object-storage location hint is best-effort rather than a promise. Which provider is permitted to process which class of data is on the subprocessors page, and the privacy notice carries the same statement about international processing."],
] as const;

/*
  §17.1's last question, now split in two, because half of it got answered.

  The restore happened (see the Backup and restore control above, 2026-09-10). The objectives
  did not, and those are the harder half: an RPO and an RTO are numbers somebody promises, and
  a single successful drill does not imply either one. Every sentence available to close the
  gap anyway is reassurance -- "stored durably", "the storage provider replicates" -- and each
  answers a different, easier question than the one being asked.

  So the row below narrowed from the whole subject to the part that is still missing, rather
  than being deleted once the drill gave it something friendly to say. Founder item F-10 owns
  the targets; until they are set, this stays where a reader looking for them will find it.
*/
const UNANSWERED = [
  ["Recovery objectives", "Not yet answered. There is no recovery point objective, no recovery time objective and no published backup retention period for this deployment. Those are commitments somebody has to make and nobody has: the restore above shows the database came back once, which is a different statement from how much work or how much time you would lose. Ask before you depend on either number, and read their absence here as the state of it."],
  /*
    The question a procurement reader asks before any of the controls above, which this page left
    to /trust. It has to be answerable on the page a buyer is sent to, because the controls above
    are all "checked by us" and that phrase only means something next to the absence of anyone
    else having checked.

    One sentence of sequencing, no date. An external test after the first paying customer is an
    order of events; "Q1", "by year end" or "under way" would each be the commitment this row
    refuses, and nothing has been commissioned. SOC 2 has no timing at all because none is chosen.
    `lib/trust-page-answers.test.ts` allows these three artefact names only inside this block and
    fails on a date appearing in it.
  */
  ["Third-party certification and audit", "Not yet answered, because nothing exists to answer it with. No SOC 2 report, no ISO 27001 certificate and no independent penetration-test report exists for this deployment, and no such review has been commissioned — which is why no badge appears anywhere on this site. An external penetration test is planned after the first paying customer; SOC 2 timing is not set. Every control above is enforced and checked by us, and that is the whole of what is being claimed."],
] as const;

export default function SecurityPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>SECURITY</b><span />DATA PATH AND CONTROLS</p>
              <h1 className="document-title">Where your documents go,<br />and what never sees them.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Your sources move through a tenant-scoped processing path, and activation remains
                under human control. Browser-direct upload → quarantine → sanitize and disarm →
                isolated analysis → candidate world → your approval.
                <b> Every external operation fails closed.</b>
              </p>

              <p className="slate"><span />THE BOUNDARY, IN THE ORDER IT IS ENFORCED</p>
              <div className="chain">
                {BOUNDARY.map(([num, name, text]) => (
                  <article className="link" key={num}>
                    <span className="st">{num}</span>
                    <h2>{name}</h2>
                    <p>{text}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />WHAT HOLDS WHAT</p>
              <div className="chain">
                {PATH.map(([name, text]) => (
                  <article className="link" key={name}>
                    <h2>{name}</h2>
                    <p>{text}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />CONTROLS</p>
              <div className="tiles">
                {CONTROLS.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />NOT ANSWERED HERE</p>
              <div className="tiles">
                {UNANSWERED.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />CURRENT DEPLOYMENT CONTROLS</p>
              <div className="status-list">
                {Object.entries(activationPolicy).map(([key, value]) => (
                  <article key={key} data-state={value.enabled ? "operational" : "restricted"}>
                    <span>{value.enabled ? "enabled" : "human gate"}</span>
                    <h2>{CAPABILITY_LABELS[key as keyof typeof CAPABILITY_LABELS]}</h2>
                    <p>{value.reason}</p>
                  </article>
                ))}
              </div>
              <p className="fine">
                Promotion is closed by design: a candidate world becomes active only after an
                authenticated person approves it.
              </p>

              <div className="actions">
                <Link className="btn ghost" href={"/subprocessors" as Route}>Subprocessors</Link>
                <Link className="btn ghost" href={"/privacy" as Route}>Data handling and retention</Link>
                <Link className="btn ghost" href={"/contact" as Route}>Security contact</Link>
              </div>
            </div>
            <TrustNext from="/security" />
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
