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

/*
  The same file uploaded twice, which used to make a whole Core V2 World unreadable.

  `versionKey` is the content digest, so two uploads of one PDF are two product documents under
  one digest. The join required exactly one and answered `null`, and `null` here is a 422 from
  `/api/collections/<id>`, `/download`, `/world` and `/ask`. The bytes are the only identifier
  both sides record, so the pairing stays unknown; the permission question is answered over every
  document carrying the bytes instead, which is the conservative reading and the one the ACL
  needs. Only Core V2 was affected -- the fallback engine never joins on a digest.
*/
const SAME_BYTES = [
  { documentId: "doc-1", versionKey: VERSION, inputSha256: `sha256:${VERSION}` },
  { documentId: "doc-2", versionKey: VERSION, inputSha256: `sha256:${VERSION}` },
];

it("names both product documents when one digest carries two of them", () => {
  expect(collectionSourceDocumentIds(coreArtifact({ sourceDocuments: SAME_BYTES })))
    .toEqual(["doc-1", "doc-2"]);
});

it("names every carrier when the Core compiled both uploads as its own two sources", () => {
  const second = `src_${"4".repeat(64)}`;
  expect(collectionSourceDocumentIds(coreArtifact({
    sourceDocuments: SAME_BYTES,
    sources: [
      { documentId: SRC, documentVersionId: DV, sourceSha256: `sha256:${VERSION}` },
      { documentId: second, documentVersionId: `dv_${"5".repeat(64)}`, sourceSha256: `sha256:${VERSION}` },
    ],
    documents: [{ documentId: SRC, title: "Acceptance test report" }, { documentId: second, title: "Again" }],
  }))).toEqual(["doc-1", "doc-2"]);
});

/*
  The reason the union is the right answer and not merely a convenient one.

  `checkConnectorSourceAccess` matches these ids against `connector_document_bindings.document_id`
  and blocks the read if any is suspended. Returning one of the two carriers would make the
  outcome depend on which upload the join happened to pick: block a suspended `doc-2` on one
  recompile and miss it on the next. The list has to contain the blocked one for the check to be
  able to see it, whichever upload the Core source was compiled from.
*/
it("hands the ACL the blocked upload too, so a suspended twin cannot be read around", () => {
  const ids = collectionSourceDocumentIds(coreArtifact({ sourceDocuments: SAME_BYTES }));
  const suspended = new Set(["doc-2"]);
  expect(ids).toContain("doc-2");
  expect(ids!.some((id) => suspended.has(id)), "a suspended twin blocks the collection").toBe(true);
});

it("refuses more Core sources under a digest than there are documents carrying it", () => {
  const surplus = `src_${"6".repeat(64)}`;
  expect(collectionSourceDocumentIds(coreArtifact({
    sources: [
      { documentId: SRC, documentVersionId: DV, sourceSha256: `sha256:${VERSION}` },
      { documentId: surplus, documentVersionId: `dv_${"7".repeat(64)}`, sourceSha256: `sha256:${VERSION}` },
    ],
    documents: [{ documentId: SRC, title: "Acceptance test report" }, { documentId: surplus, title: "Surplus" }],
  }))).toBeNull();
});

it("still refuses one product document listed twice, which is malformed rather than shared", () => {
  expect(collectionSourceDocumentIds(coreArtifact({
    sourceDocuments: [
      { documentId: "doc-1", versionKey: VERSION, inputSha256: `sha256:${VERSION}` },
      { documentId: "doc-1", versionKey: VERSION, inputSha256: `sha256:${VERSION}` },
    ],
  }))).toBeNull();
});

it("pairs the same package to the same documents however the input is ordered", () => {
  expect(collectionSourceDocumentIds(coreArtifact({ sourceDocuments: [...SAME_BYTES].reverse() })))
    .toEqual(collectionSourceDocumentIds(coreArtifact({ sourceDocuments: SAME_BYTES })));
});
