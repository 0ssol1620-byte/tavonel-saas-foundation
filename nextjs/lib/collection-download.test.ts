import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import {
  buildCollectionZip,
  isSafeArchivePath,
  validateDownloadableCollectionArtifact,
} from "./collection-download";

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

describe("Foundation collection package download", () => {
  it("creates a readable ZIP only after validating every package file", () => {
    const source = completedArtifact();
    const artifact = validateDownloadableCollectionArtifact(source, source.collectionId);
    expect(artifact).not.toBeNull();

    const entries = unzipSync(buildCollectionZip(artifact!));
    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      "ontology/knowledge.jsonld",
      "graph/relationships.csv",
      "rag/chunks.jsonl",
      "manifest/candidate-world.json",
      "manifest/DOWNLOAD_README.txt",
    ]));
    expect(strFromU8(entries["manifest/DOWNLOAD_README.txt"])).toContain("candidatePromotion=false");
    expect(JSON.parse(strFromU8(entries["manifest/candidate-world.json"])).collectionId).toBe(source.collectionId);
  });

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
