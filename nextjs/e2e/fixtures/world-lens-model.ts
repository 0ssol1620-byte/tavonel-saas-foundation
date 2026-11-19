/**
 * A synthetic World read model for the workspace World lens specs.
 *
 * Labelled fixture, not a compiled artifact: ids are deterministic (`obj-c<cluster>-<n>`), every
 * cluster is one document joined to its topics, and nothing here claims to be a customer World.
 * `clusters * perCluster` is the object count, so a spec states the size it wants and gets
 * exactly that.
 */

export const LENS_COLLECTION_ID = `collection-${"a".repeat(32)}`;
export const LENS_CURRENT_MANIFEST = `sha256:${"a".repeat(64)}`;
export const LENS_PAST_MANIFEST = `sha256:${"e".repeat(64)}`;

const NOT_YET = { state: "not_yet", reason: "Not recorded in this compiled artifact." } as const;

export type WorldLensModelOptions = {
  clusters: number;
  perCluster: number;
  manifest?: string;
  status?: "active" | "candidate";
  /** Clusters below this index carry evidence; the rest do not, so a past version can lack a pin. */
  evidenceClusters?: number;
};

export const lensObjectId = (cluster: number, index: number) => `obj-c${cluster}-${index}`;
export const lensEvidenceId = (cluster: number) => `ev-c${cluster}`;
export const lensObjectLabel = (cluster: number, index: number) => (index === 0 ? `Document C${cluster}` : `Topic C${cluster}.${index}`);

/** The two versions the History list names: the current one and one retained older one. */
export function lensHistory(currentManifest = LENS_CURRENT_MANIFEST, pastManifest = LENS_PAST_MANIFEST) {
  return [
    { version: "2", manifestDigest: currentManifest, status: "active", activatedAt: NOT_YET, activationCount: { state: "read", value: 1 } },
    { version: "1", manifestDigest: pastManifest, status: "superseded", activatedAt: NOT_YET, activationCount: { state: "read", value: 1 } },
  ];
}

export function worldLensModel(options: WorldLensModelOptions) {
  const { clusters, perCluster, manifest = LENS_CURRENT_MANIFEST, status = "active" } = options;
  const evidenceClusters = options.evidenceClusters ?? clusters;
  const objects = [];
  const relations = [];
  const evidence = [];
  for (let c = 0; c < clusters; c += 1) {
    const withEvidence = c < evidenceClusters;
    if (withEvidence) {
      evidence.push({
        id: lensEvidenceId(c), sourceId: `doc-c${c}`, sourceVersionId: "ver-1", page: 1, bbox: [100, 100, 900, 200],
        blockId: `block-c${c}`, excerpt: `Synthetic excerpt for cluster ${c}.`, authority: "official", digest: `sha256:${"1".repeat(64)}`,
      });
    }
    for (let n = 0; n < perCluster; n += 1) {
      const relationIds = n === 0
        ? Array.from({ length: perCluster - 1 }, (_, k) => `rel-c${c}-${k + 1}`)
        : [`rel-c${c}-${n}`];
      objects.push({
        id: lensObjectId(c, n), stableKey: `c${c}-${n}`, label: lensObjectLabel(c, n), type: n === 0 ? "Document" : "Topic", status: "active",
        aliases: { state: "read", value: [] }, claims: [], relations: relationIds, evidenceRefs: n === 0 && withEvidence ? [lensEvidenceId(c)] : [],
        sourceVersions: ["ver-1"], firstSeen: NOT_YET, lastChanged: NOT_YET, readState: "read",
      });
      if (n > 0) {
        relations.push({ id: `rel-c${c}-${n}`, subject: lensObjectId(c, 0), predicate: "discusses_topic", object: lensObjectId(c, n), evidenceRefs: [], version: "1", status: "active" });
      }
    }
  }
  return {
    schemaVersion: "tavonel.world_read_model.v1",
    contract: { origin: "compiled_artifact", deterministicSample: false, realObjectsOnly: true, missingData: "not_yet" },
    world: { id: LENS_COLLECTION_ID, manifestDigest: manifest, status, revision: { state: "read", value: 2 } },
    objects,
    relations,
    evidence,
    directory: [],
    ontology: { classes: [], properties: [], hierarchy: "not_yet", exports: [] },
    history: lensHistory(),
    files: [],
    signature: NOT_YET,
    review: {
      state: "not_yet", reasons: [], evidenceRefs: [],
      impact: { state: "not_yet", affectedObjectIds: [], claims: { state: "not_yet", reason: "No review decision is pending." }, relations: { state: "not_yet", reason: "No review decision is pending." }, answerCaches: { state: "not_yet", reason: "Not materialized." }, activeWorldObjects: { state: "read", value: 0 }, researchImpactPath: { status: "research", state: "not_yet", reason: "Research lens." } },
      receipt: { state: "not_yet", reason: "No review decision has been recorded." },
    },
  };
}
