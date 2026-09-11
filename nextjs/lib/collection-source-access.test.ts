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

/*
  A Core V2 package names its sources in the Core's identity scheme, and the ACL is not.

  `akc_cir.identity` writes `src_<sha256>`; `connector_documents_blocked` matches
  `connector_document_bindings.document_id`, which is the product's document id. The id pattern
  here had no underscore, so every Core package answered `null` and every caller -- the World
  read model, `/download`, `/api/collections/[id]`, the active-World access check -- answered
  422. Translating is what makes the check possible; answering with the Core's ids would make
  "nothing is blocked" indistinguishable from "nothing was checked", which is why an
  untranslatable row still refuses.
*/
const VERSION = "a".repeat(64);
const SRC = `src_${"1".repeat(64)}`;
const DV = `dv_${"2".repeat(64)}`;

function coreArtifact(overrides: Partial<{ sources: unknown; documents: unknown[]; sourceDocuments: unknown }> = {}) {
  const sources = overrides.sources ?? [{ documentId: SRC, documentVersionId: DV, sourceSha256: `sha256:${VERSION}` }];
  const documents = overrides.documents ?? [{ documentId: SRC, title: "Acceptance test report" }];
  return {
    sourceDocuments: overrides.sourceDocuments ?? [{ documentId: "doc-1", versionKey: VERSION, inputSha256: `sha256:${VERSION}` }],
    package: { files: [
      { path: "source/collection-files.json", content: JSON.stringify(sources) },
      { path: "rag/documents.jsonl", content: documents.map(row => JSON.stringify(row)).join("\n") },
    ] },
  } as unknown as ReviewableCollectionArtifact;
}

it("translates a Core source manifest into the product document ids the ACL is keyed on", () => {
  expect(collectionSourceDocumentIds(coreArtifact())).toEqual(["doc-1"]);
});

it("refuses a Core manifest row that no product document accounts for", () => {
  expect(collectionSourceDocumentIds(coreArtifact({
    sources: [{ documentId: SRC, documentVersionId: DV, sourceSha256: `sha256:${"9".repeat(64)}` }],
  }))).toBeNull();
});

it("refuses a Core manifest whose RAG inventory names different sources", () => {
  expect(collectionSourceDocumentIds(coreArtifact({
    documents: [{ documentId: `src_${"3".repeat(64)}`, title: "Elsewhere" }],
  }))).toBeNull();
});

it.each([
  [[]],
  [[{ documentId: "doc-1" }]],
  [[{ documentId: "doc-1", versionKey: VERSION, inputSha256: `sha256:${"7".repeat(64)}` }]],
  [[{ documentId: "../foreign", versionKey: VERSION, inputSha256: `sha256:${VERSION}` }]],
])("refuses malformed sourceDocuments %j", (sourceDocuments) => {
  expect(collectionSourceDocumentIds(coreArtifact({ sourceDocuments }))).toBeNull();
});

it("refuses two product documents under one content digest, which makes the join ambiguous", () => {
  expect(collectionSourceDocumentIds(coreArtifact({
    sourceDocuments: [
      { documentId: "doc-1", versionKey: VERSION, inputSha256: `sha256:${VERSION}` },
      { documentId: "doc-2", versionKey: VERSION, inputSha256: `sha256:${VERSION}` },
    ],
  }))).toBeNull();
});
