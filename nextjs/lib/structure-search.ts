import type { RankedList } from "./rank-fusion";

// The structure retrieval path: proximity in the existing canonical claim/entity graph,
// not a new model and not a generic graph database (see the project's rule against adding
// Neo4j or similar without a measured bottleneck and an ADR). A unit's score is how many
// seed claim/entity ids it shares with the query's own matched claims/entities -- a
// deterministic, explainable signal that composes with the lexical and dense lists purely
// through RRF, exactly like any other source.
export type StructureCandidate = {
  unitId: string;
  claimIds: string[];
  entityIds: string[];
};

export type StructureSearchParams = {
  seedClaimIds: string[];
  seedEntityIds: string[];
};

// Units sharing zero seed ids are dropped entirely rather than given rank with a zero
// score: RRF distinguishes "this source found nothing relevant here" (absent from the
// list, ranks[list] = null) from "this source ranked it last" (present with a high rank
// number), and a unit with no structural relation at all is the former.
export function rankByStructuralOverlap(candidates: StructureCandidate[], params: StructureSearchParams): RankedList {
  const seedClaims = new Set(params.seedClaimIds);
  const seedEntities = new Set(params.seedEntityIds);

  const scored = candidates
    .map((candidate) => {
      const claimOverlap = candidate.claimIds.filter((id) => seedClaims.has(id)).length;
      const entityOverlap = candidate.entityIds.filter((id) => seedEntities.has(id)).length;
      return { id: candidate.unitId, score: claimOverlap + entityOverlap };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  return scored.map((item, index) => ({ id: item.id, rank: index + 1 }));
}
