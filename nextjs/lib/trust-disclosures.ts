/** Compatibility exports for existing trust consumers. */
export {
  PUBLIC_DISCLOSURE_STATUS_LABEL as DISCLOSURE_STATUS_LABEL,
  PUBLIC_TRUST_DISCLOSURES as TRUST_DISCLOSURES,
  getPublicTrustDisclosure,
  selectPublicTrustDisclosures,
} from "./public-trust-contract";

export type {
  PublicTrustDisclosure as TrustDisclosure,
  PublicTrustDisclosureId,
  PublicTrustDisclosureStatus as DisclosureStatus,
} from "./public-trust-contract";
