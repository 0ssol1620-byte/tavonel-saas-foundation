import {
  canonicalize,
  type CollectionCandidateArtifact,
  materializeLabelDerivedFiles,
  sha256,
} from "./collection-compiler";
import { validatePromotableCollectionArtifact, validateReviewableCollectionArtifact } from "./collection-download";
import { evaluateCompetencyCoverage, type CompetencyCoverageRow, type CompetencyQuestion } from "./competency-coverage";
import { filesFromArtifact, validateCompiledWorldPackage } from "../scripts/compiled-world/validate.mjs";

/*
  A reviewer's correction, as a new candidate rather than an edit.

  What "Edit" did before was write a decision row with a reason. That is a record that someone
  disagreed; it is not a correction, and the compiled World it disagreed with stayed exactly as
  it was. Masterplan 10 asks for the other half: the edit changes the candidate, the change is
  validated, a new candidate artifact comes out, and a receipt binds who did it, when, what it
  said before, what it says now, which evidence it was reviewed against, and which version
  resulted.

  Nothing here mutates anything. Object storage is immutable artifact truth, so a patch
  produces a second artifact under a second key, derived from the first and pointing back at
  it. The previous candidate remains readable and remains what its digest says it is.

  Three limits worth stating, because each of them is a decision and not an oversight.

  Only Topic, Entity and Claim labels are editable. A Document's label is its title as read
  from the document and an Evidence node's label is the immutable OCR key it was read from --
  editing either would make the artifact say the source contained something it did not, which
  is the one thing this system exists not to do.

  A patch never touches evidence. Page, bbox, digest and the binding from a claim to the
  region that supports it are untouched by construction: the patch changes a label and the
  materializer regenerates the files that embed labels. `rag/chunks.jsonl` and the Obsidian
  source markdown carry document text and are deliberately left alone -- the excerpt is what
  the page said, and a corrected label does not change that.

  And a patch does not clear `review_required`. A human fixing a spelling has not resolved
  whatever made the compiler ask for review, and letting the edit look like a resolution would
  turn a correction into a promotion.
*/

export type CandidatePatch = {
  /** The compiled node whose label is being corrected. */
  objectId: string;
  /** What the reviewer saw. A mismatch means the World moved under them. */
  before: string;
  after: string;
};

export type PatchFailure =
  | "PATCH_TARGET_NOT_FOUND"
  | "PATCH_TARGET_NOT_EDITABLE"
  | "PATCH_BEFORE_MISMATCH"
  | "PATCH_NO_CHANGE"
  | "PATCH_LABEL_INVALID"
  | "PATCH_ARTIFACT_INVALID";

type StoredArtifact = CollectionCandidateArtifact & {
  coreExecution?: {
    status: "completed" | "review_required";
    runtime: string;
    worldStateId: string | null;
    receipt: Record<string, unknown> & { requestId: string; outputSha256: string; candidatePromotion: false };
  };
  reviewPatch?: unknown;
};

export type PatchedCandidate = StoredArtifact & {
  reviewPatch: {
    schemaVersion: "tavonel.review_patch.v1";
    derivedFromManifestDigest: string;
    objectId: string;
    before: string;
    after: string;
    evidenceId: string;
    actorUserId: string;
    patchedAt: string;
  };
};

export type PatchResult =
  | { ok: true; artifact: PatchedCandidate }
  | { ok: false; code: PatchFailure };

/** Labels a reviewer may correct, and the two the source owns. */
const EDITABLE = new Set(["Topic", "Entity", "Claim"]);

const MAX_LABEL = 500;

function validLabel(value: string) {
  // A label is a line of text. Control characters would survive into the RDF and the CSV,
  // where they are not text but structure.
  const control = new RegExp("[\u0000-\u001f\u007f]");
  return value.length >= 1 && value.length <= MAX_LABEL && !control.test(value);
}

export function applyCandidatePatch(
  source: unknown,
  patch: CandidatePatch,
  context: { evidenceId: string; actorUserId: string; patchedAt: string },
): PatchResult {
  if (!source || typeof source !== "object") return { ok: false, code: "PATCH_ARTIFACT_INVALID" };
  const artifact = source as StoredArtifact;
  if (!artifact.ontology?.nodes || !Array.isArray(artifact.ontology.nodes) || !Array.isArray(artifact.package?.files)) {
    return { ok: false, code: "PATCH_ARTIFACT_INVALID" };
  }

  const target = artifact.ontology.nodes.find((node) => node.id === patch.objectId);
  if (!target) return { ok: false, code: "PATCH_TARGET_NOT_FOUND" };
  if (!EDITABLE.has(target.kind)) return { ok: false, code: "PATCH_TARGET_NOT_EDITABLE" };

  /*
    The reviewer's `before` is checked against the artifact, not trusted.

    This is optimistic concurrency and it is also the receipt's honesty: the "before" a person
    is shown later has to be what the label actually was, not what the client claimed it was.
  */
  if (target.label !== patch.before) return { ok: false, code: "PATCH_BEFORE_MISMATCH" };

  const after = patch.after.trim();
  if (!validLabel(after)) return { ok: false, code: "PATCH_LABEL_INVALID" };
  if (after === target.label) return { ok: false, code: "PATCH_NO_CHANGE" };

  const nodes = artifact.ontology.nodes.map((node) => (node.id === patch.objectId ? { ...node, label: after } : node));
  const edges = artifact.ontology.edges;

  return {
    ok: true,
    artifact: {
      ...rebuild(artifact, nodes, edges, false),
      reviewPatch: {
        schemaVersion: "tavonel.review_patch.v1" as const,
        derivedFromManifestDigest: artifact.manifestDigest,
        objectId: patch.objectId,
        before: patch.before,
        after,
        evidenceId: context.evidenceId,
        actorUserId: context.actorUserId,
        patchedAt: context.patchedAt,
      },
    },
  };
}

type Nodes = CollectionCandidateArtifact["ontology"]["nodes"];
type Edges = CollectionCandidateArtifact["ontology"]["edges"];

/*
  The one path from a changed graph to a new candidate, shared by the label correction and the
  ontology patch, so the two cannot hash different field lists or regenerate different files.

  `recount` is false for a label correction (its counts cannot move, and it keeps the bytes it
  always wrote). An ontology patch can add or remove Topics, Entities and relations, and
  `validate.mjs` refuses a `validation/report.json` whose counts disagree with the graph
  (COUNTS_DISAGREE), so it passes true: those three counts are recomputed, and only rewritten
  when they moved.
*/
function rebuild(artifact: StoredArtifact, nodes: Nodes, edges: Edges, recount: boolean) {
  /*
    Regenerate every file whose content depends on a label, using the compiler's own
    materializer.

    Rewriting three of the four by hand would leave an artifact that still validates while the
    graph and the RDF disagree, with one digest over both. Sharing the function is what makes
    that impossible rather than merely unlikely.
  */
  const inputBinding = artifact.sourceDocuments.map((document) => ({
    documentId: document.documentId,
    versionKey: document.versionKey,
    inputSha256: document.inputSha256,
    sourceImmutableKey: document.sanitizedKey,
  }));
  /*
    The artifact's own blueprint, not the fallback's constant.

    `scripts/compiled-world/validate.mjs` reads `canonical/model.json`'s
    `blueprint.ontologyRelations` as the allowlist an edge predicate must be inside
    (PREDICATE_UNDECLARED). A Core V2 candidate's edges include `mentions` and `contradicts`,
    which the constant does not declare, so re-materialising one with the default wrote a
    canonical model its own validator refuses: a reviewer correcting a spelling would have
    invalidated the package. `artifact.blueprint.ontologyRelations` is that compile's emitted set
    (`advertisedOntologyRelations`), so the regenerated file keeps declaring what the artifact
    actually contains.
  */
  const derived = materializeLabelDerivedFiles({
    collectionId: artifact.collectionId,
    nodes,
    edges,
    inputBinding,
    blueprint: artifact.blueprint,
  });
  const replacements = new Map([
    [derived.canonicalModel.path, derived.canonicalModel],
    [derived.turtle.path, derived.turtle],
    [derived.jsonld.path, derived.jsonld],
    [derived.nodeCsv.path, derived.nodeCsv],
    [derived.edgeCsv.path, derived.edgeCsv],
  ]);
  let validation = artifact.validation;
  if (recount) {
    const counts = {
      topics: nodes.filter((node) => node.kind === "Topic").length,
      entities: nodes.filter((node) => node.kind === "Entity").length,
      relations: edges.length,
    };
    if ((Object.keys(counts) as Array<keyof typeof counts>).some((key) => validation.counts[key] !== counts[key])) {
      validation = { ...validation, counts: { ...validation.counts, ...counts } };
      const report = artifact.package.files.find((file) => file.path === "validation/report.json");
      // The caller validated the base, which parses this file. A report with no counts object is
      // one `validate.mjs` does not compare, so it is left as written.
      const parsed = report ? JSON.parse(report.content) as { counts?: unknown } : null;
      if (report && parsed?.counts && typeof parsed.counts === "object") {
        const content = JSON.stringify({ ...parsed, counts: { ...parsed.counts, ...counts } }, null, 2) + "\n";
        replacements.set(report.path, {
          ...report,
          content,
          sizeBytes: Buffer.byteLength(content, "utf8"),
          sha256: `sha256:${sha256(content)}`,
        });
      }
    }
  }
  const files = artifact.package.files.map((file) => replacements.get(file.path) ?? file);

  const patched = {
    ...artifact,
    ontology: { nodes, edges },
    package: { ...artifact.package, files },
    validation,
  };

  /*
    The digest is computed over exactly the fields the compiler hashes.

    Not over the whole artifact: `coreExecution` and `reviewPatch` sit outside it, as
    `coreExecution` always has. That is deliberate. The digest identifies compiled content, so
    a patched candidate and an identical one produced directly by the compiler have the same
    digest -- and provenance lives where provenance belongs, in the receipt and the ledger.
  */
  const withoutDigest = {
    schemaVersion: patched.schemaVersion,
    executionAuthority: patched.executionAuthority,
    lifecycle: patched.lifecycle,
    candidatePromotion: patched.candidatePromotion,
    collectionId: patched.collectionId,
    blueprint: patched.blueprint,
    sourceDocuments: patched.sourceDocuments,
    directoryPlan: patched.directoryPlan,
    ontology: patched.ontology,
    package: patched.package,
    validation: patched.validation,
  };
  const manifestDigest = `sha256:${sha256(canonicalize(withoutDigest))}`;

  return {
    ...patched,
    manifestDigest,
    /*
      The Core did not produce this content, so its receipt may not claim to attest it.

      The runtime string keeps the Core that produced the artifact this was derived from and
      names the step that followed, and the output hash is recomputed over what is actually
      here. A receipt that still said "this is what the Core emitted" would be false.
    */
    coreExecution: artifact.coreExecution
      ? {
          ...artifact.coreExecution,
          runtime: artifact.coreExecution.runtime.endsWith("+human-review")
            ? artifact.coreExecution.runtime
            : `${artifact.coreExecution.runtime}+human-review`,
          receipt: {
            ...artifact.coreExecution.receipt,
            outputSha256: manifestDigest,
            candidatePromotion: false as const,
            derivedFromManifestDigest: artifact.manifestDigest,
          },
        }
      : undefined,
  };
}

/*
  WO-KS-3: the ontology patch (knowledge-steward.md §5; ADR-0010 §8, §12). Pure.

  Typed structural ops a person confirmed, applied in order to a candidate, through the same
  `rebuild` as a label correction. The patch infers nothing: every new object and relation cites
  Evidence nodes the base already has, from documents the proposer can read. New ids are derived
  from (base digest, op index, canonical op), so the same ops on the same base write the same
  bytes.

  What it refuses beyond the design's list, each because it would be the patch deciding something
  the evidence did not:
  - `supported_by` is never added or removed: it is the binding from a claim to the region that
    supports it, which a patch never touches (removal answers PATCH_EVIDENCE_ORPHANED, addition
    PATCH_TARGET_NOT_EDITABLE).
  - `contradicts` is never added or removed: it is a held conflict the Core flagged with its own
    reason, and removing it would resolve that conflict on the patch's say-so
    (PATCH_TARGET_NOT_EDITABLE).
  - A relation whose endpoints are not the kinds its predicate joins (RELATION_ENDPOINTS, read off
    the compiler contract) is refused as PATCH_OP_INVALID, as is any op that is not exactly the
    shape below. PATCH_OP_INVALID is a route-local code until the catalogue adds it (ADR-0010 §12).

  A retype mints a new id, because a stable id carries its kind's prefix (`validate.mjs`
  ID_NOT_STABLE); the incident edges move to it and later ops may still name the old id. A
  retyped Entity that a retrieval chunk names is refused by the validator (ENTITY_DANGLING): the
  chunks are what the page said and are not rewritten.
*/

export const MAX_ONTOLOGY_PATCH_OPS = 20;
const MAX_OP_EVIDENCE = 16;
const MAX_OP_STRING = 1_000;
const TEMP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RELATION_TYPE = /^[a-z_]{1,64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Subject and object kind of every predicate either engine emits (lib/compiler-contract.ts). */
const RELATION_ENDPOINTS: Record<Edges[number]["type"], readonly [string, string]> = {
  discusses_topic: ["Document", "Topic"],
  mentions_entity: ["Document", "Entity"],
  supported_by: ["Claim", "Evidence"],
  mentions: ["Claim", "Entity"],
  contradicts: ["Claim", "Claim"],
};
/** Relations a patch may add or remove. */
const PATCHABLE_RELATIONS = new Set(["discusses_topic", "mentions_entity", "mentions"]);

type StructuralKind = "Topic" | "Entity";
export type OntologyPatchOp =
  | { op: "relabel"; objectId: string; before: string; after: string }
  | { op: "add_object"; tempId: string; kind: StructuralKind; label: string; evidenceIds: string[] }
  | { op: "add_relation"; from: string; to: string; type: string; evidenceIds: string[] }
  | { op: "remove_relation"; edgeId: string }
  | { op: "retype"; objectId: string; from: StructuralKind; to: StructuralKind };

export type OntologyPatchFailure =
  | "PATCH_OP_INVALID"
  | "PATCH_TARGET_NOT_FOUND"
  | "PATCH_TARGET_NOT_EDITABLE"
  | "PATCH_BEFORE_MISMATCH"
  | "PATCH_LABEL_INVALID"
  | "PATCH_NO_CHANGE"
  | "PATCH_EVIDENCE_NOT_FOUND"
  | "PATCH_EVIDENCE_ORPHANED"
  | "PATCH_OBJECT_UNCONNECTED"
  | "PATCH_RETYPE_BREAKS_EDGE"
  | "PATCH_ARTIFACT_INVALID";

/** `opIndex` is null when the refusal is about the whole patch rather than one op. */
export type OntologyPatchRefusal = { opIndex: number | null; code: OntologyPatchFailure };

export type OntologyPatchContext = {
  /** Documents the proposer may read; evidence from any other document is refused. Required. */
  readableDocumentIds: ReadonlySet<string>;
};

export type OntologyPatchedCandidate = StoredArtifact & {
  ontologyPatch: {
    schemaVersion: "tavonel.ontology_patch.v1";
    derivedFromManifestDigest: string;
    patchDigest: string;
    ops: OntologyPatchOp[];
    actorUserId: string;
    patchedAt: string;
  };
};

export type OntologyPatchEvaluation = {
  valid: boolean;
  refusals: OntologyPatchRefusal[];
  loss: { edgesRemoved: number; evidenceOrphaned: number };
  affectedObjectIds: string[];
  coverage: { before: CompetencyCoverageRow[]; after: CompetencyCoverageRow[] };
};

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 128 && !CONTROL.test(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_OP_STRING;
const isKind = (value: unknown): value is StructuralKind => value === "Topic" || value === "Entity";
const hasKeys = (value: Record<string, unknown>, keys: string) => Object.keys(value).sort().join(",") === keys;

function evidenceList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_OP_EVIDENCE) return null;
  if (!value.every(isId) || new Set(value).size !== value.length) return null;
  return [...value];
}

/** Exactly one of the five shapes, copied; anything else is null. */
function readOp(raw: unknown): OntologyPatchOp | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const op = raw as Record<string, unknown>;
  switch (op.op) {
    case "relabel":
      return hasKeys(op, "after,before,objectId,op") && isId(op.objectId) && isText(op.before) && isText(op.after)
        ? { op: "relabel", objectId: op.objectId, before: op.before, after: op.after.trim() }
        : null;
    case "add_object": {
      const evidenceIds = evidenceList(op.evidenceIds);
      return hasKeys(op, "evidenceIds,kind,label,op,tempId") && typeof op.tempId === "string" && TEMP_ID.test(op.tempId) &&
        isKind(op.kind) && isText(op.label) && evidenceIds
        ? { op: "add_object", tempId: op.tempId, kind: op.kind, label: op.label.trim(), evidenceIds }
        : null;
    }
    case "add_relation": {
      const evidenceIds = evidenceList(op.evidenceIds);
      return hasKeys(op, "evidenceIds,from,op,to,type") && isId(op.from) && isId(op.to) &&
        typeof op.type === "string" && RELATION_TYPE.test(op.type) && evidenceIds
        ? { op: "add_relation", from: op.from, to: op.to, type: op.type, evidenceIds }
        : null;
    }
    case "remove_relation":
      return hasKeys(op, "edgeId,op") && isId(op.edgeId) ? { op: "remove_relation", edgeId: op.edgeId } : null;
    case "retype":
      return hasKeys(op, "from,objectId,op,to") && isId(op.objectId) && isKind(op.from) && isKind(op.to)
        ? { op: "retype", objectId: op.objectId, from: op.from, to: op.to }
        : null;
    default:
      return null;
  }
}

type Built =
  | { ok: true; base: StoredArtifact; patched: ReturnType<typeof rebuild>; ops: OntologyPatchOp[]; loss: OntologyPatchEvaluation["loss"]; affected: string[] }
  | { ok: false; refusal: OntologyPatchRefusal };

const refuse = (opIndex: number | null, code: OntologyPatchFailure): Built => ({ ok: false, refusal: { opIndex, code } });
const errorKeys = (artifact: unknown) => new Set(
  validateCompiledWorldPackage(filesFromArtifact(artifact)).errors.map((error) => `${String(error.code)}|${String(error.detail)}`),
);

/*
  The base is the server's stored candidate, not the proposer's input, so a base that fails its own
  gate is an integrity failure and throws. It is never answered as a refusal of the patch.
*/
function readBase(source: unknown): { base: StoredArtifact; gate: "promotable" | "reviewable" } {
  const invalid = () => new Error("PATCH_BASE_INVALID");
  if (!source || typeof source !== "object") throw invalid();
  const base = source as StoredArtifact;
  if (typeof base.collectionId !== "string" || !Array.isArray(base.ontology?.nodes) || !Array.isArray(base.ontology?.edges)) throw invalid();
  if (base.ontology.nodes.some((node) => !node || typeof node !== "object") || base.ontology.edges.some((edge) => !edge || typeof edge !== "object")) throw invalid();
  const gate = validatePromotableCollectionArtifact(base, base.collectionId) ? "promotable"
    : validateReviewableCollectionArtifact(base, base.collectionId) ? "reviewable" : null;
  if (!gate) throw invalid();
  return { base, gate };
}

function buildOntologyPatch(source: unknown, rawOps: unknown, context: OntologyPatchContext): Built {
  if (!(context?.readableDocumentIds instanceof Set)) throw new Error("PATCH_CONTEXT_INVALID");
  // The base has to pass the gate it will be judged by, or "the patch broke it" is unprovable.
  const { base, gate: baseGate } = readBase(source);

  if (!Array.isArray(rawOps) || rawOps.length < 1 || rawOps.length > MAX_ONTOLOGY_PATCH_OPS) return refuse(null, "PATCH_OP_INVALID");
  const ops: OntologyPatchOp[] = [];
  for (const [index, raw] of rawOps.entries()) {
    const op = readOp(raw);
    if (!op) return refuse(index, "PATCH_OP_INVALID");
    ops.push(op);
  }

  const nodes: Nodes = base.ontology.nodes.map((node) => ({ ...node }));
  let edges: Edges = base.ontology.edges.map((edge) => ({ ...edge }));
  const evidence = new Map(base.ontology.nodes.filter((node) => node.kind === "Evidence").map((node) => [node.id, node]));
  const readable = (ids: string[]) => ids.every((id) => {
    const node = evidence.get(id);
    return node?.documentId !== undefined && context.readableDocumentIds.has(node.documentId);
  });
  /** tempIds and retyped ids, to the id they now have. */
  const alias = new Map<string, string>();
  const resolve = (id: string) => {
    let current = id;
    while (alias.has(current)) current = alias.get(current)!;
    return current;
  };
  const nodeOf = (id: string) => nodes.find((node) => node.id === resolve(id));
  const derive = (prefix: string, index: number, op: OntologyPatchOp) =>
    `${prefix}-${sha256(`${base.manifestDigest}|${index}|${canonicalize(op)}`).slice(0, 32)}`;
  const legal = (type: string, fromKind: string, toKind: string) => {
    if (!Object.hasOwn(RELATION_ENDPOINTS, type)) return false;
    const ends = RELATION_ENDPOINTS[type as Edges[number]["type"]];
    return ends[0] === fromKind && ends[1] === toKind;
  };
  const affected = new Set<string>();
  const added: Array<{ index: number; id: string }> = [];

  for (const [index, op] of ops.entries()) {
    if (op.op === "relabel") {
      const target = nodeOf(op.objectId);
      if (!target) return refuse(index, "PATCH_TARGET_NOT_FOUND");
      if (!EDITABLE.has(target.kind)) return refuse(index, "PATCH_TARGET_NOT_EDITABLE");
      if (target.label !== op.before) return refuse(index, "PATCH_BEFORE_MISMATCH");
      if (!validLabel(op.after)) return refuse(index, "PATCH_LABEL_INVALID");
      if (op.after === target.label) return refuse(index, "PATCH_NO_CHANGE");
      nodes[nodes.indexOf(target)] = { ...target, label: op.after };
      affected.add(target.id);
    } else if (op.op === "add_object") {
      if (nodes.some((node) => node.id === op.tempId) || alias.has(op.tempId)) return refuse(index, "PATCH_OP_INVALID");
      if (!validLabel(op.label)) return refuse(index, "PATCH_LABEL_INVALID");
      if (!readable(op.evidenceIds)) return refuse(index, "PATCH_EVIDENCE_NOT_FOUND");
      const id = derive(op.kind.toLowerCase(), index, op);
      nodes.push({ id, kind: op.kind, label: op.label, evidenceIds: [...op.evidenceIds] });
      alias.set(op.tempId, id);
      added.push({ index, id });
      affected.add(id);
    } else if (op.op === "add_relation") {
      if (!base.blueprint?.ontologyRelations?.includes(op.type)) return refuse(index, "PATCH_ARTIFACT_INVALID");
      if (!PATCHABLE_RELATIONS.has(op.type)) return refuse(index, "PATCH_TARGET_NOT_EDITABLE");
      const from = nodeOf(op.from);
      const to = nodeOf(op.to);
      if (!from || !to) return refuse(index, "PATCH_TARGET_NOT_FOUND");
      if (!legal(op.type, from.kind, to.kind)) return refuse(index, "PATCH_OP_INVALID");
      if (!readable(op.evidenceIds)) return refuse(index, "PATCH_EVIDENCE_NOT_FOUND");
      if (edges.some((edge) => edge.from === from.id && edge.to === to.id && edge.type === op.type)) return refuse(index, "PATCH_NO_CHANGE");
      edges.push({
        id: derive("relation", index, op),
        type: op.type as Edges[number]["type"],
        from: from.id,
        to: to.id,
        evidenceIds: [...op.evidenceIds],
      } as Edges[number]);
      affected.add(from.id).add(to.id);
    } else if (op.op === "remove_relation") {
      const edge = edges.find((item) => item.id === op.edgeId);
      if (!edge) return refuse(index, "PATCH_TARGET_NOT_FOUND");
      if (edge.type === "supported_by") return refuse(index, "PATCH_EVIDENCE_ORPHANED");
      if (!PATCHABLE_RELATIONS.has(edge.type)) return refuse(index, "PATCH_TARGET_NOT_EDITABLE");
      edges = edges.filter((item) => item !== edge);
      affected.add(edge.from).add(edge.to);
    } else {
      const target = nodeOf(op.objectId);
      if (!target) return refuse(index, "PATCH_TARGET_NOT_FOUND");
      if (!isKind(target.kind)) return refuse(index, "PATCH_TARGET_NOT_EDITABLE");
      if (target.kind !== op.from) return refuse(index, "PATCH_BEFORE_MISMATCH");
      if (op.from === op.to) return refuse(index, "PATCH_NO_CHANGE");
      const kindOf = (id: string) => (id === target.id ? op.to : nodes.find((node) => node.id === id)?.kind ?? "");
      if (edges.some((edge) => (edge.from === target.id || edge.to === target.id) && !legal(edge.type, kindOf(edge.from), kindOf(edge.to)))) {
        return refuse(index, "PATCH_RETYPE_BREAKS_EDGE");
      }
      const id = derive(op.to.toLowerCase(), index, op);
      nodes[nodes.indexOf(target)] = { ...target, id, kind: op.to };
      edges = edges.map((edge) => (edge.from === target.id || edge.to === target.id
        ? { ...edge, from: edge.from === target.id ? id : edge.from, to: edge.to === target.id ? id : edge.to }
        : edge));
      alias.set(target.id, id);
      affected.add(target.id).add(id);
    }
  }

  for (const item of added) {
    const id = resolve(item.id);
    if (!edges.some((edge) => edge.from === id || edge.to === id)) return refuse(item.index, "PATCH_OBJECT_UNCONNECTED");
  }
  // A claim the base bound to evidence that the patched graph no longer binds.
  const supported = (list: Edges) => new Set(list.filter((edge) => edge.type === "supported_by").map((edge) => edge.from));
  const after = supported(edges);
  const evidenceOrphaned = [...supported(base.ontology.edges)].filter((id) => !after.has(id)).length;
  if (evidenceOrphaned > 0) return refuse(null, "PATCH_EVIDENCE_ORPHANED");
  const kept = new Set(edges.map((edge) => edge.id));
  const edgesRemoved = base.ontology.edges.filter((edge) => !kept.has(edge.id)).length;

  /*
    The compiler's own two checks over the result: the gate the base passed (a patch never
    demotes a promotable candidate), and `validate.mjs` -- the predicate allowlist, the four graph
    serialisations agreeing, counts, dangling references -- raising nothing the base did not.
  */
  const patched = rebuild(base, nodes, edges, true);
  const gate = baseGate === "promotable" ? validatePromotableCollectionArtifact : validateReviewableCollectionArtifact;
  if (!gate(patched, base.collectionId)) return refuse(null, "PATCH_ARTIFACT_INVALID");
  const before = errorKeys(base);
  if ([...errorKeys(patched)].some((key) => !before.has(key))) return refuse(null, "PATCH_ARTIFACT_INVALID");

  return { ok: true, base, patched, ops, loss: { edgesRemoved, evidenceOrphaned }, affected: [...affected].sort() };
}

/** The new candidate a confirmed ontology patch produces. Nothing is mutated. */
export function applyOntologyPatch(
  source: unknown,
  ops: unknown,
  context: OntologyPatchContext & { actorUserId: string; patchedAt: string },
): { ok: true; artifact: OntologyPatchedCandidate } | { ok: false; refusal: OntologyPatchRefusal } {
  const built = buildOntologyPatch(source, ops, context);
  if (!built.ok) return built;
  return {
    ok: true,
    artifact: {
      ...built.patched,
      // The base's own label-correction record describes the base, not this candidate.
      reviewPatch: undefined,
      ontologyPatch: {
        schemaVersion: "tavonel.ontology_patch.v1",
        derivedFromManifestDigest: built.base.manifestDigest,
        patchDigest: `sha256:${sha256(canonicalize(built.ops))}`,
        ops: built.ops,
        actorUserId: context.actorUserId,
        patchedAt: context.patchedAt,
      },
    },
  };
}

/**
 * The dry-run a proposal shows: validity, the refusal, what is lost, what is touched, and the
 * competency coverage before and after against `questions` (the CQ set current at prepare time;
 * null when the World has none, and then both lists are empty).
 * A base that is not a valid candidate throws PATCH_BASE_INVALID, and coverage that cannot be
 * computed throws as `evaluateCompetencyCoverage` does: an unreadable artifact is never reported
 * as a refused patch or as a patch that changes nothing.
 */
export function evaluateOntologyPatch(
  source: unknown,
  ops: unknown,
  context: OntologyPatchContext & { questions: readonly CompetencyQuestion[] | null },
): OntologyPatchEvaluation {
  const built = buildOntologyPatch(source, ops, context);
  // A refused patch is applied to nothing, so it loses, touches and covers nothing: the refusal is the answer.
  if (!built.ok) {
    return {
      valid: false,
      refusals: [built.refusal],
      loss: { edgesRemoved: 0, evidenceOrphaned: 0 },
      affectedObjectIds: [],
      coverage: { before: [], after: [] },
    };
  }
  const coverage = (artifact: unknown) => (context.questions === null ? [] : evaluateCompetencyCoverage(artifact, context.questions).rows);
  return {
    valid: true,
    refusals: [],
    loss: built.loss,
    affectedObjectIds: built.affected,
    coverage: { before: coverage(built.base), after: coverage(built.patched) },
  };
}
