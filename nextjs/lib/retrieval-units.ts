import { canonicalize, sha256, stableId, type CollectionCandidateArtifact } from "./collection-compiler";
import { parseChunks, type GroundedChunk } from "./grounded-ask";
import type { RetrievalViewKind } from "./retrieval-profile";

// A RetrievalUnit is a derived, rebuildable projection of the Compiled World — never a
// canonical fact. Deleting every unit for a compile run and recompiling from the same
// (collectionId, worldManifestDigest) must reproduce them byte-for-byte (contentDigest
// exists to make that reproducibility checkable). See
// supabase/migrations/0020_retrieval_foundation.sql for the storage shape this mirrors.
export type RetrievalUnit = {
  unitId: string;
  unitType: RetrievalViewKind;
  collectionId: string;
  worldManifestDigest: string;
  documentId: string;
  documentVersionKey: string;
  text: string;
  pageNumber1: number | null;
  bbox1000: [number, number, number, number] | null;
  claimIds: string[];
  entityIds: string[];
  evidenceIds: string[];
  authority: string | null;
  authorityScore: number | null;
  contentDigest: string;
};

function buildUnit(
  candidate: CollectionCandidateArtifact,
  unitType: RetrievalViewKind,
  discriminator: string,
  fields: {
    documentId: string;
    documentVersionKey: string;
    text: string;
    pageNumber1: number | null;
    bbox1000: [number, number, number, number] | null;
    claimIds: string[];
    entityIds: string[];
    evidenceIds: string[];
    authority: string | null;
    authorityScore: number | null;
  },
): RetrievalUnit {
  const withoutDigest = {
    unitType,
    collectionId: candidate.collectionId,
    worldManifestDigest: candidate.manifestDigest,
    ...fields,
  };
  return {
    unitId: stableId("retrieval-unit", candidate.collectionId, unitType, discriminator),
    contentDigest: `sha256:${sha256(canonicalize(withoutDigest))}`,
    ...withoutDigest,
  };
}

function nodeLabel(candidate: CollectionCandidateArtifact, nodeId: string): string | null {
  return candidate.ontology.nodes.find((node) => node.id === nodeId)?.label ?? null;
}

// One SectionView unit per OCR region (the finest document-structure granularity
// currently available — see collection-compiler.ts's per-region rag chunk emission).
// True hierarchical sections (heading levels, numbered clauses like "3.2 Payment Terms")
// require Reader-layer structure detection that does not exist yet; this is the honest v1
// approximation, not the final shape.
export function compileSectionViewUnits(candidate: CollectionCandidateArtifact, chunks: GroundedChunk[]): RetrievalUnit[] {
  return chunks.map((chunk) =>
    buildUnit(candidate, "section", chunk.chunkId, {
      documentId: chunk.sourceId,
      documentVersionKey: chunk.sourceVersionId,
      text: chunk.text,
      pageNumber1: chunk.pageNumber1,
      bbox1000: chunk.bbox1000,
      claimIds: chunk.claimIds,
      entityIds: chunk.entityIds,
      evidenceIds: [chunk.evidenceId],
      authority: chunk.authority,
      authorityScore: chunk.authorityScore,
    }));
}

// One ClaimView unit per (claim, region-it-was-found-in) pair. Claim IDs are document-
// scoped by construction (see collection-compiler.ts's claimsFor/stableId), so a claim
// never spans documents; it can span more than one region only if the same sentence is
// repeated verbatim, in which case each occurrence gets its own unit with its own
// provenance rather than one unit arbitrarily picking a "first" location.
export function compileClaimViewUnits(candidate: CollectionCandidateArtifact, chunks: GroundedChunk[]): RetrievalUnit[] {
  const units: RetrievalUnit[] = [];
  for (const chunk of chunks) {
    for (const claimId of chunk.claimIds) {
      const label = nodeLabel(candidate, claimId);
      if (label === null) continue;
      const entityIds = chunk.entityIds.filter((entityId) => {
        const entityLabel = nodeLabel(candidate, entityId);
        return entityLabel !== null && label.includes(entityLabel);
      });
      units.push(buildUnit(candidate, "claim", `${chunk.chunkId}:${claimId}`, {
        documentId: chunk.sourceId,
        documentVersionKey: chunk.sourceVersionId,
        text: label,
        pageNumber1: chunk.pageNumber1,
        bbox1000: chunk.bbox1000,
        claimIds: [claimId],
        entityIds,
        evidenceIds: [chunk.evidenceId],
        authority: chunk.authority,
        authorityScore: chunk.authorityScore,
      }));
    }
  }
  return units;
}

// One EntityView unit per (entity, region-mentioning-it) pair. Unlike claims, the same
// entity is deliberately deduplicated to one canonical ID across every document in the
// collection (see collection-compiler.ts's shared entityIds map) — so an entity mentioned
// in three documents gets three units here, each with its own document/page/bbox
// provenance, rather than one unit that could only point at a single location.
export function compileEntityViewUnits(candidate: CollectionCandidateArtifact, chunks: GroundedChunk[]): RetrievalUnit[] {
  const units: RetrievalUnit[] = [];
  for (const chunk of chunks) {
    for (const entityId of chunk.entityIds) {
      const label = nodeLabel(candidate, entityId);
      if (label === null) continue;
      const claimIds = chunk.claimIds.filter((claimId) => {
        const claimLabel = nodeLabel(candidate, claimId);
        return claimLabel !== null && claimLabel.includes(label);
      });
      units.push(buildUnit(candidate, "entity", `${chunk.chunkId}:${entityId}`, {
        documentId: chunk.sourceId,
        documentVersionKey: chunk.sourceVersionId,
        text: label,
        pageNumber1: chunk.pageNumber1,
        bbox1000: chunk.bbox1000,
        claimIds,
        entityIds: [entityId],
        evidenceIds: [chunk.evidenceId],
        authority: chunk.authority,
        authorityScore: chunk.authorityScore,
      }));
    }
  }
  return units;
}

// Forward-compatible stub: CollectionOcrRegion.blockType is only ever "paragraph" today
// (see collection-compiler.ts), so no table structure exists to project yet. This always
// returns [] rather than fabricating table boundaries from paragraph text — TableView
// becomes real once the Reader layer adds table-region detection, at which point this is
// the only function that needs to change.
export function compileTableViewUnits(): RetrievalUnit[] {
  return [];
}

const VIEW_COMPILERS: Record<RetrievalViewKind, (candidate: CollectionCandidateArtifact, chunks: GroundedChunk[]) => RetrievalUnit[]> = {
  section: compileSectionViewUnits,
  claim: compileClaimViewUnits,
  entity: compileEntityViewUnits,
  table: () => compileTableViewUnits(),
  event: () => [],
  graph_neighborhood: () => [],
  summary: () => [],
};

export type RetrievalUnitCompileResult = {
  units: RetrievalUnit[];
  skippedViews: RetrievalViewKind[];
};

// Compiles every view a RetrievalProfile asks for, from a Compiled World candidate
// artifact's own rag/chunks.jsonl (the same page/bbox-bound chunks grounded-ask.ts
// requires — reusing its parser keeps the two paths from silently drifting apart again,
// which is exactly the regression Wave 0 fixed). Views with no compiler yet (event,
// graph_neighborhood, summary) are reported as skipped rather than silently ignored.
export function compileRetrievalUnits(
  candidate: CollectionCandidateArtifact,
  views: RetrievalViewKind[],
): RetrievalUnitCompileResult {
  const chunks = parseChunks(candidate);
  const units: RetrievalUnit[] = [];
  const skippedViews: RetrievalViewKind[] = [];
  for (const view of views) {
    const compiled = VIEW_COMPILERS[view](candidate, chunks);
    const unimplemented: RetrievalViewKind[] = ["table", "event", "graph_neighborhood", "summary"];
    if (compiled.length === 0 && unimplemented.includes(view)) {
      skippedViews.push(view);
      continue;
    }
    units.push(...compiled);
  }
  return { units, skippedViews };
}
