import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/**
 * These values arrive from connector JSON and from the `principals` jsonb column, so they are not
 * closed by the TypeScript union at runtime. Ranked through an object literal they WIDENED twice
 * over: an unknown permission ranked `undefined` and `undefined < 2` is false, so the comparison
 * kept the more permissive side; and a permission spelled like an `Object.prototype` member ranked
 * as a *function*, which is not `undefined` at all, so it was neither refused nor dropped and rode
 * out as the emitted permission. Contract §8.1 ("F ACL and pages"): an unknown permission refuses
 * the whole intersection -- never widens, never invents.
 */
describe("intersectAcl with a grant outside the frozen vocabulary", () => {
  const junk = { principalId: "ana@example.com", kind: "user", permission: "admin" } as unknown as AclPrincipal;
  const junkKind = { principalId: "ana@example.com", kind: "service", permission: "read" } as unknown as AclPrincipal;
  const outOfVocabulary = [
    "admin",
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "",
  ];

  it.each(outOfVocabulary)(
    "refuses the intersection rather than let the permission %j preserve an owner grant",
    (permission) => {
      const smuggled = { ...ana, permission } as unknown as AclPrincipal;
      expect(() => intersectAcl([snapshot("sv_1", [ana]), snapshot("sv_2", [smuggled])])).toThrow(
        /ACL_VOCABULARY_UNKNOWN/,
      );
    },
  );

  it.each(outOfVocabulary)("never emits %j as an intersected permission", (permission) => {
    const smuggled = { ...bo, permission } as unknown as AclPrincipal;
    expect(() => intersectAcl([snapshot("sv_1", [smuggled]), snapshot("sv_2", [smuggled])])).toThrow(
      /ACL_VOCABULARY_UNKNOWN/,
    );
  });

  it("refuses even when the unrankable row duplicates a principal that would otherwise survive", () => {
    expect(() => intersectAcl([snapshot("sv_1", [junk, ana]), snapshot("sv_2", [ana])])).toThrow(
      /ACL_VOCABULARY_UNKNOWN/,
    );
  });

  it("refuses a principal whose kind is outside the frozen vocabulary", () => {
    expect(() => intersectAcl([snapshot("sv_1", [junkKind]), snapshot("sv_2", [junkKind])])).toThrow(
      /ACL_VOCABULARY_UNKNOWN/,
    );
  });

  it("names the value it refused, so a corrupt stored ACL is diagnosable", () => {
    expect(() => intersectAcl([snapshot("sv_1", [junk])])).toThrow(/"admin"/);
  });
});

/**
 * The principal-key separator is a NUL. Written as a raw byte it made git classify this security
 * module as binary -- no textual diff, in the branch or in a PR -- so the source stays plain ASCII
 * and the byte is built at runtime.
 */
describe("shared/aclSnapshot.ts as a reviewable text file", () => {
  it("contains no raw control bytes", () => {
    const source = readFileSync(resolve(process.cwd(), "shared/aclSnapshot.ts"));
    const offending = [...source].filter(
      (byte) => byte > 126 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13),
    );
    expect(offending).toEqual([]);
  });

  it("still separates the key with a byte no identifier can contain", () => {
    expect(
      intersectAcl([
        snapshot("sv_1", [{ principalId: "x", kind: "user", permission: "read" }]),
        snapshot("sv_2", [{ principalId: "x", kind: "user", permission: "read" }]),
      ]),
    ).toEqual([{ principalId: "x", kind: "user", permission: "read" }]);
    expect(
      intersectAcl([
        snapshot("sv_1", [{ principalId: " x", kind: "user", permission: "read" }]),
        snapshot("sv_2", [{ principalId: "x", kind: "user", permission: "read" }]),
      ]),
    ).toEqual([]);
  });
});
