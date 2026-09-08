import { describe, expect, it } from "vitest";
import {
  USKC_ENUMS_CONTRACT,
  capabilityStatuses,
  capabilityStatusesAcceptedAtUpload,
  customerDataPreconditions,
  failureClasses,
  locatorKinds,
  privacyPolicies,
  readerFeatures,
  readerRegistryStatuses,
  representationKinds,
  sourceFamilies,
} from "../../shared/uskcEnums";

/**
 * The frozen lists, retyped from `contract/enums.v1.json`
 * (sha256 3c668dc9c22289b27a7d0dd8b072cf23fa0511fd8fe888875770171e664f11d1).
 *
 * Retyped on purpose: the contract file lives outside this repository, so a test that read it
 * would pass in a lane worktree and fail in CI. These literals are the copy CI can check, and a
 * value that drifts from the contract fails here rather than at integration, where the site and
 * the Python core would disagree about a vocabulary they never share a compiler for.
 */
const FROZEN = {
  SourceFamily: [
    "document", "spreadsheet", "presentation", "image", "email", "structured_data", "web", "code",
    "cad_2d", "cad_3d", "bim", "audio", "video", "archive", "database", "api", "unknown",
  ],
  CapabilityStatus: [
    "VERIFIED_NATIVE", "VERIFIED_HYBRID", "BEST_EFFORT", "METADATA_ONLY", "REVIEW_REQUIRED", "UNSUPPORTED",
  ],
  CapabilityStatusAcceptedAtUpload: ["VERIFIED_NATIVE", "VERIFIED_HYBRID", "BEST_EFFORT", "METADATA_ONLY"],
  RepresentationKind: ["original", "native", "rendered", "ocr", "visual", "normalized", "canonical_ir"],
  ReaderFeature: [
    "native_text", "layout", "tables", "formula", "comments", "track_changes", "chart_data",
    "geometry", "assembly", "acl", "thread", "timestamp", "ast", "dependency_graph",
  ],
  LocatorKind: [
    "pdf", "image", "docx", "xlsx", "pptx", "email", "json", "xml", "code", "cad", "media", "database", "api",
  ],
  ReaderRegistryStatus: ["candidate", "qualified", "retired"],
  FailureClass: [
    "UNSUPPORTED_FORMAT", "ENCRYPTED_SOURCE", "CORRUPT_SOURCE", "MALWARE_QUARANTINED", "PARSER_TIMEOUT",
    "PARSER_OOM", "EMPTY_OUTPUT", "NATIVE_VISUAL_DISAGREEMENT", "LAYOUT_FAILURE", "TABLE_FAILURE",
    "FORMULA_FAILURE", "TEXT_OMISSION", "IDENTITY_UNRESOLVED", "EVIDENCE_BROKEN", "ACL_UNRESOLVED",
    "SOURCE_DELETED", "RECEIPT_MISMATCH", "PRESERVATION_FAILED", "EQUIVALENCE_FAILED", "PROVIDER_UNAVAILABLE",
  ],
  PrivacyPolicy: ["foundation_synthetic_only", "approved_customer_data"],
  CustomerDataPrecondition: [
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
  ],
} as const;

describe("USKC frozen enumerations", () => {
  it("names the contract it transliterates", () => {
    expect(USKC_ENUMS_CONTRACT).toBe("tavonel.uskc.enums.v1");
  });

  it("carries every frozen list, in the frozen order", () => {
    expect([...sourceFamilies]).toEqual(FROZEN.SourceFamily);
    expect([...capabilityStatuses]).toEqual(FROZEN.CapabilityStatus);
    expect([...capabilityStatusesAcceptedAtUpload]).toEqual(FROZEN.CapabilityStatusAcceptedAtUpload);
    expect([...representationKinds]).toEqual(FROZEN.RepresentationKind);
    expect([...readerFeatures]).toEqual(FROZEN.ReaderFeature);
    expect([...locatorKinds]).toEqual(FROZEN.LocatorKind);
    expect([...readerRegistryStatuses]).toEqual(FROZEN.ReaderRegistryStatus);
    expect([...failureClasses]).toEqual(FROZEN.FailureClass);
    expect([...privacyPolicies]).toEqual(FROZEN.PrivacyPolicy);
    expect([...customerDataPreconditions]).toEqual(FROZEN.CustomerDataPrecondition);
  });

  it("keeps the upload-accepted statuses a subset that excludes the two refusing tiers", () => {
    for (const status of capabilityStatusesAcceptedAtUpload) {
      expect(capabilityStatuses).toContain(status);
    }
    expect([...capabilityStatusesAcceptedAtUpload]).not.toContain("REVIEW_REQUIRED");
    expect([...capabilityStatusesAcceptedAtUpload]).not.toContain("UNSUPPORTED");
  });

  it("has no duplicate value in any list", () => {
    for (const list of [
      sourceFamilies, capabilityStatuses, representationKinds, readerFeatures, locatorKinds,
      readerRegistryStatuses, failureClasses, privacyPolicies, customerDataPreconditions,
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
