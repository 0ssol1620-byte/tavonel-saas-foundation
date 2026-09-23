/**
 * What a security reviewer gets today, what is on the roadmap, and what is absent.
 *
 * Every row restates something already published on `/security`, `/privacy`, `/subprocessors` or
 * in the draft data processing agreement, and carries the link to the page that maintains the
 * wording. Nothing here is a new commitment: this module is a re-arrangement of prose a reviewer
 * currently has to read four pages to assemble, into the shape a procurement checklist arrives
 * in. If a row and its source page ever disagree, the source page is right and this row is the
 * bug -- `lib/trust-provisions.test.ts` holds each row's key phrase against the file that
 * publishes it.
 *
 * Three rules the shape enforces rather than asks for:
 *
 * 1. Three states, and the absent one is a state rather than a missing row. A checklist answered
 *    only where the answer is yes is how a reviewer ends up inferring the rest from silence.
 * 2. `roadmap` means a named intention already published somewhere. It is not a softer way to
 *    write "not provided", and a row may not move here to avoid the word.
 * 3. No row names a certification, a report or an audit as held. The two that a buyer asks for
 *    first are stated as absent, in the draft agreement's own words.
 */

export const TRUST_PROVISION_STATES = ["provided", "roadmap", "not_provided"] as const;
export type TrustProvisionState = (typeof TRUST_PROVISION_STATES)[number];

/** The word a reader reads. The state key stays the key. */
export const TRUST_PROVISION_STATE_LABEL: Record<TrustProvisionState, string> = {
  provided: "Provided",
  roadmap: "Roadmap",
  not_provided: "Not provided",
};

/*
  Which of the four status colours each state takes.

  The same four tokens `/sources` uses, chosen by the same rule -- what the deployment owes the
  reader, not how good the answer is. `--verified` for a thing that is in place, `--changed` for
  a thing a person still has to decide or sign, `--reused` for an absence. A fourth hue would
  have to mean something the state name does not already say.
*/
export const TRUST_PROVISION_STATE_TOKEN: Record<TrustProvisionState, "verified" | "changed" | "reused"> = {
  provided: "verified",
  roadmap: "changed",
  not_provided: "reused",
};

export type TrustProvision = {
  readonly id: string;
  /** The checklist line a reviewer arrives with. */
  readonly subject: string;
  readonly state: TrustProvisionState;
  /** What is true today, in the words the source page uses. */
  readonly line: string;
  /** Where that wording is maintained. */
  readonly source: { readonly label: string; readonly href: string };
};

const SECURITY = { label: "Security", href: "/security" } as const;
const PRIVACY = { label: "Privacy notice", href: "/privacy" } as const;
const SUBPROCESSORS = { label: "Subprocessors", href: "/subprocessors" } as const;
const DPA = { label: "Data processing agreement (draft)", href: "/policy/TAVONEL_DPA_v2_2026-09-23.md" } as const;
const PRICING = { label: "Pricing", href: "/pricing#pricing-limits-title" } as const;
const CONTACT = { label: "Contact", href: "/contact" } as const;
const DISCLOSURE = { label: "security.txt", href: "/.well-known/security.txt" } as const;

export const TRUST_PROVISIONS: readonly TrustProvision[] = [
  {
    id: "encryption_in_transit",
    subject: "Encryption in transit",
    state: "provided",
    line: "Traffic is encrypted in transit throughout.",
    source: SECURITY,
  },
  {
    id: "encryption_at_rest",
    subject: "Encryption at rest",
    state: "provided",
    line: "Stored objects are encrypted at rest by the storage provider, and service credentials remain on trusted server boundaries.",
    source: SECURITY,
  },
  {
    id: "customer_managed_keys",
    subject: "Customer-managed encryption keys",
    state: "not_provided",
    line: "Encryption at rest is the storage provider's. There is no customer-managed key.",
    source: DPA,
  },
  {
    id: "workspace_isolation",
    subject: "Workspace isolation",
    state: "provided",
    line: "Identity and workspace membership are resolved server-side, and data access is scoped to the authenticated workspace and rechecked at protected operations.",
    source: SECURITY,
  },
  {
    id: "roles_sso_seats",
    subject: "Roles, single sign-on and a seat model",
    state: "not_provided",
    line: "Access control is a workspace membership checked server-side on every request. The account that owns a workspace is the account that reaches it, and source-level access is enforced at the grain of the workspace rather than the member.",
    source: DPA,
  },
  {
    id: "subprocessor_record",
    subject: "Subprocessor record",
    state: "provided",
    line: "Every third party permitted to process account, document, billing or inquiry data is named with its purpose, the data class and the region it is configured to process in. Thirty days' notice of an addition or replacement, with an objection right, is written into the draft agreement.",
    source: SUBPROCESSORS,
  },
  {
    id: "data_residency",
    subject: "Contractual data residency",
    state: "not_provided",
    line: "The database and the serverless functions are configured for Seoul and the object bucket carries an Asia-Pacific location hint, which is best-effort. One processor (RunPod) has no pinned region.",
    source: SUBPROCESSORS,
  },
  {
    id: "breach_notification",
    subject: "Personal data breach notification",
    state: "provided",
    line: "Without undue delay and no later than 72 hours after becoming aware, with the nature, the categories and volume affected, the likely consequences and the measures taken. The service is operated by one person without a 24-hour rota, which is why the committed window is 72 hours rather than shorter.",
    source: DPA,
  },
  {
    id: "deletion",
    subject: "Deletion on a verified request",
    state: "provided",
    line: "On a verified deletion request, or on termination, the scope and outcome are confirmed in writing, and compiled worlds can be exported as signed packages first. A request may be limited or delayed by a legal hold or retention duty, and no fixed operational completion period is committed in the draft.",
    source: PRIVACY,
  },
  {
    id: "retention_period",
    subject: "A stated retention period",
    state: "not_provided",
    line: "Material stays until you delete it, until the workspace is deleted, or until a legal retention duty applies. No day count is established, and copies in provider backups age out under the provider's lifecycle.",
    source: PRIVACY,
  },
  {
    id: "restore_drill",
    subject: "Restore drill",
    state: "provided",
    line: "One drill is on record: on 2026-09-10 the production database was restored from its 2026-09-08 backup into a separate temporary project, the catalog of the original and the restored copy matched on all 431 objects, and the temporary project was deleted. It covered the database. It did not cover the document bytes in object storage, a full service recovery, or a run through the customer-facing application, and the receipt is available to a customer on request.",
    source: DPA,
  },
  {
    id: "recovery_objectives",
    subject: "Recovery point and recovery time objectives",
    state: "not_provided",
    line: "No recovery point objective, no recovery time objective and no backup retention period is committed. Objectives and a drill cadence are marked for the executed version of the agreement.",
    source: DPA,
  },
  {
    id: "uptime_sla",
    subject: "Contractual uptime or resolution target",
    state: "not_provided",
    line: "Published plans include no contractual availability or resolution commitment. The published support target is an acknowledgement target rather than a resolution time, and Enterprise support terms are agreed during scoping.",
    source: PRICING,
  },
  {
    id: "dpa",
    subject: "Signed data processing agreement",
    state: "roadmap",
    line: "Draft v2 (2026-09-23) is published in full for review and is labelled as a draft, not a signed agreement. The clauses still open say so in place, and the standard contractual clauses are incorporated at signature.",
    source: DPA,
  },
  {
    id: "third_party_assurance",
    subject: "Third-party assurance report",
    state: "not_provided",
    line: "No SOC 2 report, ISO 27001 certificate or independent penetration-test report exists yet. An external penetration test is planned after the first paying customer; SOC 2 timing is not set. The draft agreement's audit right is a real right to inspect controls, not a report that already exists.",
    source: DPA,
  },
  {
    id: "responsible_disclosure",
    subject: "Responsible disclosure",
    state: "provided",
    line: "The reporting address, the policy and the preferred languages are published at the standard well-known path.",
    source: DISCLOSURE,
  },
  {
    id: "qualified_review",
    subject: "Architecture, control evidence and questionnaire responses",
    state: "provided",
    line: "Deployment-specific architecture, control evidence, assurance scope and questionnaire responses are provided through a qualified review rather than published here.",
    source: CONTACT,
  },
  {
    id: "self_hosting",
    subject: "Self-hosted, private-cloud or air-gapped installation",
    state: "not_provided",
    line: "There is one hosted deployment. No separate installation is offered on any scope.",
    source: PRICING,
  },
] as const;

/** Grouped in reading order, so the absent rows are read after what is in place, not instead. */
export function trustProvisionsByState(
  rows: readonly TrustProvision[] = TRUST_PROVISIONS,
): ReadonlyArray<readonly [TrustProvisionState, readonly TrustProvision[]]> {
  return TRUST_PROVISION_STATES.map(
    (state) => [state, rows.filter((row) => row.state === state)] as const,
  );
}

/** The denominator a reviewer counts for themselves if the table does not print it. */
export function trustProvisionCounts(rows: readonly TrustProvision[] = TRUST_PROVISIONS) {
  return Object.fromEntries(
    TRUST_PROVISION_STATES.map((state) => [state, rows.filter((row) => row.state === state).length]),
  ) as Record<TrustProvisionState, number>;
}
