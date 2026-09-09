import { RetryableError } from "./errors";
import { bytesToUnpaddedBase64Url, hmacSecretIsConfigured } from "./hmac";

export const PRIVATE_CDR_ORIGIN = "https://tavonel-cdr-validation-0909-jw7bqc3nla-du.a.run.app";
// Use the canonical Vercel project origin for this server-to-server hop. The public custom
// domain is proxied through Cloudflare; calling it from a Worker can be rejected before the
// signed request reaches Vercel. The broker itself remains HMAC-, replay- and budget-protected.
export const IDENTITY_BROKER = "https://tavonel-saas-foundation.vercel.app/api/internal/cdr/identity";

export class CdrIdentityError extends RetryableError {
  constructor(readonly stage: "request" | "sign" | "fetch" | "response" | "body" | "json" | "token") {
    super("CDR identity is unavailable");
    this.name = "CdrIdentityError";
  }
}

export async function cdrAuthorization(target: string, secret: string | undefined,
  fetcher: typeof fetch, now = new Date(), requestId = crypto.randomUUID()): Promise<string | undefined> {
  const privateTarget = target === `${PRIVATE_CDR_ORIGIN}/v1/disarm` || target === `${PRIVATE_CDR_ORIGIN}/health`;
  if (!secret && !target.startsWith(PRIVATE_CDR_ORIGIN)) return undefined; // Existing synthetic lane only.
  if (!privateTarget || !hmacSecretIsConfigured(secret)) throw new RetryableError("CDR identity configuration is invalid");
  let stage: CdrIdentityError["stage"] = "request";
  try {
    const timestamp = now.toISOString();
    const data = `tavonel.cdr.identity.v1\nPOST\n/api/internal/cdr/identity\n${PRIVATE_CDR_ORIGIN}\n${timestamp}\n${requestId}`;
    stage = "sign";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = bytesToUnpaddedBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
    stage = "fetch";
    const response = await fetcher(IDENTITY_BROKER, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "x-tavonel-identity-timestamp": timestamp, "x-tavonel-identity-request-id": requestId,
        "x-tavonel-identity-signature": signature } });
    stage = "response";
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("unavailable");
    }
    stage = "body";
    const reader = response.body.getReader();
    let body = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 12_288) throw new Error("oversized");
        body += decoder.decode(next.value, { stream: true });
      }
      body += decoder.decode();
    } catch {
      await reader.cancel().catch(() => undefined);
      throw new Error("unavailable");
    } finally { reader.releaseLock(); }
    stage = "json";
    const value = JSON.parse(body) as { audience?: unknown; token?: unknown };
    stage = "token";
    if (!value || value.audience !== PRIVATE_CDR_ORIGIN || typeof value.token !== "string"
      || value.token.length < 16 || value.token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token)) throw new Error("invalid");
    return `Bearer ${value.token}`;
  } catch {
    throw new CdrIdentityError(stage);
  }
}
