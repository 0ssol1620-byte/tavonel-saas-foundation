// Server-side only. The caller must authenticate the Worker before invoking this module
// and obtain subjectToken from the Vercel runtime, never a caller-supplied header/body.
export const CDR_IDENTITY_AUDIENCE = "https://tavonel-cdr-validation-0909-jw7bqc3nla-du.a.run.app";
const STS = "https://sts.googleapis.com/v1/token";
const TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const PROVIDER = /^projects\/317850201666\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/;
const ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@tavonel-saas-foundation\.iam\.gserviceaccount\.com$/;
const SAFE_TOKEN = /^[A-Za-z0-9._~+\/-]+={0,2}$/;

export type CdrIdentityConfig = { providerResource: string; serviceAccount: string };

async function tokenResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("CDR_IDENTITY_UNAVAILABLE");
  }
  if (!response.body) throw new Error("CDR_IDENTITY_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 16_384) throw new Error("CDR_IDENTITY_UNAVAILABLE");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CDR_IDENTITY_UNAVAILABLE");
    return parsed as Record<string, unknown>;
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error("CDR_IDENTITY_UNAVAILABLE");
  } finally { reader.releaseLock(); }
}

/** No token cache or persistent credential. Google validates the external subject and IAM policy. */
export async function cdrIdentityToken(config: CdrIdentityConfig, subjectToken: string,
  fetcher: typeof fetch = fetch): Promise<string> {
  if (!PROVIDER.test(config.providerResource) || !ACCOUNT.test(config.serviceAccount)
    || subjectToken.length < 16 || subjectToken.length > 8192 || !SAFE_TOKEN.test(subjectToken)) {
    throw new Error("CDR_IDENTITY_CONFIG_INVALID");
  }
  try {
    const signal = AbortSignal.timeout(15_000);
    const exchanged = await tokenResponse(await fetcher(STS, {
      method: "POST", redirect: "error", cache: "no-store", signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audience: `//iam.googleapis.com/${config.providerResource}`,
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange", requestedTokenType: TOKEN_TYPE,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt", subjectToken,
        scope: "https://www.googleapis.com/auth/iam" }),
    }));
    const access = exchanged.access_token;
    if (typeof access !== "string" || access.length > 8192 || !SAFE_TOKEN.test(access)
      || exchanged.token_type !== "Bearer" || exchanged.issued_token_type !== TOKEN_TYPE
      || typeof exchanged.expires_in !== "number" || exchanged.expires_in <= 0) throw new Error("CDR_IDENTITY_UNAVAILABLE");
    const generated = await tokenResponse(await fetcher(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccount}:generateIdToken`, {
        method: "POST", redirect: "error", cache: "no-store", signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
        body: JSON.stringify({ audience: CDR_IDENTITY_AUDIENCE, includeEmail: true }),
      }));
    if (typeof generated.token !== "string" || generated.token.length < 16
      || generated.token.length > 8192 || !SAFE_TOKEN.test(generated.token)) throw new Error("CDR_IDENTITY_UNAVAILABLE");
    return generated.token;
  } catch {
    // Deliberately omit provider/network error text, which can contain tokens.
    throw new Error("CDR_IDENTITY_UNAVAILABLE");
  }
}
