import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getExportTrust } from "../app/api/export/trust/route";
import {
  ANSWER_RECEIPT_SIGNATURE_SCOPE,
  CAPABILITY_MANIFEST_SIGNATURE_SCOPE,
  COMPILE_RECEIPT_SIGNATURE_SCOPE,
  DEVELOPER_CHANNEL_SIGNATURE_SCOPE,
  WORLD_RELEASE_SIGNATURE_SCOPE,
  createExportSigner,
  isScopedSignature,
  exportTrustRecord,
  readExportSignerEnv,
  readExportTrustStoreEnv,
  verifyExportSignature,
  verifyExportSignatureWithTrustStore,
  type ExportSignature,
  type ExportSignatureV2,
  type SignatureScope,
  type ExportTrustKey,
  type ExportTrustStore,
} from "./export-signing";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8DerBase64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeySpkiDer: createPublicKey(pair.privateKey).export({ format: "der", type: "spki" }),
  };
}

describe("Foundation signed exports", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs exact bytes with Ed25519 and rejects tampering", () => {
    const material = keys();
    const signer = createExportSigner({ keyId: "foundation-export-2026", ...material });
    expect(signer).not.toBeNull();
    const payload = Buffer.from("exact export manifest bytes\n");
    const signature = signer!.signPayload(payload);

    expect(verifyExportSignature(payload, signature, material.publicKeySpkiDer)).toBe(true);
    expect(verifyExportSignature(Buffer.from("tampered\n"), signature, material.publicKeySpkiDer)).toBe(false);
    expect(verifyExportSignature(payload, { ...signature, signatureBase64: "AAAA" }, material.publicKeySpkiDer)).toBe(false);
    expect(verifyExportSignature(payload, { ...signature, signatureBase64: `${signature.signatureBase64}=` }, material.publicKeySpkiDer)).toBe(false);

    expect(exportTrustRecord(signer!)).toEqual({
      schemaVersion: "tavonel.export_trust.v1",
      algorithm: "Ed25519",
      keyId: "foundation-export-2026",
      publicKeySpkiDerBase64: material.publicKeySpkiDer.toString("base64"),
      publicKeySpkiSha256: signature.publicKeySpkiSha256,
    });
  });

  it("fails closed for absent, malformed and non-Ed25519 environment keys", () => {
    expect(readExportSignerEnv({})).toBeNull();
    expect(readExportSignerEnv({
      TAVONEL_EXPORT_SIGNING_KEY_ID: "bad key id",
      TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: "not-base64",
    })).toBeNull();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(createExportSigner({
      keyId: "foundation-export-rsa",
      privateKeyPkcs8DerBase64: rsa.export({ format: "der", type: "pkcs8" }).toString("base64"),
    })).toBeNull();
  });

  it("allows v1 only when the trust store is absent and never downgrades a malformed configured store", async () => {
    const material = keys();
    const keyId = "foundation-export-2026";
    const baseEnv = {
      TAVONEL_EXPORT_SIGNING_KEY_ID: keyId,
      TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: material.privateKeyPkcs8DerBase64,
    };
    const fingerprint = `sha256:${createHash("sha256").update(material.publicKeySpkiDer).digest("hex")}`;
    const validKey: ExportTrustKey = {
      keyId,
      keyVersion: 1,
      algorithm: "Ed25519",
      status: "active",
      notBefore: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
      publicKeySpkiDerBase64: material.publicKeySpkiDer.toString("base64"),
      publicKeySpkiSha256: fingerprint,
    };

    const compatibilitySigner = readExportSignerEnv(baseEnv);
    expect(compatibilitySigner?.signPayload(Buffer.from("legacy compatibility\n")).schemaVersion)
      .toBe("tavonel.export_signature.v1");

    const malformedStores = [
      "",
      "   ",
      "{",
      JSON.stringify({ schemaVersion: "tavonel.export_trust.v1", minimumSignatureVersion: 2,
        activeKeyId: keyId, keys: [validKey] }),
      JSON.stringify({ schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2,
        activeKeyId: keyId, keys: [{ ...validKey, publicKeySpkiSha256: `sha256:${"0".repeat(64)}` }] }),
      JSON.stringify({ schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2,
        activeKeyId: keyId, keys: [{ ...validKey, notBefore: validKey.expiresAt, expiresAt: validKey.notBefore }] }),
      JSON.stringify({ schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2,
        activeKeyId: keyId, keys: [{ ...validKey, status: "revoked" }] }),
    ];

    for (const configuredStore of malformedStores) {
      const env = { ...baseEnv, TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: configuredStore };
      expect(readExportTrustStoreEnv(env)).toBeNull();
      expect(readExportSignerEnv(env, new Date("2026-09-20T00:00:00.000Z"))).toBeNull();
    }

    vi.stubEnv("TAVONEL_EXPORT_SIGNING_KEY_ID", keyId);
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64", material.privateKeyPkcs8DerBase64);
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON", malformedStores[0]);
    const response = getExportTrust();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "EXPORT_SIGNER_INVALID" });
  });

  it("selects the active kid/version while retaining a retired key for rotation overlap", () => {
    const previous = keys();
    const current = keys();
    const trustKey = (
      keyId: string,
      keyVersion: number,
      material: ReturnType<typeof keys>,
      status: ExportTrustKey["status"],
    ): ExportTrustKey => ({
      keyId,
      keyVersion,
      algorithm: "Ed25519",
      status,
      notBefore: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
      publicKeySpkiDerBase64: material.publicKeySpkiDer.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(material.publicKeySpkiDer).digest("hex")}`,
    });
    const trust: ExportTrustStore = {
      schemaVersion: "tavonel.export_trust.v2",
      minimumSignatureVersion: 2,
      activeKeyId: "export-current",
      keys: [
        trustKey("export-previous", 1, previous, "retired"),
        trustKey("export-current", 2, current, "active"),
      ],
    };
    const env = {
      TAVONEL_EXPORT_SIGNING_KEY_ID: "export-current",
      TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: current.privateKeyPkcs8DerBase64,
      TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify(trust),
    };
    const signer = readExportSignerEnv(env, new Date("2026-09-20T00:00:00.000Z"));
    expect(signer?.keyVersion).toBe(2);
    const payload = Buffer.from("current export manifest\n");
    const currentSignature = signer!.signPayload(payload);
    expect(verifyExportSignatureWithTrustStore(payload, currentSignature, trust, new Date("2026-09-21T00:00:00.000Z"))).toBe(true);

    const previousSigner = createExportSigner({
      keyId: "export-previous",
      keyVersion: 1,
      privateKeyPkcs8DerBase64: previous.privateKeyPkcs8DerBase64,
      notBefore: trust.keys[0].notBefore,
      expiresAt: trust.keys[0].expiresAt,
      issuedAt: "2026-09-15T00:00:00.000Z",
    })!;
    expect(verifyExportSignatureWithTrustStore(payload, previousSigner.signPayload(payload), trust,
      new Date("2026-09-21T00:00:00.000Z"))).toBe(true);
    expect(readExportTrustStoreEnv(env)).toEqual(trust);
  });

  it("rejects revoked, expired, replayed, version-substituted and downgraded signatures", () => {
    const material = keys();
    const key: ExportTrustKey = {
      keyId: "export-current",
      keyVersion: 4,
      algorithm: "Ed25519",
      status: "active",
      notBefore: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-22T00:00:00.000Z",
      publicKeySpkiDerBase64: material.publicKeySpkiDer.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(material.publicKeySpkiDer).digest("hex")}`,
    };
    const trust: ExportTrustStore = {
      schemaVersion: "tavonel.export_trust.v2",
      minimumSignatureVersion: 2,
      activeKeyId: key.keyId,
      keys: [key],
    };
    const signer = createExportSigner({
      keyId: key.keyId,
      keyVersion: key.keyVersion,
      privateKeyPkcs8DerBase64: material.privateKeyPkcs8DerBase64,
      notBefore: key.notBefore,
      expiresAt: key.expiresAt,
      issuedAt: "2026-09-20T00:00:00.000Z",
    })!;
    const payload = Buffer.from("manifest A\n");
    const signature = signer.signPayload(payload) as ExportSignatureV2;
    const duringValidity = new Date("2026-09-21T00:00:00.000Z");

    expect(verifyExportSignatureWithTrustStore(Buffer.from("manifest B\n"), signature, trust, duringValidity)).toBe(false);
    expect(verifyExportSignatureWithTrustStore(payload, { ...signature, keyVersion: 3 }, trust, duringValidity)).toBe(false);
    expect(verifyExportSignatureWithTrustStore(payload, { ...signature, issuedAt: "2026-09-19T00:00:00.000Z" }, trust, duringValidity)).toBe(false);
    expect(verifyExportSignatureWithTrustStore(payload, signature, { ...trust, keys: [{ ...key, status: "revoked" }] }, duringValidity)).toBe(false);
    expect(verifyExportSignatureWithTrustStore(payload, signature, trust, new Date(key.expiresAt))).toBe(false);

    const legacy = createExportSigner({ keyId: key.keyId, privateKeyPkcs8DerBase64: material.privateKeyPkcs8DerBase64 })!;
    expect(verifyExportSignatureWithTrustStore(payload, legacy.signPayload(payload), trust, duringValidity)).toBe(false);
  });

  it("refuses malformed lifecycle policy and a private key that does not match the selected trust key", () => {
    const trusted = keys();
    const other = keys();
    const record = {
      keyId: "export-current",
      keyVersion: 2,
      algorithm: "Ed25519" as const,
      status: "active" as const,
      notBefore: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
      publicKeySpkiDerBase64: trusted.publicKeySpkiDer.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(trusted.publicKeySpkiDer).digest("hex")}`,
    };
    const env = {
      TAVONEL_EXPORT_SIGNING_KEY_ID: record.keyId,
      TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: other.privateKeyPkcs8DerBase64,
      TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify({
        schemaVersion: "tavonel.export_trust.v2",
        minimumSignatureVersion: 2,
        activeKeyId: record.keyId,
        keys: [record],
      }),
    };
    expect(readExportSignerEnv(env, new Date("2026-09-20T00:00:00.000Z"))).toBeNull();
    expect(readExportTrustStoreEnv({ ...env, TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify({
      schemaVersion: "tavonel.export_trust.v2",
      minimumSignatureVersion: 2,
      activeKeyId: record.keyId,
      keys: [{ ...record, notBefore: "2026-09-01" }],
    }) })).toBeNull();
  });

  it("keeps capability-manifest, world-release and developer-channel signatures to their own scope and refuses v1", () => {
    const material = keys();
    const payload = Buffer.from("scoped payload");
    const scopes: SignatureScope[] = [
      "tavonel.signed_export_manifest.v1", COMPILE_RECEIPT_SIGNATURE_SCOPE, ANSWER_RECEIPT_SIGNATURE_SCOPE,
      CAPABILITY_MANIFEST_SIGNATURE_SCOPE, WORLD_RELEASE_SIGNATURE_SCOPE, DEVELOPER_CHANNEL_SIGNATURE_SCOPE,
    ];
    for (const scope of [CAPABILITY_MANIFEST_SIGNATURE_SCOPE, WORLD_RELEASE_SIGNATURE_SCOPE, DEVELOPER_CHANNEL_SIGNATURE_SCOPE]) {
      const signer = createExportSigner({
        keyId: "scoped-key", keyVersion: 1, privateKeyPkcs8DerBase64: material.privateKeyPkcs8DerBase64,
        notBefore: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z",
        issuedAt: "2026-09-15T00:00:00.000Z", signatureScope: scope,
      })!;
      const signature = signer.signPayload(payload);
      for (const expected of scopes) {
        expect(verifyExportSignature(payload, signature, material.publicKeySpkiDer, expected)).toBe(expected === scope);
        expect(isScopedSignature(signature, expected)).toBe(expected === scope);
      }
    }
    const v1 = createExportSigner({ keyId: "scoped-key", privateKeyPkcs8DerBase64: material.privateKeyPkcs8DerBase64 })!
      .signPayload(payload) as ExportSignature;
    expect(v1.schemaVersion).toBe("tavonel.export_signature.v1");
    expect(isScopedSignature(v1, WORLD_RELEASE_SIGNATURE_SCOPE)).toBe(false);
    expect(isScopedSignature(v1, CAPABILITY_MANIFEST_SIGNATURE_SCOPE)).toBe(false);
    expect(isScopedSignature(v1, DEVELOPER_CHANNEL_SIGNATURE_SCOPE)).toBe(false);
  });

  /*
    WO-LOC-3: the channel signing script is a Node built-ins copy of the house v2 signer, so this runs the real
    script on a synthetic channel and checks its output with this module. The channel is written with sorted
    keys and no whitespace, which makes the file its own canonical JSON.
  */
  describe("scripts/sign-developer-channel.mjs", () => {
    const script = fileURLToPath(new URL("../scripts/sign-developer-channel.mjs", import.meta.url));
    let directory = "";
    afterEach(() => {
      if (directory) rmSync(directory, { recursive: true, force: true });
    });

    function channelDirectory(trustedKey: string) {
      directory = mkdtempSync(join(tmpdir(), "tavonel-channel-sign-"));
      const asset = Buffer.from("asset bytes\n");
      writeFileSync(join(directory, "a.mjs"), asset);
      const channel = Buffer.from(JSON.stringify({
        assets: { a: { sha256: `sha256:${createHash("sha256").update(asset).digest("hex")}`, url: "https://tavonel.com/developer/a.mjs" } },
        version: "2026.11.18.1",
      }));
      writeFileSync(join(directory, "channel.json"), channel);
      const publicKey = createPublicKey(createPrivateKey({ key: Buffer.from(trustedKey, "base64"), format: "der", type: "pkcs8" }))
        .export({ format: "der", type: "spki" });
      const trust: ExportTrustStore = {
        schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "test-channel-key",
        keys: [{
          keyId: "test-channel-key", keyVersion: 1, algorithm: "Ed25519", status: "active",
          notBefore: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          publicKeySpkiDerBase64: publicKey.toString("base64"),
          publicKeySpkiSha256: `sha256:${createHash("sha256").update(publicKey).digest("hex")}`,
        }],
      };
      writeFileSync(join(directory, "channel-trust.json"), JSON.stringify(trust));
      return { channel, trust };
    }

    function runScript(key: string | undefined) {
      const env = { ...process.env };
      delete env.TAVONEL_CHANNEL_SIGNING_KEY;
      if (key !== undefined) env.TAVONEL_CHANNEL_SIGNING_KEY = key;
      return spawnSync(process.execPath, [script, directory], { env, encoding: "utf8", timeout: 10_000 });
    }

    it("signs under the developer-channel scope only, verifiable with the trust record", () => {
      const key = keys().privateKeyPkcs8DerBase64;
      const { channel, trust } = channelDirectory(key);
      const outcome = runScript(key);
      expect(outcome.status, outcome.stderr).toBe(0);
      expect(`${outcome.stdout}${outcome.stderr}`).not.toContain(key);
      const signature = JSON.parse(readFileSync(join(directory, "channel.json.sig"), "utf8")) as ExportSignatureV2;
      expect(isScopedSignature(signature, DEVELOPER_CHANNEL_SIGNATURE_SCOPE)).toBe(true);
      expect(verifyExportSignatureWithTrustStore(channel, signature, trust, new Date(), DEVELOPER_CHANNEL_SIGNATURE_SCOPE)).toBe(true);
      for (const scope of [WORLD_RELEASE_SIGNATURE_SCOPE, CAPABILITY_MANIFEST_SIGNATURE_SCOPE, "tavonel.signed_export_manifest.v1"] as const) {
        expect(verifyExportSignatureWithTrustStore(channel, signature, trust, new Date(), scope)).toBe(false);
      }
      expect(verifyExportSignatureWithTrustStore(Buffer.from(channel.toString().replace("2026.11.18.1", "2026.11.18.2")),
        signature, trust, new Date(), DEVELOPER_CHANNEL_SIGNATURE_SCOPE)).toBe(false);
    }, 15_000);

    it("refuses, writing no signature, without a key, with a key the trust record does not name, or with a stale asset", () => {
      const key = keys().privateKeyPkcs8DerBase64;
      const other = keys().privateKeyPkcs8DerBase64;
      const cases: [string | undefined, RegExp, (() => void)?][] = [
        [undefined, /CHANNEL_SIGNING_KEY_MISSING/],
        ["not-a-key", /CHANNEL_SIGNING_KEY_INVALID/],
        [other, /CHANNEL_SIGNING_KEY_NOT_TRUSTED/],
        [key, /CHANNEL_ASSET_MISMATCH/, () => writeFileSync(join(directory, "a.mjs"), "changed after the digest\n")],
      ];
      for (const [signingKey, refusal, tamper] of cases) {
        channelDirectory(key);
        tamper?.();
        const outcome = runScript(signingKey);
        expect(outcome.status).toBe(1);
        expect(outcome.stderr).toMatch(refusal);
        if (signingKey) expect(`${outcome.stdout}${outcome.stderr}`).not.toContain(signingKey);
        expect(existsSync(join(directory, "channel.json.sig"))).toBe(false);
        rmSync(directory, { recursive: true, force: true });
      }
    }, 30_000);
  });
});
