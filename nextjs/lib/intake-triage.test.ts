import { describe, expect, it } from "vitest";
import {
  buildIntakeTriage,
  INTAKE_TRIAGE_VERSION,
  intakeTriageDigest,
  type TriageChoice,
  type TriageObservation,
  type TriageEstimateRange,
} from "./intake-triage";

const workspaceKey = "pilot-test";
const hash = `sha256:${"a".repeat(64)}`;
const priceFingerprint = `sha256:${"b".repeat(64)}`;
const scope = {
  workspaceKey,
  sourceKind: "direct_upload" as const,
  sourceId: "attempt-1",
  inventoryRevision: `sha256:${"f".repeat(64)}`,
  aclObservationSha256: null,
};
const estimate: TriageEstimateRange = {
  currency: "USD",
  initial: { minimum: 0.2, maximum: 1.4 },
  incremental: { minimum: 0, maximum: 0 },
  customerChargeCoverage: {
    policy: "published_page_admission_once",
    scope: "entire_affected_source_version_set",
    pricingFingerprint: priceFingerprint,
    sourceVersions: [],
  },
  operatorCost: { status: "not_priced", unavailableProviders: ["cdr_infrastructure", "gpu_compute"] },
  basis: "Existing page quote; unknown files use the configured hard ceiling",
  assumptions: ["New reads use the existing page price; zero additional recompile charges require trusted prior-read and metering proof."],
};
const observation = (fileKey: string, overrides: Partial<TriageObservation> = {}): TriageObservation => ({
  fileKey,
  relativePath: `${fileKey}.pdf`,
  revision: null,
  byteLength: 1024,
  mimeType: "application/pdf",
  contentSha256: hash,
  digestEvidence: "server_verified",
  aclObservationSha256: null,
  signature: "valid",
  encryption: "unencrypted",
  corruption: "valid",
  archiveExpansion: "within_limit",
  ...overrides,
});

function build(observations: TriageObservation[], choices: Record<string, TriageChoice> = {}) {
  const chargeSources = observations.filter((row) => choices[row.fileKey] === "include").map((row) => ({
    fileKey: row.fileKey, revision: row.revision, contentSha256: row.contentSha256!, mode: "new_read" as const,
  }));
  return buildIntakeTriage({
    scope,
    configurationRevision: "triage-config-1",
    pricingFingerprint: priceFingerprint,
    supportedMimeTypes: ["application/pdf"],
    observations,
    choices,
    estimate: { ...estimate, customerChargeCoverage: { ...estimate.customerChargeCoverage, sourceVersions: chargeSources } },
  });
}

describe("versioned reviewed intake triage", () => {
  it("distinguishes byte-exact duplicates and never auto-excludes one", () => {
    const inventory = build([
      observation("file-b", { relativePath: "copy.pdf", aclObservationSha256: "e".repeat(64) }),
      observation("file-a", { relativePath: "original.pdf", aclObservationSha256: "c".repeat(64) }),
    ]);

    expect(inventory?.version).toBe(INTAKE_TRIAGE_VERSION);
    expect(inventory?.files).toEqual([
      expect.objectContaining({ fileKey: "file-a", disposition: "needs_review", exactDuplicateOf: null }),
      expect.objectContaining({
        fileKey: "file-b",
        disposition: "needs_review",
        reason: "byte_exact_duplicate_requires_review",
        suggestedChoice: null,
        exactDuplicateOf: "file-a",
        aclObservationSha256: "e".repeat(64),
      }),
    ]);
    expect(inventory?.files.map((file) => file.fileKey)).toEqual(["file-a", "file-b"]);
    expect(inventory?.duplicatePolicy).toBe("review_only_no_artifact_reuse");
    expect(inventory?.selectedFileKeys).toEqual([]);
  });

  it("keeps byte-identical sources with different ACL observations separately selected and charge-covered", () => {
    const inventory = build([
      observation("file-b", { relativePath: "shared/copy.pdf", revision: "rev-b1", aclObservationSha256: "e".repeat(64) }),
      observation("file-a", { relativePath: "private/original.pdf", revision: "rev-a1", aclObservationSha256: "c".repeat(64) }),
    ], { "file-a": "include", "file-b": "include" });

    expect(inventory?.files.map((file) => [file.fileKey, file.revision, file.aclObservationSha256])).toEqual([
      ["file-a", "rev-a1", "c".repeat(64)],
      ["file-b", "rev-b1", "e".repeat(64)],
    ]);
    expect(inventory?.files[1]).toMatchObject({ disposition: "include", exactDuplicateOf: "file-a" });
    expect(inventory?.selectedFileKeys).toEqual(["file-a", "file-b"]);
    expect(inventory?.estimate.customerChargeCoverage.sourceVersions).toEqual([
      { fileKey: "file-b", revision: "rev-b1", contentSha256: hash, mode: "new_read" },
      { fileKey: "file-a", revision: "rev-a1", contentSha256: hash, mode: "new_read" },
    ]);
    expect(inventory?.approvalReady).toBe(true);
    expect(inventory?.approvalBlockers).toEqual([]);
  });

  it("blocks byte-identical sources with different ACL observations when only one is charge-covered", () => {
    const inventory = buildIntakeTriage({
      scope, configurationRevision: "triage-config-1", pricingFingerprint: priceFingerprint,
      supportedMimeTypes: ["application/pdf"],
      observations: [
        observation("file-b", { relativePath: "shared/copy.pdf", revision: "rev-b1", aclObservationSha256: "e".repeat(64) }),
        observation("file-a", { relativePath: "private/original.pdf", revision: "rev-a1", aclObservationSha256: "c".repeat(64) }),
      ],
      choices: { "file-a": "include", "file-b": "include" },
      estimate: { ...estimate, customerChargeCoverage: {
        ...estimate.customerChargeCoverage,
        sourceVersions: [{ fileKey: "file-a", revision: "rev-a1", contentSha256: hash, mode: "new_read" }],
      } },
    });
    expect(inventory?.selectedFileKeys).toEqual(["file-a", "file-b"]);
    expect(inventory?.approvalReady).toBe(false);
    expect(inventory?.approvalBlockers).toContain("customer_charge_scope_or_new_read_coverage_incomplete");
  });

  it("does not treat client-claimed or connector-observed hashes as byte proof", () => {
    const inventory = build([
      observation("file-a", { digestEvidence: "client_claimed" }),
      observation("file-b", { digestEvidence: "connector_observed" }),
    ]);

    expect(inventory?.files.map((file) => file.exactDuplicateOf)).toEqual([null, null]);
    expect(inventory?.files.map((file) => file.reason)).toEqual([
      "supported_candidate",
      "supported_candidate",
    ]);
  });

  it("keeps uncertain similarity separate from exact duplicates and requires review", () => {
    const inventory = build([
      observation("file-a", { contentSha256: "a".repeat(64) }),
      observation("file-b", {
        contentSha256: "c".repeat(64),
        similarity: { method: "text-trigram-jaccard", version: "1", score: 0.93, threshold: 0.9 },
      }),
    ]);

    expect(inventory?.files[1]).toMatchObject({
      disposition: "needs_review",
      reason: "similarity_candidate_requires_review",
      exactDuplicateOf: null,
    });
  });

  it("requires an explicit choice and preserves unknown byte properties", () => {
    const unknownObservation = observation("file-a", {
      signature: "not_checked", encryption: "unknown", corruption: "unknown", archiveExpansion: "unknown",
    });
    const pending = build([unknownObservation]);
    const reviewed = build([unknownObservation], { "file-a": "include" });

    expect(pending?.reviewed).toBe(false);
    expect(pending?.files[0]?.unknowns).toEqual({
      signature: "not_checked",
      encryption: "unknown",
      corruption: "unknown",
      archiveExpansion: "unknown",
    });
    expect(reviewed?.reviewed).toBe(false);
    expect(reviewed?.selectedFileKeys).toEqual([]);
    expect(reviewed?.approvalReady).toBe(false);
    expect(reviewed?.approvalBlockers).toContain("inventory_review_incomplete");
    expect(reviewed?.approvalBlockers).toContain("no_files_selected");
  });

  it("keeps a fully bounded customer charge approval-ready when operator provider costs are unknown", () => {
    const inventory = buildIntakeTriage({
      scope,
      configurationRevision: "triage-config-1",
      pricingFingerprint: priceFingerprint,
      supportedMimeTypes: ["application/pdf"],
      observations: [observation("file-a")],
      choices: { "file-a": "include" },
      estimate: {
        ...estimate,
        customerChargeCoverage: {
          ...estimate.customerChargeCoverage,
          sourceVersions: [{ fileKey: "file-a", revision: null, contentSha256: hash, mode: "new_read" }],
        },
        operatorCost: { status: "not_priced", unavailableProviders: ["cdr_infrastructure", "gpu_compute"] },
      },
    });

    expect(inventory?.approvalReady).toBe(true);
    expect(inventory?.approvalBlockers).toEqual([]);
  });

  it("blocks if an affected source/version is missing from the customer quote scope", () => {
    const inventory = buildIntakeTriage({
      scope, configurationRevision: "triage-config-1", pricingFingerprint: priceFingerprint,
      supportedMimeTypes: ["application/pdf"],
      observations: [observation("file-a"), observation("file-b", { contentSha256: `sha256:${"c".repeat(64)}` })],
      choices: { "file-a": "include", "file-b": "include" },
      estimate: { ...estimate, customerChargeCoverage: {
        ...estimate.customerChargeCoverage,
        sourceVersions: [{ fileKey: "file-a", revision: null, contentSha256: hash, mode: "new_read" }],
      } },
    });
    expect(inventory?.approvalReady).toBe(false);
    expect(inventory?.approvalBlockers).toContain("customer_charge_scope_or_new_read_coverage_incomplete");
  });

  it("blocks a new-version or reprocessing mode with no verified charge treatment", () => {
    const inventory = buildIntakeTriage({
      scope, configurationRevision: "triage-config-1", pricingFingerprint: priceFingerprint,
      supportedMimeTypes: ["application/pdf"], observations: [observation("file-a", { revision: "rev-2" })],
      choices: { "file-a": "include" },
      estimate: { ...estimate, customerChargeCoverage: {
        ...estimate.customerChargeCoverage,
        sourceVersions: [{ fileKey: "file-a", revision: "rev-2", contentSha256: hash, mode: "unknown_reprocessing" }],
      } },
    });
    expect(inventory?.approvalReady).toBe(false);
    expect(inventory?.approvalBlockers).toContain("customer_charge_scope_or_new_read_coverage_incomplete");
  });

  it("blocks unchanged recompile without trusted persisted read proof", () => {
    const inventory = buildIntakeTriage({
      scope, configurationRevision: "triage-config-1", pricingFingerprint: priceFingerprint,
      supportedMimeTypes: ["application/pdf"], observations: [observation("file-a", { revision: "read-rev-1" })],
      choices: { "file-a": "include" },
      estimate: { ...estimate, incremental: { minimum: 0, maximum: 0 }, customerChargeCoverage: {
        ...estimate.customerChargeCoverage,
        sourceVersions: [{ fileKey: "file-a", revision: "read-rev-1", contentSha256: hash, mode: "unchanged_already_read_recompile" }],
      } },
    });
    expect(inventory?.approvalReady).toBe(false);
    expect(inventory?.approvalBlockers).toContain("READ_PROOF_REQUIRED");
  });

  it("suggests known sidecars for exclusion without hiding them from review", () => {
    const inventory = build([observation("sidecar", { relativePath: "folder/.DS_Store" })]);
    expect(inventory?.files[0]).toMatchObject({
      disposition: "needs_review",
      reason: "known_os_sidecar_requires_review",
      suggestedChoice: "exclude",
    });
  });

  it("blocks a positively identified unsafe file even when the user chooses include", () => {
    const inventory = build([observation("encrypted", { encryption: "encrypted" })], { encrypted: "include" });
    expect(inventory?.reviewed).toBe(false);
    expect(inventory?.selectedFileKeys).toEqual([]);
    expect(inventory?.files[0]).toMatchObject({
      disposition: "needs_review",
      reason: "encrypted_file",
      suggestedChoice: "exclude",
    });
  });

  it("blocks inclusion when encryption, corruption, or archive expansion remains unknown", () => {
    const inventory = build([observation("unclassified", {
      encryption: "unknown", corruption: "unknown", archiveExpansion: "unknown",
    })], { unclassified: "include" });
    expect(inventory?.reviewed).toBe(false);
    expect(inventory?.selectedFileKeys).toEqual([]);
    expect(inventory?.files[0]).toMatchObject({
      disposition: "needs_review",
      reason: "content_safety_classification_unknown",
      suggestedChoice: "exclude",
    });
  });

  it("binds the reviewed choices, source/tenant inventory, pricing and configuration revisions", async () => {
    const inventory = build([observation("file-a")], { "file-a": "include" });
    expect(inventory).not.toBeNull();
    const digest = await intakeTriageDigest(inventory!);

    const reordered = build([observation("file-a")], { "file-a": "include" });
    expect(await intakeTriageDigest(reordered!)).toBe(digest);
    expect(await intakeTriageDigest({ ...inventory!, scope: { ...scope, workspaceKey: "pilot-other" } })).not.toBe(digest);
    expect(await intakeTriageDigest({ ...inventory!, scope: { ...scope, sourceId: "connection-2" } })).not.toBe(digest);
    expect(await intakeTriageDigest({ ...inventory!, scope: { ...scope, inventoryRevision: `sha256:${"9".repeat(64)}` } })).not.toBe(digest);
    expect(await intakeTriageDigest({
      ...inventory!,
      scope: { ...scope, sourceKind: "connector", inventoryRevision: "2", aclObservationSha256: "e".repeat(64) },
    })).not.toBe(digest);
    expect(await intakeTriageDigest({
      ...inventory!,
      files: [{ ...inventory!.files[0]!, aclObservationSha256: "c".repeat(64) }],
    })).not.toBe(digest);
    expect(await intakeTriageDigest({ ...inventory!, pricingFingerprint: `sha256:${"d".repeat(64)}` })).not.toBe(digest);
    expect(await intakeTriageDigest({ ...inventory!, configurationRevision: "triage-config-2" })).not.toBe(digest);
    expect(await intakeTriageDigest({
      ...inventory!,
      files: [{ ...inventory!.files[0]!, disposition: "exclude" }],
      selectedFileKeys: [],
    })).not.toBe(digest);
  });

  it("rejects invalid digests, ambiguous revisions, and malformed estimate ranges", () => {
    expect(build([observation("file-a", { digestEvidence: "server_verified", contentSha256: "not-a-hash" })])).toBeNull();
    expect(build([observation("file-a"), observation("file-a")])).toBeNull();
    expect(buildIntakeTriage({
      scope,
      configurationRevision: "triage-config-1",
      pricingFingerprint: priceFingerprint,
      supportedMimeTypes: ["application/pdf"],
      observations: [observation("file-a")],
      choices: {},
      estimate: { ...estimate, initial: { minimum: 2, maximum: 1 } },
    })).toBeNull();
  });
});
