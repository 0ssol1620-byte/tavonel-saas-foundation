import { canonicalJson } from "./change-notify";
import {
  WORLD_RELEASE_SIGNATURE_SCOPE,
  isScopedSignature,
  verifyExportSignatureWithTrustStore,
  type ExportSignature,
  type ExportSigner,
  type ExportTrustStore,
} from "./export-signing";
import type { SourceRights } from "./home-evidence-view";

// V29 section 2.2 WorldRelease. Contract only: no table, route or UI. Immutable after publish; a
// withdrawal is a new signed release with the same release_id, same snapshot_hash and withdrawn_at set.
export type WorldRelease = {
  release_id: string;
  publisher_id: string;
  world_id: string;
  snapshot_hash: string;
  source_manifest_hash: string;
  license_id: string;
  rights_policy_version: string;
  review_status: string;
  withdrawn_at: string | null;
};

export type RightsRefusalReason = "no_rights_record" | "not_cleared" | "public_sample_not_redistributable";
// Counts only: a refusal never names a title, id or attribution (metadata negative).
export type ReleaseRefusal = { reason: RightsRefusalReason; count: number };
export type RightsResult = { ok: true } | { ok: false; refused: ReleaseRefusal[] };
type RightsSource = { sourceId: string; rights: SourceRights | null };

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function intersectRights(sources: ReadonlyArray<RightsSource>): RightsResult {
  // No sources means nothing was cleared: refuse rather than release an empty intersection.
  if (sources.length === 0) return { ok: false, refused: [{ reason: "no_rights_record", count: 0 }] };
  const counts = new Map<RightsRefusalReason, number>();
  for (const { rights } of sources) {
    const reason: RightsRefusalReason | null = !rights ? "no_rights_record"
      : rights.publication === "public_sample" ? "public_sample_not_redistributable"
        : rights.publication === "cleared" ? null : "not_cleared";
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return counts.size === 0 ? { ok: true }
    : { ok: false, refused: [...counts].map(([reason, count]) => ({ reason, count })) };
}

export type BuildRefusal = "rights_refused" | "invalid_hash" | "signer_unavailable" | "signer_not_v2_release_scope";
export type BuildResult =
  | { ok: true; release: WorldRelease; payload: string; signature: ExportSignature }
  | { ok: false; reason: BuildRefusal; refused?: ReleaseRefusal[] };

export function buildWorldRelease(
  input: { release: WorldRelease; sources: ReadonlyArray<RightsSource> },
  signer: ExportSigner | null,
): BuildResult {
  if (!signer) return { ok: false, reason: "signer_unavailable" };
  const rights = intersectRights(input.sources);
  if (!rights.ok) return { ok: false, reason: "rights_refused", refused: rights.refused };
  const { release } = input;
  if (!SHA256.test(release.snapshot_hash) || !SHA256.test(release.source_manifest_hash)) return { ok: false, reason: "invalid_hash" };
  const payload = canonicalJson(release);
  const signature = signer.signPayload(Buffer.from(payload));
  if (!isScopedSignature(signature, WORLD_RELEASE_SIGNATURE_SCOPE)) return { ok: false, reason: "signer_not_v2_release_scope" };
  return { ok: true, release, payload, signature };
}

export type VerifyRefusal = "wrong_scope" | "bad_signature" | "replay" | "withdrawn";
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyRefusal };

export function verifyWorldRelease(
  release: WorldRelease,
  signature: ExportSignature,
  trust: ExportTrustStore,
  now: Date,
  seen: ReadonlyMap<string, string>,
): VerifyResult {
  if (!isScopedSignature(signature, WORLD_RELEASE_SIGNATURE_SCOPE)) return { ok: false, reason: "wrong_scope" };
  if (!verifyExportSignatureWithTrustStore(Buffer.from(canonicalJson(release)), signature, trust, now, WORLD_RELEASE_SIGNATURE_SCOPE)) {
    return { ok: false, reason: "bad_signature" };
  }
  // Signed bytes verified, so the fields below are the publisher's own.
  if (release.withdrawn_at !== null) return { ok: false, reason: "withdrawn" };
  const prior = seen.get(release.release_id);
  if (prior !== undefined && prior !== release.snapshot_hash) return { ok: false, reason: "replay" };
  return { ok: true };
}
