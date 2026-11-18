import { createHash } from "node:crypto";
import { canonicalJson } from "./change-notify";
import type { Failure, ProposalExecutor } from "./change-proposals";
import { applyCandidatePatch, type PatchFailure } from "./collection-patch";
import { loadPreferredCollectionCandidate } from "./collection-storage";
import { CANONICAL_DOCUMENT_ID, mayPublish, registerCollectionArtifact } from "./compile-artifact-provenance";
import { checkConnectorSourceAccessForViewer } from "./connector-source-access";
import { admitsDerivedCustomerData } from "./derived-data-admission";
import { collectionCandidateKey, COLLECTION_ID_PATTERN } from "./immutable-keys";
import { decidingRead, failClosed, READ_FAILED } from "./proposal-compile-plan";
import { putWorkspaceCollectionCandidate } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { hasCorrectionChild, recordFoundationReviewPatchIfLeaf } from "./review-store";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { loadWorldReadModel } from "./world-read-model";

/*
  `ontology_label_patch` (workorders/agent-native.md §4.2, §4.3; WO-AN-4). An agent proposes correcting the
  label of one Topic, Entity or Claim of a candidate; a confirmed correction makes a new immutable candidate,
  exactly as the human review route does, and Active is untouched.

  The base must be the correction leaf: a candidate with no recorded correction child. It is checked at
  creation (PROPOSAL_BASE_NOT_HEAD), bound before the decision (a child appearing since makes it `stale`), and
  re-checked atomically when the correction is recorded (record-if-leaf; refused → `failed`, no object written).
*/

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** `collection-patch.ts` MAX_LABEL, existing. */
const MAX_LABEL = 500;
const CANDIDATE_SCAN = 50;
/** The review decision row's reason (the reviews route requires 8–1000 characters). */
export const LABEL_CORRECTION_REASON = "Label correction suggested by a connected agent and confirmed in a signed-in TAVONEL session.";

export type EditableKind = "Topic" | "Entity" | "Claim";
export type LabelPatchInput = Readonly<{
  collectionId: string; baseManifestDigest: string; objectId: string; kind: EditableKind; before: string; after: string; evidenceId: string;
  documentIds: readonly string[];
}>;

const failure = (code: string, status: number): Failure => ({ ok: false, code, status });
const NOT_FOUND = failure("PROPOSAL_TARGET_NOT_FOUND", 404);
const UNAVAILABLE = failure("PROPOSAL_PRECONDITION_UNAVAILABLE", 503);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const label = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= MAX_LABEL && !CONTROL.test(value);
const KINDS: readonly string[] = ["Topic", "Entity", "Claim"];
const patchStatus = (code: PatchFailure) => (code === "PATCH_BEFORE_MISMATCH" ? 409 : 422);
/** A fixed instant for the dry-run: the manifest digest excludes `reviewPatch`, so it does not depend on it. */
const DRY_RUN_AT = "1970-01-01T00:00:00.000Z";

const REQUEST_KEYS = ["collectionId", "baseManifestDigest", "objectId", "before", "after", "evidenceId"] as const;
const INPUT_KEYS = [...REQUEST_KEYS, "kind", "documentIds"] as const;

/** The stored input: exact keys, the base's provenance set sorted and canonical, `after` already trimmed. */
export function parseLabelPatchInput(raw: unknown): LabelPatchInput | null {
  if (!isObject(raw) || !sameKeys(raw, INPUT_KEYS)) return null;
  const { collectionId, baseManifestDigest, objectId, kind, before, after, evidenceId, documentIds } = raw;
  if (typeof collectionId !== "string" || !COLLECTION_ID_PATTERN.test(collectionId) || typeof baseManifestDigest !== "string" || !SHA256.test(baseManifestDigest)
    || typeof objectId !== "string" || !OBJECT_ID.test(objectId) || typeof kind !== "string" || !KINDS.includes(kind)
    || !label(before) || !label(after) || after !== after.trim() || typeof evidenceId !== "string" || !EVIDENCE_ID.test(evidenceId)
    || !Array.isArray(documentIds) || documentIds.length < 1 || !documentIds.every((id) => typeof id === "string" && CANONICAL_DOCUMENT_ID.test(id))
    || documentIds.some((id, index) => index > 0 && (documentIds[index - 1] as string) >= id)) return null;
  return { collectionId, baseManifestDigest, objectId, kind: kind as EditableKind, before, after, evidenceId, documentIds: [...documentIds as string[]] };
}

export const labelPatchPreview = (input: LabelPatchInput) => ({
  collectionId: input.collectionId, baseManifestDigest: input.baseManifestDigest, objectId: input.objectId, kind: input.kind,
  before: input.before, after: input.after, evidenceId: input.evidenceId,
});

/** The documents the base candidate was registered under (list_collection_candidates), or null when it is not listed. */
async function baseCandidateDocuments(workspaceKey: string, collectionId: string, base: string): Promise<{ ok: true; documentIds: string[] | null } | Failure> {
  const config = readSupabaseAdminConfig();
  if (!config) return UNAVAILABLE;
  let listed: unknown;
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/list_collection_candidates", {
      method: "POST", body: JSON.stringify({ p_workspace_key: workspaceKey, p_collection_id: collectionId, p_limit: CANDIDATE_SCAN }),
    });
    if (!response.ok) return UNAVAILABLE;
    listed = await response.json().catch(() => null);
  } catch {
    return UNAVAILABLE;
  }
  if (!Array.isArray(listed) || !listed.every((row) => isObject(row) && typeof row.manifestDigest === "string")) return UNAVAILABLE;
  const row = (listed as Record<string, unknown>[]).find((candidate) => candidate.manifestDigest === base);
  if (!row) return { ok: true, documentIds: null };
  const ids = row.documentIds;
  if (!Array.isArray(ids) || ids.length < 1 || !ids.every((id) => typeof id === "string" && CANONICAL_DOCUMENT_ID.test(id))) return UNAVAILABLE;
  return { ok: true, documentIds: [...new Set(ids as string[])].sort() };
}

async function leafBinding(input: Pick<LabelPatchInput, "collectionId" | "baseManifestDigest">, workspaceKey: string): Promise<{ ok: true; digest: string; leaf: boolean } | Failure> {
  const child = await hasCorrectionChild(workspaceKey, input.collectionId, input.baseManifestDigest);
  if (!child.ok) return UNAVAILABLE;
  const leaf = !child.child;
  return { ok: true, leaf, digest: `sha256:${createHash("sha256").update(canonicalJson({ base: input.baseManifestDigest, leaf })).digest("hex")}` };
}

/** A read-model refusal: anything that says "not there / not yours" is the same not-found; the rest passes through. */
const readModelFailure = (loaded: { code: string; status: number }) =>
  loaded.status === 403 || loaded.status === 404 ? NOT_FOUND : failure(loaded.code, loaded.status);

export const labelCorrectionExecutor: ProposalExecutor<LabelPatchInput> = failClosed({
  parse: parseLabelPatchInput,
  documentsOf: (input) => [...input.documentIds],
  previewOf: labelPatchPreview,
  bindingKind: "correction_leaf",
  /*
    Raw: {collectionId, baseManifestDigest, objectId, before, after, evidenceId}. Access first: the base must be a
    registered candidate whose every document the proposer can read and whose derived data is admitted, and
    every refusal up to there is the same not-found. Then the leaf, the evidence, and the patch applied in
    memory. Writes nothing: no registration, no record, no PUT.

    The candidate listing and the access check decide whether the base names something this caller can read
    (§18: P4 = candidates + access); the agent tool no longer decides it first (WO-AN-8). For an agent, any
    failure of them -- an error or malformed answer, a throw, an access check that cannot answer -- is the
    not-found an absent base gets (flagged READ_FAILED for the server log). A person's listing outage stays a 503.
  */
  async prepare(actor, raw, evidenceIds) {
    if (!isObject(raw) || !sameKeys(raw, REQUEST_KEYS)) return failure("PROPOSAL_REQUEST_INVALID", 400);
    const { collectionId, baseManifestDigest, objectId, before, after, evidenceId } = raw;
    if (typeof collectionId !== "string" || !COLLECTION_ID_PATTERN.test(collectionId) || typeof baseManifestDigest !== "string" || !SHA256.test(baseManifestDigest)
      || typeof objectId !== "string" || !OBJECT_ID.test(objectId) || !label(before) || !label(after)
      || typeof evidenceId !== "string" || !EVIDENCE_ID.test(evidenceId)) return failure("PROPOSAL_REQUEST_INVALID", 400);
    const agent = actor.kind === "agent";
    const deciding = decidingRead(agent);
    const base = await deciding(() => baseCandidateDocuments(actor.workspaceKey, collectionId, baseManifestDigest));
    if (!base || !base.ok) return agent ? READ_FAILED : base ?? UNAVAILABLE;
    if (base.documentIds === null) return NOT_FOUND;
    const documentIds = base.documentIds;
    const access = await deciding(() => checkConnectorSourceAccessForViewer(actor.workspaceKey, [...documentIds], actor.userId));
    if (!access?.ok) return access?.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? NOT_FOUND : READ_FAILED;
    if (!await admitsDerivedCustomerData(actor.workspaceKey, documentIds)) return NOT_FOUND;
    const leaf = await leafBinding({ collectionId, baseManifestDigest }, actor.workspaceKey);
    if (!leaf.ok) return leaf;
    if (!leaf.leaf) return failure("PROPOSAL_BASE_NOT_HEAD", 409);
    const model = await loadWorldReadModel(actor.workspaceKey, collectionId, baseManifestDigest);
    if (!model.ok) return readModelFailure(model);
    if (!model.model.evidence.some((item) => item.id === evidenceId)) return failure("PATCH_EVIDENCE_NOT_FOUND", 422);
    const signer = readR2SignerEnv();
    if (!signer) return UNAVAILABLE;
    const stored = await loadPreferredCollectionCandidate(signer, actor.workspaceKey, collectionId, baseManifestDigest);
    if (!stored.ok) return stored.code === "NOT_FOUND" ? NOT_FOUND : UNAVAILABLE;
    const applied = applyCandidatePatch(stored.value.artifact, { objectId, before, after }, { evidenceId, actorUserId: actor.userId, patchedAt: DRY_RUN_AT });
    if (!applied.ok) return failure(applied.code, patchStatus(applied.code));
    const kind = applied.artifact.ontology.nodes.find((node) => node.id === objectId)?.kind;
    if (typeof kind !== "string" || !KINDS.includes(kind)) return failure("PATCH_TARGET_NOT_EDITABLE", 422);
    return {
      ok: true, collectionId, evidenceIds, bindingDigest: leaf.digest,
      input: { collectionId, baseManifestDigest, objectId, kind: kind as EditableKind, before, after: applied.artifact.reviewPatch.after, evidenceId, documentIds },
    };
  },
  currentBinding: (actor, _row, input) => leafBinding(input, actor.workspaceKey),
  preconditions: async () => (readR2SignerEnv() ? null : UNAVAILABLE),
  /*
    register → record-if-leaf → mayPublish → PUT (§4.2). The patch inputs are fixed to the row's decider and
    decision time, so a re-run writes the same key with the same bytes and the record answers `replayed`.
    A lease that ran out after a successful record is renewed once, never answered `failed` (that would leave
    a recorded correction with no object); a renewal the registry refuses (source deleted or blocked since)
    is `failed` with no PUT: the deletion wins.
  */
  async run({ actor, row, input }) {
    const signer = readR2SignerEnv();
    if (!signer) return UNAVAILABLE;
    if (row.decided_by === null || row.decided_at === null) return failure("PROPOSAL_EXECUTOR_FAILED", 500);
    const { workspaceKey } = actor;
    const model = await loadWorldReadModel(workspaceKey, input.collectionId, input.baseManifestDigest);
    if (!model.ok) return readModelFailure(model);
    const evidence = model.model.evidence.find((item) => item.id === input.evidenceId);
    if (!evidence) return failure("PATCH_EVIDENCE_NOT_FOUND", 422);
    const stored = await loadPreferredCollectionCandidate(signer, workspaceKey, input.collectionId, input.baseManifestDigest);
    if (!stored.ok) return stored.code === "NOT_FOUND" ? NOT_FOUND : UNAVAILABLE;
    const applied = applyCandidatePatch(stored.value.artifact, { objectId: input.objectId, before: input.before, after: input.after },
      { evidenceId: input.evidenceId, actorUserId: row.decided_by, patchedAt: row.decided_at });
    if (!applied.ok) return failure(applied.code, patchStatus(applied.code));
    const resulting = applied.artifact.manifestDigest;
    const key = collectionCandidateKey(workspaceKey, input.collectionId, resulting.replace("sha256:", ""));
    if (!key) return failure("COLLECTION_KEY_INVALID", 500);
    const registration = { workspaceKey, collectionId: input.collectionId, manifestDigest: resulting,
      documentIds: applied.artifact.sourceDocuments.map((document) => document.documentId) };
    let lease = await registerCollectionArtifact(registration);
    if (!lease.ok) return failure(lease.code, lease.refused ? 409 : 503);
    const recorded = await recordFoundationReviewPatchIfLeaf({
      workspaceKey, collectionId: input.collectionId, manifestDigest: input.baseManifestDigest, evidenceId: input.evidenceId,
      sourceId: evidence.sourceId, sourceVersionId: evidence.sourceVersionId, pageNumber: evidence.page, bbox1000: evidence.bbox,
      action: "edit", reason: LABEL_CORRECTION_REASON, actorUserId: row.decided_by,
      patch: { objectId: input.objectId, before: input.before, after: applied.artifact.reviewPatch.after, resultingManifestDigest: resulting },
    });
    if (!recorded.ok) return recorded.code === "REVIEW_BASE_NOT_HEAD" ? failure("PROPOSAL_BASE_NOT_HEAD", 409) : failure(recorded.code, 503);
    if (!mayPublish(lease)) {
      lease = await registerCollectionArtifact(registration);
      if (!lease.ok) return failure(lease.code, lease.refused ? 409 : 503);
      if (!mayPublish(lease)) return failure("COLLECTION_ARTIFACT_PUBLICATION_LEASE_EXPIRED", 503);
    }
    const written = await putWorkspaceCollectionCandidate(signer, workspaceKey, key, applied.artifact);
    if (!written.ok) return failure(written.code, 503);
    return { ok: true, candidateManifestDigest: resulting, replayed: recorded.receipt.replayed };
  },
  resultRef: (result) => ({ candidateManifestDigest: result.candidateManifestDigest }),
});
