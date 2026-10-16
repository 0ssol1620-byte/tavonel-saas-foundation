import { createHash } from "node:crypto";
import { canonicalJsonWireField } from "./canonical-json-wire";

export const WORLD_PURPOSE = "native_world_reduction" as const;
export const WORLD_PROFILE = "tavonel.native_cell_observation_world.refs.v1" as const;
export const WORLD_COMMIT_SCHEMA = "tavonel.native_world_reduction_commit.v1" as const;
export const WORLD_MANIFEST_SCHEMA = "tavonel.product_core.native_world_artifact_manifest.v1" as const;
export const WORLD_AUTHORITY_SCHEMA = "tavonel.native_world_reduction_authority.v1" as const;
export const WORLD_MANIFEST_LIMIT = 32 * 1024;
export const WORLD_ARTIFACT_LIMIT = 32 * 1024 * 1024;
export const WORLD_DEFAULT_SERVICES = null;

export type ArtifactKind = "native_facts" | "full_cir_package" | "canonical_knowledge_model";
export type ArtifactRef = Readonly<{ artifactId: string; kind: ArtifactKind; mediaType: "application/json";
  byteLength: number; sha256: string }>;
export type StoredArtifactRef = ArtifactRef & Readonly<{ objectKey: string }>;
export type WorldSource = Readonly<{ nativeId: string; sourceId: string; sourceVersionId: string;
  contentSha256: string; cirSha256: string; processingReceiptId: string }>;
export type WorldContext = Readonly<{ tenantId: string; workspaceId: string; principalUserId: string;
  jobId: string; authorizationRevision: number; collectionId: string; documentIds: readonly string[] }>;
export type WorldGrantClaims = Readonly<{
  schemaVersion: typeof WORLD_AUTHORITY_SCHEMA; purpose: typeof WORLD_PURPOSE; grantId: string;
  issuerId: string; issuerKeyId: string; callerId: string; policySha256: string; evidenceSha256: string;
  tenantId: string; workspaceId: string; principalUserId: string; jobId: string;
  authorizationRevision: number; collectionId: string; preparationGrantId: string;
  preparationJobId: string; preparationReplayBinding: string; worldReplayBinding: string;
  canonicalRequestSha256: string; coreReleaseDigest: string; projectionVersion: typeof WORLD_PROFILE;
  sources: readonly WorldSource[]; inputArtifacts: readonly StoredArtifactRef[];
  issuedAt: string; expiresAt: string;
}>;
export type SignedWorldGrant = Readonly<{ claims: WorldGrantClaims; issuerSignature: string }>;
export type WorldManifest = Readonly<{
  schemaVersion: typeof WORLD_MANIFEST_SCHEMA; projectionVersion: typeof WORLD_PROFILE;
  kind: "native_world_artifact_manifest"; operationClass: "initial_compile";
  status: "review_required"; approvalStatus: "unbound"; candidatePromotion: false;
  signatureStatus: "external_signer_required"; tenantId: string; workspaceId: string; collectionId: string;
  coreReleaseDigest: string; canonicalRequestSha256: string; worldStateId: string; manifestDigest: string;
  sources: readonly WorldSource[]; artifacts: readonly ArtifactRef[]; cellCount: number;
  knowledgeObjectCount: number; validation: Record<string, unknown>; reviewReasons: readonly string[];
}>;
export type WorldCommitRequest = Readonly<{
  schemaVersion: typeof WORLD_COMMIT_SCHEMA; context: WorldContext; grantId: string;
  worldReplayBinding: string; inputWorkSha256: string; outputBindingSha256: string;
  manifestWire: string; manifestRawSha256: string; artifactRefs: readonly StoredArtifactRef[];
}>;
export type WorldCommitResult = Readonly<{ schemaVersion: typeof WORLD_COMMIT_SCHEMA;
  writeStatus: "written" | "exists"; worldStateId: string; manifestRawSha256: string;
  artifactRefs: readonly StoredArtifactRef[] }>;

const SHA = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const JOB = /^cjob-[a-f0-9]{32}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function deny(code: string): never { throw new Error(code); }
export function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
/** Same Unicode-code-point key order as Python; canonicalize small typed headers only. */
export function canonical(value: unknown): string {
  const compare = (a: string, b: string) => {
    const left = Array.from(a, c => c.codePointAt(0)!), right = Array.from(b, c => c.codePointAt(0)!);
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
    return left.length - right.length;
  };
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compare(a, b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
/** Bound a repository envelope before cloning/awaiting; reject unsupported values/depth. */
export function boundedSnapshot(value: unknown): SignedWorldGrant {
  let budget = WORLD_MANIFEST_LIMIT, nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (depth > 16 || ++nodes > 4096) deny("NATIVE_WORLD_AUTHORITY_TOO_LARGE");
    if (typeof v === "string") {
      if (v.length > budget) deny("NATIVE_WORLD_AUTHORITY_TOO_LARGE");
      budget -= Buffer.byteLength(JSON.stringify(v));
    } else if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isSafeInteger(v))) {
      budget -= String(v).length;
    } else if (Array.isArray(v)) {
      budget -= 2 + v.length; for (const child of v) visit(child, depth + 1);
    } else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      const entries = Object.entries(v); budget -= 2 + 2 * entries.length;
      for (const [k, child] of entries) { visit(k, depth + 1); visit(child, depth + 1); }
    } else deny("NATIVE_WORLD_AUTHORITY_INVALID");
    if (budget < 0) deny("NATIVE_WORLD_AUTHORITY_TOO_LARGE");
  };
  visit(value, 0);
  const copy = JSON.parse(canonical(value));
  const freeze = (v: unknown): void => {
    if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  };
  freeze(copy); return copy as SignedWorldGrant;
}
function row(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function exact(v: unknown, fields: string): v is Record<string, unknown> {
  const names = fields.split(" "); return row(v) && Object.keys(v).length === names.length && names.every(n => Object.hasOwn(v, n));
}
function text(v: unknown, pattern = IDENTIFIER): v is string { return typeof v === "string" && pattern.test(v); }
function integer(v: unknown, maximum: number, minimum = 1): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= minimum && v <= maximum;
}
function timestamp(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) || Number(v.slice(0, 4)) < 1) return false;
  const time = Date.parse(v);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === v.slice(0, 19);
}
function source(v: unknown): v is WorldSource {
  if (!exact(v, "nativeId sourceId sourceVersionId contentSha256 cirSha256 processingReceiptId") ||
      !text(v.nativeId, UUID) || !text(v.contentSha256, SHA) || !text(v.cirSha256, SHA) || !text(v.processingReceiptId)) return false;
  return text(v.sourceId, /^src_[a-f0-9]{64}$/) && text(v.sourceVersionId, /^dv_[a-f0-9]{64}$/);
}
function sources(v: unknown): v is readonly WorldSource[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every(source) &&
    new Set(v.map(s => s.nativeId)).size === v.length && new Set(v.map(s => s.sourceVersionId)).size === v.length &&
    v.map(s => s.sourceId).join("\n") === [...new Set(v.map(s => s.sourceId))].sort().join("\n");
}
export function artifact(v: unknown, stored = false): v is StoredArtifactRef {
  return exact(v, `artifactId kind mediaType byteLength sha256${stored ? " objectKey" : ""}`) &&
    ["native_facts", "full_cir_package", "canonical_knowledge_model"].includes(String(v.kind)) &&
    v.mediaType === "application/json" && integer(v.byteLength, WORLD_ARTIFACT_LIMIT) && text(v.sha256, SHA) &&
    v.artifactId === `${v.kind}_${v.sha256.slice(7)}` && (!stored || typeof v.objectKey === "string");
}
export function context(v: unknown): asserts v is WorldContext {
  if (!exact(v, "tenantId workspaceId principalUserId jobId authorizationRevision collectionId documentIds") ||
      !text(v.workspaceId, /^pilot-[A-Za-z0-9]{1,16}$/) || v.tenantId !== v.workspaceId || !text(v.principalUserId, UUID) ||
      !text(v.jobId, JOB) || !integer(v.authorizationRevision, Number.MAX_SAFE_INTEGER) ||
      !text(v.collectionId, /^collection-[a-f0-9]{32}$/) || !Array.isArray(v.documentIds) ||
      v.documentIds.length < 1 || v.documentIds.length > 16 || !v.documentIds.every(d => text(d, UUID)) ||
      new Set(v.documentIds).size !== v.documentIds.length) deny("NATIVE_WORLD_CONTEXT_INVALID");
  const expected = `collection-${sha256(`native-v1\n${v.workspaceId}\n${[...v.documentIds].sort().join("\n")}`).slice(7, 39)}`;
  if (v.collectionId !== expected) deny("NATIVE_WORLD_COLLECTION_IDENTITY_INVALID");
}
export function claims(v: unknown, ctx: WorldContext, grantId: string): asserts v is WorldGrantClaims {
  if (!exact(v, "schemaVersion purpose grantId issuerId issuerKeyId callerId policySha256 evidenceSha256 tenantId workspaceId principalUserId jobId authorizationRevision collectionId preparationGrantId preparationJobId preparationReplayBinding worldReplayBinding canonicalRequestSha256 coreReleaseDigest projectionVersion sources inputArtifacts issuedAt expiresAt") ||
      v.schemaVersion !== WORLD_AUTHORITY_SCHEMA || v.purpose !== WORLD_PURPOSE || v.grantId !== grantId || !text(grantId, UUID) ||
      ![v.issuerId, v.issuerKeyId, v.callerId].every(x => text(x)) || v.issuerId === v.callerId ||
      ![v.policySha256, v.evidenceSha256, v.canonicalRequestSha256, v.coreReleaseDigest].every(x => text(x, SHA)) ||
      ["tenantId", "workspaceId", "principalUserId", "jobId", "authorizationRevision", "collectionId"].some(k => v[k] !== ctx[k as keyof WorldContext]) ||
      !text(v.preparationGrantId, UUID) || v.preparationGrantId === grantId || !text(v.preparationJobId, JOB) || v.preparationJobId === ctx.jobId ||
      !text(v.preparationReplayBinding, /^native-work-[a-f0-9]{32}$/) || !text(v.worldReplayBinding, /^native-world-work-[a-f0-9]{32}$/) ||
      v.projectionVersion !== WORLD_PROFILE || !sources(v.sources) ||
      canonical(v.sources.map(s => s.nativeId).sort()) !== canonical([...ctx.documentIds].sort()) ||
      !Array.isArray(v.inputArtifacts) || v.inputArtifacts.length !== 2 || !v.inputArtifacts.every(a => artifact(a, true)) ||
      v.inputArtifacts[0].kind !== "native_facts" || v.inputArtifacts[1].kind !== "full_cir_package" ||
      !timestamp(v.issuedAt) || !timestamp(v.expiresAt) || Date.parse(v.expiresAt) <= Date.parse(v.issuedAt)) deny("NATIVE_WORLD_AUTHORITY_BINDING_INVALID");
  const c = v as unknown as WorldGrantClaims;
  for (const ref of c.inputArtifacts) {
    const expected = `immutable/${ctx.tenantId}/${ctx.workspaceId}/native-preparations/nprep_${c.canonicalRequestSha256.slice(7)}/${ref.sha256.slice(7)}/${ref.kind}.json`;
    if (ref.objectKey !== expected) deny("NATIVE_WORLD_INPUT_KEY_INVALID");
  }
  for (const s of c.sources) {
    const id = (prefix: string, ...parts: string[]) => `${prefix}_${sha256(`akc.identity.v1\x1e${prefix}\x1e${parts.map(p => `${Array.from(p).length}:${p}`).join("\x1f")}`).slice(7)}`;
    const expected = id("src", ctx.tenantId, "foundation-r2", s.nativeId);
    if (s.sourceId !== expected || s.sourceVersionId !== id("dv", expected, s.contentSha256)) deny("NATIVE_WORLD_SOURCE_IDENTITY_INVALID");
  }
  if (Buffer.byteLength(canonical(c)) > WORLD_MANIFEST_LIMIT) deny("NATIVE_WORLD_AUTHORITY_TOO_LARGE");
}
export function parseManifest(bytes: Uint8Array): WorldManifest {
  if (bytes.byteLength > WORLD_MANIFEST_LIMIT) deny("NATIVE_WORLD_MANIFEST_TOO_LARGE");
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const wire = canonicalJsonWireField(`{"manifest":${raw}}`, "manifest");
  if (!wire || wire + "\n" !== raw) deny("NATIVE_WORLD_MANIFEST_WIRE_INVALID");
  const v: unknown = JSON.parse(raw);
  if (!exact(v, "schemaVersion projectionVersion kind operationClass status approvalStatus candidatePromotion signatureStatus tenantId workspaceId collectionId coreReleaseDigest canonicalRequestSha256 worldStateId manifestDigest sources artifacts cellCount knowledgeObjectCount validation reviewReasons") ||
      v.schemaVersion !== WORLD_MANIFEST_SCHEMA || v.projectionVersion !== WORLD_PROFILE || v.kind !== "native_world_artifact_manifest" ||
      v.operationClass !== "initial_compile" || v.status !== "review_required" || v.approvalStatus !== "unbound" || v.candidatePromotion !== false ||
      v.signatureStatus !== "external_signer_required" || !text(v.coreReleaseDigest, SHA) || !text(v.canonicalRequestSha256, SHA) ||
      !text(v.manifestDigest, SHA) || !text(v.worldStateId, /^native_refs_ws_[a-f0-9]{64}$/) || !sources(v.sources) ||
      !Array.isArray(v.artifacts) || v.artifacts.length !== 3 || !v.artifacts.every(a => artifact(a)) ||
      v.artifacts.map(a => a.kind).join() !== "native_facts,full_cir_package,canonical_knowledge_model" ||
      !integer(v.cellCount, 100_000, 0) || !integer(v.knowledgeObjectCount, 1_000_000) ||
      !row(v.validation) || !Array.isArray(v.reviewReasons) || !v.reviewReasons.every(x => typeof x === "string")) deny("NATIVE_WORLD_MANIFEST_INVALID");
  // Preserve Python numeric tokens in validation metadata; parsing/stringifying 1.0 loses bytes.
  const wireWithout = (...omitted: string[]) => `{${Object.keys(v).filter(k => !omitted.includes(k)).sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJsonWireField(raw, k)}`).join(",")}}`;
  if (v.worldStateId !== `native_refs_ws_${sha256(canonical([wireWithout("manifestDigest", "worldStateId")])).slice(7)}` ||
      v.manifestDigest !== sha256(wireWithout("manifestDigest") + "\n")) deny("NATIVE_WORLD_MANIFEST_HASH_INVALID");
  return v as unknown as WorldManifest;
}
export function descriptor(ref: StoredArtifactRef): ArtifactRef {
  const { objectKey: _, ...value } = ref; return value;
}
