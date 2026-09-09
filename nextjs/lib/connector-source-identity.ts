import { createHash } from "node:crypto";
import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { deterministicSourceDocumentId } from "./source-intake";
import type { OAuthConnectorProvider } from "./connector-oauth";

export type ConnectorSourceIdentity = {
  sourceId: string;
  sourceVersionId: string;
  documentId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS: readonly string[] = ["google_drive", "dropbox", "microsoft_graph"];
function opaque(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

/** Logical identity excludes names, paths and revisions. Version identity includes revision. */
export async function connectorSourceIdentity(input: {
  workspaceKey: string; connectionId: string; provider: OAuthConnectorProvider; nativeId: string; revision: string;
}): Promise<ConnectorSourceIdentity> {
  if (!WORKSPACE_ID_PATTERN.test(input.workspaceKey) || !UUID.test(input.connectionId) ||
      !PROVIDERS.includes(input.provider) || !opaque(input.nativeId) || !opaque(input.revision)) {
    throw new Error("SOURCE_IDENTITY_INVALID");
  }
  const sourceId = `src-${digest(JSON.stringify(["connector.v1", input.workspaceKey, input.connectionId, input.provider, input.nativeId]))}`;
  const sourceVersionId = `sv-${digest(JSON.stringify([sourceId, input.revision]))}`;
  // Preserve existing quarantine identities for valid provider revisions. Reject delimiter
  // ambiguity above instead of silently reassigning already-admitted documents.
  const legacyKey = digest(`${input.connectionId}\u001f${input.nativeId}\u001f${input.revision}`);
  return { sourceId, sourceVersionId, documentId: await deterministicSourceDocumentId(input.workspaceKey, legacyKey) };
}
