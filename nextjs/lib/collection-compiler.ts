import { createHash } from "node:crypto";
import { judgeCompileSet } from "./compile-limits";

export const COLLECTION_CANDIDATE_SCHEMA = "tavonel.collection_candidate.v1" as const;
export const GENERIC_MIXED_CORPUS_BLUEPRINT = {
  id: "generic-mixed-corpus",
  version: "1.0.0",
  roots: ["Sources", "Topics", "Entities", "Claims", "Evidence", "Assets", "MOCs", "Packages"],
  maximumDepth: 3,
  namingPolicy: "stable-id-title",
  preserveExistingFolders: true,
  ontologyClasses: ["Document", "Topic", "Entity", "Claim", "Evidence", "Asset"],
  ontologyRelations: ["discusses_topic", "mentions_entity", "supported_by"],
} as const;

const PACKAGE_ROOTS = [
  "source",
  "canonical",
  "obsidian",
  "ontology",
  "graph",
  "rag",
  "provenance",
  "validation",
] as const;
const MAX_TEXT_CHARS = 50_000;

export type CollectionOcrInput = {
  documentId: string;
  versionKey: string;
  sanitizedKey: string;
  ocrJsonKey: string;
  pageCount: number;
  text: string;
  inputSha256: string;
  sourceImmutableKey: string;
  regions?: CollectionOcrRegion[];
};

export type CollectionOcrRegion = {
  regionId: string;
  pageIndex0: number;
  pageNumber1: number;
  order: number;
  blockType: "paragraph";
  text: string;
  bbox1000: [number, number, number, number];
  confidence: number;
  authority: "unknown" | "informal" | "official" | "contractual";
};

type KnowledgeNode = {
  id: string;
  kind: "Document" | "Topic" | "Entity" | "Claim" | "Evidence";
  label: string;
  documentId?: string;
  evidenceIds: string[];
};

type KnowledgeEdge = {
  id: string;
  type: "discusses_topic" | "mentions_entity" | "supported_by";
  from: string;
  to: string;
  evidenceIds: string[];
};

export type CollectionCandidateArtifact = {
  schemaVersion: typeof COLLECTION_CANDIDATE_SCHEMA;
  executionAuthority: "tavonel-foundation-core-runtime-v1";
  lifecycle: "candidate" | "review_required";
  candidatePromotion: false;
  collectionId: string;
  manifestDigest: string;
  blueprint: typeof GENERIC_MIXED_CORPUS_BLUEPRINT;
  sourceDocuments: Array<{
    documentId: string;
    versionKey: string;
    sanitizedKey: string;
    ocrJsonKey: string;
    pageCount: number;
    textCharacters: number;
    inputSha256: string;
  }>;
  directoryPlan: Array<{ path: string; kind: string; sourceIds: string[] }>;
  ontology: {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
  };
  package: {
    roots: readonly string[];
    files: Array<{
      path: string;
      mediaType: string;
      sizeBytes: number;
      sha256: string;
      content: string;
    }>;
    signatureStatus: "external_signer_required";
  };
  validation: {
    status: "passed" | "review_required";
    deterministicMaterialization: true;
    sourceCoverage: true;
    evidenceCoverage: true;
    immutableInputsOnly: true;
    fullRebuildEquivalence?: "passed" | "failed" | "not_run";
    reviewReasons?: string[];
    counts: {
      documents: number;
      topics: number;
      entities: number;
      claims: number;
      evidence: number;
      relations: number;
      packageFiles: number;
    };
  };
  reviewReasons?: string[];
};

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}
export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}-${sha256(parts.join("\0")).slice(0, 32)}`;
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

function documentTitle(text: string, documentId: string) {
  const first = text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((item) => item.trim())
    .find((item) => item.length >= 4);
  return (first ?? `Document ${documentId.slice(0, 8)}`).slice(0, 96);
}

const TOPIC_RULES: Array<{ topic: string; pattern: RegExp }> = [
  { topic: "Finance", pattern: /\b(revenue|financial|income|expense|asset|liabilit|quarter|fiscal)\b|매출|재무|자산|부채|분기/i },
  { topic: "Governance", pattern: /\b(governance|board|policy|compliance|authority)\b|지배구조|이사회|정책|준수/i },
  { topic: "Security", pattern: /\b(security|privacy|access control|threat|risk)\b|보안|개인정보|접근\s*통제|위험/i },
  { topic: "Accessibility", pattern: /\b(accessibility|accessible|wcag|w3c)\b|접근성/i },
  { topic: "Research", pattern: /\b(research|experiment|method|result|evaluation)\b|연구|실험|방법|평가/i },
];

function topicsFor(text: string) {
  const matched = TOPIC_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.topic);
  return matched.length > 0 ? matched.slice(0, 3) : ["General"];
}

function entitiesFor(text: string) {
  const values = text.match(/\b[A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3}\b/g) ?? [];
  return [...new Set(values.map((item) => item.trim()).filter((item) => item.length <= 80))].slice(0, 8);
}

function claimsFor(text: string) {
  return [...new Set(
    text
      .split(/(?<=[.!?。])\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 20 && item.length <= 500),
  )].slice(0, 4);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeForMatch(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function mediaType(path: string) {
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".ttl")) return "text/turtle; charset=utf-8";
  if (path.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (path.endsWith(".jsonld")) return "application/ld+json";
  if (path.endsWith(".jsonl")) return "application/x-ndjson";
  return "application/json";
}

export type LabelDerivedInput = {
  collectionId: string;
  nodes: readonly KnowledgeNode[];
  edges: readonly KnowledgeEdge[];
  inputBinding: ReadonlyArray<{
    documentId: string;
    versionKey: string;
    inputSha256: string;
    sourceImmutableKey: string;
  }>;
};

/*
  Every package file whose content depends on a node label, produced in one place.

  Four files embed labels: the canonical model, the Turtle and JSON-LD serialisations, and the
  node CSV. They used to be written inline in the compiler, which was fine while the compiler
  was the only thing that produced an artifact. A reviewer editing a label produces one too --
  a new candidate, never a mutation of the old one -- and if that path regenerated three of
  the four, the artifact would be internally inconsistent while still validating: the graph
  would say one thing and the RDF another, with a digest over both.

  Note what is *not* here. `rag/chunks.jsonl` and the Obsidian source markdown carry document
  text, not node labels. An edited claim label does not rewrite what the page said, and it
  must not: the excerpt is evidence of the source, and the label is the compiled assertion
  about it. Those are different things and only one of them is a reviewer's to change.
*/
export function materializeLabelDerivedFiles(input: LabelDerivedInput) {
  const { collectionId, nodes, edges, inputBinding } = input;
  const canonicalModel = {
    schemaVersion: "akc.canonical-knowledge-model.v1",
    collectionId,
    blueprint: GENERIC_MIXED_CORPUS_BLUEPRINT,
    nodes,
    edges,
    inputBinding,
  };
  const ttl = [
    "@prefix tav: <urn:tavonel:> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "@prefix prov: <http://www.w3.org/ns/prov#> .",
    "",
    ...nodes.map((node) => `<urn:tavonel:${node.id}> a tav:${node.kind} ; rdfs:label ${JSON.stringify(node.label)} .`),
    ...edges.map((edge) => `<urn:tavonel:${edge.from}> tav:${edge.type} <urn:tavonel:${edge.to}> .`),
    "",
  ].join("\n");
  const jsonld = JSON.stringify({
    "@context": {
      "@vocab": "urn:tavonel:",
      label: "http://www.w3.org/2000/01/rdf-schema#label",
      evidence: "http://www.w3.org/ns/prov#wasDerivedFrom",
    },
    "@graph": nodes.map((node) => ({ "@id": `urn:tavonel:${node.id}`, "@type": node.kind, label: node.label, evidence: node.evidenceIds })),
  }, null, 2) + "\n";
  const nodeCsv = ["id,label,name,document_id", ...nodes.map((node) => [node.id, node.kind, node.label, node.documentId ?? ""].map(csvCell).join(","))].join("\n") + "\n";
  const edgeCsv = ["id,subject_id,predicate,object_id,evidence_ids", ...edges.map((edge) => [edge.id, edge.from, edge.type, edge.to, edge.evidenceIds.join("|")].map(csvCell).join(","))].join("\n") + "\n";

  return {
    canonicalModel: packageFile("canonical/model.json", JSON.stringify(canonicalModel, null, 2) + "\n"),
    turtle: packageFile("ontology/knowledge.ttl", ttl),
    jsonld: packageFile("ontology/knowledge.jsonld", jsonld),
    nodeCsv: packageFile("graph/nodes.csv", nodeCsv),
    edgeCsv: packageFile("graph/relationships.csv", edgeCsv),
  };
}

function packageFile(path: string, content: string) {
  return {
    path,
    mediaType: mediaType(path),
    sizeBytes: Buffer.byteLength(content, "utf8"),
    sha256: `sha256:${sha256(content)}`,
    content,
  };
}

export function validateCollectionOcrInput(value: unknown): CollectionOcrInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.documentId !== "string" ||
    typeof input.versionKey !== "string" ||
    typeof input.sanitizedKey !== "string" ||
    typeof input.ocrJsonKey !== "string" ||
    typeof input.text !== "string" ||
    typeof input.pageCount !== "number" ||
    !Number.isInteger(input.pageCount) ||
    input.pageCount < 1 ||
    typeof input.inputSha256 !== "string" ||
    typeof input.sourceImmutableKey !== "string" ||
    input.sourceImmutableKey !== input.sanitizedKey ||
    input.inputSha256.toLowerCase() !== `sha256:${input.versionKey.toLowerCase()}`
  ) {
    return null;
  }
  if (input.regions !== undefined) {
    if (!Array.isArray(input.regions) || input.regions.length < 1 || input.regions.length > 50_000) return null;
    const ids = new Set<string>();
    const orders = new Set<number>();
    const authorities = new Set(["unknown", "informal", "official", "contractual"]);
    for (const rawRegion of input.regions) {
      if (!rawRegion || typeof rawRegion !== "object") return null;
      const region = rawRegion as Record<string, unknown>;
      const bbox = region.bbox1000;
      if (
        typeof region.regionId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(region.regionId) ||
        ids.has(region.regionId) ||
        !Number.isInteger(region.pageIndex0) ||
        Number(region.pageIndex0) < 0 ||
        Number(region.pageIndex0) >= Number(input.pageCount) ||
        region.pageNumber1 !== Number(region.pageIndex0) + 1 ||
        !Number.isInteger(region.order) ||
        Number(region.order) < 0 ||
        orders.has(Number(region.order)) ||
        region.blockType !== "paragraph" ||
        typeof region.text !== "string" ||
        region.text.trim().length < 1 ||
        !Array.isArray(bbox) ||
        bbox.length !== 4 ||
        bbox.some((coordinate) => !Number.isInteger(coordinate) || coordinate < 0 || coordinate > 1000) ||
        Number(bbox[0]) >= Number(bbox[2]) ||
        Number(bbox[1]) >= Number(bbox[3]) ||
        typeof region.confidence !== "number" ||
        !Number.isFinite(region.confidence) ||
        region.confidence < 0 ||
        region.confidence > 1 ||
        typeof region.authority !== "string" ||
        !authorities.has(region.authority)
      ) return null;
      ids.add(region.regionId);
      orders.add(Number(region.order));
    }
    if (input.regions.some((_region, index) => !orders.has(index))) return null;
    if (input.text !== input.regions.map((region) => (region as Record<string, unknown>).text).join("\n").trim()) return null;
  }
  return input as CollectionOcrInput;
}

export function compileCollectionCandidate(inputs: CollectionOcrInput[]): CollectionCandidateArtifact {
  // One document is a world. The old floor of two was a compiler implementation detail that
  // reached the customer as "upload succeeded, nothing was built". The ceiling is shared with
  // the route and the workspace so a selection cannot pass one check and fail the next.
  if (!judgeCompileSet(inputs.length).ok) {
    throw new Error("collection_document_count_out_of_bounds");
  }
  const sorted = [...inputs].sort((left, right) =>
    `${left.documentId}/${left.versionKey}`.localeCompare(`${right.documentId}/${right.versionKey}`),
  );
  if (new Set(sorted.map((item) => item.documentId)).size !== sorted.length) {
    throw new Error("collection_document_id_duplicate");
  }

  const inputBinding = sorted.map((item) => ({
    documentId: item.documentId,
    versionKey: item.versionKey.toLowerCase(),
    inputSha256: item.inputSha256.toLowerCase(),
    sourceImmutableKey: item.sourceImmutableKey,
  }));
  const collectionId = stableId("collection", canonicalize(inputBinding));
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const directoryPlan: Array<{ path: string; kind: string; sourceIds: string[] }> = [
    { path: "Sources", kind: "root", sourceIds: [] },
    { path: "Topics", kind: "root", sourceIds: [] },
    { path: "Entities", kind: "root", sourceIds: [] },
    { path: "Claims", kind: "root", sourceIds: [] },
    { path: "Evidence", kind: "root", sourceIds: [] },
    { path: "Assets", kind: "root", sourceIds: [] },
    { path: "MOCs", kind: "root", sourceIds: [] },
    { path: "Packages", kind: "root", sourceIds: [] },
  ];
  const topicIds = new Map<string, string>();
  const entityIds = new Map<string, string>();
  const sourceMarkdown: Array<{ documentId: string; title: string; text: string }> = [];
  const groundedChunks: Array<{
    chunkId: string;
    logicalId: string;
    text: string;
    sourceId: string;
    sourceVersionId: string;
    evidenceId: string;
    pageNumber1: number;
    bbox1000: [number, number, number, number];
    authority: string;
    claimIds: string[];
    entityIds: string[];
    entityNames: string[];
  }> = [];

  for (const input of sorted) {
    const text = normalizeText(input.text);
    const title = documentTitle(text, input.documentId);
    const evidenceId = stableId("evidence", input.documentId, input.versionKey);
    const documentNodeId = stableId("document", input.documentId, input.versionKey);
    nodes.push({ id: evidenceId, kind: "Evidence", label: input.ocrJsonKey, documentId: input.documentId, evidenceIds: [evidenceId] });
    nodes.push({ id: documentNodeId, kind: "Document", label: title, documentId: input.documentId, evidenceIds: [evidenceId] });
    directoryPlan.push({ path: `Sources/${input.documentId}.md`, kind: "document", sourceIds: [input.documentId] });
    directoryPlan.push({ path: `Evidence/${evidenceId}.json`, kind: "evidence", sourceIds: [input.documentId] });
    sourceMarkdown.push({ documentId: input.documentId, title, text });

    for (const topic of topicsFor(text)) {
      const topicId = topicIds.get(topic) ?? stableId("topic", topic);
      if (!topicIds.has(topic)) {
        topicIds.set(topic, topicId);
        nodes.push({ id: topicId, kind: "Topic", label: topic, evidenceIds: [evidenceId] });
        directoryPlan.push({ path: `Topics/${topic}.md`, kind: "topic", sourceIds: [input.documentId] });
      } else {
        const node = nodes.find((item) => item.id === topicId);
        if (node && !node.evidenceIds.includes(evidenceId)) node.evidenceIds.push(evidenceId);
        const entry = directoryPlan.find((item) => item.path === `Topics/${topic}.md`);
        if (entry && !entry.sourceIds.includes(input.documentId)) entry.sourceIds.push(input.documentId);
      }
      edges.push({
        id: stableId("relation", documentNodeId, "discusses_topic", topicId),
        type: "discusses_topic",
        from: documentNodeId,
        to: topicId,
        evidenceIds: [evidenceId],
      });
    }

    const documentEntities: Array<{ id: string; text: string }> = [];
    for (const entity of entitiesFor(text)) {
      const entityId = entityIds.get(entity) ?? stableId("entity", entity.toLowerCase());
      if (!entityIds.has(entity)) {
        entityIds.set(entity, entityId);
        nodes.push({ id: entityId, kind: "Entity", label: entity, evidenceIds: [evidenceId] });
        directoryPlan.push({ path: `Entities/${entityId}.md`, kind: "entity", sourceIds: [input.documentId] });
      }
      edges.push({
        id: stableId("relation", documentNodeId, "mentions_entity", entityId),
        type: "mentions_entity",
        from: documentNodeId,
        to: entityId,
        evidenceIds: [evidenceId],
      });
      documentEntities.push({ id: entityId, text: entity });
    }

    const documentClaims: Array<{ id: string; text: string }> = [];
    for (const claim of claimsFor(text)) {
      const claimId = stableId("claim", input.documentId, claim);
      nodes.push({ id: claimId, kind: "Claim", label: claim, documentId: input.documentId, evidenceIds: [evidenceId] });
      directoryPlan.push({ path: `Claims/${claimId}.md`, kind: "claim", sourceIds: [input.documentId] });
      edges.push({
        id: stableId("relation", claimId, "supported_by", evidenceId),
        type: "supported_by",
        from: claimId,
        to: evidenceId,
        evidenceIds: [evidenceId],
      });
      documentClaims.push({ id: claimId, text: claim });
    }

    // Grounded retrieval requires page/bbox evidence per chunk (see GroundedChunk in
    // grounded-ask.ts). Only OCR v2 regions carry that evidence, so a document compiled
    // without regions produces zero rag chunks (honest abstention) rather than a
    // fabricated page/bbox.
    for (const region of input.regions ?? []) {
      const regionText = normalizeForMatch(region.text);
      const regionClaimIds = documentClaims.filter((claim) => regionText.includes(normalizeForMatch(claim.text))).map((claim) => claim.id);
      const regionEntities = documentEntities.filter((entity) => regionText.includes(normalizeForMatch(entity.text)));
      groundedChunks.push({
        chunkId: stableId("chunk", input.documentId, input.versionKey, region.regionId),
        logicalId: stableId("chunk-logical", input.documentId, region.regionId),
        text: region.text,
        sourceId: input.documentId,
        sourceVersionId: input.versionKey,
        evidenceId,
        pageNumber1: region.pageNumber1,
        bbox1000: region.bbox1000,
        authority: region.authority,
        claimIds: regionClaimIds,
        entityIds: regionEntities.map((entity) => entity.id),
        entityNames: regionEntities.map((entity) => entity.text),
      });
    }
  }

  directoryPlan.push({ path: "MOCs/Home.md", kind: "map-of-content", sourceIds: sorted.map((item) => item.documentId) });
  directoryPlan.push({ path: "Packages/knowledge-package.json", kind: "package", sourceIds: sorted.map((item) => item.documentId) });

  const home = `# TAVONEL Candidate Knowledge Package\n\n${sourceMarkdown.map((item) => `- [[Sources/${item.documentId}|${item.title}]]`).join("\n")}\n`;
  const labelDerived = materializeLabelDerivedFiles({ collectionId, nodes, edges, inputBinding });
  const ragDocuments = sourceMarkdown.map((item) => JSON.stringify({ documentId: item.documentId, title: item.title })).join("\n") + "\n";
  const ragChunks = groundedChunks.map((chunk) => JSON.stringify(chunk)).join("\n") + (groundedChunks.length > 0 ? "\n" : "");
  const evidenceEvents = sorted.map((item, index) => JSON.stringify({ sequence: index + 1, type: "document.ocr.verified", documentId: item.documentId, ocrJsonKey: item.ocrJsonKey, inputSha256: item.inputSha256 })).join("\n") + "\n";

  const files = [
    packageFile("source/collection-files.json", JSON.stringify(inputBinding, null, 2) + "\n"),
    labelDerived.canonicalModel,
    packageFile("obsidian/Home.md", home),
    ...sourceMarkdown.map((item) => packageFile(`obsidian/Sources/${item.documentId}.md`, `---\ndocument_id: ${item.documentId}\n---\n\n# ${item.title}\n\n${item.text}\n`)),
    labelDerived.turtle,
    labelDerived.jsonld,
    labelDerived.nodeCsv,
    labelDerived.edgeCsv,
    packageFile("rag/documents.jsonl", ragDocuments),
    packageFile("rag/chunks.jsonl", ragChunks),
    packageFile("provenance/activities.jsonl", evidenceEvents),
  ];
  const counts = {
    documents: sorted.length,
    topics: nodes.filter((node) => node.kind === "Topic").length,
    entities: nodes.filter((node) => node.kind === "Entity").length,
    claims: nodes.filter((node) => node.kind === "Claim").length,
    evidence: nodes.filter((node) => node.kind === "Evidence").length,
    relations: edges.length,
    packageFiles: files.length + 1,
  };
  files.push(packageFile("validation/report.json", JSON.stringify({ status: "passed", counts, checks: { deterministicMaterialization: true, sourceCoverage: true, evidenceCoverage: true, immutableInputsOnly: true } }, null, 2) + "\n"));

  const withoutDigest = {
    schemaVersion: COLLECTION_CANDIDATE_SCHEMA,
    executionAuthority: "tavonel-foundation-core-runtime-v1" as const,
    lifecycle: "candidate" as const,
    candidatePromotion: false as const,
    collectionId,
    blueprint: GENERIC_MIXED_CORPUS_BLUEPRINT,
    sourceDocuments: sorted.map((item) => ({
      documentId: item.documentId,
      versionKey: item.versionKey.toLowerCase(),
      sanitizedKey: item.sanitizedKey,
      ocrJsonKey: item.ocrJsonKey,
      pageCount: item.pageCount,
      textCharacters: normalizeText(item.text).length,
      inputSha256: item.inputSha256.toLowerCase(),
    })),
    directoryPlan,
    ontology: { nodes, edges },
    package: { roots: PACKAGE_ROOTS, files, signatureStatus: "external_signer_required" as const },
    validation: {
      status: "passed" as const,
      deterministicMaterialization: true as const,
      sourceCoverage: true as const,
      evidenceCoverage: true as const,
      immutableInputsOnly: true as const,
      counts,
    },
  };
  return { ...withoutDigest, manifestDigest: `sha256:${sha256(canonicalize(withoutDigest))}` };
}
