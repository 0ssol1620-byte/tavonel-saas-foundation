/**
 * The frozen Universal Source Knowledge Compiler vocabulary, transliterated from
 * `contract/enums.v1.json` of the 2026-09-06 P0 lane contract.
 *
 * Both repositories carry this list. The site has it here; the compiler core has it in
 * `akc_readers/enums.py` and `akc_cir/evidence_locator.py`. A value that exists in one copy and
 * not the other is the failure this file is written to make impossible, so the copies are
 * mechanical and boring on purpose: a lane that needs a new value proposes it in its report and
 * does not add it here.
 *
 * The arrays are the payload, not the types. A type alias can be widened by an edit that looks
 * harmless; a `const` array is what a test can compare against the frozen contract value for
 * value, which is what `server/foundation/capabilityManifest.test.ts` does.
 */

export const SOURCE_FAMILIES = [
  "document", "spreadsheet", "presentation", "image", "email", "structured_data", "web", "code",
  "cad_2d", "cad_3d", "bim", "audio", "video", "archive", "database", "api", "unknown",
] as const;
export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

export const CAPABILITY_STATUSES = [
  "VERIFIED_NATIVE", "VERIFIED_HYBRID", "BEST_EFFORT", "METADATA_ONLY", "REVIEW_REQUIRED", "UNSUPPORTED",
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/**
 * The four tiers a file may be accepted at upload with. `REVIEW_REQUIRED` and `UNSUPPORTED` are
 * refusals, so a format that reaches either is refused by the intake contract rather than
 * accepted and disappointed later.
 */
export const CAPABILITY_STATUS_ACCEPTED_AT_UPLOAD = [
  "VERIFIED_NATIVE", "VERIFIED_HYBRID", "BEST_EFFORT", "METADATA_ONLY",
] as const;
export type CapabilityStatusAcceptedAtUpload = (typeof CAPABILITY_STATUS_ACCEPTED_AT_UPLOAD)[number];

export const REPRESENTATION_KINDS = [
  "original", "native", "rendered", "ocr", "visual", "normalized", "canonical_ir",
] as const;
export type RepresentationKind = (typeof REPRESENTATION_KINDS)[number];

export const READER_FEATURES = [
  "native_text", "layout", "tables", "formula", "comments", "track_changes", "chart_data",
  "geometry", "assembly", "acl", "thread", "timestamp", "ast", "dependency_graph",
] as const;
export type ReaderFeature = (typeof READER_FEATURES)[number];

export const LOCATOR_KINDS = [
  "pdf", "image", "docx", "xlsx", "pptx", "email", "json", "xml", "code", "cad", "media", "database", "api",
] as const;
export type LocatorKind = (typeof LOCATOR_KINDS)[number];

export const READER_REGISTRY_STATUSES = ["candidate", "qualified", "retired"] as const;
export type ReaderRegistryStatus = (typeof READER_REGISTRY_STATUSES)[number];

export const FAILURE_CLASSES = [
  "UNSUPPORTED_FORMAT", "ENCRYPTED_SOURCE", "CORRUPT_SOURCE", "MALWARE_QUARANTINED", "PARSER_TIMEOUT",
  "PARSER_OOM", "EMPTY_OUTPUT", "NATIVE_VISUAL_DISAGREEMENT", "LAYOUT_FAILURE", "TABLE_FAILURE",
  "FORMULA_FAILURE", "TEXT_OMISSION", "IDENTITY_UNRESOLVED", "EVIDENCE_BROKEN", "ACL_UNRESOLVED",
  "SOURCE_DELETED", "RECEIPT_MISMATCH", "PRESERVATION_FAILED", "EQUIVALENCE_FAILED", "PROVIDER_UNAVAILABLE",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const PRIVACY_POLICIES = ["foundation_synthetic_only", "approved_customer_data"] as const;
export type PrivacyPolicy = (typeof PRIVACY_POLICIES)[number];

export const CUSTOMER_DATA_PRECONDITIONS = [
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
export type CustomerDataPrecondition = (typeof CUSTOMER_DATA_PRECONDITIONS)[number];
