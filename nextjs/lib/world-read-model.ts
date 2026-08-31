import { validateReviewableCollectionArtifact } from "./collection-download";
import { loadPreferredCollectionCandidate } from "./collection-storage";
import { COLLECTION_ID_PATTERN } from "./immutable-keys";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import {
  getFoundationActiveWorld,
  listFoundationWorldVersions,
  type WorldVersionRow,
} from "./world-store";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
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
  objects: WorldObject[];
  relations: WorldRelation[];
  evidence: WorldEvidence[];
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

type SourceBinding = {
  documentId: string;
  versionKey: string;
  inputSha256: string;
};

type CanonicalModel = {
  collectionId: string;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  inputBinding: SourceBinding[];
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
    inputBinding.push({ documentId: binding.documentId, versionKey: binding.versionKey, inputSha256: binding.inputSha256 });
  }

  if (nodes.some((node) => node.evidenceIds.some((id) => !evidenceNodeIds.has(id)))) return null;
  return { collectionId, nodes, edges, inputBinding };
}

function validBbox(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000) && value[0] < value[2] && value[1] < value[3];
}

function parseEvidence(content: string, model: CanonicalModel): WorldEvidence[] | null {
  const sourceById = new Map(model.inputBinding.map((binding) => [binding.documentId, binding]));
  const evidenceIds = new Set(model.nodes.filter((node) => node.kind === "Evidence").map((node) => node.id));
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
      sourceId: chunk.sourceId as string,
      sourceVersionId: chunk.sourceVersionId as string,
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

export function buildWorldReadModel(value: unknown, collectionId: string, context: BuildContext = {}): WorldReadModel | null {
  const artifact = validateReviewableCollectionArtifact(value, collectionId);
  if (!artifact) return null;
  const canonicalFile = artifact.package.files.find((file) => file.path === "canonical/model.json");
  const chunksFile = artifact.package.files.find((file) => file.path === "rag/chunks.jsonl");
  if (!canonicalFile || !chunksFile) return null;
  const canonical = parseCanonicalModel(canonicalFile.content, collectionId);
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
    objects,
    relations,
    evidence,
    history,
    files: artifact.package.files.map((file) => ({ path: file.path, mediaType: file.mediaType, sizeBytes: file.sizeBytes, sha256: file.sha256 })),
    signature: notYet("The candidate artifact does not contain a verified signed-export receipt."),
    review: reviewModel(reasons, canonical, evidence),
  };
}

export type LoadWorldReadModelResult =
  | { ok: true; model: WorldReadModel }
  | { ok: false; code: string; status: number };

export async function loadWorldReadModel(workspaceKey: string, collectionId: string): Promise<LoadWorldReadModelResult> {
  if (!COLLECTION_ID_PATTERN.test(collectionId)) return { ok: false, code: "WORLD_ID_INVALID", status: 400 };
  const signer = readR2SignerEnv();
  if (!signer) return { ok: false, code: "SIGNER_NOT_CONFIGURED", status: 503 };
  const loaded = await loadPreferredCollectionCandidate(signer, workspaceKey, collectionId);
  if (!loaded.ok) return { ok: false, code: loaded.code, status: loaded.code === "NOT_FOUND" ? 404 : 503 };
  const active = await getFoundationActiveWorld(workspaceKey, collectionId);
  if (!active.ok && active.code !== "ACTIVE_WORLD_NOT_FOUND") return { ok: false, code: active.code, status: 503 };
  const versions = active.ok ? await listFoundationWorldVersions(workspaceKey, collectionId) : { ok: true as const, versions: [] };
  if (!versions.ok) return { ok: false, code: versions.code, status: 503 };
  const model = buildWorldReadModel(loaded.value.artifact, collectionId, {
    activeManifestDigest: active.ok ? active.world.manifestDigest : null,
    activeRevision: active.ok ? active.world.revision : null,
    versions: versions.versions,
  });
  return model ? { ok: true, model } : { ok: false, code: "WORLD_READ_MODEL_INVALID", status: 422 };
}
