import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { COLLECTION_CANDIDATE_SCHEMA } from "./collection-compiler";
import type { ExportSigner } from "./export-signing";

const MAX_PACKAGE_FILES = 200;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const REQUIRED_PACKAGE_PATHS = [
  "ontology/knowledge.jsonld",
  "ontology/knowledge.ttl",
  "graph/nodes.csv",
  "graph/relationships.csv",
  "rag/documents.jsonl",
  "rag/chunks.jsonl",
  "provenance/activities.jsonl",
  "validation/report.json",
] as const;

type PackageFile = {
  path: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  content: string;
};

export type ReviewableCollectionArtifact = {
  schemaVersion: typeof COLLECTION_CANDIDATE_SCHEMA;
  collectionId: string;
  manifestDigest: string;
  lifecycle: "candidate" | "review_required";
  candidatePromotion: false;
  directoryPlan: unknown[];
  package: { files: PackageFile[] };
  validation: {
    status: "passed" | "review_required";
    fullRebuildEquivalence?: "passed" | "failed" | "not_run";
    reviewReasons?: string[];
  };
  reviewReasons?: string[];
  coreExecution: {
    status: "completed" | "review_required";
    runtime: string;
    worldStateId?: string | null;
    receipt: {
      requestId: string;
      outputSha256: string;
      candidatePromotion: false;
      equivalence?: "passed" | "failed" | "not_run";
    };
  };
};

export type PromotableCollectionArtifact = ReviewableCollectionArtifact & {
  lifecycle: "candidate";
  validation: ReviewableCollectionArtifact["validation"] & { status: "passed" };
  coreExecution: ReviewableCollectionArtifact["coreExecution"] & { status: "completed" };
};

export type DownloadableCollectionArtifact = ReviewableCollectionArtifact;

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sameStrings(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}

export function isSafeArchivePath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

export function validateReviewableCollectionArtifact(
  value: unknown,
  expectedCollectionId: string,
): ReviewableCollectionArtifact | null {
  if (!value || typeof value !== "object") return null;
  const artifact = value as Partial<ReviewableCollectionArtifact>;
  if (
    artifact.schemaVersion !== COLLECTION_CANDIDATE_SCHEMA ||
    artifact.collectionId !== expectedCollectionId ||
    !SHA256.test(artifact.manifestDigest ?? "") ||
    (artifact.lifecycle !== "candidate" && artifact.lifecycle !== "review_required") ||
    artifact.candidatePromotion !== false ||
    (artifact.validation?.status !== "passed" && artifact.validation?.status !== "review_required") ||
    (artifact.coreExecution?.status !== "completed" && artifact.coreExecution?.status !== "review_required") ||
    typeof artifact.coreExecution.runtime !== "string" ||
    artifact.coreExecution.runtime.length === 0 ||
    typeof artifact.coreExecution.receipt?.requestId !== "string" ||
    artifact.coreExecution.receipt.requestId.length === 0 ||
    !SHA256.test(artifact.coreExecution.receipt.outputSha256 ?? "") ||
    artifact.coreExecution.receipt?.candidatePromotion !== false ||
    !Array.isArray(artifact.directoryPlan) ||
    !Array.isArray(artifact.package?.files) ||
    artifact.package.files.length === 0 ||
    artifact.package.files.length > MAX_PACKAGE_FILES
  ) {
    return null;
  }

  const reviewReasons = artifact.reviewReasons ?? artifact.validation.reviewReasons ?? [];
  if (
    !Array.isArray(reviewReasons) ||
    new Set(reviewReasons).size !== reviewReasons.length ||
    reviewReasons.some((reason) => typeof reason !== "string" || reason.length === 0 || reason.length > 500) ||
    (artifact.reviewReasons !== undefined && artifact.validation.reviewReasons !== undefined &&
      !sameStrings(artifact.reviewReasons, artifact.validation.reviewReasons)) ||
    (artifact.lifecycle === "candidate" && (
      artifact.validation.status !== "passed" ||
      artifact.coreExecution.status !== "completed" ||
      reviewReasons.length !== 0 ||
      artifact.coreExecution.receipt.equivalence === "failed" ||
      artifact.validation.fullRebuildEquivalence === "failed"
    )) ||
    (artifact.lifecycle === "review_required" && (
      artifact.validation.status !== "review_required" ||
      artifact.coreExecution.status !== "review_required" ||
      reviewReasons.length === 0
    ))
  ) {
    return null;
  }

  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of artifact.package.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !isSafeArchivePath(file.path) ||
      paths.has(file.path) ||
      typeof file.mediaType !== "string" ||
      typeof file.content !== "string" ||
      typeof file.sizeBytes !== "number" ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes !== Buffer.byteLength(file.content, "utf8") ||
      file.sha256 !== sha256(file.content)
    ) {
      return null;
    }
    paths.add(file.path);
    totalBytes += file.sizeBytes;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) return null;
  }
  if (REQUIRED_PACKAGE_PATHS.some((path) => !paths.has(path))) return null;

  const validationFile = artifact.package.files.find((file) => file.path === "validation/report.json")!;
  try {
    const report = JSON.parse(validationFile.content) as { status?: unknown; reviewReasons?: unknown };
    if (report.status !== artifact.validation.status) return null;
    if (
      artifact.lifecycle === "review_required" &&
      (!Array.isArray(report.reviewReasons) || !sameStrings(reviewReasons, report.reviewReasons))
    ) return null;
  } catch {
    return null;
  }
  return artifact as ReviewableCollectionArtifact;
}

export const validateDownloadableCollectionArtifact = validateReviewableCollectionArtifact;

export function validatePromotableCollectionArtifact(
  value: unknown,
  expectedCollectionId: string,
): PromotableCollectionArtifact | null {
  const artifact = validateReviewableCollectionArtifact(value, expectedCollectionId);
  return artifact?.lifecycle === "candidate" &&
    artifact.validation.status === "passed" &&
    artifact.coreExecution.status === "completed"
    ? artifact as PromotableCollectionArtifact
    : null;
}

export function buildSignedCollectionZip(artifact: ReviewableCollectionArtifact, signer: ExportSigner) {
  const entries: Record<string, Uint8Array> = {};
  for (const file of artifact.package.files) entries[file.path] = strToU8(file.content);
  const candidateWorld = `${JSON.stringify(artifact, null, 2)}\n`;
  const readme = [
    `TAVONEL signed ${artifact.lifecycle === "candidate" ? "candidate" : "human-review"} knowledge package`,
    `Collection: ${artifact.collectionId}`,
    `Manifest: ${artifact.manifestDigest}`,
    `Core receipt: ${artifact.coreExecution.receipt.requestId}`,
    `Export signer: ${signer.keyId}`,
    `Public key fingerprint: ${signer.publicKeySpkiSha256}`,
    `Lifecycle: ${artifact.lifecycle}`,
    "candidatePromotion=false",
    "",
    "Formats: Markdown, JSON, JSON-LD, Turtle, CSV and JSON Lines.",
    "This package is reviewable output. It is not a human-approved world or a semantic-quality benchmark.",
    "Every listed file was SHA-256 checked, then the exact export manifest bytes were signed with Ed25519.",
    "Verify manifest/export-manifest.json against signatures/export-manifest.ed25519.json before import.",
    "",
  ].join("\n");
  entries["manifest/candidate-world.json"] = strToU8(candidateWorld);
  entries["manifest/DOWNLOAD_README.txt"] = strToU8(readme);

  const files = [
    ...artifact.package.files.map((file) => ({ path: file.path, mediaType: file.mediaType, sizeBytes: file.sizeBytes, sha256: file.sha256 })),
    { path: "manifest/candidate-world.json", mediaType: "application/json", sizeBytes: Buffer.byteLength(candidateWorld), sha256: sha256(candidateWorld) },
    { path: "manifest/DOWNLOAD_README.txt", mediaType: "text/plain; charset=utf-8", sizeBytes: Buffer.byteLength(readme), sha256: sha256(readme) },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const exportManifest = {
    schemaVersion: "tavonel.signed_export_manifest.v1",
    collectionId: artifact.collectionId,
    manifestDigest: artifact.manifestDigest,
    lifecycle: artifact.lifecycle,
    candidatePromotion: false,
    core: {
      runtime: artifact.coreExecution.runtime,
      requestId: artifact.coreExecution.receipt.requestId,
      outputSha256: artifact.coreExecution.receipt.outputSha256,
    },
    formats: ["text/markdown", "application/json", "application/ld+json", "text/turtle", "text/csv", "application/x-ndjson"],
    files,
  } as const;
  const manifestBytes = strToU8(`${JSON.stringify(exportManifest, null, 2)}\n`);
  const signature = signer.signPayload(manifestBytes);
  entries["manifest/export-manifest.json"] = manifestBytes;
  entries["signatures/export-manifest.ed25519.json"] = strToU8(`${JSON.stringify(signature, null, 2)}\n`);
  return {
    archive: zipSync(entries, { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") }),
    signature,
    exportManifest,
  };
}
