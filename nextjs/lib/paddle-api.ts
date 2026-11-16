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

/* Read-only list/get calls for reconciliation (WO-D27-2). Only the fields a delta needs are kept. */
const LIST_PAGE_CAP = 20;
const TRANSACTION_ID = /^txn_[a-z0-9]{26}$/;
const ADJUSTMENT_ID = /^adj_[a-z0-9]{26}$/;
const PRICE_ID = /^pri_[a-z0-9]{26}$/;

export type PaddleTransaction = {
  id: string;
  status: string;
  currency: string;
  /** Minor units as Paddle sends them: a string. */
  total: string;
  lineItems: Array<{ priceId: string; quantity: number }>;
};
export type PaddleAdjustment = { id: string; transactionId: string; action: string; status: string; currency: string; total: string };
export type PaddlePrice = {
  id: string;
  status: string;
  amount: string;
  currency: string;
  interval: string | null;
  frequency: number | null;
};

export type PaddleReadFailure = "PADDLE_API_NOT_CONFIGURED" | "PADDLE_READ_FAILED" | "PADDLE_READ_INVALID";
export type PaddleListResult<T> =
  | { ok: true; items: T[]; truncated: boolean; next: string | null }
  | { ok: false; code: PaddleReadFailure };

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
/** Parsers meet arbitrary JSON: a shape they cannot read (a null row, a null line item) is invalid, never a throw. */
const parseSafely = <T>(parse: (r: Row) => T | null, raw: unknown): T | null => {
  try {
    return parse(raw as Row);
  } catch {
    return null;
  }
};

function parseTransaction(r: Row): PaddleTransaction | null {
  const details = r.details as Row | undefined;
  const items = (details?.line_items ?? r.items) as Row[] | undefined;
  const total = str((details?.totals as Row | undefined)?.total);
  if (typeof r.id !== "string" || !TRANSACTION_ID.test(r.id) || !str(r.status) || !str(r.currency_code) || !total || !Array.isArray(items)) return null;
  const lineItems = items.map((i) => ({ priceId: str(i.price_id ?? (i.price as Row | undefined)?.id), quantity: i.quantity }));
  if (lineItems.some((i) => !i.priceId || typeof i.quantity !== "number")) return null;
  return { id: r.id, status: r.status as string, currency: r.currency_code as string, total, lineItems: lineItems as PaddleTransaction["lineItems"] };
}

function parseAdjustment(r: Row): PaddleAdjustment | null {
  const total = str((r.totals as Row | undefined)?.total);
  if (typeof r.id !== "string" || !ADJUSTMENT_ID.test(r.id) || typeof r.transaction_id !== "string" || !TRANSACTION_ID.test(r.transaction_id)
    || !str(r.action) || !str(r.status) || !str(r.currency_code) || !total) return null;
  return { id: r.id, transactionId: r.transaction_id, action: r.action as string, status: r.status as string, currency: r.currency_code as string, total };
}

function parsePrice(r: Row): PaddlePrice | null {
  const unit = r.unit_price as Row | undefined;
  const cycle = r.billing_cycle as Row | null | undefined;
  if (typeof r.id !== "string" || !PRICE_ID.test(r.id) || !str(r.status) || !str(unit?.amount) || !str(unit?.currency_code)) return null;
  return {
    id: r.id, status: r.status as string, amount: unit!.amount as string, currency: unit!.currency_code as string,
    interval: str(cycle?.interval), frequency: typeof cycle?.frequency === "number" ? cycle.frequency : null,
  };
}

async function paddleGet(path: string, query: URLSearchParams, env: Env) {
  const config = readPaddleApiConfig(env);
  if (!config) return { code: "PADDLE_API_NOT_CONFIGURED" as const, json: null };
  try {
    const response = await fetch(`${config.baseUrl}${path}?${query}`, {
      method: "GET",
      headers: { authorization: `Bearer ${config.apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { code: response.status === 404 ? "NOT_FOUND" as const : "PADDLE_READ_FAILED" as const, json: null };
    }
    return { code: null, json: await response.json().catch(() => null) as Row | null };
  } catch {
    return { code: "PADDLE_READ_FAILED" as const, json: null };
  }
}

async function listPaddle<T>(
  path: string, { updatedAfter, after }: { updatedAfter: string; after?: string },
  parse: (r: Row) => T | null, env: Env,
): Promise<PaddleListResult<T>> {
  const items: T[] = [];
  let cursor = after ?? null;
  for (let page = 0; page < LIST_PAGE_CAP; page++) {
    const query = new URLSearchParams({ per_page: "200", order_by: "id[ASC]", "updated_at[GT]": updatedAfter });
    if (cursor) query.set("after", cursor);
    const result = await paddleGet(path, query, env);
    if (result.code) return { ok: false, code: result.code === "NOT_FOUND" ? "PADDLE_READ_FAILED" : result.code };
    const data = result.json?.data;
    if (!Array.isArray(data)) return { ok: false, code: "PADDLE_READ_INVALID" };
    for (const raw of data) {
      const parsed = parseSafely(parse, raw);
      if (!parsed) return { ok: false, code: "PADDLE_READ_INVALID" };
      items.push(parsed);
    }
    const pagination = (result.json?.meta as Row | undefined)?.pagination as Row | undefined;
    if (pagination?.has_more !== true) return { ok: true, items, truncated: false, next: null };
    cursor = str(data.length ? (data[data.length - 1] as Row).id : null);
    if (!cursor) return { ok: false, code: "PADDLE_READ_INVALID" };
  }
  return { ok: true, items, truncated: true, next: cursor };
}

export const listPaddleTransactions = (q: { updatedAfter: string; after?: string }, env: Env = process.env) =>
  listPaddle("/transactions", q, parseTransaction, env);

export const listPaddleAdjustments = (q: { updatedAfter: string; after?: string }, env: Env = process.env) =>
  listPaddle("/adjustments", q, parseAdjustment, env);

export async function getPaddlePrice(
  id: string, env: Env = process.env,
): Promise<{ ok: true; price: PaddlePrice } | { ok: false; code: PaddleReadFailure | "PADDLE_PRICE_ID_INVALID" | "PADDLE_PRICE_NOT_FOUND" }> {
  if (!PRICE_ID.test(id)) return { ok: false, code: "PADDLE_PRICE_ID_INVALID" };
  const result = await paddleGet(`/prices/${encodeURIComponent(id)}`, new URLSearchParams(), env);
  if (result.code) return { ok: false, code: result.code === "NOT_FOUND" ? "PADDLE_PRICE_NOT_FOUND" : result.code };
  const price = parseSafely(parsePrice, result.json?.data);
  return price && price.id === id ? { ok: true, price } : { ok: false, code: "PADDLE_READ_INVALID" };
}
