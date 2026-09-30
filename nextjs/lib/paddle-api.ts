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

type Env = Readonly<Record<string, string | undefined>>;
const SUBSCRIPTION_ID = /^sub_[a-z0-9]{26}$/;
const CUSTOMER_ID = /^ctm_[a-z0-9]{26}$/;
const SUBSCRIPTION_STATUSES = new Set(["active", "canceled", "past_due", "paused", "trialing"]);

/** The provider facts billing-gate enforcement decides from. Nothing else is read or kept. */
export type PaddleSubscription = {
  id: string;
  status: "active" | "canceled" | "past_due" | "paused" | "trialing";
  customerId: string;
  customData: unknown;
  nextBilledAt: string | null;
  firstBilledAt: string | null;
  pausedAt: string | null;
  currentPeriodStartsAt: string | null;
  scheduledChange: { action: string; effectiveAt: string } | null;
};

export type PaddleSubscriptionResult =
  | { ok: true; environment: "sandbox" | "production"; subscription: PaddleSubscription }
  | { ok: false; code: "PADDLE_API_NOT_CONFIGURED" | "PADDLE_SUBSCRIPTION_ID_INVALID" |
      "PADDLE_SUBSCRIPTION_NOT_FOUND" | "PADDLE_SUBSCRIPTION_READ_FAILED" | "PADDLE_SUBSCRIPTION_INVALID" |
      "PADDLE_SUBSCRIPTION_PAUSE_FAILED" };

const instantOrNull = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : value == null ? null : undefined;

function parseSubscription(value: unknown, expectedId: string): PaddleSubscription | null {
  const data = (value as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object" || data.id !== expectedId) return null;
  if (typeof data.status !== "string" || !SUBSCRIPTION_STATUSES.has(data.status)) return null;
  if (typeof data.customer_id !== "string" || !CUSTOMER_ID.test(data.customer_id)) return null;
  const nextBilledAt = instantOrNull(data.next_billed_at);
  const firstBilledAt = instantOrNull(data.first_billed_at);
  const pausedAt = instantOrNull(data.paused_at);
  const period = data.current_billing_period as Record<string, unknown> | null | undefined;
  const currentPeriodStartsAt = instantOrNull(period?.starts_at);
  const change = data.scheduled_change as Record<string, unknown> | null | undefined;
  const effectiveAt = instantOrNull(change?.effective_at);
  if ([nextBilledAt, firstBilledAt, pausedAt, currentPeriodStartsAt].includes(undefined)) return null;
  if (change != null && (typeof change.action !== "string" || !effectiveAt)) return null;
  return {
    id: data.id,
    status: data.status as PaddleSubscription["status"],
    customerId: data.customer_id,
    customData: data.custom_data ?? null,
    nextBilledAt: nextBilledAt!,
    firstBilledAt: firstBilledAt!,
    pausedAt: pausedAt!,
    currentPeriodStartsAt: currentPeriodStartsAt!,
    scheduledChange: change == null ? null : { action: change.action as string, effectiveAt: effectiveAt! },
  };
}

async function subscriptionRequest(
  subscriptionId: string,
  env: Env,
  pause: boolean,
): Promise<PaddleSubscriptionResult> {
  const config = readPaddleApiConfig(env);
  if (!config) return { ok: false, code: "PADDLE_API_NOT_CONFIGURED" };
  if (!SUBSCRIPTION_ID.test(subscriptionId)) return { ok: false, code: "PADDLE_SUBSCRIPTION_ID_INVALID" };
  const failed = pause ? "PADDLE_SUBSCRIPTION_PAUSE_FAILED" as const : "PADDLE_SUBSCRIPTION_READ_FAILED" as const;
  let response: Response;
  try {
    response = await fetch(
      `${config.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}${pause ? "/pause" : ""}`,
      {
        method: pause ? "POST" : "GET",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        // https://developer.paddle.com/api-reference/subscriptions/pause-subscription/ -- `immediately`
        // sets status `paused` now; the default would only schedule a pause at the period end.
        body: pause ? JSON.stringify({ effective_from: "immediately" }) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return { ok: false, code: failed };
  }
  // A 404 is only meaningful on the read: an ID this environment does not know (for example a
  // sandbox subscription projected before the live key) is never a reason to mutate anything.
  if (response.status === 404 && !pause) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "PADDLE_SUBSCRIPTION_NOT_FOUND" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: failed };
  }
  const subscription = parseSubscription(await response.json().catch(() => null), subscriptionId);
  if (!subscription) return { ok: false, code: pause ? failed : "PADDLE_SUBSCRIPTION_INVALID" };
  if (pause && subscription.status !== "paused") return { ok: false, code: failed };
  return { ok: true, environment: config.environment, subscription };
}

export function getPaddleSubscription(subscriptionId: string, env: Env = process.env) {
  return subscriptionRequest(subscriptionId, env, false);
}

/** Succeeds only when Paddle answers with this subscription already in status `paused`. */
export function pausePaddleSubscriptionImmediately(subscriptionId: string, env: Env = process.env) {
  return subscriptionRequest(subscriptionId, env, true);
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
