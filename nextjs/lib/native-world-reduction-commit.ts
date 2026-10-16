import { createHmac, timingSafeEqual } from "node:crypto";
import { artifact, boundedSnapshot, canonical, claims, context, deny, descriptor, parseManifest, sha256,
  WORLD_ARTIFACT_LIMIT, WORLD_COMMIT_SCHEMA, WORLD_MANIFEST_LIMIT, WORLD_PURPOSE,
  type ArtifactRef, type SignedWorldGrant, type StoredArtifactRef, type WorldCommitRequest,
  type WorldCommitResult, type WorldContext, type WorldGrantClaims } from "./native-world-reduction-contract";

export type WorldPhase = "before_read" | "before_core" | "after_core" | "before_stage" | "before_commit" | "after_commit";
/** Trusted server construction only. Every callback is mandatory; no default live adapter. */
export interface NativeWorldCommitServices {
  callerId: string;
  resolveWorldGrant(grantId: string): Promise<SignedWorldGrant | null>;
  issuerKey(issuerId: string, keyId: string): Promise<Uint8Array | null>;
  /** Require the current fresh nonterminal World job/epoch/source; refuse failed settlement. */
  authorizeCurrentSourceAndJob(ctx: WorldContext, phase: WorldPhase): Promise<void>;
  /** Authenticate bound producer/security receipts and current independent qualification/revocation. */
  verifyCurrentProvenance(grant: WorldGrantClaims): Promise<void>;
  readInputArtifact(ref: StoredArtifactRef): Promise<Uint8Array>;
  /** Must run published Core verify_native_manifest against ALL actual bytes, not shape/hash only. */
  verifyCoreArtifacts(manifest: Uint8Array, artifacts: ReadonlyMap<string, Uint8Array>): Promise<void>;
  /** Create-once immutable model; equality on existing bytes. Staging conveys no visibility. */
  stageModel(ref: StoredArtifactRef, bytes: Uint8Array): Promise<StoredArtifactRef>;
  /** One transaction: current authority/revocation + complete refs + manifest + replay, all or none. */
  commitAtomically(request: WorldCommitRequest): Promise<WorldCommitResult>;
  clock?: () => Date;
}
export function createNativeWorldReductionCommitter(services: NativeWorldCommitServices | null = null) {
  return { async commit(inputContext: WorldContext, grantId: string, manifestBytes: Uint8Array,
                       modelBytes: Uint8Array): Promise<WorldCommitResult> {
    if (!services) deny("NATIVE_WORLD_REDUCTION_DISABLED");
    const required = ["resolveWorldGrant", "issuerKey", "authorizeCurrentSourceAndJob", "verifyCurrentProvenance",
      "readInputArtifact", "verifyCoreArtifacts", "stageModel", "commitAtomically"] as const;
    if (required.some(k => typeof services[k] !== "function")) deny("NATIVE_WORLD_SERVICES_INCOMPLETE");
    context(inputContext);
    // Snapshot mutable caller input before the first await. No buffered blob copy before admission.
    const ctx: WorldContext = Object.freeze({ ...inputContext, documentIds: Object.freeze([...inputContext.documentIds].sort()) });
    if (manifestBytes.byteLength > WORLD_MANIFEST_LIMIT || modelBytes.byteLength > WORLD_ARTIFACT_LIMIT) deny("NATIVE_WORLD_INPUT_TOO_LARGE");
    const body = Buffer.from(manifestBytes), model = Buffer.from(modelBytes);
    const manifest = parseManifest(body);
    const manifestRawSha256 = sha256(body);
    let pinned: SignedWorldGrant | undefined;
    async function checkpoint(phase: WorldPhase): Promise<WorldGrantClaims> {
      await services!.authorizeCurrentSourceAndJob(ctx, phase);
      const value = await services!.resolveWorldGrant(grantId);
      if (!value || Object.keys(value).sort().join() !== "claims,issuerSignature") deny("NATIVE_WORLD_AUTHORITY_REQUIRED");
      // Authenticated repository values are frozen by a bounded canonical copy before later awaits.
      const current = boundedSnapshot(value);
      claims(current.claims, ctx, grantId);
      if (current.claims.callerId !== services!.callerId) deny("NATIVE_WORLD_CALLER_INVALID");
      const key = await services!.issuerKey(current.claims.issuerId, current.claims.issuerKeyId);
      if (!key || key.byteLength < 32) deny("NATIVE_WORLD_ISSUER_UNAVAILABLE");
      const expected = `sha256:${createHmac("sha256", key).update(`${WORLD_PURPOSE}\n${canonical(current.claims)}`).digest("hex")}`;
      if (!/^sha256:[a-f0-9]{64}$/.test(current.issuerSignature) ||
          !timingSafeEqual(Buffer.from(expected), Buffer.from(current.issuerSignature))) deny("NATIVE_WORLD_SIGNATURE_INVALID");
      if (pinned && canonical(pinned) !== canonical(current)) deny("NATIVE_WORLD_AUTHORITY_CHANGED");
      await services!.verifyCurrentProvenance(current.claims);
      // Earlier source/job checks precede awaited grant/key/provenance reads. Revalidate
      // after those waits, including the final after_commit release boundary. This is a
      // current point-in-time decision; it does not lease authority beyond this check.
      await services!.authorizeCurrentSourceAndJob(ctx, phase);
      // No awaits after the trusted decision clock; neither caller timestamps nor booleans qualify.
      const now = (services!.clock?.() ?? new Date()).getTime();
      if (!Number.isFinite(now) || Date.parse(current.claims.issuedAt) > now || now >= Date.parse(current.claims.expiresAt)) deny("NATIVE_WORLD_AUTHORITY_EXPIRED");
      pinned = current;
      return current.claims;
    }
    const grant = await checkpoint("before_read");
    if (["tenantId", "workspaceId", "collectionId", "coreReleaseDigest", "canonicalRequestSha256", "projectionVersion"]
        .some(k => manifest[k as keyof typeof manifest] !== grant[k as keyof WorldGrantClaims]) ||
        canonical(manifest.sources) !== canonical(grant.sources) ||
        canonical(manifest.artifacts.slice(0, 2)) !== canonical(grant.inputArtifacts.map(descriptor))) deny("NATIVE_WORLD_MANIFEST_AUTHORITY_MISMATCH");
    const blobs = new Map<string, Uint8Array>();
    const checkBytes = (ref: ArtifactRef, bytes: Uint8Array) => {
      if (bytes.byteLength > WORLD_ARTIFACT_LIMIT || bytes.byteLength !== ref.byteLength || sha256(bytes) !== ref.sha256) deny("NATIVE_WORLD_ARTIFACT_MISMATCH");
    };
    checkBytes(manifest.artifacts[2]!, model);
    for (const ref of grant.inputArtifacts) {
      await checkpoint("before_read");
      const raw = await services.readInputArtifact(ref);
      checkBytes(ref, raw);
      blobs.set(ref.artifactId, Buffer.from(raw));
    }
    blobs.set(manifest.artifacts[2]!.artifactId, model);
    await checkpoint("before_core");
    await services.verifyCoreArtifacts(body, blobs);
    await checkpoint("after_core");
    if (sha256(body) !== manifestRawSha256) deny("NATIVE_WORLD_MANIFEST_CHANGED");
    for (const ref of manifest.artifacts) checkBytes(ref, blobs.get(ref.artifactId)!);
    const modelRef = manifest.artifacts[2]!;
    const storedModel: StoredArtifactRef = Object.freeze({ ...modelRef,
      objectKey: `immutable/${ctx.tenantId}/${ctx.workspaceId}/native-world-reductions/${manifest.worldStateId}/${modelRef.sha256.slice(7)}/${modelRef.kind}.json` });
    await checkpoint("before_stage");
    const staged = await services.stageModel(storedModel, model);
    if (!artifact(staged, true) || canonical(staged) !== canonical(storedModel)) deny("NATIVE_WORLD_STAGING_INVALID");
    checkBytes(modelRef, model);
    const refs = Object.freeze([...grant.inputArtifacts, storedModel]);
    const inputWorkSha256 = sha256(`${WORLD_COMMIT_SCHEMA}\n${canonical({ purpose: WORLD_PURPOSE, context: ctx,
      grantId, worldReplayBinding: grant.worldReplayBinding, canonicalRequestSha256: grant.canonicalRequestSha256,
      sources: grant.sources, inputArtifacts: grant.inputArtifacts, coreReleaseDigest: grant.coreReleaseDigest,
      projectionVersion: grant.projectionVersion })}`);
    const outputBindingSha256 = sha256(`${WORLD_COMMIT_SCHEMA}\n${canonical({ manifestRawSha256, artifactRefs: refs })}`);
    await checkpoint("before_commit");
    const request: WorldCommitRequest = Object.freeze({ schemaVersion: WORLD_COMMIT_SCHEMA, context: ctx, grantId,
      worldReplayBinding: grant.worldReplayBinding, inputWorkSha256, outputBindingSha256,
      manifestWire: body.toString("utf8"), manifestRawSha256, artifactRefs: refs });
    const result = await services.commitAtomically(request);
    // A committed row may exist if this later release check denies; no bytes/refs are released.
    await checkpoint("after_commit");
    if (!result || Object.keys(result).sort().join() !== "artifactRefs,manifestRawSha256,schemaVersion,worldStateId,writeStatus" ||
        result.schemaVersion !== WORLD_COMMIT_SCHEMA || !["written", "exists"].includes(result.writeStatus) ||
        result.worldStateId !== manifest.worldStateId || result.manifestRawSha256 !== manifestRawSha256 ||
        canonical(result.artifactRefs) !== canonical(refs)) deny("NATIVE_WORLD_COMMIT_RESULT_INVALID");
    return Object.freeze({ ...result, artifactRefs: refs });
  } };
}
