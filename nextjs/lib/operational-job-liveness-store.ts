import {
  MAX_OBSERVED_ACTIVE_JOBS,
  OPERATIONAL_JOB_ACTIVE_STATES,
  type OperationalJobObservation,
  type OperationalJobRow,
  type OperationalJobStoreFailure,
} from "./operational-job-liveness";

// Read-only observation of active foundation_jobs rows. Only liveness columns
// are selected; job ids, workspace keys, payloads, connection references,
// cursor tokens and error text are never requested, and anything extra the
// server returns is dropped.
export const OPERATIONAL_JOB_SELECTED_COLUMNS = [
  "state",
  "available_at",
  "lease_expires_at",
  "updated_at",
  "items_seen",
  "items_done",
] as const;

// MAX_OBSERVED_ACTIVE_JOBS + 1 rows at their widest column values serialize to
// roughly 105 KB, so a body past this cap is not an answer to our query.
export const OPERATIONAL_JOB_MAX_RESPONSE_BYTES = 256 * 1024;

const REQUEST_TIMEOUT_MS = 5_000;
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
// URL.hostname keeps IPv6 brackets and is already lowercased.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type OperationalJobLivenessStoreConfig = {
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function readOperationalJobObservation(
  config: OperationalJobLivenessStoreConfig,
): Promise<OperationalJobObservation> {
  const url = activeJobsUrl(config.supabaseUrl);
  const serviceRoleKey = config.serviceRoleKey?.trim();
  if (!url || !serviceRoleKey) return failure("store_not_configured");

  let response: Response;
  try {
    response = await (config.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      // A redirect would forward the service-role key somewhere unexpected.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch {
    return failure("store_request_failed");
  }

  if (!response.ok) {
    await discardBody(response);
    return failure("store_http_error");
  }
  // Observed time comes from the server's response clock, never the local one.
  const observedAt = observedAtFromDateHeader(response.headers.get("date"));
  if (!observedAt) {
    await discardBody(response);
    return failure("store_clock_unavailable");
  }

  const received = await readBoundedBytes(response, OPERATIONAL_JOB_MAX_RESPONSE_BYTES);
  if (typeof received === "string") return failure(received);

  let body: unknown;
  try {
    // fatal: invalid UTF-8 is malformed, never silently replaced.
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(received));
  } catch {
    return failure("store_invalid_response");
  }
  if (!Array.isArray(body) || !body.every(isRecord)) {
    return failure("store_invalid_response");
  }

  return {
    ok: true,
    observedAt,
    // The query asks for one row past the cap so an over-cap workload is
    // detectable; the evaluator turns truncated into unknown.
    truncated: body.length > MAX_OBSERVED_ACTIVE_JOBS,
    rows: body.slice(0, MAX_OBSERVED_ACTIVE_JOBS).map(pickLivenessColumns),
  };
}

// Nothing is parsed until the whole body is known to fit: a declared oversize
// body is refused unread, and an undeclared one is cut off at the first chunk
// that crosses the cap.
async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | OperationalJobStoreFailure> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await discardBody(response);
    return "store_response_too_large";
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "store_response_too_large";
      }
      chunks.push(value);
    }
  } catch {
    // Reset or timeout mid-body: a transport failure, not a malformed body.
    return "store_request_failed";
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function activeJobsUrl(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl?.trim()) return null;
  let url: URL;
  try {
    url = new URL("/rest/v1/foundation_jobs", supabaseUrl.trim());
  } catch {
    return null;
  }
  // The service-role key rides in the headers, so only TLS may carry it off
  // the host; plain HTTP is allowed solely for a loopback local runtime.
  const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) return null;
  url.searchParams.set("select", OPERATIONAL_JOB_SELECTED_COLUMNS.join(","));
  url.searchParams.set("state", `in.(${OPERATIONAL_JOB_ACTIVE_STATES.join(",")})`);
  url.searchParams.set("limit", String(MAX_OBSERVED_ACTIVE_JOBS + 1));
  return url.toString();
}

function pickLivenessColumns(record: Record<string, unknown>): OperationalJobRow {
  return {
    state: record.state,
    available_at: record.available_at,
    lease_expires_at: record.lease_expires_at,
    updated_at: record.updated_at,
    items_seen: record.items_seen,
    items_done: record.items_done,
  };
}

function observedAtFromDateHeader(value: string | null): string | null {
  if (!value || !HTTP_DATE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function failure(code: OperationalJobStoreFailure): OperationalJobObservation {
  return { ok: false, failure: code };
}
