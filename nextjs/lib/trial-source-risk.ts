import { createHmac } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
const SOURCE_SHA256 = /^sha256:([a-f0-9]{64})$/;

export type TrialSourceDecision =
  | { ok: true; status: "allow" | "not_trial"; idempotentReplay?: boolean }
  | { ok: false; code: "TRIAL_SOURCE_REVIEW_REQUIRED" | "TRIAL_SOURCE_RISK_NOT_CONFIGURED" | "TRIAL_SOURCE_RISK_FAILED" };

/**
 * Build a privacy-preserving exact-content signal.
 *
 * The value persisted in Postgres is an HMAC over the source's SHA-256, domain-separated from
 * billing bindings and the device/IP abuse signals. An operator with a guessed document hash
 * cannot query the database for it without also knowing the server secret.
 *
 * The SHA-256 itself is no longer computed here, and that is the point. This function used to
 * take the document's bytes, which meant the application server had to download the customer's
 * source back out of the quarantine bucket to fingerprint it -- through a helper capped at 5 MiB,
 * against an intake that admitted fifty. The digest now arrives already computed: the browser
 * takes it with SubtleCrypto over the bytes it is sending, confirmation records it on the
 * admission, and the CDR worker independently takes the same digest over what actually arrived.
 * The ledger value is unchanged, so rows written before this still compare.
 *
 * The domain separator and the string it covers are deliberately identical to the previous
 * version: changing either would silently start a second, unrelated abuse ledger.
 */
function keyedContentDigest(contentSha: string, secret: string) {
  return `hmac256:${createHmac("sha256", secret)
    .update(`tavonel-trial-source-content/v1\0${contentSha}`, "utf8")
    .digest("hex")}`;
}

export async function assessTrialSourceReuse(value: {
  workspaceKey: string;
  userId: string;
  documentId: string;
  /** `sha256:<hex>`, as the browser and the CDR worker both report it. */
  sourceSha256: string;
}): Promise<TrialSourceDecision> {
  const digest = SOURCE_SHA256.exec(value.sourceSha256 ?? "")?.[1];
  if (!WORKSPACE.test(value.workspaceKey) || !UUID.test(value.userId) || !UUID.test(value.documentId)
    || !digest) {
    return { ok: false, code: "TRIAL_SOURCE_RISK_FAILED" };
  }
  const secret = process.env.FOUNDATION_BILLING_HMAC?.trim() ?? "";
  const config = readSupabaseAdminConfig();
  if (secret.length < 32 || !config) return { ok: false, code: "TRIAL_SOURCE_RISK_NOT_CONFIGURED" };

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/assess_foundation_trial_source_digest", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: value.userId,
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        p_content_hmac: keyedContentDigest(digest, secret),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { ok: false, code: "TRIAL_SOURCE_RISK_FAILED" };
  }
  if (!response.ok) return { ok: false, code: "TRIAL_SOURCE_RISK_FAILED" };
  const receipt = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!receipt || typeof receipt.status !== "string") return { ok: false, code: "TRIAL_SOURCE_RISK_FAILED" };
  if (receipt.status === "denied") return { ok: false, code: "TRIAL_SOURCE_REVIEW_REQUIRED" };
  if (receipt.status === "allow" || receipt.status === "not_trial") {
    return {
      ok: true,
      status: receipt.status,
      ...(typeof receipt.idempotentReplay === "boolean" ? { idempotentReplay: receipt.idempotentReplay } : {}),
    };
  }
  return { ok: false, code: "TRIAL_SOURCE_RISK_FAILED" };
}
