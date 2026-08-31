// The World Gate is the post-retrieval, pre-ContextPacket filter: "similar" must also be
// "valid, trusted, visible here and now" before it becomes context, per the retrieval
// architecture's separation of ranking from eligibility. Tenant isolation itself is
// enforced first, and primarily, by the SQL query boundary (workspace_key + RLS on
// foundation_retrieval_units/embeddings) -- a unit should never reach this function from a
// different tenant's rows in the first place. The check here is defense in depth: if one
// slipped through anyway, it fails closed instead of silently entering a packet.
//
// Temporal validity, authority classification and contradiction/held state are NOT checked
// here yet -- that requires the bitemporal Claim schema, authority classifier and
// contradiction detector that Wave 3's semantic compiler builds. Gating on data that
// doesn't exist would mean fabricating a pass/fail no evidence backs, which this project's
// own rules forbid. Extend WorldGateCandidate and this function once that data exists;
// until then, only the checks below are real.
export type WorldGateCandidate = {
  unitId: string;
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  evidenceIds: string[];
};

// Returns the active world's manifest digest for (workspaceKey, collectionId), or null if
// no world is active (never promoted, or rolled back to nothing). A thin wrapper over a
// foundation_active_worlds lookup in production; injected here so this function stays pure
// and testable without a database.
export type ActiveWorldLookup = (workspaceKey: string, collectionId: string) => string | null;

export type WorldGateRejectionReason =
  | "TENANT_MISMATCH"
  | "NO_ACTIVE_WORLD"
  | "SUPERSEDED_WORLD_VERSION"
  | "NO_EVIDENCE_BOUND";

export type WorldGateRejection = { unitId: string; reason: WorldGateRejectionReason };

export type WorldGateResult<T extends WorldGateCandidate> = {
  eligible: T[];
  rejected: WorldGateRejection[];
};

export function applyWorldGate<T extends WorldGateCandidate>(
  requestingWorkspaceKey: string,
  units: T[],
  activeWorldOf: ActiveWorldLookup,
): WorldGateResult<T> {
  const eligible: T[] = [];
  const rejected: WorldGateRejection[] = [];

  for (const unit of units) {
    if (unit.workspaceKey !== requestingWorkspaceKey) {
      rejected.push({ unitId: unit.unitId, reason: "TENANT_MISMATCH" });
      continue;
    }
    const activeDigest = activeWorldOf(unit.workspaceKey, unit.collectionId);
    if (activeDigest === null) {
      rejected.push({ unitId: unit.unitId, reason: "NO_ACTIVE_WORLD" });
      continue;
    }
    if (activeDigest !== unit.worldManifestDigest) {
      rejected.push({ unitId: unit.unitId, reason: "SUPERSEDED_WORLD_VERSION" });
      continue;
    }
    if (unit.evidenceIds.length === 0) {
      rejected.push({ unitId: unit.unitId, reason: "NO_EVIDENCE_BOUND" });
      continue;
    }
    eligible.push(unit);
  }

  return { eligible, rejected };
}
