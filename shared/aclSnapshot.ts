import { createHash } from "node:crypto";

/**
 * The ACL a source version carried at the moment it was read.
 *
 * The rule this type exists to express: derived knowledge may never be more permissive than every
 * source evidence that governs it. A compiled answer assembled from three documents is readable by
 * the people who could read all three -- not by the union, which is how a compiler leaks.
 *
 * What this is not: enforcement. No retrieval code in this repository filters by source ACL today
 * (`lib/retrieval-store.ts` and `lib/retrieval-pipeline.ts` filter by tenant and workspace only),
 * and no connector captures a snapshot at ingestion. Shipping the type without saying that would
 * create a field that looks like coverage and provides none, so it is said here and in
 * `docs/CUSTOMER_DATA_GATE_2026-09-06.md`, and `per_source_acl_preserved` is a MISSING row in the
 * gate's precondition matrix until a capture path and a consumer both exist.
 */

export const ACL_SNAPSHOT_SCHEMA = "tavonel.acl_snapshot.v1" as const;

export type AclPrincipalKind = "user" | "group" | "domain" | "anyone";
export type AclPermission = "read" | "write" | "owner";

export type AclPrincipal = {
  principalId: string;
  kind: AclPrincipalKind;
  permission: AclPermission;
};

export type AclSnapshot = {
  schemaVersion: typeof ACL_SNAPSHOT_SCHEMA;
  sourceVersionId: string;
  principals: AclPrincipal[];
  capturedAt: string;
  providerId: string;
  snapshotSha256: string;
};

/**
 * Ascending permissiveness. The intersection takes the minimum, never the maximum.
 *
 * A `Map`, not an object literal, because a literal answers for keys nobody put in it:
 * `({read:0,write:1,owner:2})["constructor"]` is a function, not `undefined`. A permission spelled
 * `__proto__`, `constructor`, `toString`, `valueOf` or `hasOwnProperty` was therefore ranked as
 * truthy garbage, survived every `<` comparison, preserved another snapshot's `owner` grant and was
 * emitted verbatim as the intersected permission -- a value outside the frozen vocabulary, which is
 * invented data. A `Map` has no prototype chain to inherit an answer from.
 */
const PERMISSION_RANK = new Map<string, number>([
  ["read", 0],
  ["write", 1],
  ["owner", 2],
]);
const PRINCIPAL_KINDS: readonly string[] = ["user", "group", "domain", "anyone"];

/**
 * A grant this code cannot rank is not a weaker grant and not a droppable one: it is evidence that
 * the ACL being intersected is not the ACL that was captured. These values cross the type boundary
 * at runtime -- connector JSON, and the `principals` jsonb of `source_acl_snapshots` -- so an
 * out-of-vocabulary permission is reachable from stored data, and the answer to it is to refuse the
 * whole intersection rather than to compute a permission set from a vocabulary that has already
 * been violated (contract section 8.1, "F ACL and pages"). Dropping the principal was the previous
 * behaviour; it returned a plausible answer over corrupt input, which is the shape of a leak nobody
 * reviews.
 */
function rankOf(principal: AclPrincipal): number {
  const rank = PERMISSION_RANK.get(principal.permission);
  if (rank === undefined || !PRINCIPAL_KINDS.includes(principal.kind)) {
    throw new Error(
      `ACL_VOCABULARY_UNKNOWN: kind ${JSON.stringify(principal.kind)}, permission ${JSON.stringify(principal.permission)}`,
    );
  }
  return rank;
}

/**
 * A separator that cannot occur inside a kind or a principal id. Built with `fromCharCode`, never
 * written as a raw byte: three raw NUL bytes made git classify this file as binary, so the one
 * security-critical module in this lane had no reviewable diff, in the branch or in a PR.
 */
const KEY_SEPARATOR = String.fromCharCode(0);

function principalKey(principal: Pick<AclPrincipal, "kind" | "principalId">): string {
  return `${principal.kind}${KEY_SEPARATOR}${principal.principalId}`;
}

/** Digest of the principal set, order-independent, so two captures of one ACL agree. */
export function aclSnapshotSha256(
  sourceVersionId: string,
  providerId: string,
  principals: readonly AclPrincipal[],
): string {
  const canonical = JSON.stringify({
    principals: [...principals]
      .map((principal) => ({
        kind: principal.kind,
        permission: principal.permission,
        principalId: principal.principalId,
      }))
      .sort((left, right) => principalKey(left).localeCompare(principalKey(right))),
    providerId,
    sourceVersionId,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * The principals a derived artifact may be shown to, given every governing source snapshot.
 *
 * A principal survives only if it appears in every snapshot, and it survives at the least
 * permissive permission any snapshot gave it. No governing evidence at all yields no principals:
 * an empty list is "nobody", never "everybody", because the caller that forgot to pass its
 * snapshots must not thereby publish. A grant whose kind or permission is outside the frozen
 * vocabulary refuses the whole intersection by throwing: it never widens and never invents, and the
 * caller learns that the stored ACL is corrupt instead of receiving a narrower-looking answer that
 * was computed from a vocabulary violation.
 *
 * Deliberately not implemented: containment between kinds (`anyone` covers a `domain` covers a
 * `group` covers a `user`). Expanding a group to its members needs a directory lookup this
 * repository does not have, and every containment rule can only widen the result -- so the strict
 * identity intersection is the one that cannot leak while the lookup is missing. The consequence is
 * stated in the doc: a source shared with `anyone` and a source shared with one named user
 * intersect to nobody, and that pair needs a human decision rather than a guess.
 */
export function intersectAcl(snapshots: readonly AclSnapshot[]): AclPrincipal[] {
  if (snapshots.length === 0) return [];

  const narrowed = snapshots.map((snapshot) => {
    const byKey: Record<string, { principal: AclPrincipal; rank: number }> = {};
    for (const principal of snapshot.principals) {
      const rank = rankOf(principal);
      const key = principalKey(principal);
      const held = byKey[key];
      // A snapshot that lists one principal twice disagrees with itself; keep the weaker grant.
      if (!held || rank < held.rank) byKey[key] = { principal, rank };
    }
    return byKey;
  });

  const [first, ...rest] = narrowed;
  const result: AclPrincipal[] = [];
  for (const key of Object.keys(first)) {
    let least = first[key];
    let present = true;
    for (const other of rest) {
      const match = other[key];
      if (!match) {
        present = false;
        break;
      }
      if (match.rank < least.rank) least = match;
    }
    if (present) {
      result.push({
        principalId: least.principal.principalId,
        kind: least.principal.kind,
        permission: least.principal.permission,
      });
    }
  }
  return result.sort((left, right) => principalKey(left).localeCompare(principalKey(right)));
}
