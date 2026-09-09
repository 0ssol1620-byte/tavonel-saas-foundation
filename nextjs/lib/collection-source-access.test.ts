import { expect, it } from "vitest";
import { collectionSourceDocumentIds } from "./collection-source-access";
import type { ReviewableCollectionArtifact } from "./collection-download";
function artifact(source: unknown, documents: unknown[]): ReviewableCollectionArtifact {
  // Parser fixture only: cryptographic package validation is performed separately by the route.
  return { package: { files: [
    { path: "source/collection-files.json", content: JSON.stringify(source) },
    { path: "rag/documents.jsonl", content: documents.map(row => JSON.stringify(row)).join("\n") },
  ] } } as ReviewableCollectionArtifact;
}
it("reads matching source and document inventories independent of order", () => {
  expect(collectionSourceDocumentIds(artifact([{ documentId: "b" }, { documentId: "a" }], [{ documentId: "a" }, { documentId: "b" }]))).toEqual(["a", "b"]);
});
it.each([
  [[], []], [[{ documentId: "a" }], [{ documentId: "b" }]],
  [[{ documentId: "a" }, { documentId: "a" }], [{ documentId: "a" }, { documentId: "a" }]],
  [[{ documentId: "a" }], [{ documentId: "a" }, { documentId: "b" }]],
  [[{ documentId: "../foreign" }], [{ documentId: "../foreign" }]],
  [[null], [null]],
])("refuses empty, ambiguous or mismatched inventory %j", (sources, documents) => {
  expect(collectionSourceDocumentIds(artifact(sources, documents))).toBeNull();
});
it("refuses missing source manifest", () => {
  const value = artifact([{ documentId: "a" }], [{ documentId: "a" }]);
  value.package.files.shift();
  expect(collectionSourceDocumentIds(value)).toBeNull();
});
