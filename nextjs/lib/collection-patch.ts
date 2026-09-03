import {
  canonicalize,
  type CollectionCandidateArtifact,
  materializeLabelDerivedFiles,
  sha256,
} from "./collection-compiler";

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
  const derived = materializeLabelDerivedFiles({ collectionId: artifact.collectionId, nodes, edges, inputBinding });
  const replacements = new Map([
    [derived.canonicalModel.path, derived.canonicalModel],
    [derived.turtle.path, derived.turtle],
    [derived.jsonld.path, derived.jsonld],
    [derived.nodeCsv.path, derived.nodeCsv],
    [derived.edgeCsv.path, derived.edgeCsv],
  ]);
  const files = artifact.package.files.map((file) => replacements.get(file.path) ?? file);

  const patched = {
    ...artifact,
    ontology: { nodes, edges },
    package: { ...artifact.package, files },
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
    ok: true,
    artifact: {
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
