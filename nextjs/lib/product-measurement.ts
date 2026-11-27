import { PUBLIC_MARKETING_PATHS } from "./marketing-analytics";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  WO-AN-RUM-1: the server half of the two first-party measurements that start the calendar clocks
  (D26 retention, D35 ad test, U19/U43 field Core Web Vitals). Migration 20261127100000.

  1. Product measurement. A signed-in user's own choice, made in the workspace. While it says yes,
     the server records three facts and nothing else: the first verified record (today the proxy is
     the World activation, WO-EXT-07 spec definition `world_activated_proxy_v0`), the first agent
     read (an API key or remote MCP token answered by ask, search or download), and the UTC days
     with a qualifying use (a grounded answer, an agent read, an applied source revision). The
     database keys them by a random subject, never by user id; no text, title, path, question or
     token is passed. Without a yes the database records nothing (fail closed, decided there, not
     here), and a withdrawal deletes what was recorded. An optional campaign label travels with a
     yes only, and only when it is a campaign we registered below.
  2. Field vitals. One page load's LCP / INP / CLS on a listed public page, sent by the browser
     only after the visitor allowed analytics, stored as daily counters per path and range bucket.

  Both are off unless NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED is exactly "1" -- the same switch that
  already turns on website analytics. Off means the routes answer 404 and no record call is made.

  Public and internal shapes are separate types: what a browser sends or reads (`FieldVitalsBeacon`,
  `ProductMeasurementChoice`, `ProductMeasurementRequest`) never carries a subject, a bucket or a
  campaign, and the RPC argument types below are never returned to a client. The aggregate read
  model (`product_measurement_summary`, `field_vitals_summary`) is SQL, service role only, counts only.
*/

type Env = Readonly<Record<string, string | undefined>>;

export function productMeasurementEnabled(env: Env = process.env): boolean {
  return env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1";
}

export const PRODUCT_MEASUREMENT_VERSION = "product-measurement-v1";

/*
  The campaign ids we wrote ourselves (workorders/d34-d35-prep.md §3.3). A label is stored only when
  it is one of these: an unregistered value is dropped, not stored, so a crafted link cannot put a
  name or an address into the record. Adding a campaign is a code change with its own review.
*/
export const REGISTERED_CAMPAIGNS: ReadonlySet<string> = new Set([
  "d35_dev_mcp_en_us",
  "d35_eng_revision_en_us",
  "d35_dev_mcp_chatgpt_us",
  "d35_dev_meta_us",
]);
const CAMPAIGN_CONTENT = /^[a-z0-9_-]{1,64}$/;

/* ------------------------------------------------------------------ public shapes */

/** What GET and POST /api/product-measurement return: the caller's own choice and nothing else. */
export type ProductMeasurementChoice = { readonly choice: "allowed" | "declined" | "undecided" };

/** What the workspace sends. The two campaign fields are the first-touch values, if any. */
export type ProductMeasurementRequest = {
  readonly allowed: boolean;
  readonly utm_campaign?: string;
  readonly utm_content?: string;
};

/** What a browser sends after a page load. Milliseconds for LCP and INP, unitless CLS. */
export type FieldVitalsBeacon = {
  readonly path: string;
  readonly lcp?: number;
  readonly inp?: number;
  readonly cls?: number;
};

/* ------------------------------------------------------------------ internal shapes */

type ConsentRpcArgs = {
  p_user_id: string;
  p_allowed: boolean;
  p_version: string;
  p_campaign: string | null;
  p_campaign_content: string | null;
};

export type ProductMeasurementEvent = "first_verified_record" | "first_agent_read" | "active_day";

type FieldVitalsRpcArgs = { p_path: string; p_lcp: number | null; p_inp: number | null; p_cls: number | null };

/* ------------------------------------------------------------------ parsing */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Strict: an unknown key, a non-boolean `allowed` or an over-long label refuses the whole request. */
export function parseProductMeasurementRequest(value: unknown): ProductMeasurementRequest | null {
  if (!isPlainObject(value)) return null;
  if (Object.keys(value).some((key) => key !== "allowed" && key !== "utm_campaign" && key !== "utm_content")) return null;
  if (typeof value.allowed !== "boolean") return null;
  for (const key of ["utm_campaign", "utm_content"] as const) {
    const field = value[key];
    if (field !== undefined && (typeof field !== "string" || field.length > 120)) return null;
  }
  return value as ProductMeasurementRequest;
}

/** The label that may be stored: a registered campaign, and its content only beside it. */
export function registeredCampaign(request: ProductMeasurementRequest): { campaign: string | null; content: string | null } {
  if (!request.allowed || !request.utm_campaign || !REGISTERED_CAMPAIGNS.has(request.utm_campaign)) {
    return { campaign: null, content: null };
  }
  const content = request.utm_content && CAMPAIGN_CONTENT.test(request.utm_content) ? request.utm_content : null;
  return { campaign: request.utm_campaign, content };
}

const VITAL_LIMITS = { lcp: 120_000, inp: 120_000, cls: 100 } as const;
type Vital = keyof typeof VITAL_LIMITS;
const VITALS: readonly Vital[] = ["lcp", "inp", "cls"];

/** Strict: listed public path, only the four keys, finite non-negative values under a cap, at least one metric. */
export function parseFieldVitalsBeacon(value: unknown): FieldVitalsBeacon | null {
  if (!isPlainObject(value)) return null;
  if (Object.keys(value).some((key) => key !== "path" && !VITALS.includes(key as Vital))) return null;
  if (typeof value.path !== "string" || !PUBLIC_MARKETING_PATHS.has(value.path)) return null;
  let seen = 0;
  for (const metric of VITALS) {
    const metricValue = value[metric];
    if (metricValue === undefined) continue;
    if (typeof metricValue !== "number" || !Number.isFinite(metricValue) || metricValue < 0 || metricValue > VITAL_LIMITS[metric]) return null;
    seen += 1;
  }
  return seen > 0 ? (value as FieldVitalsBeacon) : null;
}

/*
  Range buckets, 40 per metric, the last one open: LCP 250 ms, INP 25 ms, CLS 0.025 wide. The
  "good" thresholds (LCP 2.5 s, INP 200 ms, CLS 0.1) fall on bucket edges (10, 8, 4), so "p75 is
  good" is read exactly from the bucket: p75 bucket < edge. CLS is compared in thousandths so a
  float such as 0.075 lands in its own bucket rather than the one below.
*/
export const FIELD_VITALS_BUCKET = { lcp: 250, inp: 25, cls: 25 } as const;

export function fieldVitalsBucket(metric: Vital, value: number): number {
  const units = metric === "cls" ? Math.round(value * 1000) : Math.round(value);
  return Math.min(39, Math.floor(units / FIELD_VITALS_BUCKET[metric]));
}

/* ------------------------------------------------------------------ store */

const STORE_TIMEOUT_MS = 1_500;

function log(line: Record<string, string>) {
  try { console.info(JSON.stringify(line)); } catch { /* telemetry never breaks an action */ }
}

async function rpc(name: string, args: Record<string, unknown>, env: Env): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: false };
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST", body: JSON.stringify(args), signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false };
    // An unreadable body is `undefined`, which no reader below accepts -- never the `null` of "no choice yet".
    return { ok: true, body: await response.json().catch(() => undefined) };
  } catch {
    return { ok: false };
  }
}

const choiceOf = (body: unknown): ProductMeasurementChoice["choice"] | null => {
  if (body === null) return "undecided";
  if (isPlainObject(body) && typeof body.allowed === "boolean") return body.allowed ? "allowed" : "declined";
  return null;
};

export async function readProductMeasurementChoice(userId: string, env: Env = process.env) {
  const result = await rpc("read_product_measurement_consent", { p_user_id: userId }, env);
  const choice = result.ok ? choiceOf(result.body) : null;
  return choice ? { ok: true as const, choice } : { ok: false as const };
}

export async function setProductMeasurementChoice(userId: string, request: ProductMeasurementRequest, env: Env = process.env) {
  const label = registeredCampaign(request);
  const args: ConsentRpcArgs = {
    p_user_id: userId, p_allowed: request.allowed, p_version: PRODUCT_MEASUREMENT_VERSION,
    p_campaign: label.campaign, p_campaign_content: label.content,
  };
  const result = await rpc("set_product_measurement_consent", args, env);
  const choice = result.ok ? choiceOf(result.body) : null;
  return choice && choice !== "undecided" ? { ok: true as const, choice } : { ok: false as const };
}

/*
  Called from the routes that witness a fact. It never fails or delays the user's action beyond the
  store timeout: a failure is one log line with a reason and no identifier. Whether anything is
  recorded is the database's decision -- no yes, no row -- so a caller never checks consent itself.
*/
export async function recordProductMeasurement(userId: string, events: readonly ProductMeasurementEvent[], env: Env = process.env) {
  if (!productMeasurementEnabled(env) || events.length === 0) return;
  const result = await rpc("record_product_measurement", { p_user_id: userId, p_events: [...new Set(events)] }, env);
  if (!result.ok) log({ event: "product_measurement_dropped", reason: "store_error" });
}

export async function recordFieldVitals(beacon: FieldVitalsBeacon, env: Env = process.env): Promise<boolean> {
  const bucket = (metric: Vital) => (beacon[metric] === undefined ? null : fieldVitalsBucket(metric, beacon[metric]!));
  const args: FieldVitalsRpcArgs = { p_path: beacon.path, p_lcp: bucket("lcp"), p_inp: bucket("inp"), p_cls: bucket("cls") };
  const result = await rpc("record_field_vitals", args, env);
  if (!result.ok) log({ event: "field_vitals_dropped", reason: "store_error" });
  return result.ok;
}
