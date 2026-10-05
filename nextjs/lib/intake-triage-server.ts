import { FILE_KEY_PATTERN, SHA256_DIGEST_PATTERN, intakeManifestDigest, type IntakeManifestEntry } from "./intake-approval";
import { readFoundationIntakeTriageReceipt, type FoundationIntakeTriageReceipt } from "./compute-reservation";
import { quoteIntakeManifest } from "./usage-pricing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReadyUploadTriage = {
  receipt: FoundationIntakeTriageReceipt;
  entries: IntakeManifestEntry[];
  clientManifestDigest: string;
};

/** Load server-owned inventory and refuse unbounded customer charges, stale receipts, or mutable bytes. */
export async function readReadyUploadTriage(value: {
  workspaceKey: string;
  userId: string;
  receiptId: string;
  now?: number;
}): Promise<{ ok: true; result: ReadyUploadTriage } | { ok: false; code: string; status: number }> {
  const loaded = await readFoundationIntakeTriageReceipt(value);
  if (!loaded.ok) return loaded;
  const receipt = loaded.result;
  const now = value.now ?? Date.now();
  const inventory = receipt.inventory;
  const estimate = receipt.estimate;
  const files = Array.isArray(inventory.files) ? inventory.files as Array<Record<string, unknown>> : [];
  const selected = Array.isArray(inventory.selectedFileKeys) ? inventory.selectedFileKeys.filter((key): key is string => typeof key === "string") : [];
  const coverage = estimate.customerChargeCoverage && typeof estimate.customerChargeCoverage === "object"
    ? estimate.customerChargeCoverage as Record<string, unknown> : null;
  const initial = estimate.initial && typeof estimate.initial === "object" ? estimate.initial as Record<string, unknown> : null;
  const incremental = estimate.incremental && typeof estimate.incremental === "object" ? estimate.incremental as Record<string, unknown> : null;
  const coveredSources = coverage && Array.isArray(coverage.sourceVersions)
    ? coverage.sourceVersions.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row)) : [];
  if (coveredSources.some((source) => source.mode === "unchanged_already_read_recompile")) {
    return { ok: false, code: "READ_PROOF_REQUIRED", status: 409 };
  }
  const coverageComplete = !!coverage
    && coverage.policy === "published_page_admission_once"
    && coverage.scope === "entire_affected_source_version_set"
    && coverage.pricingFingerprint === receipt.pricingFingerprint
    && coveredSources.length === selected.length
    && new Set(coveredSources.map((source) => source.fileKey)).size === coveredSources.length
    && selected.every((key) => {
      const file = files.find((candidate) => candidate.fileKey === key);
      const charge = coveredSources.find((candidate) => candidate.fileKey === key);
      return !!file && !!charge && charge.revision === file.revision
        && charge.contentSha256 === file.contentSha256
        && file.disposition === "include" && file.digestEvidence === "server_verified"
        && charge.mode === "new_read";
    });
  const customerChargeAmountsValid = !!initial && !!incremental
    && estimate.currency === "USD"
    && typeof initial.minimum === "number" && Number.isFinite(initial.minimum) && initial.minimum >= 0
    && typeof initial.maximum === "number" && Number.isFinite(initial.maximum) && initial.maximum >= initial.minimum
    && incremental.minimum === 0 && incremental.maximum === 0;
  const bindings = new Map(receipt.fileBindings.map((binding) => [binding.fileKey, binding]));
  if (receipt.sourceKind !== "direct_upload" || inventory.version !== receipt.triageVersion
    || inventory.inventoryDigest !== receipt.inventoryDigest || inventory.approvalReady !== true
    || inventory.scope === null || typeof inventory.scope !== "object"
    || (inventory.scope as Record<string, unknown>).workspaceKey !== value.workspaceKey
    || (inventory.scope as Record<string, unknown>).sourceId !== receipt.sourceId
    || !receipt.approvalReady || Date.parse(receipt.expiresAt) <= now
    || !coverageComplete || !customerChargeAmountsValid
    || selected.length < 1 || new Set(selected).size !== selected.length
    || bindings.size !== receipt.fileBindings.length
    || files.length < selected.length || files.some((file) => file.disposition === "needs_review")) {
    return { ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 };
  }
  const entries: IntakeManifestEntry[] = [];
  for (const key of selected) {
    const file = files.find((candidate) => candidate.fileKey === key);
    const binding = bindings.get(key);
    if (!file || file.disposition !== "include" || file.digestEvidence !== "server_verified"
      || typeof file.contentSha256 !== "string" || !SHA256_DIGEST_PATTERN.test(file.contentSha256)
      || !FILE_KEY_PATTERN.test(key) || typeof file.byteLength !== "number"
      || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1
      || typeof file.mimeType !== "string" || typeof file.relativePath !== "string") {
      return { ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 };
    }
    if (!binding || binding.sealed !== true || binding.fileKey !== key
      || typeof binding.stageId !== "string" || !UUID.test(binding.stageId)
      || typeof binding.documentId !== "string" || !UUID.test(binding.documentId)
      || binding.stagingKey !== `quarantine/${value.workspaceKey}/triage-staging/${binding.stageId}/upload`
      || binding.objectKey !== `quarantine/${value.workspaceKey}/${binding.documentId}/source`
      || typeof binding.objectVersion !== "string" || binding.objectVersion.length < 1
      || binding.sealMode !== "server_only_copy_v1"
      || typeof binding.stagingWriteExpiresAt !== "string" || typeof binding.sealedAt !== "string"
      || !Number.isFinite(Date.parse(binding.stagingWriteExpiresAt)) || !Number.isFinite(Date.parse(binding.sealedAt))
      || Date.parse(binding.sealedAt) > now) {
      return { ok: false, code: "INTAKE_TRIAGE_OBJECT_NOT_SEALED", status: 409 };
    }
    const filename = file.relativePath.split(/[\\/]/).pop() ?? "";
    if (!filename) return { ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 };
    entries.push({
      fileKey: key,
      originalFilename: filename,
      contentSha256: file.contentSha256,
      byteLength: file.byteLength,
      mimeType: file.mimeType,
      claimedPages: null,
      claimedBasis: null,
    });
  }
  const digest = await intakeManifestDigest(entries);
  const recomputedQuote = quoteIntakeManifest(entries.map((entry) => ({
    bytes: entry.byteLength, mimeType: entry.mimeType, claimedPages: entry.claimedPages, claimedBasis: entry.claimedBasis,
  })));
  if (!recomputedQuote.ok || receipt.inventoryRevision !== digest
    || recomputedQuote.quote.estimatedUsd !== initial!.minimum
    || recomputedQuote.quote.maximumUsd !== initial!.maximum) {
    return { ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 };
  }
  return { ok: true, result: { receipt, entries, clientManifestDigest: digest } };
}
