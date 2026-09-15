/*
  One list of what a security review will find, and what it will not.

  Three pages were answering the same procurement questions with three different amounts of
  honesty. `/trust` published every absence -- no SOC 2, no ISO 27001, no external test, no
  recovery objective, one person on the security inbox. `/security` published most of them.
  `/enterprise`, which is where a reviewer arriving from a search result actually lands and
  converts, published none of them, and also said nothing about deployment options, SSO, an SLA,
  an MSA, a questionnaire or a VPAT -- while `/contact` offered air-gapped deployment and four
  data regions as selectable requirements.

  So the disclosures are data, rendered on all three pages from here. A row that changes changes
  everywhere, and a page cannot quietly carry the shorter version of the list.

  Three rules this file exists to hold:

  - The status is one of three words and never a fourth. "Partially", "in review" and "available
    on request" are the vocabulary an absence hides in.
  - `roadmap` is an order of events with no date in it. The moment a row needs a quarter, a month
    or "under way", it is a commitment somebody has to fund, and nobody has.
  - Every line is what a buyer would have found out during the pilot. Publishing it before the
    contract is the whole point of the list.

  SD-09 (`docs/policy/DECISION_LOG_2026-09-16.md`) settled the SOC 2 sentence and SD-11 the
  region rows below; the process vocabulary stays in that log and never reaches a public page.
*/

export type DisclosureStatus = "provided" | "roadmap" | "not_provided";

/** The three words a row may print. Customer wording: no internal status vocabulary. */
export const DISCLOSURE_STATUS_LABEL: Record<DisclosureStatus, string> = {
  provided: "In place",
  roadmap: "Planned, not started",
  not_provided: "Not in place",
};

export type TrustDisclosure = {
  /** What a reviewer's checklist calls it. */
  readonly subject: string;
  readonly status: DisclosureStatus;
  /** One line, in the words we would use answering the question on a call. */
  readonly line: string;
  /** The page that maintains the longer answer, where one exists. */
  readonly href?: string;
};

export const TRUST_DISCLOSURES: readonly TrustDisclosure[] = [
  {
    subject: "SOC 2",
    status: "not_provided",
    line: "No SOC 2 report exists for this deployment and no audit has started. SOC 2 is planned after the first paying customer, alongside the external penetration test.",
    href: "/trust",
  },
  {
    subject: "ISO 27001",
    status: "not_provided",
    line: "No ISO 27001 certificate exists for this deployment, and nothing has been commissioned toward one.",
    href: "/trust",
  },
  {
    subject: "Independent penetration test",
    status: "roadmap",
    line: "Nobody outside this company has tested this deployment. An external penetration test is planned after the first paying customer.",
    href: "/security",
  },
  {
    subject: "Recovery objectives (RPO / RTO)",
    status: "not_provided",
    line: "No recovery point objective, no recovery time objective and no backup retention period is published. The absence of a target is the state of it; ask before you depend on one.",
    href: "/security",
  },
  {
    subject: "Backup and restore",
    status: "provided",
    line: "The database is backed up by the provider, and one restore was performed and verified on 2026-09-10 with all 431 catalog objects matching. That drill covered the database and not the document bytes in object storage.",
    href: "/security",
  },
  {
    subject: "SSO, SAML and SCIM",
    status: "not_provided",
    line: "Sign-in is Google OAuth. There is no SAML, no SCIM, no role model and no seat model: a workspace has exactly one member here.",
    href: "/security",
  },
  {
    subject: "On-call and incident staffing",
    status: "not_provided",
    line: "One person operates the service and reads security@tavonel.com directly. There is no on-call rotation and no triage tier in front of that inbox, and no tabletop exercise has been run.",
    href: "/trust",
  },
  {
    subject: "Breach notification",
    status: "provided",
    line: "An affected customer is notified without undue delay and no later than 72 hours after we become aware of a breach of their personal data, which is the commitment written into the published DPA draft.",
    href: "/trust",
  },
  {
    subject: "Deployment options",
    status: "not_provided",
    line: "Managed by TAVONEL is the only deployment. There is no customer-cloud, VPC, on-premise or air-gapped option, and a processing region cannot be chosen.",
    href: "/security",
  },
  {
    subject: "Data residency",
    status: "not_provided",
    line: "No residency is guaranteed. Which provider processes what, in which configured region, is published rather than withheld — including the two components that touch document bytes.",
    href: "/security",
  },
  {
    subject: "Uptime SLA",
    status: "not_provided",
    line: "No uptime percentage and no service credit is committed. Email to support is acknowledged within one business day (KST), which is an acknowledgement target rather than a resolution time.",
    href: "/status",
  },
  {
    subject: "Master services agreement",
    status: "not_provided",
    line: "No MSA is offered. The published terms are the agreement, and custom volumes are agreed in writing.",
    href: "/terms",
  },
  {
    subject: "Data processing agreement",
    status: "provided",
    line: "A draft v1 DPA is published for reading at a URL, labelled a draft and not a signed agreement, with the notification, sub-processor and deletion commitments written down.",
    href: "/trust",
  },
  {
    subject: "Security questionnaire (CAIQ / SIG)",
    status: "not_provided",
    line: "No completed CAIQ or SIG package is held. Review questions are answered from the pages linked here and in a call, in writing where you need it in writing.",
    href: "/contact",
  },
  {
    subject: "Accessibility conformance (VPAT)",
    status: "not_provided",
    line: "No VPAT and no WCAG conformance report has been produced for this deployment.",
  },
  {
    subject: "HIPAA business associate agreement",
    status: "not_provided",
    line: "No BAA is offered. This service is not built for protected health information, and none should be uploaded to it.",
  },
];

/*
  SD-11: where the work physically happens, read from configuration rather than typed.

  Every value below is fixed by a file in this repository, named in `pinnedBy`, and a component
  whose region no configuration fixes says so instead of being given a plausible one. "Not pinned
  to one region" and "we will not say where" are different statements, and only the first is
  defensible -- which is the whole finding this table answers.

  The GPU row is the one a reviewer cares about most and is the one nothing pins: the endpoint is
  configured by URL, the URL carries no region, and the provider's own Asia data-centre list held
  no Seoul site when it was last read. Saying "APAC" there would be a guess.
*/
export const REGION_NOT_PINNED = "Not pinned to one region";

export type ProcessingRegion = {
  readonly component: string;
  readonly provider: string;
  /** The configured region, or `REGION_NOT_PINNED`. Never a guess. */
  readonly region: string;
  /** What fixes it, in a sentence a reader can act on. */
  readonly note: string;
};

export const PROCESSING_REGIONS: readonly ProcessingRegion[] = [
  {
    component: "Website, workspace and API",
    provider: "Vercel",
    region: "Seoul — icn1",
    note: "The deployment configuration pins serverless functions to the Seoul region. Edge delivery of static assets is global.",
  },
  {
    component: "Database and authentication",
    provider: "Supabase",
    region: "Seoul — ap-northeast-2",
    note: "The project region was selected at creation and is the one named on the privacy notice. It holds metadata and proof references, never document bytes.",
  },
  {
    component: "Object storage — quarantine and artifacts",
    provider: "Cloudflare R2",
    region: "APAC location hint, default jurisdiction",
    note: "This is where document bytes live. The location hint is a best-effort placement rather than a Korea-residency guarantee, and no jurisdiction restriction is set on the bucket.",
  },
  {
    component: "Content disarm and reconstruction",
    provider: "Google Cloud Run",
    region: "Seoul — asia-northeast3",
    note: "The sanitizer service and its secret are both configured in Seoul. It reads document bytes, which is why it is named here rather than left inside a provider row.",
  },
  {
    component: "GPU document reading",
    provider: "RunPod",
    region: REGION_NOT_PINNED,
    note: "The endpoint is configured by URL and no region is fixed by that configuration, so a document read can be carried out wherever the provider places the worker. This is the component with the weakest residency answer, and it reads document bytes.",
  },
];
