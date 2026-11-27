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

/**
 * A local-folder source (migration 20261127110000, local_folder_source_identity). The logical id is
 * (workspace, foundation connection, path, generation): a path removed and later re-added is a new
 * generation, i.e. a new logical source. The version id carries the revision and the uploaded
 * document, so reverting to earlier bytes is either the same version again or a new one -- never a
 * second current document. The database derives these inside the batch; this is its twin.
 */
export function localFolderSourceIdentity(input: {
  workspaceKey: string; connectionId: string; nativeId: string; generation: number; revision: string; documentId: string;
}): { sourceId: string; sourceVersionId: string } {
  if (!WORKSPACE_ID_PATTERN.test(input.workspaceKey) || !UUID.test(input.connectionId) || !UUID.test(input.documentId) ||
      !Number.isSafeInteger(input.generation) || input.generation < 0 || input.generation > 1_000_000 ||
      typeof input.nativeId !== "string" || input.nativeId.length < 1 || input.nativeId.length > 1024 ||
      /[\u0000-\u001f\u007f]/.test(input.nativeId) || !opaque(input.revision)) {
    throw new Error("SOURCE_IDENTITY_INVALID");
  }
  const logical: unknown[] = ["connector.v1", input.workspaceKey, input.connectionId.toLowerCase(), "local_folder", input.nativeId];
  if (input.generation > 0) logical.push(input.generation);
  const sourceId = `src-${digest(JSON.stringify(logical))}`;
  return { sourceId, sourceVersionId: `sv-${digest(JSON.stringify([sourceId, input.revision, input.documentId.toLowerCase()]))}` };
}

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
