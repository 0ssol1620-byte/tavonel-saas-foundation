import { createHash, createHmac } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;

export type TrialSourceDecision =
  | { ok: true; status: "allow" | "not_trial"; idempotentReplay?: boolean }
  | { ok: false; code: "TRIAL_SOURCE_REVIEW_REQUIRED" | "TRIAL_SOURCE_RISK_NOT_CONFIGURED" | "TRIAL_SOURCE_RISK_FAILED" };

/**
 * Build a privacy-preserving exact-content signal.
 *
 * SHA-256 is first used only to make arbitrary bytes a fixed-length value. The value persisted
 * in Postgres is then an HMAC over that digest, domain-separated from billing bindings and the
 * device/IP abuse signals. An operator with a guessed document hash cannot query the database
 * for it without also knowing the server secret.
 */
function keyedContentDigest(bytes: Buffer, secret: string) {
  const contentSha = createHash("sha256").update(bytes).digest("hex");
  return `hmac256:${createHmac("sha256", secret)
    .update(`tavonel-trial-source-content/v1\0${contentSha}`, "utf8")
    .digest("hex")}`;
}

export async function assessTrialSourceReuse(value: {
  workspaceKey: string;
  userId: string;
  documentId: string;
  bytes: Buffer;
}): Promise<TrialSourceDecision> {
  if (!WORKSPACE.test(value.workspaceKey) || !UUID.test(value.userId) || !UUID.test(value.documentId)
    || value.bytes.length < 1 || value.bytes.length > 5 * 1024 * 1024) {
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
        p_content_hmac: keyedContentDigest(value.bytes, secret),
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
