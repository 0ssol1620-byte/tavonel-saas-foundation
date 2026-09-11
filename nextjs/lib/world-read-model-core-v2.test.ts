import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CollectionOcrInput } from "./collection-compiler";
import { validatePromotableCollectionArtifact } from "./collection-download";
import { COLLECTION_SOURCE_MANIFEST, collectionSourceDocumentIds } from "./collection-source-access";
import { projectProductCoreV2Candidate, PRODUCT_CORE_RESPONSE_SCHEMA } from "./core-runtime-v2";
import { buildWorldReadModel, type WorldReadModel } from "./world-read-model";
import WorldGraphCanvas from "../components/world-graph-canvas";
import WorldOntologyViewer from "../components/world-ontology-viewer";

/*
  Can the World a customer promoted from the live engine be read back at all?

  `buildWorldReadModel` parses `canonical/model.json` as `akc.canonical-knowledge-model.v1`
  -- the shape the TypeScript fallback compiler writes, with `nodes`, `edges` and `inputBinding`.
  Core V2 writes the canonical *knowledge model* at that path instead (`compiler.py`:
  `{schemaVersion, tenantId, collectionId, objects}`), and every identifier in its package comes
  from `akc_cir.identity`, in namespaces the product does not share: a source is `src_<hex>`
  rather than the product's document id, a source version is `dv_<hex>` rather than a content
  digest, and an Evidence object's node id is its `stableId` while the string its edges and its
  chunk rows cite is its `payload.evidenceId`. So the fixture below is not "a candidate
  artifact"; it is specifically the artifact `projectProductCoreV2Candidate` produces from the
  response shapes in `packages/product-core/src/akc_product_core/{compiler,semantics}.py`, with
  the package files the Core actually materialises.

  The identifiers are the Core's *shapes*, not recomputed digests: `src_`, `dv_`, `ev_`, `ko_`,
  `claim_`, `entity_`, `relation_` and `chunk_` followed by a sha256 hex. Re-deriving
  `akc_cir.identity` here would be a second implementation of the identity scheme, and what the
  read model is sensitive to is which namespace each field is in, not the digest.
*/

const WORKSPACE = "pilot";
const TENANT = "pilot";
const VERSION_KEY = "a".repeat(64);
const INPUT_SHA256 = `sha256:${VERSION_KEY}`;
const COLLECTION = "collection-0123456789abcdef0123456789abcdef";

/** One Core identifier of each kind, in the `prefix_<sha256>` shape `_digest` produces. */
const coreId = (prefix: string, seed: string) =>
  `${prefix}_${createHash("sha256").update(seed, "utf8").digest("hex")}`;

const SRC = coreId("src", "source");
const DV = coreId("dv", "version");
const EVIDENCE = coreId("ev", "evidence");
const KO_DOCUMENT = coreId("ko_document", "document");
const KO_EVIDENCE = coreId("ko_evidence", "evidence-object");
const CLAIM = coreId("claim", "claim");
const ENTITY = coreId("entity", "entity");
const RELATION = coreId("relation", "relation");
const CHUNK = coreId("chunk", "chunk");
const BLOCK_TEXT = "Feedwater Pump 200 ran at 42 bar during the acceptance test.";

function inputs(): CollectionOcrInput[] {
  const sanitizedKey = `immutable/${WORKSPACE}/${WORKSPACE}/documents/doc-1/${VERSION_KEY}/sanitized.pdf`;
  return [{
    documentId: "doc-1",
    versionKey: VERSION_KEY,
    sanitizedKey,
    ocrJsonKey: sanitizedKey.replace("sanitized.pdf", "ocr.json"),
    pageCount: 1,
    text: BLOCK_TEXT,
    inputSha256: INPUT_SHA256,
    sourceImmutableKey: sanitizedKey,
    regions: [{
      regionId: "native-doc-1-p1-b1",
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph",
      text: BLOCK_TEXT,
      bbox1000: [100, 120, 900, 240],
      confidence: 1,
      authority: "official",
    }],
  }];
}

/** The `SourceRef` every Core knowledge object carries, in the Core's own namespace. */
const SOURCE_REF = {
  documentId: SRC,
  documentVersionId: DV,
  pageIndex0: 0,
  pageNumber1: 1,
  bbox1000: [100, 120, 900, 240],
  nativeObjectId: "native-doc-1-p1-b1",
};

function knowledgeObject(
  kind: string,
  stableId: string,
  links: string[],
  payload: Record<string, unknown>,
) {
  return {
    stableId,
    tenantId: TENANT,
    collectionId: COLLECTION,
    kind,
    sourceRefs: [SOURCE_REF],
    origin: "rule_derived",
    verificationState: "verified_with_warning",
    createdByActivity: coreId("activity", "activity"),
    version: 1,
    hash: `sha256:${"1".repeat(64)}`,
    links,
    payload,
  };
}

/*
  The objects `_knowledge_projection` emits for one region that yields one claim and one entity.

  `collection` and `block` are in the list because the Core always emits them and the
  projection sorts them into "not projected" rather than dropping them silently.
*/
const OBJECTS = [
  knowledgeObject("collection", coreId("ko_collection", COLLECTION), [KO_DOCUMENT], { workspaceId: WORKSPACE }),
  knowledgeObject("document", KO_DOCUMENT, [coreId("ko_block", "block")], { title: "Acceptance test report", documentVersionId: DV }),
  knowledgeObject("block", coreId("ko_block", "block"), [], { text: BLOCK_TEXT, blockType: "paragraph" }),
  knowledgeObject("evidence", KO_EVIDENCE, [], { evidenceId: EVIDENCE }),
  knowledgeObject("claim", CLAIM, [KO_EVIDENCE, ENTITY], {
    claimId: CLAIM,
    logicalId: coreId("ku", "unit"),
    sourceId: SRC,
    sourceVersionId: DV,
    evidenceId: EVIDENCE,
    text: BLOCK_TEXT,
    entityIds: [ENTITY],
  }),
  knowledgeObject("entity", ENTITY, [], {
    entityId: ENTITY,
    canonicalName: "Feedwater Pump 200",
    entityType: "entity",
    claimIds: [CLAIM],
    evidenceIds: [EVIDENCE],
  }),
  knowledgeObject("relation", RELATION, [CLAIM, ENTITY], {
    relationId: RELATION,
    subjectId: CLAIM,
    predicate: "mentions",
    objectId: ENTITY,
    evidenceId: EVIDENCE,
  }),
];

/** The chunk row `rag/chunks.jsonl` carries: every id in the Core's namespace, not the product's. */
const CHUNK_ROW = {
  chunkId: CHUNK,
  logicalId: coreId("ku", "unit"),
  logicalIds: [coreId("ku", "unit")],
  text: BLOCK_TEXT,
  sourceId: SRC,
  sourceVersionId: DV,
  evidenceId: EVIDENCE,
  evidenceIds: [EVIDENCE],
  evidenceRefs: [SOURCE_REF],
  pageNumber1: 1,
  bbox1000: [100, 120, 900, 240],
  authority: "official",
  authorityTier: "official",
  authorityScore: 0.8,
  claimIds: [CLAIM],
  entityIds: [ENTITY],
  entityNames: ["Feedwater Pump 200"],
  languages: ["en"],
  temporalRefs: [],
  retrievalTerms: ["feedwater", "pump"],
};

function packageFile(path: string, content: string) {
  return {
    path,
    mediaType: path.endsWith(".csv") ? "text/csv; charset=utf-8" : path.endsWith(".jsonl") ? "application/x-ndjson" : "application/json",
    sizeBytes: Buffer.byteLength(content, "utf8"),
    sha256: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
    content,
  };
}

/** Exactly the package paths `_package_projection` writes that this read path opens. */
function packageFiles(overrides: Record<string, string> = {}) {
  const contents: Record<string, string> = {
    [COLLECTION_SOURCE_MANIFEST]: `${JSON.stringify([{ documentId: SRC, documentVersionId: DV, sourceSha256: INPUT_SHA256 }])}\n`,
    "canonical/model.json": `${JSON.stringify({ schemaVersion: "canonical-knowledge-1.0.0", tenantId: TENANT, collectionId: COLLECTION, objects: OBJECTS })}\n`,
    "ontology/knowledge.jsonld": `${JSON.stringify({ "@context": { "@vocab": "urn:tavonel:" }, "@graph": [] })}\n`,
    "ontology/knowledge.ttl": "@prefix tav: <urn:tavonel:> .\n",
    "graph/nodes.csv": `"id","kind"\n"${KO_DOCUMENT}","document"\n`,
    "graph/relationships.csv": `"id","predicate"\n"${RELATION}","mentions"\n`,
    "rag/documents.jsonl": `${JSON.stringify({ documentId: SRC, title: "Acceptance test report" })}\n`,
    "rag/chunks.jsonl": `${JSON.stringify(CHUNK_ROW)}\n`,
    "provenance/activities.jsonl": `${JSON.stringify({ sequence: 1, type: "document.ocr.verified", documentId: SRC })}\n`,
    "validation/report.json": `${JSON.stringify({ status: "passed", matchingPolicy: "legacy", candidatePromotion: false, reviewReasons: [] })}\n`,
    ...overrides,
  };
  return Object.entries(contents).map(([path, content]) => packageFile(path, content));
}

function response(overrides: { files?: Record<string, string>; objects?: unknown[] } = {}) {
  return {
    schemaVersion: PRODUCT_CORE_RESPONSE_SCHEMA,
    status: "completed" as const,
    runtime: "tavonel-python-core-v2" as const,
    candidate: {
      worldStateId: coreId("ws", "world"),
      manifestDigest: `sha256:${"b".repeat(64)}`,
      lifecycle: "candidate" as const,
      canonicalDocuments: [{ documentId: SRC, documentVersionId: DV, title: "Acceptance test report" }],
      canonicalKnowledgeModel: { collectionId: COLLECTION, objects: overrides.objects ?? OBJECTS },
      units: [],
      artifactHashes: { "canonical/model": `sha256:${"c".repeat(64)}` },
      diff: {},
      impact: {},
      recompilation: {},
      directoryPlan: [
        { path: "Sources", kind: "root", sourceIds: [] },
        { path: "rag/chunks.jsonl", kind: "artifact", sourceIds: [SRC] },
      ],
      package: {
        roots: ["source", "canonical", "ontology", "graph", "rag", "provenance", "validation"],
        files: packageFiles(overrides.files),
        signatureStatus: "external_signer_required" as const,
      },
      validation: {
        status: "passed",
        deterministicMaterialization: true,
        sourceCoverage: true,
        evidenceCoverage: true,
        immutableInputsOnly: true,
      },
      reviewReasons: [],
    },
    artifacts: [],
    receipt: {
      requestId: "core-worldread-fixture",
      inputSha256: `sha256:${"d".repeat(64)}`,
      outputSha256: `sha256:${"e".repeat(64)}`,
      coreReleaseDigest: `sha256:${"f".repeat(64)}`,
      matchingPolicy: "legacy" as const,
      candidatePromotion: false as const,
      equivalence: "not_run" as const,
      totalArtifacts: 5,
      rebuiltArtifacts: 5,
      workAvoidedArtifacts: 0,
    },
  };
}

/** The stored shape: the projection's artifact plus the `coreExecution` the compile run adds. */
function storedArtifact(overrides: { files?: Record<string, string>; objects?: unknown[] } = {}) {
  const projected = projectProductCoreV2Candidate(response(overrides), inputs());
  if (!projected) throw new Error("the Core V2 projection refused the fixture");
  return {
    ...projected,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-python-core-v2",
      worldStateId: coreId("ws", "world"),
      receipt: {
        requestId: "core-worldread-fixture",
        outputSha256: `sha256:${"e".repeat(64)}`,
        candidatePromotion: false as const,
        equivalence: "not_run" as const,
      },
    },
  };
}

/*
  Two separate defects, both of which this fixture reproduced before this lane touched anything.

  The artifact passes `validatePromotableCollectionArtifact`, so a Core V2 World can be
  promoted. Then:

  - `buildWorldReadModel` returned `null` for it, so `/api/collections/[id]/world` answered
    WORLD_READ_MODEL_INVALID (422) for every World the live engine compiled, and the relations
    R3-K09 restored reached the stored artifact and the signed download and nothing a customer
    could look at.
  - `collectionSourceDocumentIds` answered with the *Core's* `src_<hex>` source ids, which pass
    every shape check it applies and match no `connector_document_bindings` row. So the
    connector ACL check every read path makes -- this one, `/download`,
    `/api/collections/[id]`, the active-World access check -- ran against ids that cannot match,
    found nothing blocked, and allowed the read. A suspended connector source would not have
    stopped it. That one is a permission defect rather than a rendering one, and it was live.
*/
describe("a promoted Core V2 World, read back", () => {
  it("is promotable, which is what made the unreadable World reachable", () => {
    expect(validatePromotableCollectionArtifact(storedArtifact(), COLLECTION)).not.toBeNull();
  });

  it("names its sources in the product's namespace, so the connector ACL can be checked", () => {
    const artifact = validatePromotableCollectionArtifact(storedArtifact(), COLLECTION);
    if (!artifact) throw new Error("fixture is not promotable");

    // Not the Core's `src_<hex>`: `connector_documents_blocked` matches the product's document id,
    // so a list in the Core's namespace matches no binding row and checks nothing.
    expect(collectionSourceDocumentIds(artifact)).toEqual(["doc-1"]);
    expect(collectionSourceDocumentIds(artifact)).not.toContain(SRC);
  });

  it("reads its nodes, its Core-computed relation, and page-exact evidence", () => {
    const model = buildWorldReadModel(storedArtifact(), COLLECTION);
    if (!model) throw new Error("a promoted Core V2 World is still unreadable");

    expect(model.objects.map((object) => ({ id: object.id, type: object.type })).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([
        { id: CLAIM, type: "Claim" },
        { id: ENTITY, type: "Entity" },
        { id: KO_DOCUMENT, type: "Document" },
        { id: KO_EVIDENCE, type: "Evidence" },
      ].sort((a, b) => a.id.localeCompare(b.id)));

    // R3-K09's relation, all the way through to the read model the World UI renders.
    expect(model.relations.map((relation) => relation.predicate).sort()).toEqual(["mentions", "supported_by"]);
    const mentions = model.relations.find((relation) => relation.predicate === "mentions");
    expect(mentions).toMatchObject({ subject: CLAIM, object: ENTITY, status: "candidate" });
    expect(mentions?.evidenceRefs).toEqual([`${EVIDENCE}:${CHUNK}`]);
    expect(model.ontology.properties.map((property) => property.name)).toEqual(["mentions", "supported_by"]);

    expect(model.evidence).toHaveLength(1);
    expect(model.evidence[0]).toMatchObject({
      id: `${EVIDENCE}:${CHUNK}`,
      // The product's ids, because `/api/documents/<id>/source?version=<v>` is what opens the page.
      sourceId: "doc-1",
      sourceVersionId: VERSION_KEY,
      page: 1,
      bbox: [100, 120, 900, 240],
      excerpt: BLOCK_TEXT,
      authority: "official",
      digest: INPUT_SHA256,
    });
    expect(model.evidence[0].sourceId, "the Core's src_ id cannot be opened by the document route")
      .not.toBe(SRC);

    // Every object that has evidence says so, via the payload.evidenceId namespace.
    expect(model.objects.find((object) => object.id === CLAIM)?.evidenceRefs).toEqual([]);
    expect(model.objects.find((object) => object.id === KO_EVIDENCE)?.evidenceRefs)
      .toEqual([`${EVIDENCE}:${CHUNK}`]);
    expect(model.objects.find((object) => object.id === KO_EVIDENCE)?.sourceVersions).toEqual([VERSION_KEY]);
  });

  it("keeps the Core's source ids on the directory plan, which is where they belong", () => {
    const model = buildWorldReadModel(storedArtifact(), COLLECTION);
    expect(model?.directory.find((entry) => entry.path === "rag/chunks.jsonl")?.sourceIds).toEqual([SRC]);
  });

  it("reports candidate or active from the manifest binding, as the fallback path does", () => {
    const stored = storedArtifact();
    const active = buildWorldReadModel(stored, COLLECTION, { activeManifestDigest: stored.manifestDigest, activeRevision: 3 });
    expect(active?.world.status).toBe("active");
    expect(active?.world.revision).toEqual({ state: "read", value: 3 });
    expect(active?.relations.every((relation) => relation.status === "active")).toBe(true);
  });
});

/*
  The failure paths, which are the half that says the relaxation is bounded.

  Reading a Core package means accepting a second canonical-model shape, a source binding
  joined across two namespaces, and an evidence id that is not a node id. None of those may
  become "accept whatever is there": an unresolvable reference has to refuse the World rather
  than render a citation that goes nowhere.
*/
describe("an unreadable Core V2 artifact still refuses", () => {
  it("refuses an artifact with no ontology to read", () => {
    const { ontology: _dropped, ...withoutOntology } = storedArtifact();
    expect(buildWorldReadModel(withoutOntology, COLLECTION)).toBeNull();
    expect(buildWorldReadModel({ ...storedArtifact(), ontology: { nodes: [], edges: {} } }, COLLECTION)).toBeNull();
  });

  it("refuses an edge citing evidence no Evidence node carries", () => {
    const stored = storedArtifact();
    const dangling = {
      ...stored,
      ontology: {
        ...stored.ontology,
        edges: stored.ontology.edges.map((edge) => edge.type === "mentions"
          ? { ...edge, evidenceIds: [coreId("ev", "nowhere")] }
          : edge),
      },
    };
    expect(buildWorldReadModel(dangling, COLLECTION)).toBeNull();
  });

  it("refuses an edge whose endpoint is not a node", () => {
    const stored = storedArtifact();
    const dangling = {
      ...stored,
      ontology: {
        ...stored.ontology,
        edges: stored.ontology.edges.map((edge) => ({ ...edge, to: coreId("entity", "fabricated") })),
      },
    };
    expect(buildWorldReadModel(dangling, COLLECTION)).toBeNull();
  });

  it("refuses a source manifest that no product document accounts for", () => {
    // A row whose digest matches nothing in `sourceDocuments`: the source cannot be named in the
    // namespace the ACL and the document route use, so it is not named at all.
    const orphaned = `${JSON.stringify([{ documentId: SRC, documentVersionId: DV, sourceSha256: `sha256:${"9".repeat(64)}` }])}\n`;
    expect(buildWorldReadModel(storedArtifact({ files: { [COLLECTION_SOURCE_MANIFEST]: orphaned } }), COLLECTION)).toBeNull();
  });

  it("refuses malformed sourceDocuments rather than reading the package without them", () => {
    const stored = storedArtifact();
    expect(buildWorldReadModel({ ...stored, sourceDocuments: [] }, COLLECTION)).toBeNull();
    expect(buildWorldReadModel({ ...stored, sourceDocuments: [{ documentId: "doc-1" }] }, COLLECTION)).toBeNull();
    // A digest that is not the digest of the version it claims: the join key is not trusted.
    expect(buildWorldReadModel({
      ...stored,
      sourceDocuments: [{ ...stored.sourceDocuments[0], inputSha256: `sha256:${"7".repeat(64)}` }],
    }, COLLECTION)).toBeNull();
    // Two documents under one digest would make the join ambiguous.
    expect(buildWorldReadModel({
      ...stored,
      sourceDocuments: [stored.sourceDocuments[0], { ...stored.sourceDocuments[0], documentId: "doc-2" }],
    }, COLLECTION)).toBeNull();
  });

  it("refuses a chunk row bound to a source version the manifest does not name", () => {
    const drifted = `${JSON.stringify({ ...CHUNK_ROW, sourceVersionId: coreId("dv", "other") })}\n`;
    expect(buildWorldReadModel(storedArtifact({ files: { "rag/chunks.jsonl": drifted } }), COLLECTION)).toBeNull();
  });

  it("refuses a chunk row citing an evidence id the World does not contain", () => {
    const drifted = `${JSON.stringify({ ...CHUNK_ROW, evidenceId: coreId("ev", "nowhere") })}\n`;
    expect(buildWorldReadModel(storedArtifact({ files: { "rag/chunks.jsonl": drifted } }), COLLECTION)).toBeNull();
  });

  it("refuses a chunk row that lost its page bbox", () => {
    const { bbox1000: _dropped, ...withoutBbox } = CHUNK_ROW;
    expect(buildWorldReadModel(
      storedArtifact({ files: { "rag/chunks.jsonl": `${JSON.stringify(withoutBbox)}\n` } }),
      COLLECTION,
    )).toBeNull();
  });

  it("refuses a fallback-shaped manifest through the Core reader", () => {
    /*
      `documentVersionId` and `sourceSha256` are the discriminator, not decoration. A package
      with the fallback's manifest shape and an unreadable canonical model must not be read out
      of its `ontology`: there its canonical model *is* the graph, and a package file that
      disagrees with the artifact is a broken package, not a second format.
    */
    const fallbackShaped = `${JSON.stringify([{
      documentId: "doc-1",
      versionKey: VERSION_KEY,
      inputSha256: INPUT_SHA256,
      sourceImmutableKey: inputs()[0].sanitizedKey,
    }])}\n`;
    expect(buildWorldReadModel(storedArtifact({ files: { [COLLECTION_SOURCE_MANIFEST]: fallbackShaped } }), COLLECTION)).toBeNull();
  });
});

/*
  The World UI, against the data range this fixture introduced (worldread CROSS-LANE 2).

  Three things changed shape for the renderers when a Core V2 World became readable: the
  predicates are `mentions` and `contradicts` rather than the fallback's three, object ids are
  68-76 characters instead of 39, and there is no `Topic` object at all. None of that is a
  contract change, so nothing would have failed to compile -- it is the kind of change that
  shows up as a blank filter, a mislabelled edge or a crash in front of a customer.

  Rendered to static markup, which is the first paint: the graph canvas derives its predicate
  filter from the edges it is handed, so the first paint is exactly where a missing predicate
  would be missing.
*/
describe("the World UI reads a Core V2 World", () => {
  const model = () => {
    const read = buildWorldReadModel(storedArtifact(), COLLECTION);
    if (!read) throw new Error("a promoted Core V2 World is still unreadable");
    return read;
  };

  const markup = (world: WorldReadModel) => renderToStaticMarkup(createElement(WorldGraphCanvas, {
    model: world,
    selectedObjectId: null,
    onObjectSelect: () => {},
  }));

  it("offers the Core's predicates as filters and labels the edge with the predicate", () => {
    const html = markup(model());
    expect(html).toContain("mentions");
    // The label is the predicate with its underscores spaced, never the raw id of either end.
    expect(html).not.toContain("relation-undefined");
    expect(html).toContain("evidence");
  });

  it("renders a contradicts relation rather than dropping it or mislabelling it", () => {
    /*
      The projection's `contradicts` edge is pinned in core-runtime-v2.test.ts; this is the
      renderer's half of the same question. It is added to the read model rather than to the
      fixture's Core response because a contradiction is between two claims and this corpus has
      one -- and inventing a second claim to satisfy a renderer test would put a fact in the
      fixture that the compiler never produced.
    */
    const read = model();
    const contradiction = {
      ...read.relations[0]!,
      id: "relation-contradiction-fixture",
      predicate: "contradicts",
    };
    const html = markup({ ...read, relations: [...read.relations, contradiction] });
    expect(html).toContain("contradicts");
    expect(html).toContain("mentions");
  });

  it("draws a World with no Topic object without inventing one", () => {
    const read = model();
    expect(read.objects.some((object) => object.type === "Topic")).toBe(false);
    const html = markup(read);
    expect(html).not.toContain(">Topic<");
    // The classes that are there still render, so an absent class is absent and not an error.
    for (const type of ["Claim", "Entity", "Document", "Evidence"]) expect(html).toContain(type);
  });

  it("keeps a 68-character Core id readable instead of printing it whole", () => {
    const read = model();
    expect(CLAIM.length).toBeGreaterThanOrEqual(68);
    const html = markup(read);
    // The canvas truncates its node labels at 28 characters, so the full id is never a label.
    expect(html).not.toContain(`>${CLAIM}<`);
    expect(html).toContain("Feedwater Pump 200");
  });

  it("reads the compiled ontology of a World whose classes are the Core's four", () => {
    const read = model();
    const html = renderToStaticMarkup(createElement(WorldOntologyViewer, { ontology: read.ontology }));
    expect(html).toContain("mentions");
    expect(html).not.toContain("No compiled ontology to read");
  });
});
