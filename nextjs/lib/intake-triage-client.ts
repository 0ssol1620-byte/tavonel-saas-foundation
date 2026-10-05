export type TriageUploadFile = { file: File; relativePath: string; mimeType: string };

export type TriageStage = {
  index: number;
  stageId: string;
  relativePath: string;
  requestedBytes: number;
  uploadUrl: string;
};

export type TriageReviewRow = {
  fileKey: string;
  relativePath: string;
  choice: "include" | "exclude" | null;
  disposition?: string;
  reason?: string;
  exactDuplicateOf?: string | null;
  unknowns?: Record<string, unknown>;
  [key: string]: unknown;
};

export type TriageReceiptReply = {
  code: string;
  receipt: {
    receiptId: string;
    triageVersion: "tavonel-intake-triage-v1";
    inventoryDigest: string;
    inventory: Record<string, unknown>;
    estimate: TriageReceiptReply["estimate"];
    approvalReady: boolean;
    expiresAt: string;
  };
  review: TriageReviewRow[];
  approvalBlockers: string[];
  estimate: {
    currency: "USD";
    initial: { minimum: number; maximum: number };
    incremental: { minimum: number | null; maximum: number | null };
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
    operatorCost: { status: "priced" | "not_priced"; unavailableProviders: string[] };
    basis: string;
    assumptions: string[];
  };
  quote?: { estimatedUsd?: number; maximumUsd?: number };
};

export type TriageProcessingQuote = {
  triageReceiptId: string;
  clientManifestDigest: string;
  pricingFingerprint: string;
  quote: {
    maximumPages: number;
    reservedCredits: number;
    maximumCredits: number;
    estimatedUsd: number;
    maximumUsd: number;
  };
  files: Array<{ fileKey: string }>;
};

export type TriageClientError = { code: string; status: number; detail?: unknown };
export type StageTriageResult =
  | { kind: "disabled" }
  | { kind: "blocked"; error: TriageClientError }
  | { kind: "ready"; batchId: string; staged: TriageStage[] };

export function createLegacyFallbackGate() {
  let awaitingApproval = false;
  let started = false;
  return {
    markDisabled(): boolean {
      if (started) return false;
      awaitingApproval = true;
      return true;
    },
    approveOnce(): boolean {
      if (!awaitingApproval || started) return false;
      awaitingApproval = false;
      started = true;
      return true;
    },
  };
}

export function confirmLegacyFallback(
  gate: ReturnType<typeof createLegacyFallbackGate>,
  pending: boolean,
  busy: boolean,
  onApprove: () => void,
): boolean {
  if (!pending || busy || !gate.approveOnce()) return false;
  onApprove();
  return true;
}

async function jsonReply(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validReview(value: unknown, allowChoiceOnly: boolean): value is TriageReviewRow[] {
  return Array.isArray(value) && value.length > 0 && value.every((candidate) => {
    if (!record(candidate) || typeof candidate.fileKey !== "string" || !candidate.fileKey
      || typeof candidate.relativePath !== "string" || !candidate.relativePath) return false;
    if (candidate.choice !== undefined && candidate.choice !== null
      && candidate.choice !== "include" && candidate.choice !== "exclude") return false;
    if (allowChoiceOnly) return candidate.choice === null || candidate.choice === "include" || candidate.choice === "exclude";
    return typeof candidate.disposition === "string" && record(candidate.unknowns);
  });
}

function validEstimate(value: unknown): value is TriageReceiptReply["estimate"] {
  if (!record(value) || value.currency !== "USD" || !record(value.initial) || !record(value.incremental)) return false;
  const min = value.initial.minimum;
  const max = value.initial.maximum;
  const incrementMin = value.incremental.minimum;
  const incrementMax = value.incremental.maximum;
  const coverage = value.customerChargeCoverage;
  const operatorCost = value.operatorCost;
  return typeof min === "number" && Number.isFinite(min) && min >= 0
    && typeof max === "number" && Number.isFinite(max) && max >= min
    && typeof incrementMin === "number" && Number.isFinite(incrementMin) && incrementMin >= 0
    && typeof incrementMax === "number" && Number.isFinite(incrementMax) && incrementMax >= incrementMin
    && incrementMin === 0 && incrementMax === 0
    && record(coverage) && coverage.policy === "published_page_admission_once"
    && ["entire_affected_source_version_set", "unknown"].includes(String(coverage.scope))
    && typeof coverage.pricingFingerprint === "string" && /^sha256:[a-f0-9]{64}$/.test(coverage.pricingFingerprint)
    && Array.isArray(coverage.sourceVersions) && coverage.sourceVersions.every((source) => record(source)
      && typeof source.fileKey === "string" && source.fileKey.length > 0
      && (source.revision === null || typeof source.revision === "string")
      && typeof source.contentSha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(source.contentSha256)
      && ["new_read", "unchanged_already_read_recompile", "unknown_reprocessing"].includes(String(source.mode)))
    && record(operatorCost) && ["priced", "not_priced"].includes(String(operatorCost.status))
    && Array.isArray(operatorCost.unavailableProviders)
    && operatorCost.unavailableProviders.every((item) => typeof item === "string")
    && typeof value.basis === "string" && value.basis.length > 0
    && Array.isArray(value.assumptions) && value.assumptions.every((item) => typeof item === "string");
}

function validReceipt(value: unknown): value is TriageReceiptReply["receipt"] {
  if (!record(value) || !record(value.inventory)) return false;
  const selectedKeys = Array.isArray(value.inventory.selectedFileKeys)
    ? value.inventory.selectedFileKeys.filter((key): key is string => typeof key === "string") : [];
  const covered = value.estimate && record(value.estimate) && record(value.estimate.customerChargeCoverage)
    ? value.estimate.customerChargeCoverage : null;
  const coveredSources = covered && Array.isArray(covered.sourceVersions) ? covered.sourceVersions : [];
  const completeReadyScope = value.approvalReady !== true || (covered?.scope === "entire_affected_source_version_set"
    && selectedKeys.length > 0 && selectedKeys.length === coveredSources.length
    && new Set(coveredSources.filter(record).map((source) => source.fileKey)).size === coveredSources.length
    && selectedKeys.every((key) => coveredSources.some((source) => record(source) && source.fileKey === key
      && source.mode !== "unknown_reprocessing")));
  return typeof value.receiptId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.receiptId)
    && value.triageVersion === "tavonel-intake-triage-v1"
    && typeof value.inventoryDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(value.inventoryDigest)
    && value.inventory.inventoryDigest === value.inventoryDigest
    && validEstimate(value.estimate)
    && value.estimate.customerChargeCoverage.pricingFingerprint === value.inventory.pricingFingerprint
    && typeof value.approvalReady === "boolean"
    && completeReadyScope
    && typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt));
}

function validQuote(value: unknown) {
  if (!record(value)) return false;
  return ["estimatedUsd", "maximumUsd"].every((key) => typeof value[key] === "number"
    && Number.isFinite(value[key]) && (value[key] as number) >= 0);
}

async function postJson(fetcher: typeof fetch, path: string, token: string, body: unknown, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetcher(path, {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw { code: "INTAKE_TRIAGE_NETWORK_ERROR", status: 0 } satisfies TriageClientError;
  }
  return { response, json: await jsonReply(response) };
}

function fail(response: Response, json: Record<string, unknown>): TriageClientError {
  return {
    code: typeof json.code === "string" ? json.code : `HTTP_${response.status}`,
    status: response.status,
    detail: json.errors ?? json.reason,
  };
}

export async function stageTriage(
  files: TriageUploadFile[],
  token: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<StageTriageResult> {
  const batchId = crypto.randomUUID();
  let stagedReply: Awaited<ReturnType<typeof postJson>>;
  try {
    stagedReply = await postJson(fetcher, "/api/v1/uploads/triage/stage", token, {
      batchId,
      files: files.map(({ file, relativePath, mimeType }) => ({
        relativePath,
        idempotencyKey: crypto.randomUUID(),
        declaredMimeType: mimeType,
        requestedBytes: file.size,
      })),
    }, signal);
  } catch (error) {
    if (signal?.aborted) return { kind: "blocked", error: { code: "INTAKE_TRIAGE_ABORTED", status: 0 } };
    return { kind: "blocked", error: error as TriageClientError };
  }
  const { response, json } = stagedReply;

  if (!response.ok && json.code === "INTAKE_TRIAGE_DISABLED") return { kind: "disabled" };
  const staged = Array.isArray(json.staged) ? json.staged as TriageStage[] : [];
  if (!response.ok || json.code !== "TRIAGE_STAGE_READY" || staged.length !== files.length
    || staged.some((row, index) => row.index !== index || typeof row.stageId !== "string"
      || typeof row.uploadUrl !== "string" || row.relativePath !== files[index]?.relativePath)) {
    return { kind: "blocked", error: fail(response, json) };
  }
  return { kind: "ready", batchId, staged };
}

export async function approveAndSealTriage(
  batch: Extract<StageTriageResult, { kind: "ready" }>,
  files: TriageUploadFile[],
  token: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ approvalId: string; review: TriageReviewRow[] } | { error: TriageClientError }> {
  const preflight = await postJson(fetcher, "/api/v1/uploads/triage/preflight", token, {
    batchId: batch.batchId,
    choices: batch.staged.map((stage) => ({ stageId: stage.stageId, choice: "preflight" })),
  }, signal).catch(() => null);
  if (!preflight || !preflight.response.ok || preflight.json.code !== "TRIAGE_PREFLIGHT_APPROVED") {
    return { error: preflight ? fail(preflight.response, preflight.json) : { code: "INTAKE_TRIAGE_NETWORK_ERROR", status: 0 } };
  }
  const approval = preflight.json.approval as Record<string, unknown> | undefined;
  const approvalId = typeof approval?.preflightApprovalId === "string" ? approval.preflightApprovalId : "";
  if (!approvalId || preflight.json.providerCalls !== 0 || preflight.json.monetaryCostStatus !== "not_priced") {
    return { error: { code: "INTAKE_TRIAGE_PREFLIGHT_RECEIPT_INVALID", status: 503 } };
  }

  for (const stage of batch.staged) {
    const file = files[stage.index]?.file;
    if (!file || file.size !== stage.requestedBytes) return { error: { code: "INTAKE_TRIAGE_FILE_SET_CHANGED", status: 409 } };
    let put: Response;
    try {
      put = await fetcher(stage.uploadUrl, { method: "PUT", headers: { "content-type": files[stage.index]!.mimeType }, body: file, signal });
    } catch {
      return { error: { code: "INTAKE_TRIAGE_STAGE_UPLOAD_FAILED", status: 0 } };
    }
    if (!put.ok) return { error: { code: "INTAKE_TRIAGE_STAGE_UPLOAD_FAILED", status: put.status } };
  }

  for (const stage of batch.staged) {
    const completed = await postJson(fetcher, "/api/v1/uploads/triage/complete", token, { stageId: stage.stageId, preflightApprovalId: approvalId }, signal)
    .catch(() => null);
    if (!completed || !completed.response.ok || completed.json.code !== "TRIAGE_FILE_SEALED") {
      return { error: completed ? fail(completed.response, completed.json) : { code: "INTAKE_TRIAGE_NETWORK_ERROR", status: 0 } };
    }
  }

  const requested = await postJson(fetcher, "/api/v1/uploads/triage/receipt", token, {
    batchId: batch.batchId, preflightApprovalId: approvalId, choices: {},
  }, signal).catch(() => null);
  if (!requested || requested.response.status !== 409 || requested.json.code !== "TRIAGE_CHOICES_REQUIRED"
    || !validReview(requested.json.review, true)) {
    return { error: requested ? fail(requested.response, requested.json) : { code: "INTAKE_TRIAGE_NETWORK_ERROR", status: 0 } };
  }
  return { approvalId, review: requested.json.review as TriageReviewRow[] };
}

export async function finalizeTriageReceipt(
  batch: Extract<StageTriageResult, { kind: "ready" }>,
  approvalId: string,
  choices: Record<string, "include" | "exclude">,
  token: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TriageReceiptReply | { error: TriageClientError }> {
  try {
    const { response, json } = await postJson(fetcher, "/api/v1/uploads/triage/receipt", token, {
      batchId: batch.batchId, preflightApprovalId: approvalId, choices,
    }, signal);
    const ready = response.ok && json.code === "TRIAGE_RECEIPT_READY";
    const reviewRequired = response.ok && json.code === "TRIAGE_REVIEW_REQUIRED";
    if ((!ready && !reviewRequired) || !validReceipt(json.receipt)
      || json.receipt.approvalReady !== ready
      || !validReview(json.review, false)
      || !Array.isArray(json.approvalBlockers) || !json.approvalBlockers.every((item) => typeof item === "string")
      || !validEstimate(json.estimate) || !validQuote(json.quote)) {
      if (response.ok && (json.code === "TRIAGE_RECEIPT_READY" || json.code === "TRIAGE_REVIEW_REQUIRED")) {
        return { error: { code: "INTAKE_TRIAGE_RECEIPT_INVALID", status: 503 } };
      }
      return { error: fail(response, json) };
    }
    return json as TriageReceiptReply;
  } catch (error) {
    return { error: error as TriageClientError };
  }
}

export async function quoteTriageProcessing(
  receipt: TriageReceiptReply,
  token: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TriageProcessingQuote | { error: TriageClientError }> {
  if (receipt.code !== "TRIAGE_RECEIPT_READY" || receipt.receipt.approvalReady !== true
    || (receipt.approvalBlockers?.length ?? 0) > 0) {
    return { error: { code: "INTAKE_REVIEW_OR_BUDGET_REQUIRED", status: 409 } };
  }
  try {
    const { response, json } = await postJson(fetcher, "/api/v1/uploads/quote", token, {
      triageReceiptId: receipt.receipt.receiptId,
    }, signal);
    const q = record(json.quote) ? json.quote : null;
    const values = q ? [q.maximumPages, q.reservedCredits, q.maximumCredits, q.estimatedUsd, q.maximumUsd] : [];
    const selected = record(receipt.receipt.inventory) && Array.isArray(receipt.receipt.inventory.selectedFileKeys)
      ? receipt.receipt.inventory.selectedFileKeys : [];
    const files = Array.isArray(json.files) ? json.files : [];
    if (!response.ok) return { error: fail(response, json) };
    if (json.code !== "INTAKE_QUOTE"
      || json.triageReceiptId !== receipt.receipt.receiptId
      || json.triageInventoryDigest !== receipt.receipt.inventoryDigest
      || typeof json.clientManifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(json.clientManifestDigest)
      || typeof json.pricingFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(json.pricingFingerprint)
      || (receipt.receipt.estimate.customerChargeCoverage.pricingFingerprint !== json.pricingFingerprint)
      || !q || values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)
      || !Number.isSafeInteger(q.maximumCredits) || q.maximumUsd !== (q.maximumCredits as number) / 100
      || !Array.isArray(selected) || selected.length === 0 || files.length !== selected.length
      || !files.every((file) => record(file) && typeof file.fileKey === "string" && selected.includes(file.fileKey))
      || new Set(files.map((file) => record(file) ? file.fileKey : null)).size !== files.length) {
      return { error: { code: "INTAKE_QUOTE_INVALID", status: 503 } };
    }
    return {
      triageReceiptId: receipt.receipt.receiptId,
      clientManifestDigest: json.clientManifestDigest,
      pricingFingerprint: json.pricingFingerprint,
      quote: {
        maximumPages: q.maximumPages as number,
        reservedCredits: q.reservedCredits as number,
        maximumCredits: q.maximumCredits as number,
        estimatedUsd: q.estimatedUsd as number,
        maximumUsd: q.maximumUsd as number,
      },
      files: files.map((file) => ({ fileKey: (file as Record<string, unknown>).fileKey as string })),
    };
  } catch (error) {
    return { error: error as TriageClientError };
  }
}
