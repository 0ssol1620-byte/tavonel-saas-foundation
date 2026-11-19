import { REMOTE_MCP_TOOL_SCOPES } from "./remote-mcp";
import { PROPOSAL_ACTION_TYPES } from "./change-proposals";
import {
  CAPABILITY_MANIFEST_SIGNATURE_SCOPE,
  isScopedSignature,
  verifyExportSignatureWithTrustStore,
  type ExportSignature,
  type ExportSigner,
  type ExportTrustStore,
} from "./export-signing";

/**
 * D31 M9-04. An agent can only read, or file a proposal (D30). There is no `write` mode: execution happens
 * in the app after a person confirms. Signed v2-only under CAPABILITY_MANIFEST_SIGNATURE_SCOPE.
 */
export const CAPABILITY_MANIFEST_SCHEMA = "tavonel.capability_manifest.v1" as const;

export type CapabilityTool = {
  name: string;
  mode: "read" | "propose";
  scope: string;
  proposalActionType?: string;
};

export type CapabilityManifest = {
  schemaVersion: typeof CAPABILITY_MANIFEST_SCHEMA;
  manifestId: string;
  issuedAt: string;
  expiresAt: string;
  tools: CapabilityTool[];
};

export type CapabilityManifestRefusal =
  | "malformed" | "mode_not_allowed" | "unknown_action" | "duplicate_tool" | "expiry_not_after_issue"
  | "wrong_signature_scope" | "signature_invalid" | "manifest_expired" | "key_retired";

export type CapabilityManifestResult =
  | { ok: true; manifest: CapabilityManifest }
  | { ok: false; reason: CapabilityManifestRefusal };

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const instant = (value: unknown) => {
  if (typeof value !== "string" || !INSTANT.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
};
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const refuse = (reason: CapabilityManifestRefusal): CapabilityManifestResult => ({ ok: false, reason });

/** Every tool in the existing bridge table is a read tool. */
export function manifestFromToolTable(
  tools: readonly string[],
  scopes: Readonly<Record<string, string>> = REMOTE_MCP_TOOL_SCOPES,
  meta: { manifestId: string; issuedAt: string; expiresAt: string },
): CapabilityManifest {
  return {
    schemaVersion: CAPABILITY_MANIFEST_SCHEMA,
    ...meta,
    tools: tools.map((name) => {
      const scope = scopes[name];
      if (scope === undefined) throw new Error(`capability_manifest_unscoped_tool:${name}`);
      return { name, mode: "read" as const, scope };
    }),
  };
}

export function parseCapabilityManifest(json: unknown): CapabilityManifestResult {
  let value: unknown = json;
  if (typeof json === "string") {
    try { value = JSON.parse(json); } catch { return refuse("malformed"); }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse("malformed");
  const m = value as Record<string, unknown>;
  const issued = instant(m.issuedAt);
  const expires = instant(m.expiresAt);
  if (m.schemaVersion !== CAPABILITY_MANIFEST_SCHEMA || !isText(m.manifestId) || issued === null || expires === null
    || !Array.isArray(m.tools) || m.tools.length === 0) return refuse("malformed");
  if (expires <= issued) return refuse("expiry_not_after_issue");
  const seen = new Set<string>();
  const tools: CapabilityTool[] = [];
  for (const raw of m.tools as unknown[]) {
    if (typeof raw !== "object" || raw === null) return refuse("malformed");
    const t = raw as Record<string, unknown>;
    if (!isText(t.name) || !isText(t.scope)) return refuse("malformed");
    if (t.mode !== "read" && t.mode !== "propose") return refuse(typeof t.mode === "string" ? "mode_not_allowed" : "malformed");
    if (seen.has(t.name)) return refuse("duplicate_tool");
    seen.add(t.name);
    if (t.mode === "propose") {
      if (typeof t.proposalActionType !== "string" || !(PROPOSAL_ACTION_TYPES as readonly string[]).includes(t.proposalActionType)) {
        return refuse("unknown_action");
      }
      tools.push({ name: t.name, mode: "propose", scope: t.scope, proposalActionType: t.proposalActionType });
    } else {
      if (t.proposalActionType !== undefined) return refuse("malformed");
      tools.push({ name: t.name, mode: "read", scope: t.scope });
    }
  }
  return { ok: true, manifest: { schemaVersion: CAPABILITY_MANIFEST_SCHEMA, manifestId: m.manifestId, issuedAt: m.issuedAt as string, expiresAt: m.expiresAt as string, tools } };
}

/** Fixed key order, so the signed bytes do not depend on how the object was built. */
const payloadOf = (manifest: CapabilityManifest) => Buffer.from(JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  manifestId: manifest.manifestId,
  issuedAt: manifest.issuedAt,
  expiresAt: manifest.expiresAt,
  tools: manifest.tools.map((t) => ({ name: t.name, mode: t.mode, scope: t.scope, proposalActionType: t.proposalActionType ?? null })),
}), "utf8");

/** The signer must have been created with signatureScope CAPABILITY_MANIFEST_SIGNATURE_SCOPE. */
export function signCapabilityManifest(manifest: CapabilityManifest, signer: ExportSigner): ExportSignature {
  const parsed = parseCapabilityManifest(manifest);
  if (!parsed.ok) throw new Error(`capability_manifest_invalid:${parsed.reason}`);
  const signature = signer.signPayload(payloadOf(parsed.manifest));
  if (!isScopedSignature(signature, CAPABILITY_MANIFEST_SIGNATURE_SCOPE)) throw new Error("capability_manifest_signer_wrong_scope");
  return signature;
}

export function verifyCapabilityManifest(
  manifest: unknown,
  signature: ExportSignature,
  trust: ExportTrustStore,
  now = new Date(),
): CapabilityManifestResult {
  const parsed = parseCapabilityManifest(manifest);
  if (!parsed.ok) return parsed;
  if (!isScopedSignature(signature, CAPABILITY_MANIFEST_SIGNATURE_SCOPE)) return refuse("wrong_signature_scope");
  if (now.getTime() >= Date.parse(parsed.manifest.expiresAt)) return refuse("manifest_expired");
  const key = trust.keys.find((k) => k.keyId === signature.keyId && k.keyVersion === (signature as { keyVersion: number }).keyVersion);
  // A retired key signs nothing new; a capability grant is short-lived, so it is not honoured either.
  if (key?.status === "retired") return refuse("key_retired");
  if (!verifyExportSignatureWithTrustStore(payloadOf(parsed.manifest), signature, trust, now, CAPABILITY_MANIFEST_SIGNATURE_SCOPE)) {
    return refuse("signature_invalid");
  }
  return parsed;
}
