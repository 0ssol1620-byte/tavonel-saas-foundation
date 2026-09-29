import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  A workspace owner's explicit agreement to the published self-service terms and processing
  addendum. The receipt is evidence only: recording it never opens customer-data processing,
  starts a trial or charges. Grant issuance must read it back through the database's
  current_foundation_processing_terms_acceptance(), which stops answering once the acceptor is no
  longer the active owner at the membership revision they accepted under.

  The only offer is the pinned, published version below. Its manifest and both documents are
  read from fixed paths and re-hashed before anything is offered or accepted, so a missing or
  edited document closes the route rather than collecting consent to text nobody published.
*/

export const PROCESSING_TERMS_VERSION = "2026-09-30";
const MANIFEST_FILE = "policy/processing-terms-2026-09-30.json";
const TERMS_PATH = "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md";
const PROCESSING_PATH = "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PROCESSING_TERMS_SCOPES = ["direct_upload", "connector"] as const;
export type ProcessingTermsScope = (typeof PROCESSING_TERMS_SCOPES)[number];

export type ProcessingTermsDocument = { path: string; sha256: string };
export type ProcessingTermsManifest = {
  version: typeof PROCESSING_TERMS_VERSION;
  terms: ProcessingTermsDocument;
  processing: ProcessingTermsDocument;
};

export type ProcessingTermsAcceptanceReceipt = {
  acceptanceId: string;
  workspaceKey: string;
  userId: string;
  actorRole: "owner";
  authorizationRevision: number;
  scope: ProcessingTermsScope;
  termsVersion: string;
  terms: ProcessingTermsDocument;
  processing: ProcessingTermsDocument;
  acceptedAt: string;
  idempotentReplay: boolean;
};

type Failure = { ok: false; code: string; status: number };
const failure = (code: string, status: number): Failure => ({ ok: false, code, status });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseDocument(value: unknown, path: string): ProcessingTermsDocument | null {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "sha256"])) return null;
  if (value.path !== path || typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) return null;
  return { path, sha256: value.sha256 };
}

export function parseProcessingTermsManifest(value: unknown): ProcessingTermsManifest | null {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "terms", "processing"])) return null;
  if (value.version !== PROCESSING_TERMS_VERSION) return null;
  const terms = parseDocument(value.terms, TERMS_PATH);
  const processing = parseDocument(value.processing, PROCESSING_PATH);
  return terms && processing ? { version: PROCESSING_TERMS_VERSION, terms, processing } : null;
}

const sha256 = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Reads the manifest and both documents from fixed paths under `publicDir`; never from request input. */
export async function loadPublishedProcessingTerms(publicDir = join(process.cwd(), "public")) {
  try {
    const manifest = parseProcessingTermsManifest(JSON.parse(await readFile(join(publicDir, MANIFEST_FILE), "utf8")));
    if (!manifest) return failure("PROCESSING_TERMS_UNAVAILABLE", 503);
    const [terms, processing] = await Promise.all([
      readFile(join(publicDir, TERMS_PATH.slice(1))),
      readFile(join(publicDir, PROCESSING_PATH.slice(1))),
    ]);
    if (sha256(terms) !== manifest.terms.sha256 || sha256(processing) !== manifest.processing.sha256) {
      return failure("PROCESSING_TERMS_UNAVAILABLE", 503);
    }
    return { ok: true as const, manifest };
  } catch {
    return failure("PROCESSING_TERMS_UNAVAILABLE", 503);
  }
}

/**
 * Accepts only `{ accepted: true, version, terms, processing, scope }` naming the exact offer.
 * Any other key -- including a workspace or user identifier -- is refused: authority comes from
 * the session, never the body.
 */
export function parseProcessingTermsAcceptanceRequest(value: unknown, manifest: ProcessingTermsManifest) {
  if (!isRecord(value) || !hasExactKeys(value, ["accepted", "version", "terms", "processing", "scope"])) {
    return failure("PROCESSING_TERMS_REQUEST_INVALID", 400);
  }
  if (value.accepted !== true) return failure("PROCESSING_TERMS_NOT_ACCEPTED", 400);
  if (!PROCESSING_TERMS_SCOPES.includes(value.scope as ProcessingTermsScope)) {
    return failure("PROCESSING_TERMS_REQUEST_INVALID", 400);
  }
  const terms = parseDocument(value.terms, manifest.terms.path);
  const processing = parseDocument(value.processing, manifest.processing.path);
  if (value.version !== manifest.version || terms?.sha256 !== manifest.terms.sha256
    || processing?.sha256 !== manifest.processing.sha256) {
    return failure("PROCESSING_TERMS_OFFER_CHANGED", 409);
  }
  return { ok: true as const, scope: value.scope as ProcessingTermsScope };
}

function parseReceipt(value: unknown, expected: {
  workspaceKey: string; userId: string; scope: ProcessingTermsScope; manifest: ProcessingTermsManifest;
}): ProcessingTermsAcceptanceReceipt | null {
  if (!isRecord(value)) return null;
  const terms = parseDocument(value.terms, expected.manifest.terms.path);
  const processing = parseDocument(value.processing, expected.manifest.processing.path);
  if (typeof value.acceptanceId !== "string" || !UUID.test(value.acceptanceId)
    || value.workspaceKey !== expected.workspaceKey
    || typeof value.userId !== "string" || value.userId.toLowerCase() !== expected.userId.toLowerCase()
    || value.actorRole !== "owner"
    || !Number.isSafeInteger(value.authorizationRevision) || Number(value.authorizationRevision) < 1
    || value.scope !== expected.scope
    || value.termsVersion !== expected.manifest.version
    || terms?.sha256 !== expected.manifest.terms.sha256
    || processing?.sha256 !== expected.manifest.processing.sha256
    || typeof value.acceptedAt !== "string" || !Number.isFinite(Date.parse(value.acceptedAt))
    || typeof value.idempotentReplay !== "boolean") return null;
  return {
    acceptanceId: value.acceptanceId,
    workspaceKey: expected.workspaceKey,
    userId: value.userId,
    actorRole: "owner",
    authorizationRevision: Number(value.authorizationRevision),
    scope: expected.scope,
    termsVersion: expected.manifest.version,
    terms: terms!,
    processing: processing!,
    acceptedAt: value.acceptedAt,
    idempotentReplay: value.idempotentReplay,
  };
}

export async function recordProcessingTermsAcceptance(input: {
  workspaceKey: string;
  userId: string;
  scope: ProcessingTermsScope;
  manifest: ProcessingTermsManifest;
  requestId: string;
}) {
  if (!WORKSPACE.test(input.workspaceKey) || !UUID.test(input.userId)
    || !PROCESSING_TERMS_SCOPES.includes(input.scope)
    || input.requestId.length < 8 || input.requestId.length > 160) {
    return failure("PROCESSING_TERMS_INPUT_INVALID", 400);
  }
  const config = readSupabaseAdminConfig();
  if (!config) return failure("PROCESSING_TERMS_STORE_NOT_CONFIGURED", 503);
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_foundation_processing_terms_acceptance", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: input.workspaceKey,
        p_actor_user_id: input.userId,
        p_scope: input.scope,
        p_terms_version: input.manifest.version,
        p_terms_path: input.manifest.terms.path,
        p_terms_sha256: input.manifest.terms.sha256,
        p_processing_path: input.manifest.processing.path,
        p_processing_sha256: input.manifest.processing.sha256,
        p_request_id: input.requestId,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return failure("PROCESSING_TERMS_STORE_FAILED", 503);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";
    if (message.includes("processing_terms_acceptance_forbidden")) return failure("WORKSPACE_OWNER_REQUIRED", 403);
    if (message.includes("processing_terms_acceptance_input_invalid")) return failure("PROCESSING_TERMS_INPUT_INVALID", 400);
    return failure("PROCESSING_TERMS_STORE_FAILED", 503);
  }
  const receipt = parseReceipt(await response.json().catch(() => null), input);
  return receipt ? { ok: true as const, receipt } : failure("PROCESSING_TERMS_STORE_INVALID", 503);
}
