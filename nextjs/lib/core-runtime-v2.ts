import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  GENERIC_MIXED_CORPUS_BLUEPRINT,
  type CollectionCandidateArtifact,
  type CollectionOcrInput,
} from "./collection-compiler";

export const PRODUCT_CORE_REQUEST_SCHEMA = "tavonel.product_core.compile_request.v2" as const;
export const PRODUCT_CORE_RESPONSE_SCHEMA = "tavonel.product_core.compile_response.v2" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type ProductCoreV2Env = {
  url: string;
  hmac: string;
};

export type ProductCoreV2CompileRequest = {
  schemaVersion: typeof PRODUCT_CORE_REQUEST_SCHEMA;
  requestId: string;
  idempotencyKey: string;
  tenantId: string;
  workspaceId: string;
  collectionId: string;
  requestedAt: string;
  route: {
    operationClass: "initial_compile";
    qualityRequirement: "high_assurance";
    maxCostCredits: number;
    maxLatencyMs: number;
    privacyPolicy: "foundation_synthetic_only";
  };
  documents: Array<{
    nativeId: string;
    connectorType: "foundation-r2";
    immutableObjectKey: string;
    ocrObjectKey: string;
    contentSha256: string;
    title: string;
    sourceFilename: string;
    pageCount: number;
    regions: Array<{
      regionId: string;
      pageIndex0: number;
      pageNumber1: number;
      order: number;
      blockType: "paragraph";
      text: string;
      bbox1000?: [number, number, number, number];
      confidence?: number;
      authority: "unclassified" | "unknown" | "informal" | "official" | "contractual";
    }>;
  }>;
};

type ProductCoreV2Candidate = {
  worldStateId: string;
  parentWorldStateId?: string;
  manifestDigest: string;
  lifecycle: "candidate" | "review_required" | "rejected";
  canonicalDocuments: unknown[];
  canonicalKnowledgeModel: Record<string, unknown>;
  units: unknown[];
  artifactHashes: Record<string, string>;
  directoryPlan: Array<{ path: string; kind: string; sourceIds: string[] }>;
  package: {
    roots: string[];
    files: Array<{
      path: string;
      mediaType: string;
      sizeBytes: number;
      sha256: string;
      content: string;
    }>;
    signatureStatus: "external_signer_required";
  };
  validation: Record<string, unknown>;
  diff: Record<string, unknown>;
  impact: Record<string, unknown>;
  recompilation: Record<string, unknown>;
  reviewReasons: string[];
};

export type ProductCoreV2CompileResponse = {
  schemaVersion: typeof PRODUCT_CORE_RESPONSE_SCHEMA;
  status: "completed" | "review_required" | "rejected";
  runtime: "tavonel-python-core-v2";
  candidate: ProductCoreV2Candidate;
  artifacts: Array<{
    artifactId: string;
    kind: string;
    contentSha256: string;
    byteLength: number;
  }>;
  receipt: {
    requestId: string;
    inputSha256: string;
    outputSha256: string;
    coreReleaseDigest: string;
    matchingPolicy: "legacy";
    candidatePromotion: false;
    equivalence: "passed" | "failed" | "not_run";
    totalArtifacts: number;
    rebuiltArtifacts: number;
    workAvoidedArtifacts: number;
  };
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export function readProductCoreV2Env(): ProductCoreV2Env | null {
  const url = process.env.FOUNDATION_CORE_V2_URL?.trim() ?? "";
  const hmac = process.env.FOUNDATION_CORE_V2_HMAC ?? "";
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(url) || hmac.length < 32) return null;
  return { url: url.replace(/\/$/, ""), hmac };
}

export function buildProductCoreV2Request(
  workspaceId: string,
  documents: CollectionOcrInput[],
  now = new Date(),
  requestId = `core-${randomUUID()}`,
): ProductCoreV2CompileRequest {
  const binding = [...documents]
    .sort((left, right) => left.documentId.localeCompare(right.documentId))
    .map((document) => `${document.documentId}:${document.versionKey}`)
    .join("\n");
  const collectionId = `collection-${sha256(`${workspaceId}\n${binding}`).slice(0, 32)}`;
  return {
    schemaVersion: PRODUCT_CORE_REQUEST_SCHEMA,
    requestId,
    idempotencyKey: `compile-${sha256(`${workspaceId}\n${binding}\n${requestId}`).slice(0, 40)}`,
    tenantId: workspaceId,
    workspaceId,
    collectionId,
    requestedAt: now.toISOString(),
    route: {
      operationClass: "initial_compile",
      qualityRequirement: "high_assurance",
      maxCostCredits: 10,
      maxLatencyMs: 90_000,
      privacyPolicy: "foundation_synthetic_only",
    },
    documents: [...documents]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map((document) => ({
        nativeId: document.documentId,
        connectorType: "foundation-r2" as const,
        immutableObjectKey: document.sourceImmutableKey,
        ocrObjectKey: document.ocrJsonKey,
        contentSha256: document.inputSha256,
        title: `Document ${document.documentId.slice(0, 8)}`,
        sourceFilename: `${document.documentId}.pdf`,
        pageCount: document.pageCount,
        regions: document.regions?.map((region) => ({
          regionId: region.regionId,
          pageIndex0: region.pageIndex0,
          pageNumber1: region.pageNumber1,
          order: region.order,
          blockType: region.blockType,
          text: region.text,
          bbox1000: region.bbox1000,
          confidence: region.confidence,
          authority: region.authority,
        })) ?? [{
          regionId: `ocr-full-document-${document.documentId}`,
          pageIndex0: 0,
          pageNumber1: 1,
          order: 0,
          blockType: "paragraph" as const,
          text: document.text,
          authority: "unclassified" as const,
        }],
      })),
  };
}

function validCandidate(value: unknown): value is ProductCoreV2Candidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ProductCoreV2Candidate;
  return (
    IDENTIFIER.test(candidate.worldStateId) &&
    SHA256.test(candidate.manifestDigest) &&
    ["candidate", "review_required", "rejected"].includes(candidate.lifecycle) &&
    Array.isArray(candidate.canonicalDocuments) &&
    Boolean(candidate.canonicalKnowledgeModel) &&
    Array.isArray(candidate.units) &&
    Object.values(candidate.artifactHashes ?? {}).every((digest) => SHA256.test(digest)) &&
    Array.isArray(candidate.directoryPlan) &&
    Array.isArray(candidate.package?.files) &&
    Array.isArray(candidate.reviewReasons)
  );
}

export function projectProductCoreV2Candidate(
  result: ProductCoreV2CompileResponse,
  documents: CollectionOcrInput[],
): CollectionCandidateArtifact | null {
  if (result.status === "rejected" || result.candidate.lifecycle === "rejected") return null;
  if (
    (result.status === "completed" && result.candidate.lifecycle !== "candidate") ||
    (result.status === "review_required" && result.candidate.lifecycle !== "review_required")
  ) return null;
  const model = result.candidate.canonicalKnowledgeModel;
  const collectionId = typeof model.collectionId === "string" ? model.collectionId : "";
  const objects = Array.isArray(model.objects) ? model.objects as Array<Record<string, unknown>> : [];
  if (!IDENTIFIER.test(collectionId) || objects.length === 0) return null;
  const allowedKinds = new Set(["document", "entity", "claim", "evidence"]);
  const kindName = { document: "Document", entity: "Entity", claim: "Claim", evidence: "Evidence" } as const;
  const nodes = objects
    .filter((item) => typeof item.kind === "string" && allowedKinds.has(item.kind))
    .map((item) => {
      const kind = item.kind as keyof typeof kindName;
      const payload = item.payload && typeof item.payload === "object" ? item.payload as Record<string, unknown> : {};
      const refs = Array.isArray(item.sourceRefs) ? item.sourceRefs as Array<Record<string, unknown>> : [];
      const documentId = typeof refs[0]?.documentId === "string" ? refs[0].documentId : undefined;
      return {
        id: String(item.stableId),
        kind: kindName[kind],
        label: String(payload.title ?? payload.text ?? payload.evidenceId ?? item.stableId),
        ...(documentId ? { documentId } : {}),
        evidenceIds: kind === "evidence" ? [String(payload.evidenceId ?? item.stableId)] : [],
      };
    });
  const evidenceByObject = new Map(
    objects
      .filter((item) => item.kind === "evidence")
      .map((item) => [String(item.stableId), String((item.payload as Record<string, unknown>)?.evidenceId ?? item.stableId)]),
  );
  const edges = objects
    .filter((item) => item.kind === "claim" && Array.isArray(item.links))
    .flatMap((item) => (item.links as unknown[])
      .filter((link) => evidenceByObject.has(String(link)))
      .map((link) => ({
        id: `relation-${sha256(`${String(item.stableId)}\nsupported_by\n${String(link)}`).slice(0, 32)}`,
        type: "supported_by" as const,
        from: String(item.stableId),
        to: String(link),
        evidenceIds: [evidenceByObject.get(String(link))!],
      })));
  const counts = {
    documents: documents.length,
    topics: 0,
    entities: nodes.filter((item) => item.kind === "Entity").length,
    claims: nodes.filter((item) => item.kind === "Claim").length,
    evidence: nodes.filter((item) => item.kind === "Evidence").length,
    relations: edges.length,
    packageFiles: result.candidate.package.files.length,
  };
  return {
    schemaVersion: "tavonel.collection_candidate.v1",
    executionAuthority: "tavonel-foundation-core-runtime-v1",
    lifecycle: result.candidate.lifecycle,
    candidatePromotion: false,
    collectionId,
    manifestDigest: result.candidate.manifestDigest,
    blueprint: GENERIC_MIXED_CORPUS_BLUEPRINT,
    sourceDocuments: [...documents]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map((document) => ({
        documentId: document.documentId,
        versionKey: document.versionKey,
        sanitizedKey: document.sanitizedKey,
        ocrJsonKey: document.ocrJsonKey,
        pageCount: document.pageCount,
        textCharacters: document.text.length,
        inputSha256: document.inputSha256,
      })),
    directoryPlan: result.candidate.directoryPlan,
    ontology: { nodes, edges },
    package: {
      roots: result.candidate.package.roots,
      files: result.candidate.package.files,
      signatureStatus: result.candidate.package.signatureStatus,
    },
    validation: {
      status: result.status === "completed" ? "passed" : "review_required",
      deterministicMaterialization: true,
      sourceCoverage: true,
      evidenceCoverage: true,
      immutableInputsOnly: true,
      fullRebuildEquivalence: result.receipt.equivalence,
      reviewReasons: [...result.candidate.reviewReasons],
      counts,
    },
    reviewReasons: [...result.candidate.reviewReasons],
  };
}

export async function dispatchProductCoreV2(
  env: ProductCoreV2Env,
  workspaceId: string,
  documents: CollectionOcrInput[],
  now = new Date(),
): Promise<{ ok: true; result: ProductCoreV2CompileResponse } | { ok: false; code: string }> {
  const envelope = buildProductCoreV2Request(workspaceId, documents, now);
  const body = JSON.stringify(envelope);
  const inputSha256 = `sha256:${sha256(body)}`;
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac("sha256", env.hmac)
    .update(`${timestamp}\n${envelope.requestId}\n${inputSha256}`, "utf8")
    .digest("hex");
  let response: Response;
  try {
    response = await fetch(`${env.url}/v2/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tavonel-core-timestamp": timestamp,
        "x-tavonel-core-request-id": envelope.requestId,
        "x-tavonel-input-sha256": inputSha256,
        "x-tavonel-core-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, code: "CORE_V2_UNAVAILABLE" };
  }
  const json = await response.json().catch(() => null) as ProductCoreV2CompileResponse | { code?: unknown } | null;
  if (!response.ok || !json) {
    const errorCode = (json as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof errorCode === "string" ? errorCode : `CORE_V2_HTTP_${response.status}` };
  }
  const result = json as ProductCoreV2CompileResponse;
  const lifecycleStatus = {
    completed: "candidate",
    review_required: "review_required",
    rejected: "rejected",
  } as const;
  if (
    result.schemaVersion !== PRODUCT_CORE_RESPONSE_SCHEMA ||
    result.runtime !== "tavonel-python-core-v2" ||
    !validCandidate(result.candidate) ||
    result.candidate.lifecycle !== lifecycleStatus[result.status] ||
    !Array.isArray(result.artifacts) ||
    result.artifacts.length < 5 ||
    result.artifacts.some((artifact) => !IDENTIFIER.test(artifact.artifactId) || !SHA256.test(artifact.contentSha256) || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) ||
    result.receipt.requestId !== envelope.requestId ||
    result.receipt.inputSha256 !== inputSha256 ||
    result.receipt.outputSha256 !== `sha256:${sha256(canonicalize(result.candidate))}` ||
    !SHA256.test(result.receipt.coreReleaseDigest) ||
    result.receipt.matchingPolicy !== "legacy" ||
    result.receipt.candidatePromotion !== false ||
    result.receipt.rebuiltArtifacts > result.receipt.totalArtifacts ||
    result.receipt.workAvoidedArtifacts !== result.receipt.totalArtifacts - result.receipt.rebuiltArtifacts
  ) {
    return { ok: false, code: "CORE_V2_RECEIPT_INVALID" };
  }
  return { ok: true, result };
}
