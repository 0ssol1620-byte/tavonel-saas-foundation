import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  EXTRACTION_CANDIDATE_BUDGET,
  compileCollectionCandidate,
  type CollectionOcrInput,
} from "./collection-compiler";
import {
  MAX_UNCOMPRESSED_BYTES,
  buildSignedCollectionZip,
  isSafeArchivePath,
  validateDownloadableCollectionArtifact,
  validatePromotableCollectionArtifact,
  validateReviewableCollectionArtifact,
} from "./collection-download";
import { createExportSigner, verifyExportSignature } from "./export-signing";

function input(documentId: string, versionKey: string, text: string): CollectionOcrInput {
  const workspaceId = "pilot-download";
  const sanitizedKey = `immutable/${workspaceId}/${workspaceId}/${documentId}/${versionKey}/sanitized.pdf`;
  return {
    documentId,
    versionKey,
    sanitizedKey,
    ocrJsonKey: `immutable/${workspaceId}/${workspaceId}/${documentId}/${versionKey}/ocr.json`,
    pageCount: 1,
    text,
    inputSha256: `sha256:${versionKey}`,
    sourceImmutableKey: sanitizedKey,
    /*
      Anchored, because a downloadable candidate has to be one the gates accept.

      `evidenceCoverage` is computed from the package now rather than written as a literal, so a
      document contributing no region-anchored retrieval unit compiles to `review_required` --
      correctly, and not what these tests are about. One page-bound block over the same text.
    */
    regions: [{
      regionId: `${documentId}-p1-b1`,
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph" as const,
      text,
      bbox1000: [80, 120, 920, 320] as [number, number, number, number],
      confidence: 0.99,
      authority: "contractual" as const,
    }],
  };
}

function completedArtifact() {
  const artifact = compileCollectionCandidate([
    input("doc-one", "a".repeat(64), "Quarterly revenue increased after the reviewed policy change."),
    input("doc-two", "b".repeat(64), "Security research documented access control evidence."),
  ]);
  return {
    ...artifact,
    coreExecution: {
      status: "completed",
      runtime: "tavonel-foundation-core-deterministic-v1",
      receipt: {
        requestId: "core-proof",
        outputSha256: artifact.manifestDigest,
        candidatePromotion: false,
      },
    },
  };
}

function exportSigningMaterial() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPkcs8DerBase64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  return {
    signer: createExportSigner({ keyId: "foundation-test-2026", privateKeyPkcs8DerBase64 })!,
    publicKeySpkiDer: createPublicKey(privateKey).export({ format: "der", type: "spki" }),
  };
}

describe("Foundation collection package download", () => {
  it("creates a readable ZIP only after validating every package file", () => {
    const source = completedArtifact();
    const artifact = validateDownloadableCollectionArtifact(source, source.collectionId);
    expect(artifact).not.toBeNull();

    const material = exportSigningMaterial();
    const signed = buildSignedCollectionZip(artifact!, material.signer);
    const entries = unzipSync(signed.archive);
    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      "ontology/knowledge.jsonld",
      "graph/relationships.csv",
      "rag/chunks.jsonl",
      "manifest/candidate-world.json",
      "manifest/DOWNLOAD_README.txt",
      "README.md",
      "AGENTS.md",
      "manifest/ai-entrypoint.json",
      "manifest/export-manifest.json",
      "signatures/export-manifest.ed25519.json",
    ]));
    expect(strFromU8(entries["manifest/DOWNLOAD_README.txt"])).toContain("candidatePromotion=false");
    expect(strFromU8(entries["README.md"])).toContain("Read AGENTS.md in this folder first");
    expect(strFromU8(entries["README.md"])).toContain("A filesystem path by itself does not grant an AI access");
    expect(strFromU8(entries["AGENTS.md"])).toContain("validation/report.json");
    const aiEntrypoint = JSON.parse(strFromU8(entries["manifest/ai-entrypoint.json"]));
    expect(aiEntrypoint).toEqual(expect.objectContaining({
      schemaVersion: "tavonel.ai_entrypoint.v1",
      collectionId: source.collectionId,
      lifecycle: "candidate",
      authoritativeUse: "verify_active_world_status",
    }));
    expect(JSON.parse(strFromU8(entries["manifest/candidate-world.json"])).collectionId).toBe(source.collectionId);
    const exportManifest = JSON.parse(strFromU8(entries["manifest/export-manifest.json"]));
    const signature = JSON.parse(strFromU8(entries["signatures/export-manifest.ed25519.json"]));
    expect(exportManifest.formats).toEqual(expect.arrayContaining(["application/ld+json", "text/turtle", "text/csv"]));
    expect(signature).toEqual(expect.objectContaining({
      algorithm: "Ed25519",
      keyId: "foundation-test-2026",
      publicKeySpkiDerBase64: material.publicKeySpkiDer.toString("base64"),
      signedPayloadSha256: signed.signature.signedPayloadSha256,
    }));
    const manifestBytes = entries["manifest/export-manifest.json"];
    expect(verifyExportSignature(manifestBytes, signature, material.publicKeySpkiDer)).toBe(true);
    for (const file of exportManifest.files) {
      expect(entries[file.path], file.path).toBeDefined();
      expect(entries[file.path].byteLength, file.path).toBe(file.sizeBytes);
      expect(`sha256:${createHash("sha256").update(entries[file.path]).digest("hex")}`, file.path).toBe(file.sha256);
    }
    expect(buildSignedCollectionZip(artifact!, material.signer).archive).toEqual(signed.archive);

    const archivePath = join(tmpdir(), `tavonel-export-${randomUUID()}.zip`);
    writeFileSync(archivePath, signed.archive);
    try {
      const verifier = resolve(import.meta.dirname, "../scripts/verify-signed-export.mjs");
      const verify = (fingerprint: string) => spawnSync(
        process.execPath,
        [verifier, "--archive", archivePath, "--trusted-fingerprint", fingerprint],
        { encoding: "utf8" },
      );
      const accepted = verify(material.signer.publicKeySpkiSha256);
      expect(accepted.status, accepted.stderr).toBe(0);
      expect(JSON.parse(accepted.stdout)).toEqual(expect.objectContaining({
        ok: true,
        collectionId: source.collectionId,
        keyId: material.signer.keyId,
        filesVerified: exportManifest.files.length,
      }));
      const rejected = verify(`sha256:${"0".repeat(64)}`);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("trusted fingerprint");
    } finally {
      unlinkSync(archivePath);
    }
  });

  it("signs review-required output for inspection but never accepts it for promotion", () => {
    const source = completedArtifact();
    const reviewReasons = ["CONTRADICTION_CANDIDATE:claim-a:claim-b"];
    const validationContent = `${JSON.stringify({ status: "review_required", reviewReasons }, null, 2)}\n`;
    const reviewRequired = {
      ...source,
      lifecycle: "review_required",
      reviewReasons,
      package: {
        ...source.package,
        files: source.package.files.map((file) => file.path === "validation/report.json" ? {
          ...file,
          content: validationContent,
          sizeBytes: Buffer.byteLength(validationContent, "utf8"),
          sha256: `sha256:${createHash("sha256").update(validationContent, "utf8").digest("hex")}`,
        } : file),
      },
      validation: {
        ...source.validation,
        status: "review_required",
        reviewReasons,
      },
      coreExecution: {
        ...source.coreExecution,
        status: "review_required",
      },
    };
    const reviewable = validateReviewableCollectionArtifact(reviewRequired, source.collectionId);
    expect(reviewable).not.toBeNull();
    expect(validatePromotableCollectionArtifact(reviewRequired, source.collectionId)).toBeNull();

    const signed = buildSignedCollectionZip(reviewable!, exportSigningMaterial().signer);
    const entries = unzipSync(signed.archive);
    expect(signed.exportManifest.lifecycle).toBe("review_required");
    expect(strFromU8(entries["manifest/DOWNLOAD_README.txt"])).toContain("Lifecycle: review_required");
    expect(JSON.parse(strFromU8(entries["manifest/ai-entrypoint.json"]))).toEqual(expect.objectContaining({
      authoritativeUse: "blocked_pending_review",
    }));
  });

  /*
    The package ceiling, at the size it was re-derived to on 2026-09-08 (program §24).

    Two obligations that pull against each other. The ceiling has to be large enough that a World
    compiled inside `EXTRACTION_CANDIDATE_BUDGET` produces a package the download route will
    actually serve -- raising only the budget would compile a World whose package is then refused
    -- and it has to keep refusing past its own edge, because it is the bound on how much a
    single request may materialise in memory out of stored data. Both are asserted here, so that
    moving one constant without the other fails a test rather than a customer download.
  */
  it("serves a package at the derived ceiling and refuses the byte past it", () => {
    const source = completedArtifact();
    expect(validateDownloadableCollectionArtifact(source, source.collectionId)).not.toBeNull();

    // The derivation `collection-compiler.ts` documents: the worst case of ~2.5 KiB of package
    // per object across the whole budget, plus the 2,826,476 B the Apple corpus's region text,
    // source binding, provenance and validation files were measured to cost beside them.
    expect(MAX_UNCOMPRESSED_BYTES).toBe(24 * 1024 * 1024);
    expect(EXTRACTION_CANDIDATE_BUDGET * 2_560 + 2_826_476).toBeLessThanOrEqual(MAX_UNCOMPRESSED_BYTES);
    // And the budget still has to reach the corpus §24 directs: 290 pages, 6,300 objects.
    expect(EXTRACTION_CANDIDATE_BUDGET).toBeGreaterThanOrEqual(6_300);

    const used = source.package.files.reduce((total, file) => total + file.sizeBytes, 0);
    const padded = (size: number) => {
      const content = "x".repeat(size);
      return {
        ...source,
        package: {
          files: [...source.package.files, {
            path: "canonical/padding.txt",
            mediaType: "text/plain; charset=utf-8",
            sizeBytes: Buffer.byteLength(content, "utf8"),
            sha256: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
            content,
          }],
        },
      };
    };

    const atCeiling = padded(MAX_UNCOMPRESSED_BYTES - used);
    expect(validateDownloadableCollectionArtifact(atCeiling, source.collectionId)).not.toBeNull();

    const overCeiling = padded(MAX_UNCOMPRESSED_BYTES - used + 1);
    expect(validateDownloadableCollectionArtifact(overCeiling, source.collectionId)).toBeNull();
    // Fail closed, not fail silent: an over-ceiling artifact is not promotable either.
    expect(validatePromotableCollectionArtifact(overCeiling, source.collectionId)).toBeNull();
  }, 60_000);

  it("rejects traversal paths, altered bytes, non-Core artifacts and the wrong tenant collection", () => {
    expect(isSafeArchivePath("../secret.txt")).toBe(false);
    expect(isSafeArchivePath("ontology\\secret.txt")).toBe(false);

    const altered = completedArtifact();
    altered.package.files[0].content += "tampered";
    expect(validateDownloadableCollectionArtifact(altered, altered.collectionId)).toBeNull();

    const withoutCore = compileCollectionCandidate([
      input("doc-one", "a".repeat(64), "Quarterly revenue increased after the reviewed policy change."),
      input("doc-two", "b".repeat(64), "Security research documented access control evidence."),
    ]);
    expect(validateDownloadableCollectionArtifact(withoutCore, withoutCore.collectionId)).toBeNull();
    expect(validateDownloadableCollectionArtifact(completedArtifact(), "collection-00000000000000000000000000000000")).toBeNull();
  });
});
