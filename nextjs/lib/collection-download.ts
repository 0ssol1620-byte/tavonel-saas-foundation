import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { COLLECTION_CANDIDATE_SCHEMA } from "./collection-compiler";
import { buildAiPackageGuidance } from "./ai-package-guidance";
import type { ExportSigner } from "./export-signing";

const MAX_PACKAGE_FILES = 200;

/**
 * The most uncompressed package bytes one download may materialise, and what it protects.
 *
 * Not a quality limit and not a plan tier. `app/api/collections/[id]/download/route.ts` loads a
 * stored artifact out of object storage and then, in one synchronous pass inside one function
 * invocation, SHA-256s every file's content, copies each into a `Uint8Array`, `zipSync`s the lot
 * and buffers the finished archive so it can set `Content-Length`. Peak memory is a small
 * multiple of this number per concurrent request, and what it is spent on is *stored data*. This
 * is therefore the bound that stops one large or tampered artifact from turning a single
 * authenticated request into an out-of-memory event, and the reason it is enforced during
 * validation rather than after: `validateReviewableCollectionArtifact` returns `null` the moment
 * the running total passes it, and the route answers 422 instead of streaming a partial package.
 * That refusal is the fail-closed behaviour and it does not move.
 *
 * Re-derived 2026-09-08 from 16 MiB, measured rather than argued (program §24, matrix item 2).
 * The measurement is Apple's five 2025/2026 SEC filings, the largest corpus this product has
 * compiled: 290 pages, 1,281 regions, 6,300 candidate objects, every one of them emitted, whole
 * package 14,046,999 B (13.40 MiB).
 *
 *   - a budget that compiles that corpus whole has to be at least 6,300.
 *     `EXTRACTION_CANDIDATE_BUDGET` is 7,000, a round number above it rather than one tuned to
 *     the corpus that motivated the change;
 *   - the per-object worst case stays what it always was: a 500-character claim label
 *     materialised into four graph serialisations plus a directory entry, ~2.5 KiB. Measured on
 *     this corpus the object-scaled files (canonical model, both ontologies, both graph CSVs)
 *     come to 11,220,523 B, i.e. 1,781 B per object -- so the 2.5 KiB worst case is a real upper
 *     bound and not an optimistic one;
 *   - the rest of the package does not scale with objects. Measured on the same corpus the
 *     region text, source binding, provenance and validation files come to 2,826,476 B;
 *   - so the requirement is 7,000 x 2,560 + 2,826,476 = 20,746,476 B = 19.79 MiB. 24 MiB is the
 *     next round size above it and leaves 4.21 MiB of headroom.
 *
 * At 16 MiB the same arithmetic supports 5,449 objects, which is why the two constants had to
 * move together: raising only the budget would have compiled a World whose package the download
 * route then refuses.
 *
 * This raises peak per-request memory by half. That is the cost of the change and it is the
 * reason the number was derived rather than doubled: the control is meant to bind, and a ceiling
 * nothing ever reaches is not a control. The alternatives are recorded in the lane report --
 * splitting the package per SourceVersion breaks the single signed export manifest, and bounding
 * the compiler by measured package bytes instead of by object count is the right long-term fix
 * and a compiler change with production blast radius.
 *
 * Exported so `collection-compiler.ts` can name the number its budget is derived from instead of
 * restating it, and so a test can assert the derivation still holds.
 */
export const MAX_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
/**
 * Exported so /developers can list what a package contains from the code that writes it.
 *
 * The page described the export in prose. A published list of files is a promise about bytes,
 * and the only version worth publishing is one that fails a check when the writer changes:
 * `brand-copy.test.ts` asserts every path the page prints is a path this module produces.
 */
export const REQUIRED_PACKAGE_PATHS = [
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
    const report = JSON.parse(validationFile.content) as {
      status?: unknown;
      reviewReasons?: unknown;
      documents?: unknown;
    };
    if (report.status !== artifact.validation.status) return null;
    if (
      artifact.lifecycle === "review_required" &&
      (!Array.isArray(report.reviewReasons) || !sameStrings(reviewReasons, report.reviewReasons))
    ) return null;
    /*
      Audit U05: the per-document list has to describe this package's own binding.

      Checked only when it is present, because the live engine writes its own report at that path
      and this key is the fallback compiler's. When it is present it is cross-checked against
      `source/collection-files.json` and has to name exactly those documents: a list that names a
      document the binding does not, or omits one it does, is a package whose own two answers
      disagree about what was compiled. A `documents` list with no binding to check it against is
      refused for the same reason -- an unverifiable per-document claim is worse than none,
      because a customer can quote it back.
    */
    if (report.documents !== undefined) {
      const bindingFile = artifact.package.files.find((file) => file.path === "source/collection-files.json");
      if (!bindingFile || !Array.isArray(report.documents)) return null;
      const ids = (rows: unknown[]) => {
        const read = rows.map((row) => (row && typeof row === "object"
          ? (row as { documentId?: unknown }).documentId : null));
        return read.every((id) => typeof id === "string" && id.length > 0)
          ? (read as string[]).slice().sort()
          : null;
      };
      const binding = JSON.parse(bindingFile.content) as unknown;
      if (!Array.isArray(binding)) return null;
      const listed = ids(report.documents);
      const bound = ids(binding);
      if (!listed || !bound || !sameStrings(listed, bound)) return null;
    }
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
  const aiGuidance = buildAiPackageGuidance({
    collectionId: artifact.collectionId,
    manifestDigest: artifact.manifestDigest,
    lifecycle: artifact.lifecycle,
    worldStateId: artifact.coreExecution.worldStateId ?? null,
  });
  const aiEntrypointJson = `${JSON.stringify(aiGuidance.entrypoint, null, 2)}\n`;
  entries["README.md"] = strToU8(aiGuidance.readme);
  entries["AGENTS.md"] = strToU8(aiGuidance.agents);
  entries["manifest/ai-entrypoint.json"] = strToU8(aiEntrypointJson);

  const files = [
    ...artifact.package.files.map((file) => ({ path: file.path, mediaType: file.mediaType, sizeBytes: file.sizeBytes, sha256: file.sha256 })),
    { path: "manifest/candidate-world.json", mediaType: "application/json", sizeBytes: Buffer.byteLength(candidateWorld), sha256: sha256(candidateWorld) },
    { path: "manifest/DOWNLOAD_README.txt", mediaType: "text/plain; charset=utf-8", sizeBytes: Buffer.byteLength(readme), sha256: sha256(readme) },
    { path: "README.md", mediaType: "text/markdown; charset=utf-8", sizeBytes: Buffer.byteLength(aiGuidance.readme, "utf8"), sha256: sha256(aiGuidance.readme) },
    { path: "AGENTS.md", mediaType: "text/markdown; charset=utf-8", sizeBytes: Buffer.byteLength(aiGuidance.agents, "utf8"), sha256: sha256(aiGuidance.agents) },
    { path: "manifest/ai-entrypoint.json", mediaType: "application/json", sizeBytes: Buffer.byteLength(aiEntrypointJson, "utf8"), sha256: sha256(aiEntrypointJson) },
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
