import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { COLLECTION_CANDIDATE_SCHEMA } from "./collection-compiler";

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

export type DownloadableCollectionArtifact = {
  schemaVersion: typeof COLLECTION_CANDIDATE_SCHEMA;
  collectionId: string;
  manifestDigest: string;
  lifecycle: "candidate";
  candidatePromotion: false;
  directoryPlan: unknown[];
  package: { files: PackageFile[] };
  validation: { status: "passed" };
  coreExecution: {
    status: "completed";
    runtime: string;
    receipt: { requestId: string; outputSha256: string; candidatePromotion: false };
  };
};

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
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

export function validateDownloadableCollectionArtifact(
  value: unknown,
  expectedCollectionId: string,
): DownloadableCollectionArtifact | null {
  if (!value || typeof value !== "object") return null;
  const artifact = value as Partial<DownloadableCollectionArtifact>;
  if (
    artifact.schemaVersion !== COLLECTION_CANDIDATE_SCHEMA ||
    artifact.collectionId !== expectedCollectionId ||
    artifact.lifecycle !== "candidate" ||
    artifact.candidatePromotion !== false ||
    artifact.validation?.status !== "passed" ||
    artifact.coreExecution?.status !== "completed" ||
    artifact.coreExecution.receipt?.candidatePromotion !== false ||
    !Array.isArray(artifact.directoryPlan) ||
    !Array.isArray(artifact.package?.files) ||
    artifact.package.files.length === 0 ||
    artifact.package.files.length > MAX_PACKAGE_FILES
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
  return artifact as DownloadableCollectionArtifact;
}

export function buildCollectionZip(artifact: DownloadableCollectionArtifact) {
  const entries: Record<string, Uint8Array> = {};
  for (const file of artifact.package.files) entries[file.path] = strToU8(file.content);
  entries["manifest/candidate-world.json"] = strToU8(`${JSON.stringify(artifact, null, 2)}\n`);
  entries["manifest/DOWNLOAD_README.txt"] = strToU8(
    [
      "TAVONEL candidate knowledge package",
      `Collection: ${artifact.collectionId}`,
      `Manifest: ${artifact.manifestDigest}`,
      `Core receipt: ${artifact.coreExecution.receipt.requestId}`,
      "Lifecycle: candidate",
      "candidatePromotion=false",
      "",
      "This package is reviewable output. It is not a human-approved world or a semantic-quality benchmark.",
      "Every compiler-produced package file was SHA-256 checked before this archive was created.",
      "",
    ].join("\n"),
  );
  return zipSync(entries, { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") });
}
