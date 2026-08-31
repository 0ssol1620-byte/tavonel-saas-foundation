import { describe, expect, it } from "vitest";
import { applyWorldGate, type ActiveWorldLookup, type WorldGateCandidate } from "./world-gate";

function unit(overrides: Partial<WorldGateCandidate> = {}): WorldGateCandidate {
  return {
    unitId: "retrieval-unit-1",
    workspaceKey: "pilot-tenantone",
    collectionId: "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    worldManifestDigest: "sha256:" + "a".repeat(64),
    evidenceIds: ["evidence-1"],
    ...overrides,
  };
}

const activeWorldFixture: ActiveWorldLookup = (workspaceKey, collectionId) => {
  if (workspaceKey === "pilot-tenantone" && collectionId === "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
    return "sha256:" + "a".repeat(64);
  }
  return null;
};

describe("applyWorldGate", () => {
  it("admits a unit from the requesting tenant, matching the active world, with evidence bound", () => {
    const result = applyWorldGate("pilot-tenantone", [unit()], activeWorldFixture);
    expect(result.eligible).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects a unit belonging to a different tenant than the requester, even if everything else matches", () => {
    const result = applyWorldGate("pilot-tenanttwo", [unit()], activeWorldFixture);
    expect(result.eligible).toHaveLength(0);
    expect(result.rejected).toEqual([{ unitId: "retrieval-unit-1", reason: "TENANT_MISMATCH" }]);
  });

  it("rejects when no world is active for the collection at all", () => {
    const neverPromoted: ActiveWorldLookup = () => null;
    const result = applyWorldGate("pilot-tenantone", [unit()], neverPromoted);
    expect(result.rejected).toEqual([{ unitId: "retrieval-unit-1", reason: "NO_ACTIVE_WORLD" }]);
  });

  it("rejects a unit compiled against a world manifest that has since been superseded", () => {
    const supersededLookup: ActiveWorldLookup = () => "sha256:" + "b".repeat(64);
    const result = applyWorldGate("pilot-tenantone", [unit()], supersededLookup);
    expect(result.rejected).toEqual([{ unitId: "retrieval-unit-1", reason: "SUPERSEDED_WORLD_VERSION" }]);
  });

  it("rejects a unit with no evidence bound, even from the right tenant and active world", () => {
    const result = applyWorldGate("pilot-tenantone", [unit({ evidenceIds: [] })], activeWorldFixture);
    expect(result.rejected).toEqual([{ unitId: "retrieval-unit-1", reason: "NO_EVIDENCE_BOUND" }]);
  });

  it("checks tenant before world/evidence, so a wrong-tenant unit never leaks which world or evidence state it has", () => {
    const result = applyWorldGate(
      "pilot-tenanttwo",
      [unit({ worldManifestDigest: "sha256:" + "c".repeat(64), evidenceIds: [] })],
      activeWorldFixture,
    );
    expect(result.rejected).toEqual([{ unitId: "retrieval-unit-1", reason: "TENANT_MISMATCH" }]);
  });

  it("partitions a mixed batch into eligible and rejected independently", () => {
    const good = unit({ unitId: "u-good" });
    const wrongTenant = unit({ unitId: "u-wrong-tenant", workspaceKey: "pilot-other" });
    const noEvidence = unit({ unitId: "u-no-evidence", evidenceIds: [] });
    const result = applyWorldGate("pilot-tenantone", [good, wrongTenant, noEvidence], activeWorldFixture);
    expect(result.eligible.map((item) => item.unitId)).toEqual(["u-good"]);
    expect(result.rejected).toEqual([
      { unitId: "u-wrong-tenant", reason: "TENANT_MISMATCH" },
      { unitId: "u-no-evidence", reason: "NO_EVIDENCE_BOUND" },
    ]);
  });
});
