import { validateReviewableCollectionArtifact } from "./collection-download";
import { loadPreferredCollectionCandidate } from "./collection-storage";
import { COLLECTION_ID_PATTERN } from "./immutable-keys";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import {
  coreCollectionSourceBinding,
  collectionSourceDocumentIds,
  type CollectionSourceBinding,
} from "./collection-source-access";
import { checkConnectorSourceAccess } from "./connector-source-access";
import {
  EMPTY_WORLD_FRESHNESS,
  getFoundationActiveWorld,
  getWorldFreshness,
  listFoundationWorldVersions,
  type WorldFreshness,
  type WorldVersionRow,
} from "./world-store";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
/*
  Both engines' identifiers pass this, and that is worth stating rather than discovering.

  `akc_cir.identity` writes `<prefix>_<sha256 hex>` -- `src_`, `dv_`, `ev_`, `ku_`, and
  `akc_product_core`'s `ko_evidence_`, `claim_`, `entity_`, `relation_`, `chunk_` -- while the
  TypeScript fallback compiler writes `<prefix>-<hex>`. The character class admits both, so a
  shape check here never distinguishes the two namespaces: what separates them is which field
  an id is *resolved* against, which is what the source binding and the evidence namespace
  below are for.
*/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const NODE_KINDS = new Set(["Document", "Topic", "Entity", "Claim", "Evidence"]);

export type ReadValue<T> =
  | { state: "read"; value: T }
  | { state: "not_yet"; reason: string };

export type WorldFactStatus = "active" | "candidate" | "research";
export type WorldObjectType = "Document" | "Topic" | "Entity" | "Claim" | "Evidence";

export type WorldEvidence = {
  id: string;
  sourceId: string;
  sourceVersionId: string;
  page: number;
  bbox: [number, number, number, number];
  blockId: string;
  excerpt: string;
  authority: string;
  digest: string;
};

export type SelectedWorldEvidence = Pick<
  WorldEvidence,
  "id" | "sourceId" | "sourceVersionId" | "page" | "bbox" | "blockId" | "digest"
>;

export type WorldObject = {
  id: string;
  stableKey: string;
  label: string;
  type: WorldObjectType;
  status: Exclude<WorldFactStatus, "research">;
  aliases: ReadValue<string[]>;
  claims: string[];
  relations: string[];
  evidenceRefs: string[];
  sourceVersions: string[];
  firstSeen: ReadValue<string>;
  lastChanged: ReadValue<string>;
  readState: "read" | "not_yet";
};

export type WorldRelation = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  evidenceRefs: string[];
  version: string;
  status: Exclude<WorldFactStatus, "research">;
};

export type WorldFile = {
  path: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
};

/*
  The semantic directory the compiler actually planned.

  Not a grouping of objects by their type. The compiler emits a path-shaped plan -- Sources,
  Topics, Entities, Claims, Evidence, Assets, MOCs, Packages, with a leaf per compiled record
  -- and each leaf names the documents it came from. Grouping objects by `type` in the UI
  produced something that looked like this and was not: it could not show an empty root, could
  not show a path, and could not say which sources a folder was derived from.
*/
export type WorldDirectoryEntry = {
  path: string;
  kind: string;
  sourceIds: string[];
};

/**
 * The compiled ontology, described by what the artifact contains rather than by a template.
 *
 * `subclassOf` is absent on purpose. The compiled ontology declares no subclass axioms, and a
 * hierarchy invented for the sake of drawing a tree would be exactly the fabricated data this
 * repository forbids. The viewer says so instead.
 */
export type WorldOntologyClass = {
  name: WorldObjectType;
  instances: number;
  /** Instances carrying at least one evidence reference. */
  withEvidence: number;
};

export type WorldOntologyProperty = {
  name: string;
  usages: number;
  /** Observed, not declared: the object types this predicate was actually used between. */
  domain: WorldObjectType[];
  range: WorldObjectType[];
  withEvidence: number;
};

export type WorldOntology = {
  classes: WorldOntologyClass[];
  properties: WorldOntologyProperty[];
  hierarchy: ReadValue<never>;
  /** Where this ontology leaves the product, by package path. */
  exports: Array<{ path: string; mediaType: string; sha256: string }>;
};

export type WorldHistoryEntry = {
  version: string;
  manifestDigest: string;
  status: "active" | "candidate" | "superseded";
  activatedAt: ReadValue<string>;
  activationCount: ReadValue<number>;
};

export type ReviewImpactContract = {
  state: "read" | "not_yet";
  affectedObjectIds: string[];
  claims: ReadValue<number>;
  relations: ReadValue<number>;
  answerCaches: ReadValue<number>;
  activeWorldObjects: ReadValue<0>;
  researchImpactPath: {
    status: "research";
    state: "not_yet";
    reason: string;
  };
};

export type ReviewReceiptContract =
  | {
      state: "recorded";
      receiptId: string;
      actor: string;
      recordedAt: string;
      sourceVersionId: string;
      action: string;
      affectedObjectIds: string[];
    }
  | { state: "not_yet"; reason: string };

export type ReviewReadModel = {
  state: "read" | "not_yet";
  reasons: string[];
  evidenceRefs: string[];
  impact: ReviewImpactContract;
  receipt: ReviewReceiptContract;
};

export type WorldReadModel = {
  schemaVersion: "tavonel.world_read_model.v1";
  contract: {
    origin: "compiled_artifact" | "deterministic_sample";
    deterministicSample: boolean;
    realObjectsOnly: true;
    missingData: "not_yet";
  };
  world: {
    id: string;
    manifestDigest: string;
    status: Exclude<WorldFactStatus, "research">;
    revision: ReadValue<number>;
  };
  /*
    Four clocks, kept apart (audit TM04).

    "Current" is four different instants -- when the bytes were observed, when the compile
    settled, when a person answered a blocker, when a person activated the result -- and a
    consumer reading the previous active World while a newer version waits has no way to know
    it unless they are told. `candidateAwaitingActivation` is that signal. Every field is read
    from an existing column; a null is a value that is not recorded, never a substitute drawn
    from a neighbouring clock. See getWorldFreshness in world-store.ts.
  */
  freshness: WorldFreshness;
  objects: WorldObject[];
  relations: WorldRelation[];
  evidence: WorldEvidence[];
  directory: WorldDirectoryEntry[];
  ontology: WorldOntology;
  history: WorldHistoryEntry[];
  files: WorldFile[];
  signature: ReadValue<"verified">;
  review: ReviewReadModel;
};

export function selectWorldEvidence(
  model: WorldReadModel | null,
  evidenceId: string | null,
): SelectedWorldEvidence | null {
  if (!model || !evidenceId) return null;
  const evidence = model.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return null;
  return {
    id: evidence.id,
    sourceId: evidence.sourceId,
    sourceVersionId: evidence.sourceVersionId,
    page: evidence.page,
    bbox: [...evidence.bbox],
    blockId: evidence.blockId,
    digest: evidence.digest,
  };
}

type BuildContext = {
  activeManifestDigest?: string | null;
  activeRevision?: number | null;
  versions?: WorldVersionRow[];
  origin?: "compiled_artifact" | "deterministic_sample";
  freshness?: WorldFreshness;
};

type CanonicalNode = {
  id: string;
  kind: WorldObjectType;
  label: string;
  evidenceIds: string[];
};

type CanonicalEdge = {
  id: string;
  type: string;
  from: string;
  to: string;
  evidenceIds: string[];
};

/*
  One compiled source, in both namespaces. Defined in `collection-source-access.ts` because the
  permission check and this read model have to agree on which documents a World was compiled
  from, and a second copy of the translation is a second answer to that question.

  `documentId`/`versionKey` are the ids the package's own rows cite; `productDocumentId`/
  `productVersionKey` are the same source as the document store, `/api/documents/<id>/source` and
  the connector ACL know it. The pairs are the same strings for a fallback-compiled package and
  are not for a Core one, where the join between them is the immutable content digest.
*/
type SourceBinding = CollectionSourceBinding;

type CanonicalModel = {
  collectionId: string;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  inputBinding: SourceBinding[];
  /*
    The evidence-id namespace an edge, a node and a chunk row may cite.

    The fallback compiler gives an Evidence node the same string for its id and its evidence
    ref, so one set served both. The Core does not: an Evidence object's `stableId` is
    `ko_evidence_<hex>` while its `payload.evidenceId` -- the string `rag/chunks.jsonl`,
    `retrieval-units.ts` and every edge use -- is `ev_<hex>`. So the namespace is stated once
    here instead of being re-derived from node ids at each use.
  */
  evidenceIds: Set<string>;
};

function notYet<T>(reason: string): ReadValue<T> {
  return { state: "not_yet", reason };
}

function read<T>(value: T): ReadValue<T> {
  return { state: "read", value };
}

function isStringArray(value: unknown, max = 50_000): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && SAFE_ID.test(item));
}

function parseCanonicalModel(content: string, collectionId: string): CanonicalModel | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const model = value as Record<string, unknown>;
  if (model.collectionId !== collectionId || !Array.isArray(model.nodes) || !Array.isArray(model.edges) || !Array.isArray(model.inputBinding)) return null;

  const nodes: CanonicalNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of model.nodes) {
    if (!raw || typeof raw !== "object") return null;
    const node = raw as Record<string, unknown>;
    if (
      typeof node.id !== "string" || !SAFE_ID.test(node.id) || nodeIds.has(node.id) ||
      typeof node.kind !== "string" || !NODE_KINDS.has(node.kind) ||
      typeof node.label !== "string" || node.label.trim().length === 0 || node.label.length > 2_000 ||
      !isStringArray(node.evidenceIds)
    ) return null;
    nodeIds.add(node.id);
    nodes.push({ id: node.id, kind: node.kind as WorldObjectType, label: node.label, evidenceIds: [...node.evidenceIds] });
  }

  const evidenceNodeIds = new Set(nodes.filter((node) => node.kind === "Evidence").map((node) => node.id));
  const edges: CanonicalEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of model.edges) {
    if (!raw || typeof raw !== "object") return null;
    const edge = raw as Record<string, unknown>;
    if (
      typeof edge.id !== "string" || !SAFE_ID.test(edge.id) || edgeIds.has(edge.id) ||
      typeof edge.type !== "string" || !SAFE_ID.test(edge.type) ||
      typeof edge.from !== "string" || !nodeIds.has(edge.from) ||
      typeof edge.to !== "string" || !nodeIds.has(edge.to) ||
      !isStringArray(edge.evidenceIds) || edge.evidenceIds.some((id) => !evidenceNodeIds.has(id))
    ) return null;
    edgeIds.add(edge.id);
    edges.push({ id: edge.id, type: edge.type, from: edge.from, to: edge.to, evidenceIds: [...edge.evidenceIds] });
  }

  const inputBinding: SourceBinding[] = [];
  const sourceIds = new Set<string>();
  for (const raw of model.inputBinding) {
    if (!raw || typeof raw !== "object") return null;
    const binding = raw as Record<string, unknown>;
    if (
      typeof binding.documentId !== "string" || !SAFE_ID.test(binding.documentId) || sourceIds.has(binding.documentId) ||
      typeof binding.versionKey !== "string" || !/^[a-f0-9]{64}$/.test(binding.versionKey) ||
      typeof binding.inputSha256 !== "string" || !SHA256.test(binding.inputSha256) ||
      binding.inputSha256 !== `sha256:${binding.versionKey}`
    ) return null;
    sourceIds.add(binding.documentId);
    inputBinding.push({
      documentId: binding.documentId,
      versionKey: binding.versionKey,
      inputSha256: binding.inputSha256,
      // This package's rows are already in the product's namespace; the two are one string.
      productDocumentId: binding.documentId,
      productVersionKey: binding.versionKey,
    });
  }

  if (nodes.some((node) => node.evidenceIds.some((id) => !evidenceNodeIds.has(id)))) return null;
  return { collectionId, nodes, edges, inputBinding, evidenceIds: evidenceNodeIds };
}

/**
 * Read the compiled graph off the artifact when `canonical/model.json` is not the fallback's.
 *
 * Audit R3-K09's second half. Core V2 writes the canonical *knowledge model* at that path --
 * `{schemaVersion: "canonical-knowledge-1.0.0", tenantId, collectionId, objects}` -- so
 * `parseCanonicalModel` refuses it, `buildWorldReadModel` returns null and
 * `/api/collections/[id]/world` answers WORLD_READ_MODEL_INVALID for every World the live engine
 * compiled. The nodes and edges exist: `projectProductCoreV2Candidate` already computed them and
 * they are on the artifact as `ontology`, which is also what the graph CSVs, the download package
 * and `collection-patch.ts` read. So this reads the same field, with the same checks the
 * canonical-model parser applies, and refuses on anything that does not resolve.
 *
 * It is a second reader rather than a relaxation of the first, because the first is what keeps a
 * fallback-compiled package honest: its canonical model is a signed package file, and accepting
 * an artifact whose package file disagrees with its own `ontology` would make the file
 * decorative. Here the package file is a different document, not a disagreeing one.
 */
function parseProjectedKnowledgeModel(value: unknown, collectionId: string): CanonicalModel | null {
  if (!value || typeof value !== "object") return null;
  const artifact = value as Record<string, unknown>;
  const ontology = artifact.ontology && typeof artifact.ontology === "object"
    ? artifact.ontology as Record<string, unknown>
    : null;
  if (!ontology || !Array.isArray(ontology.nodes) || !Array.isArray(ontology.edges)) return null;
  /*
    The source binding comes from the one place a Core package names its sources, and it is
    read by the module the permission check already reads it with.

    `source/collection-files.json` names them in the Core's identity scheme; the chunk rows cite
    the same ids; the product's document store does not know them. So the binding carries both
    namespaces, joined on the content digest -- and it is `collection-source-access.ts` that owns
    that join, because the ACL list has to be the same translation or the two disagree about
    which documents this World was compiled from.
  */
  const inputBinding = coreCollectionSourceBinding(artifact);
  if (!inputBinding) return null;

  const nodes: CanonicalNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of ontology.nodes) {
    if (!raw || typeof raw !== "object") return null;
    const node = raw as Record<string, unknown>;
    if (
      typeof node.id !== "string" || !SAFE_ID.test(node.id) || nodeIds.has(node.id) ||
      typeof node.kind !== "string" || !NODE_KINDS.has(node.kind) ||
      typeof node.label !== "string" || node.label.trim().length === 0 || node.label.length > 2_000 ||
      !isStringArray(node.evidenceIds)
    ) return null;
    nodeIds.add(node.id);
    nodes.push({ id: node.id, kind: node.kind as WorldObjectType, label: node.label, evidenceIds: [...node.evidenceIds] });
  }

  /*
    An Evidence node resolves under either of its two names, and nothing else resolves at all.

    The Core's convention is that an Evidence object's `stableId` is the node id and its
    `payload.evidenceId` is the string the edges, the retrieval units and `rag/chunks.jsonl`
    cite. Accepting both is the whole relaxation; an id that is neither still refuses the read,
    which is what keeps a dangling evidence reference a refusal rather than an empty citation.
    Rewriting the Core's edge evidence to node ids instead was the alternative and is wrong:
    `retrieval-units.ts` and the chunk file are in the `payload.evidenceId` namespace, so the
    rewrite would disconnect an answer's citation from the World's.
  */
  const evidenceIds = new Set(
    nodes.filter((node) => node.kind === "Evidence").flatMap((node) => [node.id, ...node.evidenceIds]),
  );
  if (nodes.some((node) => node.evidenceIds.some((id) => !evidenceIds.has(id)))) return null;

  const edges: CanonicalEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of ontology.edges) {
    if (!raw || typeof raw !== "object") return null;
    const edge = raw as Record<string, unknown>;
    if (
      typeof edge.id !== "string" || !SAFE_ID.test(edge.id) || edgeIds.has(edge.id) ||
      typeof edge.type !== "string" || !SAFE_ID.test(edge.type) ||
      typeof edge.from !== "string" || !nodeIds.has(edge.from) ||
      typeof edge.to !== "string" || !nodeIds.has(edge.to) ||
      !isStringArray(edge.evidenceIds) || edge.evidenceIds.some((id) => !evidenceIds.has(id))
    ) return null;
    edgeIds.add(edge.id);
    edges.push({ id: edge.id, type: edge.type, from: edge.from, to: edge.to, evidenceIds: [...edge.evidenceIds] });
  }

  return { collectionId, nodes, edges, inputBinding, evidenceIds };
}

function validBbox(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000) && value[0] < value[2] && value[1] < value[3];
}

function parseEvidence(content: string, model: CanonicalModel): WorldEvidence[] | null {
  const sourceById = new Map(model.inputBinding.map((binding) => [binding.documentId, binding]));
  const evidenceIds = model.evidenceIds;
  const result: WorldEvidence[] = [];
  const ids = new Set<string>();
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return null;
    }
    if (!raw || typeof raw !== "object") return null;
    const chunk = raw as Record<string, unknown>;
    const source = typeof chunk.sourceId === "string" ? sourceById.get(chunk.sourceId) : undefined;
    if (
      typeof chunk.chunkId !== "string" || !SAFE_ID.test(chunk.chunkId) || ids.has(chunk.chunkId) ||
      !source || chunk.sourceVersionId !== source.versionKey ||
      typeof chunk.evidenceId !== "string" || !evidenceIds.has(chunk.evidenceId) ||
      !Number.isInteger(chunk.pageNumber1) || Number(chunk.pageNumber1) < 1 ||
      !validBbox(chunk.bbox1000) || typeof chunk.text !== "string" || chunk.text.trim().length === 0 ||
      typeof chunk.authority !== "string" || chunk.authority.length === 0
    ) return null;
    ids.add(chunk.chunkId);
    result.push({
      id: `${chunk.evidenceId}:${chunk.chunkId}`,
      /*
        The product's ids, not the row's.

        The two are the same string for a fallback-compiled package. For a Core one the row
        carries `src_`/`dv_`, and `world-studio-ultimate.tsx` opens the cited page with
        `/api/documents/<sourceId>/source?version=<sourceVersionId>` -- so publishing the Core's
        ids here would render a World whose every citation silently fails to open.
      */
      sourceId: source.productDocumentId,
      sourceVersionId: source.productVersionKey,
      page: chunk.pageNumber1 as number,
      bbox: chunk.bbox1000,
      blockId: chunk.chunkId,
      excerpt: chunk.text,
      authority: chunk.authority,
      digest: source.inputSha256,
    });
  }
  return result;
}

function reviewModel(reasons: string[], model: CanonicalModel, evidence: WorldEvidence[]): ReviewReadModel {
  if (reasons.length === 0) {
    return {
      state: "not_yet",
      reasons: [],
      evidenceRefs: [],
      impact: {
        state: "not_yet",
        affectedObjectIds: [],
        claims: notYet("No review decision is pending."),
        relations: notYet("No review decision is pending."),
        answerCaches: notYet("Answer-cache impact is not materialized in the compiled artifact."),
        activeWorldObjects: read(0),
        researchImpactPath: { status: "research", state: "not_yet", reason: "Selective impact-aware recompilation is a research lens, not a compiled fact." },
      },
      receipt: { state: "not_yet", reason: "No review decision has been recorded." },
    };
  }
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const edgeIds = new Set(model.edges.map((edge) => edge.id));
  const tokens = new Set(reasons.flatMap((reason) => reason.split(/[^A-Za-z0-9._:-]+/).filter(Boolean)));
  const affectedObjectIds = [...tokens].filter((id) => nodeIds.has(id) || edgeIds.has(id)).sort();
  const claimCount = affectedObjectIds.filter((id) => model.nodes.some((node) => node.id === id && node.kind === "Claim")).length;
  const relationCount = affectedObjectIds.filter((id) => edgeIds.has(id)).length;
  const evidenceRefs = [...new Set(affectedObjectIds.flatMap((id) => {
    const node = model.nodes.find((item) => item.id === id);
    const edge = model.edges.find((item) => item.id === id);
    return [...(node?.evidenceIds ?? []), ...(edge?.evidenceIds ?? [])];
  }).flatMap((evidenceId) => evidence.filter((item) => item.id.startsWith(`${evidenceId}:`)).map((item) => item.id)))];
  const hasBindings = affectedObjectIds.length > 0;
  return {
    state: "read",
    reasons,
    evidenceRefs,
    impact: {
      state: hasBindings ? "read" : "not_yet",
      affectedObjectIds,
      claims: hasBindings ? read(claimCount) : notYet("Review reason has no compiled claim binding."),
      relations: hasBindings ? read(relationCount) : notYet("Review reason has no compiled relation binding."),
      answerCaches: notYet("Answer-cache impact is not materialized in the compiled artifact."),
      activeWorldObjects: read(0),
      researchImpactPath: { status: "research", state: "not_yet", reason: "Potential impact paths remain research until separately qualified." },
    },
    receipt: { state: "not_yet", reason: "A receipt exists only after an idempotent human decision is persisted." },
  };
}

/*
  Read the compiler's directory plan, and refuse anything that does not look like one.

  The artifact validator types this field as `unknown[]` -- it checks that a plan is present,
  not what is in it -- so the shape is established here, once, before the UI sees it. A leaf
  with a traversal path or a non-string kind is dropped rather than rendered.
*/
function parseDirectoryPlan(plan: unknown[]): WorldDirectoryEntry[] {
  const entries = plan.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const entry = value as Record<string, unknown>;
    if (typeof entry.path !== "string" || typeof entry.kind !== "string") return [];
    const path = entry.path;
    if (path.length === 0 || path.length > 512 || path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..")) return [];
    const sourceIds = Array.isArray(entry.sourceIds)
      ? entry.sourceIds.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id))
      : [];
    return [{ path, kind: entry.kind, sourceIds }];
  });
  // Sorted so two renders of the same World agree, and so a folder precedes its contents.
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Describe the ontology from the compiled graph, counting rather than assuming.
 *
 * Domain and range are observed: the object types this predicate was actually used between in
 * this World. That is a weaker claim than a declared domain and range, and it is the only one
 * the artifact supports -- so it is the one made, and the viewer labels it as observed.
 */
function buildOntology(
  canonical: { nodes: CanonicalNode[]; edges: CanonicalEdge[] },
  files: WorldFile[],
): WorldOntology {
  const kindOf = new Map(canonical.nodes.map((node) => [node.id, node.kind] as const));
  const classes = [...new Set(canonical.nodes.map((node) => node.kind))].sort().map((name) => {
    const instances = canonical.nodes.filter((node) => node.kind === name);
    return {
      name,
      instances: instances.length,
      withEvidence: instances.filter((node) => node.evidenceIds.length > 0).length,
    };
  });

  const properties = [...new Set(canonical.edges.map((edge) => edge.type))].sort().map((name) => {
    const usages = canonical.edges.filter((edge) => edge.type === name);
    return {
      name,
      usages: usages.length,
      domain: [...new Set(usages.map((edge) => kindOf.get(edge.from)).filter((kind): kind is WorldObjectType => Boolean(kind)))].sort(),
      range: [...new Set(usages.map((edge) => kindOf.get(edge.to)).filter((kind): kind is WorldObjectType => Boolean(kind)))].sort(),
      withEvidence: usages.filter((edge) => edge.evidenceIds.length > 0).length,
    };
  });

  return {
    classes,
    properties,
    hierarchy: notYet("The compiled ontology declares no subclass axioms, so there is no hierarchy to read."),
    exports: files
      .filter((file) => file.path.startsWith("ontology/") || file.path.startsWith("graph/"))
      .map((file) => ({ path: file.path, mediaType: file.mediaType, sha256: file.sha256 })),
  };
}

export function buildWorldReadModel(value: unknown, collectionId: string, context: BuildContext = {}): WorldReadModel | null {
  const artifact = validateReviewableCollectionArtifact(value, collectionId);
  if (!artifact) return null;
  const canonicalFile = artifact.package.files.find((file) => file.path === "canonical/model.json");
  const chunksFile = artifact.package.files.find((file) => file.path === "rag/chunks.jsonl");
  if (!canonicalFile || !chunksFile) return null;
  /*
    Two readers, in the order that keeps the signed package file authoritative where it is one.

    A fallback-compiled package's `canonical/model.json` *is* the graph, so it is read first and
    a malformed one still refuses. A Core V2 package's is a different document -- the canonical
    knowledge model -- so the graph is read from the artifact's own `ontology`, which is what
    produced that package's graph CSVs in the first place.
  */
  const canonical = parseCanonicalModel(canonicalFile.content, collectionId)
    ?? parseProjectedKnowledgeModel(value, collectionId);
  if (!canonical) return null;
  const evidence = parseEvidence(chunksFile.content, canonical);
  if (!evidence) return null;

  const status = context.activeManifestDigest === artifact.manifestDigest ? "active" : "candidate";
  const relationIdsByNode = new Map<string, string[]>();
  for (const edge of canonical.edges) {
    relationIdsByNode.set(edge.from, [...(relationIdsByNode.get(edge.from) ?? []), edge.id]);
    relationIdsByNode.set(edge.to, [...(relationIdsByNode.get(edge.to) ?? []), edge.id]);
  }
  const sourceVersionByEvidence = new Map<string, Set<string>>();
  for (const item of evidence) {
    const evidenceId = item.id.slice(0, item.id.indexOf(":"));
    const versions = sourceVersionByEvidence.get(evidenceId) ?? new Set<string>();
    versions.add(item.sourceVersionId);
    sourceVersionByEvidence.set(evidenceId, versions);
  }

  const objects = canonical.nodes.map((node): WorldObject => {
    const relations = relationIdsByNode.get(node.id) ?? [];
    const evidenceRefs = evidence.filter((item) => node.evidenceIds.some((id) => item.id.startsWith(`${id}:`))).map((item) => item.id);
    const sourceVersions = [...new Set(node.evidenceIds.flatMap((id) => [...(sourceVersionByEvidence.get(id) ?? [])]))];
    const claims = [...new Set(relations.flatMap((id) => {
      const edge = canonical.edges.find((candidate) => candidate.id === id);
      return [edge?.from, edge?.to].filter((candidate): candidate is string => Boolean(candidate && canonical.nodes.some((item) => item.id === candidate && item.kind === "Claim")));
    }))];
    return {
      id: node.id,
      stableKey: node.id,
      label: node.label,
      type: node.kind,
      status,
      aliases: notYet("Aliases are not present in this compiled artifact."),
      claims,
      relations,
      evidenceRefs,
      sourceVersions,
      firstSeen: notYet("First-seen history is not present in this compiled artifact."),
      lastChanged: notYet("Last-changed history is not present in this compiled artifact."),
      readState: evidenceRefs.length > 0 ? "read" : "not_yet",
    };
  });
  const relations = canonical.edges.map((edge): WorldRelation => ({
    id: edge.id,
    subject: edge.from,
    predicate: edge.type,
    object: edge.to,
    evidenceRefs: evidence.filter((item) => edge.evidenceIds.some((id) => item.id.startsWith(`${id}:`))).map((item) => item.id),
    version: artifact.manifestDigest,
    status,
  }));

  const history: WorldHistoryEntry[] = (context.versions ?? []).map((version) => ({
    version: version.world_state_id,
    manifestDigest: version.manifest_digest,
    status: version.lifecycle_status,
    activatedAt: read(version.last_activated_at),
    activationCount: read(version.activation_count),
  }));
  if (!history.some((entry) => entry.manifestDigest === artifact.manifestDigest)) {
    history.unshift({
      version: artifact.coreExecution.worldStateId ?? artifact.manifestDigest.slice(7, 19),
      manifestDigest: artifact.manifestDigest,
      status: "candidate",
      activatedAt: notYet("Candidate has not been activated."),
      activationCount: notYet("Candidate has not been activated."),
    });
  }
  const reasons = artifact.reviewReasons ?? artifact.validation.reviewReasons ?? [];
  const files: WorldFile[] = artifact.package.files.map((file) => ({
    path: file.path,
    mediaType: file.mediaType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
  }));
  return {
    schemaVersion: "tavonel.world_read_model.v1",
    contract: {
      origin: context.origin ?? "compiled_artifact",
      deterministicSample: context.origin === "deterministic_sample",
      realObjectsOnly: true,
      missingData: "not_yet",
    },
    world: {
      id: collectionId,
      manifestDigest: artifact.manifestDigest,
      status,
      revision: status === "active" && context.activeRevision && context.activeRevision > 0 ? read(context.activeRevision) : notYet("No active revision is bound to this artifact."),
    },
    // Absent context means nobody read the clocks, which is reported as four nulls rather
    // than as a fresh World. buildWorldReadModel is pure; loadWorldReadModel does the read.
    freshness: context.freshness ?? { ...EMPTY_WORLD_FRESHNESS },
    objects,
    relations,
    evidence,
    history,
    directory: parseDirectoryPlan(artifact.directoryPlan),
    ontology: buildOntology(canonical, files),
    files,
    signature: notYet("The candidate artifact does not contain a verified signed-export receipt."),
    review: reviewModel(reasons, canonical, evidence),
  };
}

export type LoadWorldReadModelResult =
  | { ok: true; model: WorldReadModel }
  | { ok: false; code: string; status: number };

/**
 * Read one World, optionally a specific version of it.
 *
 * The digest is optional because almost every caller wants the current candidate. It exists
 * because comparing two versions means loading two, and a diff that could only ever read
 * "whichever one is preferred" would have nothing to compare it with.
 */
export async function loadWorldReadModel(
  workspaceKey: string,
  collectionId: string,
  manifestDigest?: string,
): Promise<LoadWorldReadModelResult> {
  if (!COLLECTION_ID_PATTERN.test(collectionId)) return { ok: false, code: "WORLD_ID_INVALID", status: 400 };
  const signer = readR2SignerEnv();
  if (!signer) return { ok: false, code: "SIGNER_NOT_CONFIGURED", status: 503 };
  const loaded = await loadPreferredCollectionCandidate(signer, workspaceKey, collectionId, manifestDigest);
  if (!loaded.ok) return { ok: false, code: loaded.code, status: loaded.code === "NOT_FOUND" ? 404 : 503 };
  const active = await getFoundationActiveWorld(workspaceKey, collectionId);
  if (!active.ok && active.code !== "ACTIVE_WORLD_NOT_FOUND") return { ok: false, code: active.code, status: 503 };
  const versions = active.ok ? await listFoundationWorldVersions(workspaceKey, collectionId) : { ok: true as const, versions: [] };
  if (!versions.ok) return { ok: false, code: versions.code, status: 503 };
  const artifact = validateReviewableCollectionArtifact(loaded.value.artifact, collectionId);
  const documentIds = artifact ? collectionSourceDocumentIds(artifact) : null;
  if (!documentIds) return { ok: false, code: "COLLECTION_SOURCE_BINDING_INVALID", status: 422 };
  const sourceAccess = await checkConnectorSourceAccess(workspaceKey, documentIds);
  if (!sourceAccess.ok) return { ok: false, code: sourceAccess.code,
    status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503 };
  /*
    The candidate digest is handed to the freshness read rather than rediscovered there: this
    function has already loaded the preferred candidate, and the database cannot see a
    candidate that was never promoted. Passing it is what makes "you are reading the previous
    active World, and a newer candidate is waiting" answerable at all (audit TM04).
  */
  const freshness = await getWorldFreshness(workspaceKey, collectionId, {
    candidateManifestDigest: artifact?.manifestDigest ?? null,
  });
  const model = buildWorldReadModel(loaded.value.artifact, collectionId, {
    activeManifestDigest: active.ok ? active.world.manifestDigest : null,
    activeRevision: active.ok ? active.world.revision : null,
    versions: versions.versions,
    freshness,
  });
  return model ? { ok: true, model } : { ok: false, code: "WORLD_READ_MODEL_INVALID", status: 422 };
}
