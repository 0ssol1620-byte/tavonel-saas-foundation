export type RankedList = Array<{ id: string; rank: number }>;

export type FusionInput = Record<string, RankedList>;

export type FusedUnit = {
  id: string;
  fusedScore: number;
  fusedRank: number;
  ranks: Record<string, number | null>;
};

// Genuine Reciprocal Rank Fusion: score(id) = sum, over every ranked list that contains id,
// of 1 / (k + rank). k comes from RetrievalProfile.fusion.k (see retrieval-profile.ts),
// never hardcoded at a call site. This is deliberately NOT a renamed weighted sum: a list's
// own native score scale (BM25 magnitude, cosine similarity, a structural-path heuristic)
// never enters the fused score, only its rank position does -- that is what makes
// lexical/dense/structure comparable even though their native scores are not.
export function reciprocalRankFusion(inputs: FusionInput, k: number): FusedUnit[] {
  if (!Number.isInteger(k) || k < 1) throw new Error("RRF k must be a positive integer");

  const listNames = Object.keys(inputs);
  const scores = new Map<string, number>();
  const ranks = new Map<string, Record<string, number | null>>();

  for (const listName of listNames) {
    for (const { id, rank } of inputs[listName]) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
      const row = ranks.get(id) ?? Object.fromEntries(listNames.map((name) => [name, null]));
      row[listName] = rank;
      ranks.set(id, row);
    }
  }

  return [...scores.entries()]
    .map(([id, fusedScore]) => ({ id, fusedScore, ranks: ranks.get(id) ?? {} }))
    .sort((left, right) => right.fusedScore - left.fusedScore || left.id.localeCompare(right.id))
    .map((item, index) => ({ ...item, fusedRank: index + 1 }));
}
