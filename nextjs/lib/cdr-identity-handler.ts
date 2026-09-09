import { verifyCdrIdentityRequest } from "./cdr-identity-request";
import { CDR_IDENTITY_AUDIENCE, type CdrIdentityConfig } from "./cdr-workload-identity";

type Dependencies = {
  env: Readonly<Record<string, string | undefined>>;
  claim: (id: string) => Promise<boolean>;
  subject: () => Promise<string>;
  mint: (config: CdrIdentityConfig, subject: string) => Promise<string>;
};
const HEADERS = { "cache-control": "no-store, private", "pragma": "no-cache", "x-content-type-options": "nosniff" };
async function hasEmptyBody(request: Request): Promise<boolean> {
  if (request.bodyUsed) return false;
  if (request.body === null) return true;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { return false; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async () => {
      // Runtime adapters may supply an empty stream for a bodyless POST.
      // Only EOF proves emptiness; never trust Content-Length for acceptance.
      for (let chunks = 0; chunks < 16; chunks++) {
        const next = await reader.read();
        if (next.done) return true;
        if (next.value.byteLength > 0) return false;
      }
      return false;
    };
    return await Promise.race([read(), new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), 1_000);
    })]);
  } catch { return false; }
  finally {
    clearTimeout(timer);
    // A stalled source must not extend the deadline through its cancel hook.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function handleCdrIdentity(request: Request, deps: Dependencies): Promise<Response> {
  const reply = (code: string, status: number) => Response.json({ code }, { status, headers: HEADERS });
  if (deps.env.FOUNDATION_CDR_IDENTITY_ENABLED !== "1" || deps.env.VERCEL_ENV !== "production")
    return reply("CDR_IDENTITY_DISABLED", 503);
  const id = verifyCdrIdentityRequest(request.headers, deps.env.FOUNDATION_CDR_IDENTITY_HMAC);
  if (!id) return reply("CDR_IDENTITY_NOT_AUTHORIZED", 401);
  // No file or caller-selected audience/account is accepted by this token-only endpoint.
  if (!await hasEmptyBody(request)) {
    return reply("CDR_IDENTITY_BODY_NOT_ALLOWED", 400);
  }
  try {
    if (!await deps.claim(id)) return reply("CDR_IDENTITY_REQUEST_REFUSED", 429);
    const token = await deps.mint({
      providerResource: deps.env.FOUNDATION_CDR_WIF_PROVIDER ?? "",
      serviceAccount: deps.env.FOUNDATION_CDR_WIF_SERVICE_ACCOUNT ?? "",
    }, await deps.subject());
    return Response.json({ token, audience: CDR_IDENTITY_AUDIENCE }, { headers: HEADERS });
  } catch {
    return reply("CDR_IDENTITY_UNAVAILABLE", 503);
  }
}
