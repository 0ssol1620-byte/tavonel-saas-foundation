export function readPaddleApiConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  const sandbox = env.PADDLE_SANDBOX === "true";
  const apiKey = env.PADDLE_API_KEY?.trim() ?? "";
  if (apiKey.length < 20) return null;
  if (sandbox && !apiKey.startsWith("pdl_sdbx_")) return null;
  if (!sandbox && !apiKey.startsWith("pdl_live_")) return null;
  return {
    apiKey,
    baseUrl: sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com",
    environment: sandbox ? "sandbox" as const : "production" as const,
  };
}

function isTrustedPortalUrl(value: unknown, environment: "sandbox" | "production") {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const allowedHosts = environment === "sandbox"
      ? new Set(["sandbox-customer-portal.paddle.com", "customer-portal.paddle.com"])
      : new Set(["customer-portal.paddle.com"]);
    return url.protocol === "https:" && allowedHosts.has(url.hostname) && url.pathname.startsWith("/cpl_");
  } catch {
    return false;
  }
}

export async function createPaddlePortalSession({
  customerId,
  subscriptionId,
}: {
  customerId: string;
  subscriptionId?: string | null;
}) {
  const config = readPaddleApiConfig();
  if (!config) return { ok: false as const, code: "PADDLE_API_NOT_CONFIGURED" };
  if (!/^ctm_[a-z0-9]{26}$/.test(customerId) || (subscriptionId && !/^sub_[a-z0-9]{26}$/.test(subscriptionId))) {
    return { ok: false as const, code: "PADDLE_PORTAL_ID_INVALID" };
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(subscriptionId ? { subscription_ids: [subscriptionId] } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { ok: false as const, code: "PADDLE_PORTAL_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "PADDLE_PORTAL_FAILED" };
  const json = await response.json() as { data?: { urls?: { general?: { overview?: unknown } } } };
  const url = json.data?.urls?.general?.overview;
  return isTrustedPortalUrl(url, config.environment)
    ? { ok: true as const, url }
    : { ok: false as const, code: "PADDLE_PORTAL_URL_INVALID" };
}
