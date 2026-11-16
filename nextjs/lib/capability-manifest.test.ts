import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  manifestFromToolTable, parseCapabilityManifest, signCapabilityManifest, verifyCapabilityManifest,
  type CapabilityManifest,
} from "./capability-manifest";
import {
  CAPABILITY_MANIFEST_SIGNATURE_SCOPE, createExportSigner, type ExportTrustStore, type SignatureScope,
} from "./export-signing";
import { REMOTE_MCP_TOOL_SCOPES } from "./remote-mcp";

const ISSUED = "2026-11-16T00:00:00.000Z";
const EXPIRES = "2026-12-16T00:00:00.000Z";
const NOW = new Date("2026-11-20T00:00:00.000Z");
const META = { manifestId: "cap-1", issuedAt: ISSUED, expiresAt: EXPIRES };

function setup(status: "active" | "retired" | "revoked" = "active", scope: SignatureScope = CAPABILITY_MANIFEST_SIGNATURE_SCOPE) {
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  const trust: ExportTrustStore = {
    schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "cap-key-2026",
    keys: [{
      keyId: "cap-key-2026", keyVersion: 1, algorithm: "Ed25519", status,
      notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z",
      publicKeySpkiDerBase64: spki.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
    }],
  };
  const signer = createExportSigner({
    keyId: "cap-key-2026", keyVersion: 1, privateKeyPkcs8DerBase64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z", issuedAt: ISSUED, signatureScope: scope,
  })!;
  return { trust, signer };
}
const table = () => manifestFromToolTable(Object.keys(REMOTE_MCP_TOOL_SCOPES), REMOTE_MCP_TOOL_SCOPES, META);

describe("capability manifest", () => {
  it("the current tool table yields an all-read manifest equal to the scope table", () => {
    const m = table();
    expect(m.tools.map((t) => t.name)).toEqual(Object.keys(REMOTE_MCP_TOOL_SCOPES));
    expect(m.tools.every((t) => t.mode === "read")).toBe(true);
    expect(Object.fromEntries(m.tools.map((t) => [t.name, t.scope]))).toEqual(REMOTE_MCP_TOOL_SCOPES);
    expect(parseCapabilityManifest(JSON.stringify(m))).toEqual({ ok: true, manifest: m });
  });

  it("refuses write mode, unknown action, duplicates, bad expiry", () => {
    const base = table();
    const withTool = (tool: object): CapabilityManifest => ({ ...base, tools: [...base.tools, tool as never] });
    expect(parseCapabilityManifest(withTool({ name: "w", mode: "write", scope: "x" }))).toEqual({ ok: false, reason: "mode_not_allowed" });
    expect(parseCapabilityManifest(withTool({ name: "p", mode: "propose", scope: "x", proposalActionType: "delete_world" }))).toEqual({ ok: false, reason: "unknown_action" });
    expect(parseCapabilityManifest(withTool({ name: "p", mode: "propose", scope: "x" }))).toEqual({ ok: false, reason: "unknown_action" });
    expect(parseCapabilityManifest(withTool({ name: base.tools[0].name, mode: "read", scope: "x" }))).toEqual({ ok: false, reason: "duplicate_tool" });
    expect(parseCapabilityManifest({ ...base, expiresAt: ISSUED })).toEqual({ ok: false, reason: "expiry_not_after_issue" });
    expect(parseCapabilityManifest("{nope")).toEqual({ ok: false, reason: "malformed" });
    expect(parseCapabilityManifest(withTool({ name: "p", mode: "propose", scope: "proposals:write", proposalActionType: "library_label" })).ok).toBe(true);
  });

  it("verifies a signed manifest, and refuses expiry, revoked or retired key, wrong scope, v1, tampering", () => {
    const { trust, signer } = setup();
    const m = table();
    const sig = signCapabilityManifest(m, signer);
    expect(verifyCapabilityManifest(m, sig, trust, NOW)).toEqual({ ok: true, manifest: m });
    expect(verifyCapabilityManifest(m, sig, trust, new Date(EXPIRES))).toEqual({ ok: false, reason: "manifest_expired" });

    const revoked = { ...trust, keys: [{ ...trust.keys[0], status: "revoked" as const }] };
    expect(verifyCapabilityManifest(m, sig, revoked, NOW)).toEqual({ ok: false, reason: "signature_invalid" });
    const retired = { ...trust, keys: [{ ...trust.keys[0], status: "retired" as const }] };
    expect(verifyCapabilityManifest(m, sig, retired, NOW)).toEqual({ ok: false, reason: "key_retired" });

    const tampered = { ...m, tools: [...m.tools, { name: "extra", mode: "read" as const, scope: "worlds:read" }] };
    expect(verifyCapabilityManifest(tampered, sig, trust, NOW)).toEqual({ ok: false, reason: "signature_invalid" });
    const widened = { ...m, tools: m.tools.map((t, i) => (i === 0 ? { ...t, scope: "collections:download" } : t)) };
    expect(verifyCapabilityManifest(widened, sig, trust, NOW)).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("refuses a signature made under the export scope, and a v1 signature", () => {
    const exp = setup("active", "tavonel.signed_export_manifest.v1");
    const m = table();
    expect(() => signCapabilityManifest(m, exp.signer)).toThrow("capability_manifest_signer_wrong_scope");
    const exportSig = exp.signer.signPayload(Buffer.from("x"));
    expect(verifyCapabilityManifest(m, exportSig, exp.trust, NOW)).toEqual({ ok: false, reason: "wrong_signature_scope" });

    const pair = generateKeyPairSync("ed25519");
    const v1 = createExportSigner({ keyId: "cap-key-2026", privateKeyPkcs8DerBase64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") })!;
    expect(() => signCapabilityManifest(m, v1)).toThrow("capability_manifest_signer_wrong_scope");
    expect(verifyCapabilityManifest(m, v1.signPayload(Buffer.from("x")), exp.trust, NOW)).toEqual({ ok: false, reason: "wrong_signature_scope" });
  });

  it("refuses to build a manifest for a tool with no scope", () => {
    expect(() => manifestFromToolTable(["ghost"], REMOTE_MCP_TOOL_SCOPES, META)).toThrow("capability_manifest_unscoped_tool:ghost");
  });
});
