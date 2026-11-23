import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./change-notify";
import {
  COMPILE_RECEIPT_SIGNATURE_SCOPE,
  WORLD_RELEASE_SIGNATURE_SCOPE,
  createExportSigner,
  type ExportTrustStore,
  type SignatureScope,
} from "./export-signing";
import type { SourceRights } from "./home-evidence-view";
import { buildWorldRelease, intersectRights, verifyWorldRelease, type WorldRelease } from "./world-release";

const pair = generateKeyPairSync("ed25519");
const der = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
const NB = "2026-11-01T00:00:00.000Z";
const EXP = "2026-12-01T00:00:00.000Z";
const NOW = new Date("2026-11-16T00:00:00.000Z");
const trust = (status: "active" | "revoked" = "active"): ExportTrustStore => ({
  schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "release-key",
  keys: [{ keyId: "release-key", keyVersion: 1, algorithm: "Ed25519", status, notBefore: NB, expiresAt: EXP,
    publicKeySpkiDerBase64: der.toString("base64"),
    publicKeySpkiSha256: `sha256:${createHash("sha256").update(der).digest("hex")}` }],
});
const signerFor = (signatureScope?: SignatureScope) => createExportSigner({ keyId: "release-key", keyVersion: 1,
  privateKeyPkcs8DerBase64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  notBefore: NB, expiresAt: EXP, issuedAt: "2026-11-15T00:00:00.000Z", signatureScope })!;
const h = (c: string) => `sha256:${c.repeat(64)}`;
const release = (over: Partial<WorldRelease> = {}): WorldRelease => ({ release_id: "rel-1", publisher_id: "pub-1",
  world_id: "world-1", snapshot_hash: h("a"), source_manifest_hash: h("b"), license_id: "lic-1",
  rights_policy_version: "v1", review_status: "approved", withdrawn_at: null, ...over });
const cleared: SourceRights = { basis: "Owned", jurisdiction: "KR", attribution: "SECRET-ATTRIBUTION", publication: "cleared" };
const src = (sourceId: string, rights: SourceRights | null) => ({ sourceId, rights });
const okSources = [src("s1", cleared), src("s2", cleared)];
const built = () => {
  const r = buildWorldRelease({ release: release(), sources: okSources }, signerFor(WORLD_RELEASE_SIGNATURE_SCOPE));
  if (!r.ok) throw new Error("build failed");
  return r;
};

describe("world release rights intersection", () => {
  it("passes only when every source is cleared", () => {
    expect(intersectRights(okSources)).toEqual({ ok: true });
  });
  it("refuses a public sample, a missing record and not_cleared, by count", () => {
    expect(intersectRights([...okSources, src("s3", { ...cleared, publication: "public_sample" })]))
      .toEqual({ ok: false, refused: [{ reason: "public_sample_not_redistributable", count: 1 }] });
    expect(intersectRights([...okSources, src("s4", null)]))
      .toEqual({ ok: false, refused: [{ reason: "no_rights_record", count: 1 }] });
    expect(intersectRights([src("s5", { ...cleared, publication: "not_cleared" })]).ok).toBe(false);
  });
  it("refuses an empty source list", () => {
    expect(intersectRights([]).ok).toBe(false);
  });
  it("never names a source id, title or attribution in a refusal", () => {
    const text = JSON.stringify(intersectRights([src("secret-id-9", null), src("s", { ...cleared, publication: "not_cleared" })]));
    expect(text).not.toContain("secret-id-9");
    expect(text).not.toContain("SECRET-ATTRIBUTION");
  });
});

describe("world release signing and verification", () => {
  it("builds and verifies a cleared release", () => {
    const b = built();
    expect(b.payload).toBe(canonicalJson(release()));
    expect(verifyWorldRelease(b.release, b.signature, trust(), NOW, new Map())).toEqual({ ok: true });
    expect(verifyWorldRelease(b.release, b.signature, trust(), NOW, new Map([["rel-1", h("a")]]))).toEqual({ ok: true });
  });
  it("refuses to build for a public sample or with no signer, without throwing", () => {
    const sample = buildWorldRelease({ release: release(), sources: [src("s", { ...cleared, publication: "public_sample" })] }, signerFor(WORLD_RELEASE_SIGNATURE_SCOPE));
    expect(sample).toEqual({ ok: false, reason: "rights_refused", refused: [{ reason: "public_sample_not_redistributable", count: 1 }] });
    expect(buildWorldRelease({ release: release(), sources: okSources }, null)).toEqual({ ok: false, reason: "signer_unavailable" });
    expect(buildWorldRelease({ release: release({ snapshot_hash: "nope" }), sources: okSources }, signerFor(WORLD_RELEASE_SIGNATURE_SCOPE)))
      .toEqual({ ok: false, reason: "invalid_hash" });
  });
  it("refuses a signer that does not sign under the release scope", () => {
    expect(buildWorldRelease({ release: release(), sources: okSources }, signerFor(COMPILE_RECEIPT_SIGNATURE_SCOPE)))
      .toEqual({ ok: false, reason: "signer_not_v2_release_scope" });
    expect(buildWorldRelease({ release: release(), sources: okSources }, signerFor()).ok).toBe(false);
  });
  it("refuses a signature from another scope", () => {
    const other = signerFor(COMPILE_RECEIPT_SIGNATURE_SCOPE).signPayload(Buffer.from(canonicalJson(release())));
    expect(verifyWorldRelease(release(), other, trust(), NOW, new Map())).toEqual({ ok: false, reason: "wrong_scope" });
  });
  it("refuses a tampered release and a revoked key", () => {
    const b = built();
    expect(verifyWorldRelease(release({ license_id: "lic-2" }), b.signature, trust(), NOW, new Map())).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWorldRelease(b.release, b.signature, trust("revoked"), NOW, new Map())).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("refuses a replayed release_id carrying a different snapshot", () => {
    const b = built();
    expect(verifyWorldRelease(b.release, b.signature, trust(), NOW, new Map([["rel-1", h("c")]]))).toEqual({ ok: false, reason: "replay" });
  });
  it("refuses a withdrawn release", () => {
    const w = buildWorldRelease({ release: release({ withdrawn_at: "2026-11-16T00:00:00.000Z" }), sources: okSources }, signerFor(WORLD_RELEASE_SIGNATURE_SCOPE));
    if (!w.ok) throw new Error("build failed");
    expect(verifyWorldRelease(w.release, w.signature, trust(), NOW, new Map())).toEqual({ ok: false, reason: "withdrawn" });
  });
});
