import { createHash } from "node:crypto";
import {
  admitsWorkspace,
  QUALIFICATION_MAX_MS,
  releaseDecisionQuery,
  verifyStoredRelease,
  workspaceGrantSha256,
  type CustomerDataScope,
  type ReleaseStage,
  type WorkspaceGrant,
} from "../../shared/scopedCustomerDataGate";
import { activationPolicy } from "./activation-policy";
import { loadPublishedProcessingTerms, type ProcessingTermsManifest } from "./processing-terms-acceptance";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  Issues or renews the v2 workspace grant the scoped customer-data gate reads. The only inputs
  are durable ones: the latest release decision for the exact deployed SHA and scope, or for the
  deployment's gate surface (D-05, docs/adr/0006; recomputed like the gate reader does), the published terms manifest (re-hashed from disk) and the current
  owner's persisted acceptance of it, narrowed by the optional operator rollout cohort. A
  qualification release yields an hour-bounded qualification grant for its one recorded workspace,
  and only when the caller opts in (the owner's own bootstrap); billing renewal never does. It never
  records release evidence or an acceptance, flips TAVONEL_CUSTOMER_DATA_GATE_VERSION, starts a
  trial or charges.

  issue_customer_data_workspace_grant() rechecks all of it under locks and refuses to write over
  the workspace's latest explicit refusal. The caller must already have authorized the session for
  `workspaceKey`; membership revocation is still enforced at every entry point.
*/

const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
const REVISION = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Env = Readonly<Record<string, string | undefined>>;
type Config = NonNullable<ReturnType<typeof readSupabaseAdminConfig>>;
export type WorkspaceGrantFailureCode =
  | "WORKSPACE_GRANT_INPUT_INVALID" | "WORKSPACE_GRANT_STORE_NOT_CONFIGURED" | "WORKSPACE_GRANT_STORE_FAILED"
  | "PROCESSING_TERMS_UNAVAILABLE" | "PROCESSING_TERMS_ACCEPTANCE_REQUIRED"
  | "SCOPED_RELEASE_NOT_FOUND" | "SCOPED_RELEASE_REFUSED" | "SCOPED_RELEASE_INVALID"
  | "SCOPED_RELEASE_STALE" | "SCOPED_RELEASE_CHANGED" | "SCOPED_WORKSPACE_REFUSED"
  | "SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE" | "SCOPED_RELEASE_QUALIFICATION_ONLY" | "SCOPED_QUALIFICATION_REFUSED"
  | "PROCESSING_COHORT_EXCLUDED" | "PROCESSING_COHORT_CONFIG_INVALID";
export type WorkspaceGrantResult =
  | { ok: true; grant: WorkspaceGrant; idempotentReplay: boolean }
  | { ok: false; code: WorkspaceGrantFailureCode };

const fail = <C extends WorkspaceGrantFailureCode>(code: C) => ({ ok: false as const, code });
const SURFACE = /^sha256:[0-9a-f]{64}$/;

/**
 * D-05 (docs/adr/0006): this deployment's gate-surface digest, computed from its own commit by
 * next.config.mjs and inlined at build. The literal `process.env.…` is what the bundler replaces;
 * an injected env (tests) is read as given. Anything malformed or absent is null, and null
 * inherits nothing: the gate then reads only the exact-SHA release, as before.
 */
export function deployedGateSurface(env: Env = process.env): string | null {
  const value = env === process.env ? process.env.TAVONEL_GATE_SURFACE_SHA256 : env.TAVONEL_GATE_SURFACE_SHA256;
  return typeof value === "string" && SURFACE.test(value) ? value : null;
}
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sha256 = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** Mirrors processing_terms_receipt_sha256() in migration 20260930030000. */
export function processingTermsReceiptSha256(kind: "terms" | "processing", acceptance: {
  acceptanceId: string; workspaceKey: string; userId: string; authorizationRevision: number;
  scope: CustomerDataScope; termsVersion: string; document: { path: string; sha256: string };
}): string {
  return sha256(["tavonel.processing_terms_receipt.v1", kind, acceptance.acceptanceId.toLowerCase(),
    acceptance.workspaceKey, acceptance.userId.toLowerCase(), String(acceptance.authorizationRevision),
    acceptance.scope, acceptance.termsVersion, acceptance.document.path, acceptance.document.sha256].join("|"));
}

/**
 * TAVONEL_PROCESSING_WORKSPACE_COHORT: optional comma-separated list of exact workspace keys for a
 * bounded rollout. Unset adds no restriction. Set, it is an extra AND on every grant and every
 * processing authorization read, per scope -- it never admits anything by itself. An empty or
 * malformed value (wildcards and prefixes included) admits nobody.
 *
 * D-19 (register 2026-10-17): while the self-serve launch switch is on
 * (`activationPolicy.customerData.enabled`, flipped only by P2-37), processing runs under gate v2
 * inside a canary of one to LAUNCH_CANARY_MAX_WORKSPACES named workspaces. An unset cohort, a wider
 * list or any gate other than v2 is then a configuration error and admits nobody. While the switch
 * is off -- production today -- this adds nothing. Widening past the canary is a reviewed change here.
 */
export const LAUNCH_CANARY_MAX_WORKSPACES = 3;
export function processingCohortRefusal(workspaceKey: string, env: Env = process.env):
  "PROCESSING_COHORT_EXCLUDED" | "PROCESSING_COHORT_CONFIG_INVALID" | null {
  const raw = env.TAVONEL_PROCESSING_WORKSPACE_COHORT;
  const launch: boolean = activationPolicy.customerData.enabled;
  if (launch && (raw === undefined || env.TAVONEL_CUSTOMER_DATA_GATE_VERSION !== "v2")) return "PROCESSING_COHORT_CONFIG_INVALID";
  if (raw === undefined) return null;
  const ids = raw.split(",").map((id) => id.trim());
  if (ids.length > (launch ? LAUNCH_CANARY_MAX_WORKSPACES : 20) || !ids.every((id) => WORKSPACE.test(id))) {
    return "PROCESSING_COHORT_CONFIG_INVALID";
  }
  return ids.includes(workspaceKey) ? null : "PROCESSING_COHORT_EXCLUDED";
}

async function call(config: Config, path: string, init?: RequestInit) {
  try { return await supabaseAdminRequest(config, path, { ...init, signal: AbortSignal.timeout(5_000) }); }
  catch { return null; }
}

function parseAcceptance(value: unknown, workspaceKey: string, scope: CustomerDataScope, manifest: ProcessingTermsManifest, now: number) {
  if (!isRecord(value) || !isRecord(value.terms) || !isRecord(value.processing)) return null;
  if (typeof value.acceptanceId !== "string" || !UUID.test(value.acceptanceId) ||
    value.workspaceKey !== workspaceKey || typeof value.userId !== "string" || !UUID.test(value.userId) ||
    value.actorRole !== "owner" || !Number.isSafeInteger(value.authorizationRevision) ||
    Number(value.authorizationRevision) < 1 || value.scope !== scope || value.termsVersion !== manifest.version ||
    value.terms.path !== manifest.terms.path || value.terms.sha256 !== manifest.terms.sha256 ||
    value.processing.path !== manifest.processing.path || value.processing.sha256 !== manifest.processing.sha256 ||
    !iso(value.acceptedAt) || Date.parse(value.acceptedAt) > now) return null;
  return { acceptanceId: value.acceptanceId.toLowerCase(), workspaceKey, userId: value.userId.toLowerCase(),
    authorizationRevision: Number(value.authorizationRevision), scope, termsVersion: manifest.version };
}

export type CurrentProcessingTermsAcceptance = {
  ok: true;
  manifest: ProcessingTermsManifest;
  acceptanceId: string;
  userId: string;
  termsReceiptSha256: string;
  processingTermsReceiptSha256: string;
};

/**
 * The served manifest (re-hashed from disk) and the workspace's current owner's acceptance of it,
 * as the receipt hashes a grant must carry. Used to issue a grant and again by the gate reader, so
 * a grant stops admitting once its owner is revoked or replaced or the served documents change.
 */
export async function readCurrentProcessingTermsAcceptance(
  config: Config, workspaceKey: string, scope: CustomerDataScope, now: number, publicDir?: string,
): Promise<CurrentProcessingTermsAcceptance | { ok: false; code:
  "PROCESSING_TERMS_UNAVAILABLE" | "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" | "WORKSPACE_GRANT_STORE_FAILED" }> {
  if (!WORKSPACE.test(workspaceKey)) return fail("PROCESSING_TERMS_ACCEPTANCE_REQUIRED");
  const published = await loadPublishedProcessingTerms(publicDir);
  if (!published.ok) return fail("PROCESSING_TERMS_UNAVAILABLE");
  const { manifest } = published;
  const response = await call(config, "/rest/v1/rpc/current_foundation_processing_terms_acceptance", {
    method: "POST",
    body: JSON.stringify({ p_workspace_key: workspaceKey, p_scope: scope, p_terms_version: manifest.version,
      p_terms_sha256: manifest.terms.sha256, p_processing_sha256: manifest.processing.sha256 }),
  });
  if (!response?.ok) return fail("WORKSPACE_GRANT_STORE_FAILED");
  const body = await response.json().catch(() => undefined) as unknown;
  if (body === undefined) return fail("WORKSPACE_GRANT_STORE_FAILED");
  const acceptance = parseAcceptance(body, workspaceKey, scope, manifest, now);
  if (!acceptance) return fail("PROCESSING_TERMS_ACCEPTANCE_REQUIRED");
  return {
    ok: true, manifest, acceptanceId: acceptance.acceptanceId, userId: acceptance.userId,
    termsReceiptSha256: processingTermsReceiptSha256("terms", { ...acceptance, document: manifest.terms }),
    processingTermsReceiptSha256: processingTermsReceiptSha256("processing", { ...acceptance, document: manifest.processing }),
  };
}

const RPC_ERRORS: Record<string, WorkspaceGrantFailureCode> = {
  workspace_grant_refused: "SCOPED_WORKSPACE_REFUSED",
  workspace_grant_release_changed: "SCOPED_RELEASE_CHANGED",
  workspace_grant_acceptance_required: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED",
  workspace_grant_input_invalid: "WORKSPACE_GRANT_INPUT_INVALID",
  workspace_grant_qualification_refused: "SCOPED_QUALIFICATION_REFUSED",
};

export async function issueProcessingWorkspaceGrant(input: {
  workspaceKey: string;
  scope: CustomerDataScope;
  now?: Date;
  env?: Env;
  publicDir?: string;
  /** Only the owner's own authenticated bootstrap may take a qualification grant. */
  allowQualification?: boolean;
}): Promise<WorkspaceGrantResult> {
  const env = input.env ?? process.env;
  const now = (input.now ?? new Date()).getTime();
  // The deployed revision, never a caller-chosen one: evidence for another build cannot grant this one.
  const revision = env.VERCEL_GIT_COMMIT_SHA ?? "";
  const { workspaceKey, scope } = input;
  if (!WORKSPACE.test(workspaceKey) || (scope !== "direct_upload" && scope !== "connector") ||
    !REVISION.test(revision) || !Number.isFinite(now)) return fail("WORKSPACE_GRANT_INPUT_INVALID");
  const config = readSupabaseAdminConfig(env);
  if (!config) return fail("WORKSPACE_GRANT_STORE_NOT_CONFIGURED");

  // The first failure is what the owner is told, so check in the order the facts hold: an explicit
  // refusal outranks everything, then the owner's own consent, and only then rollout and release.
  // Otherwise a workspace with neither terms nor a release would read as "terms accepted".
  const latestQuery = new URLSearchParams({
    select: "allowed", tenant_id: `eq.${workspaceKey}`, workspace_id: `eq.${workspaceKey}`, scope: `eq.${scope}`,
    order: "recorded_at.desc,allowed.asc", limit: "1",
  });
  const latestResponse = await call(config, `/rest/v1/customer_data_workspace_decisions?${latestQuery}`);
  const latest = latestResponse?.ok ? await latestResponse.json().catch(() => null) as unknown : null;
  if (!Array.isArray(latest)) return fail("WORKSPACE_GRANT_STORE_FAILED");
  if (isRecord(latest[0]) && latest[0].allowed === false) return fail("SCOPED_WORKSPACE_REFUSED");

  const current = await readCurrentProcessingTermsAcceptance(config, workspaceKey, scope, now, input.publicDir);
  if (!current.ok) return current;
  const { manifest } = current;

  const cohort = processingCohortRefusal(workspaceKey, env);
  if (cohort) return fail(cohort);

  const gateSurfaceSha256 = deployedGateSurface(env);
  const releaseQuery = releaseDecisionQuery(scope, revision, gateSurfaceSha256);
  const releaseResponse = await call(config, `/rest/v1/customer_data_release_decisions?${releaseQuery}`);
  if (!releaseResponse?.ok) return fail("WORKSPACE_GRANT_STORE_FAILED");
  const rows = await releaseResponse.json().catch(() => null) as unknown;
  if (!Array.isArray(rows)) return fail("WORKSPACE_GRANT_STORE_FAILED");
  if (rows.length === 0) return fail("SCOPED_RELEASE_NOT_FOUND");
  if (rows.length !== 1 || !isRecord(rows[0])) return fail("SCOPED_RELEASE_INVALID");
  // The latest row is the decision: a later production refusal is final, never a cue to qualify.
  const verified = verifyStoredRelease(rows[0],
    { scope, releaseRevision: revision, workspaceId: workspaceKey, gateSurfaceSha256 }, now);
  if (!verified.ok) return verified;
  const { release } = verified;
  const stage: ReleaseStage = release.stage;
  // The grant names the revision its release was recorded for: the deployed SHA itself, or the
  // revision whose gate surface this deployment shares (D-05). The RPC rechecks that release.
  const releaseRevision = release.releaseRevision;
  if (stage === "qualification" && !input.allowQualification) return fail("SCOPED_RELEASE_QUALIFICATION_ONLY");

  const expires = stage === "qualification"
    ? Math.min(now + QUALIFICATION_MAX_MS, Date.parse(release.qualification!.expiresAt))
    : Math.min(now + MAX_AGE_MS, Date.parse(release.evaluatedAt) + MAX_AGE_MS);
  const unsigned: Omit<WorkspaceGrant, "grantReceiptSha256"> = {
    tenantId: workspaceKey, workspaceId: workspaceKey, userId: current.userId, scope, stage,
    releaseRevision, releaseReceiptSha256: release.receiptSha256!, termsVersion: manifest.version,
    termsReceiptSha256: current.termsReceiptSha256,
    processingTermsReceiptSha256: current.processingTermsReceiptSha256,
    grantedAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString(), revokedAt: null,
  };
  if (expires <= now) return fail("SCOPED_RELEASE_STALE");
  const grantResponse = await call(config, "/rest/v1/rpc/issue_customer_data_workspace_grant", {
    method: "POST",
    body: JSON.stringify({
      p_workspace_key: workspaceKey, p_scope: scope, p_release_revision: releaseRevision,
      p_release_receipt_sha256: unsigned.releaseReceiptSha256, p_acceptance_id: current.acceptanceId,
      p_terms_version: manifest.version, p_terms_path: manifest.terms.path, p_terms_sha256: manifest.terms.sha256,
      p_processing_path: manifest.processing.path, p_processing_sha256: manifest.processing.sha256,
      p_terms_receipt_sha256: unsigned.termsReceiptSha256,
      p_processing_terms_receipt_sha256: unsigned.processingTermsReceiptSha256,
      p_granted_at: unsigned.grantedAt, p_expires_at: unsigned.expiresAt,
      p_grant_receipt_sha256: workspaceGrantSha256(unsigned),
    }),
  });
  if (!grantResponse) return fail("WORKSPACE_GRANT_STORE_FAILED");
  const body = await grantResponse.json().catch(() => null) as unknown;
  if (!grantResponse.ok) {
    const message = isRecord(body) && typeof body.message === "string" ? body.message : "";
    return fail(Object.entries(RPC_ERRORS).find(([key]) => message.includes(key))?.[1] ?? "WORKSPACE_GRANT_STORE_FAILED");
  }

  // Replays return the stored grant; either way it must pass the same check the gate reader applies.
  if (!isRecord(body) || typeof body.idempotentReplay !== "boolean") return fail("WORKSPACE_GRANT_STORE_FAILED");
  const keys = ["userId", "releaseReceiptSha256", "termsVersion", "termsReceiptSha256",
    "processingTermsReceiptSha256", "grantReceiptSha256", "grantedAt", "expiresAt"] as const;
  if (keys.some((key) => typeof body[key] !== "string")) return fail("WORKSPACE_GRANT_STORE_FAILED");
  const grant: WorkspaceGrant = {
    tenantId: workspaceKey, workspaceId: workspaceKey, scope, stage, releaseRevision, revokedAt: null,
    ...Object.fromEntries(keys.map((key) => [key, body[key] as string])) as Pick<WorkspaceGrant, (typeof keys)[number]>,
  };
  if (body.tenantId !== workspaceKey || body.workspaceId !== workspaceKey || body.scope !== scope || body.stage !== stage ||
    body.releaseRevision !== releaseRevision || grant.userId !== current.userId ||
    grant.termsReceiptSha256 !== unsigned.termsReceiptSha256 ||
    grant.processingTermsReceiptSha256 !== unsigned.processingTermsReceiptSha256 ||
    !admitsWorkspace(release, grant, { tenantId: workspaceKey, workspaceId: workspaceKey, scope, releaseRevision },
      new Date(now).toISOString())) return fail("WORKSPACE_GRANT_STORE_FAILED");
  return { ok: true, grant, idempotentReplay: body.idempotentReplay };
}
