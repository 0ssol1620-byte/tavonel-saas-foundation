import { describe, expect, it } from "vitest";
import {
  ACL_SNAPSHOT_SCHEMA,
  aclSnapshotSha256,
  intersectAcl,
  type AclPrincipal,
  type AclSnapshot,
} from "../../shared/aclSnapshot";

function snapshot(sourceVersionId: string, principals: AclPrincipal[], providerId = "google_drive"): AclSnapshot {
  return {
    schemaVersion: ACL_SNAPSHOT_SCHEMA,
    sourceVersionId,
    principals,
    capturedAt: "2026-09-06T00:00:00.000Z",
    providerId,
    snapshotSha256: aclSnapshotSha256(sourceVersionId, providerId, principals),
  };
}

const ana: AclPrincipal = { principalId: "ana@example.com", kind: "user", permission: "owner" };
const bo: AclPrincipal = { principalId: "bo@example.com", kind: "user", permission: "read" };

describe("ACL snapshot digest", () => {
  it("is order-independent over the principal set", () => {
    expect(aclSnapshotSha256("sv_1", "google_drive", [ana, bo])).toBe(
      aclSnapshotSha256("sv_1", "google_drive", [bo, ana]),
    );
  });

  it("changes when a permission changes", () => {
    expect(aclSnapshotSha256("sv_1", "google_drive", [{ ...bo, permission: "write" }])).not.toBe(
      aclSnapshotSha256("sv_1", "google_drive", [bo]),
    );
  });
});

describe("intersectAcl", () => {
  it("keeps only principals present in every governing snapshot", () => {
    const result = intersectAcl([
      snapshot("sv_1", [ana, bo]),
      snapshot("sv_2", [ana]),
    ]);
    expect(result).toEqual([{ principalId: "ana@example.com", kind: "user", permission: "owner" }]);
  });

  it("takes the least permissive grant, never the most", () => {
    const result = intersectAcl([
      snapshot("sv_1", [{ ...ana, permission: "owner" }]),
      snapshot("sv_2", [{ ...ana, permission: "read" }]),
    ]);
    expect(result).toEqual([{ principalId: "ana@example.com", kind: "user", permission: "read" }]);
  });

  it("does not widen: a public source combined with a private one grants nobody public access", () => {
    const anyone: AclPrincipal = { principalId: "*", kind: "anyone", permission: "read" };
    const result = intersectAcl([
      snapshot("sv_public", [anyone, ana]),
      snapshot("sv_private", [ana]),
    ]);
    expect(result.some((principal) => principal.kind === "anyone")).toBe(false);
    expect(result).toEqual([{ principalId: "ana@example.com", kind: "user", permission: "owner" }]);
  });

  it("does not treat a matching id under a different kind as the same principal", () => {
    const result = intersectAcl([
      snapshot("sv_1", [{ principalId: "example.com", kind: "domain", permission: "read" }]),
      snapshot("sv_2", [{ principalId: "example.com", kind: "group", permission: "read" }]),
    ]);
    expect(result).toEqual([]);
  });

  it("resolves a snapshot that lists one principal twice to the weaker grant", () => {
    const result = intersectAcl([
      snapshot("sv_1", [{ ...ana, permission: "owner" }, { ...ana, permission: "read" }]),
      snapshot("sv_2", [ana]),
    ]);
    expect(result).toEqual([{ principalId: "ana@example.com", kind: "user", permission: "read" }]);
  });

  it("grants nobody when no snapshot governs the derivation", () => {
    expect(intersectAcl([])).toEqual([]);
  });

  it("grants nobody when one governing snapshot is empty", () => {
    expect(intersectAcl([snapshot("sv_1", [ana, bo]), snapshot("sv_2", [])])).toEqual([]);
  });
});
