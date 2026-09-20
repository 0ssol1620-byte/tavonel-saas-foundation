/**
 * Canonical wording approved for unrestricted public trust surfaces.
 *
 * Detailed architecture, implementation evidence, assurance inventories, and
 * questionnaire answers belong in a qualified review. Public pages link to the
 * maintained legal and policy records without reproducing that review packet.
 */

export const PUBLIC_TRUST_DISCLOSURE_IDS = [
  "security_controls",
  "privacy",
  "subprocessors",
  "dpa",
  "responsible_disclosure",
  "qualified_review",
] as const;

export type PublicTrustDisclosureId = (typeof PUBLIC_TRUST_DISCLOSURE_IDS)[number];
export type PublicTrustDisclosureStatus = "published" | "available_on_request";

export type PublicTrustDisclosure = {
  readonly id: PublicTrustDisclosureId;
  readonly subject: string;
  readonly status: PublicTrustDisclosureStatus;
  readonly line: string;
  readonly href: `/${string}`;
};

export const PUBLIC_TRUST_DISCLOSURES = [
  {
    id: "security_controls",
    subject: "Security controls",
    status: "published",
    line: "The Security page describes the customer-facing safeguards for document intake, workspace access, evidence, activation, retention, and deletion.",
    href: "/security",
  },
  {
    id: "privacy",
    subject: "Privacy notice",
    status: "published",
    line: "The privacy notice explains the data categories, purposes, storage and transfer locations, retention, and verified access, export, and deletion requests.",
    href: "/privacy",
  },
  {
    id: "subprocessors",
    subject: "Subprocessors",
    status: "published",
    line: "The subprocessor record names the third parties permitted to process customer data, their purpose, the data class, and the applicable location information.",
    href: "/subprocessors",
  },
  {
    id: "dpa",
    subject: "Data processing agreement",
    status: "published",
    line: "A draft v1 data processing agreement is published for review and is clearly labelled as a draft, not a signed agreement.",
    href: "/policy/TAVONEL_DPA_v1_2026-09-11.md",
  },
  {
    id: "responsible_disclosure",
    subject: "Responsible disclosure",
    status: "published",
    line: "The reporting address and disclosure policy are published at the standard security.txt location.",
    href: "/.well-known/security.txt",
  },
  {
    id: "qualified_review",
    subject: "Qualified security review",
    status: "available_on_request",
    line: "Deployment-specific architecture, control evidence, assurance scope, and questionnaire responses are provided through an appropriate qualified review.",
    href: "/contact",
  },
] as const satisfies readonly PublicTrustDisclosure[];

export const PUBLIC_TRUST_DISCLOSURE_BY_ID = Object.freeze(
  Object.fromEntries(PUBLIC_TRUST_DISCLOSURES.map((row) => [row.id, row])),
) as Readonly<Record<PublicTrustDisclosureId, (typeof PUBLIC_TRUST_DISCLOSURES)[number]>>;

export function getPublicTrustDisclosure(id: PublicTrustDisclosureId) {
  return PUBLIC_TRUST_DISCLOSURE_BY_ID[id];
}

export function selectPublicTrustDisclosures(
  ids: readonly PublicTrustDisclosureId[],
): readonly PublicTrustDisclosure[] {
  return ids.map((id) => getPublicTrustDisclosure(id));
}

export const PUBLIC_DISCLOSURE_STATUS_LABEL: Record<PublicTrustDisclosureStatus, string> = {
  published: "Published",
  available_on_request: "Qualified review",
};
