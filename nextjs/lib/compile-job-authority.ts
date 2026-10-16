import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { googleDriveViewerLinkEnabled } from "./connector-oauth";
import { googleDriveAclMaxAgeSeconds } from "./connector-source-access";

export function compileJobAuthorityEnabled(): boolean {
  return process.env.TAVONEL_COMPILE_JOB_AUTHORITY_VERSION === "v1";
}

export type CompileSourceClassification =
  | { ok: true; scope: "direct_upload" | "connector" }
  | { ok: false; code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };

/** Classify queued documents without treating their enqueue creator as a provider viewer. */
export async function classifyCompileJobSources(input: {
  workspaceKey: string; documentIds: readonly string[];
}): Promise<CompileSourceClassification> {
  const config = readSupabaseAdminConfig();
  if (!config || input.documentIds.length < 1 || input.documentIds.length > 128) {
    return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
  }
  try {
    const ids = [...new Set(input.documentIds)].sort();
    const query = new URLSearchParams({
      workspace_key: `eq.${input.workspaceKey}`,
      document_id: `in.(${ids.join(",")})`,
      select: "document_id", limit: "129",
    });
    const response = await supabaseAdminRequest(config, `/rest/v1/connector_document_bindings?${query}`);
    if (!response.ok) return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" ||
        typeof (row as Record<string, unknown>).document_id !== "string" ||
        !ids.includes((row as Record<string, unknown>).document_id as string))) {
      return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
    }
    return { ok: true, scope: rows.length === 0 ? "direct_upload" : "connector" };
  } catch {
    return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
  }
}

export type CompileJobAuthorityResult =
  | { ok: true }
  | { ok: false; code: "COMPILE_JOB_AUTHORITY_DENIED" | "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };

/**
 * Ask the database to authorize a durable job at each protected phase. The RPC accepts only a
 * job key plus an expected phase: it derives the actor, revision, workspace, documents, source
 * versions, provider link, consent and ACL capture from immutable job rows. A missing draft RPC,
 * disabled rollout, malformed scope, or unreadable answer denies the operation.
 */
export async function authorizeCompileJobSourceAccess(input: {
  jobId: string;
  workspaceKey: string;
  documentIds: readonly string[];
  phase: "before_source_read" | "before_core" | "after_core" | "before_persist";
}): Promise<CompileJobAuthorityResult> {
  if (!/^cjob-[a-f0-9]{32}$/.test(input.jobId) || !WORKSPACE_ID_PATTERN.test(input.workspaceKey) ||
      input.documentIds.length < 1 || input.documentIds.length > 128 ||
      input.documentIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
  const maxAgeSeconds = googleDriveAclMaxAgeSeconds();
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/authorize_foundation_compile_job", {
      method: "POST",
      body: JSON.stringify({
        p_job_id: input.jobId,
        p_expected_workspace_key: input.workspaceKey,
        p_expected_document_ids: [...new Set(input.documentIds)].sort(),
        p_phase: input.phase,
        // Direct uploads may continue under their existing approved-intake gates. Connector
        // jobs remain denied until OAuth consent, provider capture, and viewer-link rollout are on.
        p_connector_viewer_enabled: googleDriveViewerLinkEnabled(),
        // Same server-owned validated limit used by interactive viewer checks. Null reaches SQL
        // as an invalid bound and denies connector work; direct-upload jobs remain unaffected.
        p_max_age_seconds: maxAgeSeconds,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
    const allowed: unknown = await response.json();
    if (allowed === true) return { ok: true };
    if (allowed === false) return { ok: false, code: "COMPILE_JOB_AUTHORITY_DENIED" };
    return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
  } catch {
    return { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" };
  }
}
