/** Versioned, reviewable intake triage metadata. This module never reads file bytes or invokes a parser. */

export const INTAKE_TRIAGE_VERSION = "tavonel-intake-triage-v1" as const;
const SHA256_HEX = /^(?:sha256:)?[a-f0-9]{64}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const KNOWN_SIDECARS = new Set([".ds_store", "thumbs.db", "desktop.ini", "ehthumbs.db"]);

export type TriageChoice = "include" | "exclude";
export type DigestEvidence = "server_verified" | "client_claimed" | "connector_observed" | "unavailable";
export type SignatureObservation = "valid" | "mismatch" | "not_checked";
export type EncryptionObservation = "unencrypted" | "encrypted" | "unknown";
export type CorruptionObservation = "valid" | "corrupt" | "unknown";
export type ArchiveExpansionObservation = "within_limit" | "limit_exceeded" | "unknown";

export type IntakeTriageScope = {
  /** Server-derived. Never accept this field from an untrusted inventory body. */
  workspaceKey: string;
  sourceKind: "direct_upload" | "connector";
  /** Server-derived upload attempt or connection identity; never a global content cache key. */
  sourceId: string;
  /** Complete selected-set digest for uploads, or finalized inventory epoch for connectors. */
  inventoryRevision: string;
  /** Observation only; authorization is enforced separately by the workspace/connection boundary. */
  aclObservationSha256: string | null;
};

export type TriageObservation = {
  fileKey: string;
  relativePath: string;
  revision: string | null;
  byteLength: number | null;
  mimeType: string | null;
  contentSha256: string | null;
  digestEvidence: DigestEvidence;
  /** Per-source permission observation; it does not grant authorization. */
  aclObservationSha256: string | null;
  /** Signature validation can be set only by a trusted byte-reading stage. */
  signature: SignatureObservation;
  /** Metadata inventory alone must leave these unknown. */
  encryption: EncryptionObservation;
  corruption: CorruptionObservation;
  archiveExpansion: ArchiveExpansionObservation;
  /** Optional output of a separate classifier. It is advisory and never runs here. */
  similarity?: { method: string; version: string; score: number; threshold: number } | null;
};

export type TriageEstimateRange = {
  currency: "USD";
  /** Customer-facing page charges from the published intake price policy. */
  initial: { minimum: number; maximum: number };
  /** Page charge to recompile the same unchanged source versions after they have been read. */
  incremental: { minimum: number; maximum: number };
  customerChargeCoverage: {
    policy: "published_page_admission_once";
    scope: "entire_affected_source_version_set" | "unknown";
    pricingFingerprint: string;
    sourceVersions: Array<{
      fileKey: string;
      revision: string | null;
      contentSha256: string;
      mode: "new_read" | "unchanged_already_read_recompile" | "unknown_reprocessing";
    }>;
  };
  /** Internal operator economics are reported separately and never change customer price readiness. */
  operatorCost: { status: "priced" | "not_priced"; unavailableProviders: string[] };
  basis: string;
  assumptions: string[];
};

export type TriageFile = {
  fileKey: string;
  relativePath: string;
  revision: string | null;
  byteLength: number | null;
  mimeType: string | null;
  contentSha256: string | null;
  digestEvidence: DigestEvidence;
  aclObservationSha256: string | null;
  disposition: "include" | "exclude" | "needs_review";
  reason: string;
  suggestedChoice: TriageChoice | null;
  exactDuplicateOf: string | null;
  similarity: TriageObservation["similarity"];
  unknowns: {
    signature: SignatureObservation;
    encryption: EncryptionObservation;
    corruption: CorruptionObservation;
    archiveExpansion: ArchiveExpansionObservation;
  };
};

export type ReviewedTriageInventory = {
  version: typeof INTAKE_TRIAGE_VERSION;
  duplicatePolicy: "review_only_no_artifact_reuse";
  scope: IntakeTriageScope;
  configurationRevision: string;
  pricingFingerprint: string;
  inventoryDigest: string;
  reviewed: boolean;
  approvalReady: boolean;
  approvalBlockers: string[];
  selectedFileKeys: string[];
  files: TriageFile[];
  estimate: TriageEstimateRange;
};

function validText(value: string) {
  return value.length > 0 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}

function validEstimate(value: TriageEstimateRange, pricingFingerprint: string) {
  const numbers = [value.initial.minimum, value.initial.maximum, value.incremental.minimum, value.incremental.maximum];
  return value.currency === "USD"
    && numbers.slice(0, 2).every((amount) => Number.isFinite(amount) && amount! >= 0)
    && numbers.slice(2).every((amount) => Number.isFinite(amount) && amount! >= 0)
    && value.initial.minimum <= value.initial.maximum
    && value.incremental.minimum === 0 && value.incremental.maximum === 0
    && value.customerChargeCoverage?.policy === "published_page_admission_once"
    && ["entire_affected_source_version_set", "unknown"].includes(value.customerChargeCoverage.scope)
    && value.customerChargeCoverage.pricingFingerprint === pricingFingerprint
    && Array.isArray(value.customerChargeCoverage.sourceVersions)
    && value.customerChargeCoverage.sourceVersions.every((source) => validText(source.fileKey)
      && (source.revision === null || validText(source.revision))
      && SHA256_DIGEST.test(source.contentSha256)
      && ["new_read", "unchanged_already_read_recompile", "unknown_reprocessing"].includes(source.mode))
    && (value.operatorCost?.status === "priced" || value.operatorCost?.status === "not_priced")
    && Array.isArray(value.operatorCost.unavailableProviders)
    && value.operatorCost.unavailableProviders.every(validText)
    && validText(value.basis)
    && Array.isArray(value.assumptions)
    && value.assumptions.every(validText);
}

function basename(path: string) {
  return path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function isKnownSidecar(path: string) {
  return KNOWN_SIDECARS.has(basename(path));
}

function digestHex(value: string | null) {
  return value?.startsWith("sha256:") ? value.slice(7) : value;
}

function validInventoryRevision(scope: IntakeTriageScope) {
  return scope.sourceKind === "direct_upload"
    ? SHA256_DIGEST.test(scope.inventoryRevision)
    : /^(0|[1-9][0-9]{0,14})$/.test(scope.inventoryRevision);
}

function validateInput(input: {
  scope: IntakeTriageScope;
  configurationRevision: string;
  pricingFingerprint: string;
  supportedMimeTypes: readonly string[];
  observations: readonly TriageObservation[];
  choices: Readonly<Record<string, TriageChoice>>;
  estimate: TriageEstimateRange;
}) {
  const { scope } = input;
  if (!validText(scope.workspaceKey) || !validText(scope.sourceId) || !validText(scope.inventoryRevision)
    || (scope.sourceKind !== "direct_upload" && scope.sourceKind !== "connector")
    || !validInventoryRevision(scope)
    || (scope.aclObservationSha256 !== null && !/^[a-f0-9]{64}$/.test(scope.aclObservationSha256))
    || !validText(input.configurationRevision) || !SHA256_DIGEST.test(input.pricingFingerprint)
    || !validEstimate(input.estimate, input.pricingFingerprint) || !Array.isArray(input.observations) || input.observations.length < 1
    || !Array.isArray(input.supportedMimeTypes) || input.supportedMimeTypes.some((mime) => !validText(mime))
    || input.choices === null || typeof input.choices !== "object" || Array.isArray(input.choices)
    || input.observations.length > (scope.sourceKind === "direct_upload" ? 128 : 100_000)) return false;
  const keys = new Set<string>();
  for (const item of input.observations) {
    if (!validText(item.fileKey) || !validText(item.relativePath) || keys.has(item.fileKey)
      || !["server_verified", "client_claimed", "connector_observed", "unavailable"].includes(item.digestEvidence)
      || (item.digestEvidence === "unavailable" && item.contentSha256 !== null)
      || !["valid", "mismatch", "not_checked"].includes(item.signature)
      || !["unencrypted", "encrypted", "unknown"].includes(item.encryption)
      || !["valid", "corrupt", "unknown"].includes(item.corruption)
      || !["within_limit", "limit_exceeded", "unknown"].includes(item.archiveExpansion)
      || (item.revision !== null && !validText(item.revision))
      || (item.byteLength !== null && (!Number.isSafeInteger(item.byteLength) || item.byteLength < 0))
      || (item.mimeType !== null && !validText(item.mimeType))
      || (item.contentSha256 !== null && !SHA256_HEX.test(item.contentSha256))
      || (item.aclObservationSha256 !== null && !/^[a-f0-9]{64}$/.test(item.aclObservationSha256))
      || (item.digestEvidence === "server_verified" && item.contentSha256 === null)
      || (item.similarity !== undefined && item.similarity !== null
        && (!validText(item.similarity.method) || !validText(item.similarity.version)
          || !Number.isFinite(item.similarity.score) || item.similarity.score < 0 || item.similarity.score > 1
          || !Number.isFinite(item.similarity.threshold) || item.similarity.threshold < 0 || item.similarity.threshold > 1))) return false;
    keys.add(item.fileKey);
  }
  return Object.keys(input.choices).every((key) => keys.has(key)
    && (input.choices[key] === "include" || input.choices[key] === "exclude"));
}

/** Build a review inventory from already available metadata. No absent byte property is inferred. */
export function buildIntakeTriage(input: {
  scope: IntakeTriageScope;
  configurationRevision: string;
  pricingFingerprint: string;
  supportedMimeTypes: readonly string[];
  observations: readonly TriageObservation[];
  choices: Readonly<Record<string, TriageChoice>>;
  estimate: TriageEstimateRange;
}): Omit<ReviewedTriageInventory, "inventoryDigest"> | null {
  if (!validateInput(input)) return null;
  const sorted = [...input.observations].sort((a, b) => (a.fileKey < b.fileKey ? -1 : a.fileKey > b.fileKey ? 1 : 0));
  const representatives = new Map<string, string>();
  for (const file of sorted) {
    const hex = digestHex(file.contentSha256);
    if (file.digestEvidence !== "server_verified" || !hex) continue;
    const previous = representatives.get(hex);
    if (!previous) representatives.set(hex, file.fileKey);
  }

  const files: TriageFile[] = sorted.map((item) => {
    const hex = digestHex(item.contentSha256);
    const exactDuplicateOf = item.digestEvidence === "server_verified" && hex
      ? (representatives.get(hex) === item.fileKey
        ? null
        : representatives.get(hex) ?? null)
      : null;
    const sidecar = isKnownSidecar(item.relativePath);
    const unsupported = item.mimeType !== null && !input.supportedMimeTypes.includes(item.mimeType);
    const metadataUnknown = item.mimeType === null || item.byteLength === null;
    const similarity = item.similarity ?? null;
    let reason = "supported_candidate";
    let suggestedChoice: TriageChoice | null = null;
    const inspectionBlocked = item.signature === "mismatch" || item.encryption === "encrypted"
      || item.corruption === "corrupt" || item.archiveExpansion === "limit_exceeded";
    const contentClassificationUnknown = item.encryption === "unknown" || item.corruption === "unknown"
      || item.archiveExpansion === "unknown";
    if (inspectionBlocked) {
      reason = item.signature === "mismatch" ? "signature_mismatch"
        : item.encryption === "encrypted" ? "encrypted_file"
          : item.corruption === "corrupt" ? "corrupt_file" : "archive_expansion_limit_exceeded";
      suggestedChoice = "exclude";
    } else if (contentClassificationUnknown) {
      reason = "content_safety_classification_unknown";
      suggestedChoice = "exclude";
    } else if (sidecar) {
      reason = "known_os_sidecar_requires_review";
      suggestedChoice = "exclude";
    } else if (unsupported) {
      reason = "unsupported_or_unrecognized_type";
    } else if (exactDuplicateOf !== null) {
      reason = "byte_exact_duplicate_requires_review";
    } else if (similarity && similarity.score >= similarity.threshold) {
      reason = "similarity_candidate_requires_review";
    } else if (metadataUnknown) {
      reason = "metadata_unknown";
    }
    const choice = input.choices[item.fileKey];
    const unsafeToInclude = unsupported || metadataUnknown || inspectionBlocked || contentClassificationUnknown;
    const disposition: TriageFile["disposition"] = !choice || (choice === "include" && unsafeToInclude)
      ? "needs_review"
      : choice;
    return {
      fileKey: item.fileKey,
      relativePath: item.relativePath,
      revision: item.revision,
      byteLength: item.byteLength,
      mimeType: item.mimeType,
      contentSha256: item.contentSha256,
      digestEvidence: item.digestEvidence,
      aclObservationSha256: item.aclObservationSha256,
      disposition,
      reason,
      suggestedChoice,
      exactDuplicateOf,
      similarity,
      unknowns: {
        signature: item.signature,
        encryption: item.encryption,
        corruption: item.corruption,
        archiveExpansion: item.archiveExpansion,
      },
    };
  });
  const selectedFileKeys = files.filter((file) => file.disposition === "include").map((file) => file.fileKey);
  const reviewed = files.every((file) => file.disposition !== "needs_review");
  const requestedFileKeys = sorted.filter((file) => input.choices[file.fileKey] === "include").map((file) => file.fileKey);
  const customerSources = input.estimate.customerChargeCoverage.sourceVersions;
  const customerKeys = customerSources.map((source) => source.fileKey).sort();
  const requestedKeys = [...requestedFileKeys].sort();
  const sourceCoverageComplete = input.estimate.customerChargeCoverage.scope === "entire_affected_source_version_set"
    && customerKeys.length === requestedKeys.length
    && customerKeys.every((key, index) => key === requestedKeys[index])
    && customerSources.every((source) => {
      const observed = sorted.find((file) => file.fileKey === source.fileKey);
      return !!observed && observed.revision === source.revision && observed.contentSha256 === source.contentSha256
        && observed.digestEvidence === "server_verified"
        && source.mode === "new_read";
    });
  const readProofRequired = customerSources.some((source) => source.mode === "unchanged_already_read_recompile");
  const approvalBlockers = [
    ...(!reviewed ? ["inventory_review_incomplete"] : []),
    ...(selectedFileKeys.length === 0 ? ["no_files_selected"] : []),
    ...(!sourceCoverageComplete ? ["customer_charge_scope_or_new_read_coverage_incomplete"] : []),
    ...(readProofRequired ? ["READ_PROOF_REQUIRED"] : []),
  ];
  return {
    version: INTAKE_TRIAGE_VERSION,
    duplicatePolicy: "review_only_no_artifact_reuse",
    scope: input.scope,
    configurationRevision: input.configurationRevision,
    pricingFingerprint: input.pricingFingerprint,
    reviewed,
    approvalReady: approvalBlockers.length === 0,
    approvalBlockers,
    selectedFileKeys,
    files,
    estimate: input.estimate,
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

/** Bind a reviewed selection to its tenant/source inventory, triage/config revision and quote. */
export async function intakeTriageDigest(inventory: Omit<ReviewedTriageInventory, "inventoryDigest">) {
  const bytes = new TextEncoder().encode(canonical(inventory));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
