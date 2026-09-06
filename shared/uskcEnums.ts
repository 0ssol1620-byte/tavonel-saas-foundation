/**
 * USKC contract v1 (2026-09-06) — frozen enumerations.
 *
 * Transliterated verbatim from `USKC_LANE_CONTRACT_2026-09-06.md`'s `contract/enums.v1.json`
 * (sha256 3c668dc9c22289b27a7d0dd8b072cf23fa0511fd8fe888875770171e664f11d1). Both repositories
 * carry the same value lists: this file on the site, `akc_readers/enums.py` and
 * `akc_cir/evidence_locator.py` in the core.
 *
 * The values and their order are the contract, not an implementation detail. A lane that needs a
 * new value writes the proposal in its report; it does not add the value here.
 * `server/foundation/uskcEnums.test.ts` pins every list against the frozen literals.
 */
export const USKC_ENUMS_CONTRACT = "tavonel.uskc.enums.v1" as const;

export const sourceFamilies = [
  "document",
  "spreadsheet",
  "presentation",
  "image",
  "email",
  "structured_data",
  "web",
  "code",
  "cad_2d",
  "cad_3d",
  "bim",
  "audio",
  "video",
  "archive",
  "database",
  "api",
  "unknown",
] as const;
export type SourceFamily = (typeof sourceFamilies)[number];

export const capabilityStatuses = [
  "VERIFIED_NATIVE",
  "VERIFIED_HYBRID",
  "BEST_EFFORT",
  "METADATA_ONLY",
  "REVIEW_REQUIRED",
  "UNSUPPORTED",
] as const;
export type CapabilityStatus = (typeof capabilityStatuses)[number];

/** The subset a file may be accepted at upload with. Everything else is refused at intake. */
export const capabilityStatusesAcceptedAtUpload = [
  "VERIFIED_NATIVE",
  "VERIFIED_HYBRID",
  "BEST_EFFORT",
  "METADATA_ONLY",
] as const;
export type CapabilityStatusAcceptedAtUpload = (typeof capabilityStatusesAcceptedAtUpload)[number];

export const representationKinds = [
  "original",
  "native",
  "rendered",
  "ocr",
  "visual",
  "normalized",
  "canonical_ir",
] as const;
export type RepresentationKind = (typeof representationKinds)[number];

export const readerFeatures = [
  "native_text",
  "layout",
  "tables",
  "formula",
  "comments",
  "track_changes",
  "chart_data",
  "geometry",
  "assembly",
  "acl",
  "thread",
  "timestamp",
  "ast",
  "dependency_graph",
] as const;
export type ReaderFeature = (typeof readerFeatures)[number];

export const locatorKinds = [
  "pdf",
  "image",
  "docx",
  "xlsx",
  "pptx",
  "email",
  "json",
  "xml",
  "code",
  "cad",
  "media",
  "database",
  "api",
] as const;
export type LocatorKind = (typeof locatorKinds)[number];

export const readerRegistryStatuses = ["candidate", "qualified", "retired"] as const;
export type ReaderRegistryStatus = (typeof readerRegistryStatuses)[number];

export const failureClasses = [
  "UNSUPPORTED_FORMAT",
  "ENCRYPTED_SOURCE",
  "CORRUPT_SOURCE",
  "MALWARE_QUARANTINED",
  "PARSER_TIMEOUT",
  "PARSER_OOM",
  "EMPTY_OUTPUT",
  "NATIVE_VISUAL_DISAGREEMENT",
  "LAYOUT_FAILURE",
  "TABLE_FAILURE",
  "FORMULA_FAILURE",
  "TEXT_OMISSION",
  "IDENTITY_UNRESOLVED",
  "EVIDENCE_BROKEN",
  "ACL_UNRESOLVED",
  "SOURCE_DELETED",
  "RECEIPT_MISMATCH",
  "PRESERVATION_FAILED",
  "EQUIVALENCE_FAILED",
  "PROVIDER_UNAVAILABLE",
] as const;
export type FailureClass = (typeof failureClasses)[number];

export const privacyPolicies = ["foundation_synthetic_only", "approved_customer_data"] as const;
export type PrivacyPolicy = (typeof privacyPolicies)[number];

export const customerDataPreconditions = [
  "tenant_isolation_suite_passed",
  "encryption_at_rest_verified",
  "encryption_in_transit_verified",
  "connector_credentials_in_secret_manager",
  "no_secrets_in_receipts_or_logs_verified",
  "malware_scan_and_quarantine_active",
  "archive_bomb_limits_enforced",
  "compile_receipts_signed_and_audited",
  "deletion_tombstone_propagation_verified",
  "retention_controls_configured",
  "data_export_and_delete_available",
  "audit_log_active",
  "least_privilege_connector_scopes_verified",
  "per_provider_isolation_verified",
  "dpa_and_privacy_notice_published",
  "per_source_acl_preserved",
  "founder_approval_receipt_recorded",
] as const;
export type CustomerDataPrecondition = (typeof customerDataPreconditions)[number];
