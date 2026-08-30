import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { zipSync } from "fflate";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const MANIFEST_PATH = "manifest/export-manifest.json";
const SIGNATURE_PATH = "signatures/export-manifest.ed25519.json";
const digest = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

test("accepts an intact signed export and rejects content, manifest, signature and inventory tampering", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "launch-chromium", "cryptographic verifier is browser-independent");
  const directory = await mkdtemp(join(tmpdir(), "tavonel-export-qa-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
    const contentPath = "ontology/knowledge.jsonld";
    const content = Buffer.from('{"name":"TAVONEL"}\n');
    const manifest = Buffer.from(JSON.stringify({
      schemaVersion: "tavonel.signed_export_manifest.v1",
      collectionId: `collection-${"a".repeat(32)}`,
      files: [{ path: contentPath, sizeBytes: content.byteLength, sha256: digest(content) }],
    }));
    const signature = sign(null, manifest, privateKey);
    const receiptRecord = {
      schemaVersion: "tavonel.export_signature.v1",
      algorithm: "Ed25519",
      keyId: "launch-qa",
      publicKeySpkiDerBase64: publicKeyDer.toString("base64"),
      publicKeySpkiSha256: digest(publicKeyDer),
      signedPayloadSha256: digest(manifest),
      signatureBase64: signature.toString("base64"),
    };
    const receipt = Buffer.from(JSON.stringify(receiptRecord));
    const changedSignature = `${receiptRecord.signatureBase64[0] === "A" ? "B" : "A"}${receiptRecord.signatureBase64.slice(1)}`;
    const entries = {
      [contentPath]: content,
      [MANIFEST_PATH]: manifest,
      [SIGNATURE_PATH]: receipt,
    };
    const cases = [
      { name: "valid", archive: zipSync(entries), ok: true, message: '"ok":true' },
      { name: "content", archive: zipSync({ ...entries, [contentPath]: Buffer.from("tampered") }), ok: false, message: "size mismatch" },
      { name: "manifest", archive: zipSync({ ...entries, [MANIFEST_PATH]: Buffer.concat([manifest, Buffer.from(" ")]) }), ok: false, message: "manifest digest" },
      { name: "signature", archive: zipSync({ ...entries, [SIGNATURE_PATH]: Buffer.from(JSON.stringify({ ...receiptRecord, signatureBase64: changedSignature })) }), ok: false, message: "verification failed" },
      { name: "extra", archive: zipSync({ ...entries, "unsigned.txt": Buffer.from("not in manifest") }), ok: false, message: "unsigned extra file" },
    ];

    for (const fixture of cases) {
      const archivePath = join(directory, `${fixture.name}.zip`);
      await writeFile(archivePath, fixture.archive);
      const result = spawnSync(process.execPath, [
        resolve("scripts/verify-signed-export.mjs"),
        "--archive", archivePath,
        "--trusted-fingerprint", digest(publicKeyDer),
      ], { cwd: process.cwd(), encoding: "utf8" });
      expect(result.status, `${fixture.name}: ${result.stderr}`).toBe(fixture.ok ? 0 : 1);
      expect(`${result.stdout}${result.stderr}`).toContain(fixture.message);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
