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
  ["Retention and deletion", "Source material, derived artifacts and compiled packages can be deleted on request. The categories, purposes and retention are set out in the privacy notice."],
  ["Reliability", "A control opens only after the one before it is qualified, so a partial failure stops the pipeline rather than emitting an incomplete world. There is no best-effort path that publishes anyway."],
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
    §17.1 asks two more questions this page did not answer: which model providers see a document,
    and what a model is allowed to do with it.

    Written from `lib/generator-adapter.ts`, which is a contract with no implementation -- its own
    STATUS note records that no concrete adapter and no calling route exist -- and from
    /subprocessors, which lists every service permitted to process any class of data. Neither
    names a model API, because there is not one. The sentence is about this deployment rather than
    about the product, because wiring a provider is a decision that will change the answer.
  */
  ["Model providers", "No third-party model API receives your documents in this deployment: no such integration is wired, and document reading runs on GPU workers TAVONEL operates. Every service permitted to process any class of data is named on the subprocessors page, and a new one is recorded there before it processes anything."],
] as const;

/*
  §17.1's last question, left open rather than answered comfortably.

  A buyer asking about backup and recovery is asking whether their compiled world survives a
  provider incident, and this deployment has no published answer: no tested restore, no stated
  recovery objective, no documented backup retention. Every sentence available to fill the gap is
  reassurance -- "stored durably", "the storage provider replicates" -- and each answers a
  different, easier question than the one being asked. Saying the answer is not ready is worth
  more than saying something true about a question nobody asked. Founder item F-10 owns the real
  answer; until it lands, this stays where a reader looking for it will find it.
*/
const UNANSWERED = [
  ["Backup and recovery", "Not yet answered. This deployment publishes no recovery objective, no backup retention period and no tested restore. Ask before you depend on one, and read the absence of a number here as the state of it."],
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
