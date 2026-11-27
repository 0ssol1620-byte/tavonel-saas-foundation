import { createHash } from "node:crypto";
import {
  collectionSourceGroups, filterMemberReadableDocumentIds, readsEverything, SCOPE_DENIED, SCOPE_UNAVAILABLE,
  type MemberScopeRefusal, type ScopeViewer,
} from "./member-source-scope";

/*
  WO-PROJ-K2: per-member projection of a served World.

  The whole-World gate (member-source-scope.ts memberCollectionScopeRefusal) answers "every
  source, or nothing". A ProjectionDecision answers
  which sources of the served version this viewer may be shown anything derived from, so a read
  path can drop the rest BEFORE it ranks, counts or summarises. It is the one implementation:
  every read path that projects calls decideMemberProjection, and asks projectionAdmits per unit.

  - A source is admitted only when every product document carrying its bytes is readable: the
    whole-World AND, applied one source at a time. A derived unit is shown only when every source
    behind it is admitted (projectionAdmits), and a unit naming no source is not shown.
  - Owners and admins: `all`, without a read, exactly as the whole-World gate.
  - Missing scope data (package unreadable, store down, a malformed answer) is `refused`, never
    `all`. Nothing admitted is the same 403 the whole-World gate gives.
  - `key` binds a cached derivation to this projection. It reuses the membership's
    authorization_revision (the epoch: role, state and revocation bump it) and adds a digest of
    the admitted set, because a scope change does not bump the revision (20261124000000 never
    writes it). Two viewers, or one viewer before and after a narrowing, never share a key.

  Behind TAVONEL_MEMBER_PROJECTION_ENABLED (shadow: computed and compared, counts logged, today's
  gate still decides) and TAVONEL_MEMBER_PROJECTION_ENFORCE (a partial member is served the
  projection). Both unset in production; off, nothing here runs.
*/
type ProjectionViewer = ScopeViewer & { authorizationRevision: number };
export type ProjectionDecision =
  | { kind: "all"; key: string }
  | { kind: "partial"; key: string; allowedDocumentIds: ReadonlySet<string>; sourceCount: number; admittedSourceCount: number }
  | { kind: "refused"; refusal: MemberScopeRefusal };

export type MemberProjectionMode = "off" | "shadow" | "enforce";
export function memberProjectionMode(env: Readonly<Record<string, string | undefined>> = process.env): MemberProjectionMode {
  if (env.TAVONEL_MEMBER_PROJECTION_ENABLED !== "true") return "off";
  return env.TAVONEL_MEMBER_PROJECTION_ENFORCE === "true" ? "enforce" : "shadow";
}

/** Pure half of the decision: which source groups are wholly readable. */
export function projectSourceGroups(
  revision: number, groups: readonly (readonly string[])[], readable: ReadonlySet<string>,
): ProjectionDecision {
  const admitted = groups.filter(group => group.length > 0 && group.every(id => readable.has(id)));
  if (admitted.length === 0) return { kind: "refused", refusal: SCOPE_DENIED };
  const allowed = [...new Set(admitted.flat())].sort();
  if (admitted.length === groups.length) return { kind: "all", key: `${revision}:all` };
  return {
    kind: "partial", key: `${revision}:sha256:${createHash("sha256").update(allowed.join("\n")).digest("hex")}`,
    allowedDocumentIds: new Set(allowed), sourceCount: groups.length, admittedSourceCount: admitted.length,
  };
}

export async function decideMemberProjection(
  viewer: ProjectionViewer, collectionId: string, manifestDigest?: string,
): Promise<ProjectionDecision> {
  if (readsEverything(viewer)) return { kind: "all", key: `${viewer.authorizationRevision}:all` };
  const groups = await collectionSourceGroups(viewer.workspaceKey, collectionId, manifestDigest);
  if (groups === "unavailable") return { kind: "refused", refusal: SCOPE_UNAVAILABLE };
  if (groups === null) return { kind: "refused", refusal: SCOPE_DENIED };
  const readable = await filterMemberReadableDocumentIds(viewer, [...new Set(groups.flat())]);
  if (!readable.ok) return { kind: "refused", refusal: SCOPE_UNAVAILABLE };
  return projectSourceGroups(viewer.authorizationRevision, groups, readable.documentIds);
}

/** May a unit derived from these sources be shown? Every one must be admitted; none named is no. */
export function projectionAdmits(decision: ProjectionDecision, documentIds: readonly string[]): boolean {
  if (decision.kind === "refused") return false;
  if (decision.kind === "all") return true;
  return documentIds.length > 0 && documentIds.every(id => decision.allowedDocumentIds.has(id));
}

/**
 * Shadow comparison: counts and enum labels only. Never an id, a label, a query or a text, so the
 * log cannot become the leak the projection exists to prevent.
 */
export function recordProjectionShadow(fields: {
  endpoint: "search" | "ask"; today: "served" | "refused"; projected: ProjectionDecision["kind"];
  sources?: number; admittedSources?: number;
}) {
  console.info(JSON.stringify({ event: "member_projection_shadow", ...fields,
    disagree: (fields.today === "served") !== (fields.projected === "all") }));
}

/** The decision recorded against today's gate, in the shape recordProjectionShadow takes. */
export function projectionShadowFields(endpoint: "search" | "ask", todayRefused: boolean, decision: ProjectionDecision) {
  return {
    endpoint, today: todayRefused ? "refused" as const : "served" as const, projected: decision.kind,
    ...(decision.kind === "partial" ? { sources: decision.sourceCount, admittedSources: decision.admittedSourceCount } : {}),
  };
}
