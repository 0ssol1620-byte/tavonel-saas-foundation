import { describe, expect, it } from "vitest";

import {
  evaluateOperationalJobLiveness,
  MAX_OBSERVED_ACTIVE_JOBS,
} from "./operational-job-liveness";
import {
  OPERATIONAL_JOB_MAX_RESPONSE_BYTES,
  OPERATIONAL_JOB_SELECTED_COLUMNS,
  readOperationalJobObservation,
} from "./operational-job-liveness-store";

const SUPABASE_URL = "https://project-ref.supabase.co";
const SERVICE_ROLE_KEY = "service-role-secret-value";
const DATE_HEADER = "Fri, 02 Oct 2026 12:00:00 GMT";

const SENSITIVE_VALUES = [
  "job-4f2c9d1e4f2c9d1e4f2c9d1e4f2c9d1e",
  "pilot-acme8812",
  "0b7c77aa-0000-4000-8000-000000000001",
  "alice@example.com",
  "/private/uploads/alice.csv",
  "provider exploded: token=sk_live_123",
  "https://graph.example.com/delta?token=cursor-secret",
  "worker-host-17",
];

// Liveness columns of public.foundation_jobs, as PostgREST serializes them.
function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    state: "leased",
    available_at: "2026-10-02T11:55:00+00:00",
    lease_expires_at: "2026-10-02T12:04:00+00:00",
    updated_at: "2026-10-02T11:59:45+00:00",
    items_seen: 40,
    items_done: 12,
    ...overrides,
  };
}

// Every other foundation_jobs column, populated with values that must never
// leave the store.
function sensitiveRow() {
  return activeRow({
    job_id: SENSITIVE_VALUES[0],
    workspace_key: SENSITIVE_VALUES[1],
    oauth_connection_id: SENSITIVE_VALUES[2],
    created_by: SENSITIVE_VALUES[2],
    payload: { email: SENSITIVE_VALUES[3], path: SENSITIVE_VALUES[4] },
    error_code: "PROVIDER_FAILED",
    error_detail: SENSITIVE_VALUES[5],
    cursor_token: SENSITIVE_VALUES[6],
    leased_by: SENSITIVE_VALUES[7],
    idempotency_key: SENSITIVE_VALUES[3],
  });
}

function rawResponse(
  body: BodyInit | null,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", date: DATE_HEADER, ...init.headers },
  });
}

function jsonResponse(
  body: unknown,
  init: { status?: number; date?: string | null } = {},
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.date !== null) headers.set("date", init.date ?? DATE_HEADER);
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { fetchImpl, calls };
}

function read(fetchImpl: typeof fetch) {
  return readOperationalJobObservation({
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_ROLE_KEY,
    fetchImpl,
  });
}

function expectNoSensitiveValues(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const sensitive of [...SENSITIVE_VALUES, SERVICE_ROLE_KEY]) {
    expect(serialized).not.toContain(sensitive);
  }
}

describe("readOperationalJobObservation", () => {
  it("issues one bounded read-only query for liveness columns only", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse([]));

    await read(fetchImpl);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    const parsed = new URL(url);
    expect(parsed.origin).toBe(SUPABASE_URL);
    expect(parsed.pathname).toBe("/rest/v1/foundation_jobs");
    expect(parsed.searchParams.get("select")).toBe(
      "state,available_at,lease_expires_at,updated_at,items_seen,items_done",
    );
    expect(parsed.searchParams.get("state")).toBe("in.(queued,leased)");
    expect(parsed.searchParams.get("status")).toBeNull();
    expect(parsed.searchParams.get("limit")).toBe(String(MAX_OBSERVED_ACTIVE_JOBS + 1));
    expect([...parsed.searchParams.keys()].sort()).toEqual(["limit", "select", "state"]);
    for (const column of [
      "job_id",
      "workspace_key",
      "oauth_connection_id",
      "collection_id",
      "payload",
      "idempotency_key",
      "leased_by",
      "cursor_token",
      "error_code",
      "error_detail",
      "created_by",
    ]) {
      expect(OPERATIONAL_JOB_SELECTED_COLUMNS).not.toContain(column);
    }

    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe(SERVICE_ROLE_KEY);
    expect(headers.get("authorization")).toBe(`Bearer ${SERVICE_ROLE_KEY}`);
    expect(headers.get("prefer")).toBeNull();
  });

  it("returns only liveness columns and the server-observed time", async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse([sensitiveRow()]));

    const observation = await read(fetchImpl);

    expect(observation).toEqual({
      ok: true,
      observedAt: "2026-10-02T12:00:00.000Z",
      truncated: false,
      rows: [activeRow()],
    });
    expectNoSensitiveValues(observation);
    expectNoSensitiveValues(evaluateOperationalJobLiveness(observation, "open"));
  });

  it("feeds a fresh queue through to a healthy evaluation", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse([
        activeRow(),
        activeRow({
          state: "queued",
          available_at: "2026-10-02T11:59:30+00:00",
          lease_expires_at: null,
          items_seen: 0,
          items_done: 0,
        }),
      ]),
    );

    const result = evaluateOperationalJobLiveness(await read(fetchImpl), "open");

    expect(result.state).toBe("healthy");
    expect(result.healthy).toBe(true);
  });

  it("feeds an empty queue through to idle", async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse([]));

    const result = evaluateOperationalJobLiveness(await read(fetchImpl), "open");

    expect(result.state).toBe("idle");
    expect(result.healthy).toBe(true);
  });

  it("truncates over-cap workloads of the widest legitimate rows", async () => {
    const widest = activeRow({
      available_at: "2026-10-02T11:55:00.123456+00:00",
      lease_expires_at: "2026-10-02T12:04:00.123456+00:00",
      updated_at: "2026-10-02T11:59:45.123456+00:00",
      items_seen: 2_147_483_647,
      items_done: 2_147_483_647,
    });
    const rows = Array.from({ length: MAX_OBSERVED_ACTIVE_JOBS + 1 }, () => widest);
    expect(JSON.stringify(rows).length).toBeLessThan(OPERATIONAL_JOB_MAX_RESPONSE_BYTES);
    const { fetchImpl } = stubFetch(() => jsonResponse(rows));

    const observation = await read(fetchImpl);

    expect(observation.ok).toBe(true);
    if (!observation.ok) return;
    expect(observation.truncated).toBe(true);
    expect(observation.rows).toHaveLength(MAX_OBSERVED_ACTIVE_JOBS);
    const result = evaluateOperationalJobLiveness(observation, "open");
    expect(result.state).toBe("unknown");
    expect(result.healthy).toBe(false);
    expect(result.reasons).toEqual(["workload_capped"]);
  });

  it("refuses to run without configuration", async () => {
    for (const config of [
      { supabaseUrl: undefined, serviceRoleKey: SERVICE_ROLE_KEY },
      { supabaseUrl: "not a url", serviceRoleKey: SERVICE_ROLE_KEY },
      { supabaseUrl: "ftp://project-ref.supabase.co", serviceRoleKey: SERVICE_ROLE_KEY },
      { supabaseUrl: SUPABASE_URL, serviceRoleKey: undefined },
      { supabaseUrl: SUPABASE_URL, serviceRoleKey: "   " },
    ]) {
      const { fetchImpl, calls } = stubFetch(() => jsonResponse([]));

      const observation = await readOperationalJobObservation({ ...config, fetchImpl });

      expect(observation).toEqual({ ok: false, failure: "store_not_configured" });
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses plain HTTP to a non-loopback host before sending the key", async () => {
    for (const supabaseUrl of [
      "http://project-ref.supabase.co",
      "http://10.0.0.5:54321",
      "http://localhost.example.com:54321",
      "http://127.0.0.1.nip.io:54321",
    ]) {
      const { fetchImpl, calls } = stubFetch(() => jsonResponse([]));

      const observation = await readOperationalJobObservation({
        supabaseUrl,
        serviceRoleKey: SERVICE_ROLE_KEY,
        fetchImpl,
      });

      expect(observation).toEqual({ ok: false, failure: "store_not_configured" });
      expect(calls).toHaveLength(0);
    }
  });

  it("allows plain HTTP to a loopback local runtime", async () => {
    for (const origin of [
      "http://localhost:54321",
      "http://127.0.0.1:54321",
      "http://[::1]:54321",
    ]) {
      const { fetchImpl, calls } = stubFetch(() => jsonResponse([]));

      const observation = await readOperationalJobObservation({
        supabaseUrl: origin,
        serviceRoleKey: SERVICE_ROLE_KEY,
        fetchImpl,
      });

      expect(observation.ok).toBe(true);
      expect(calls).toHaveLength(1);
      const sent = new URL(calls[0].url);
      expect(sent.origin).toBe(origin);
      expect(sent.pathname).toBe("/rest/v1/foundation_jobs");
    }
  });

  it("maps transport failures to a fixed code without leaking the error", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error(`connect failed for ${SERVICE_ROLE_KEY} ${SENSITIVE_VALUES[5]}`);
    };

    const observation = await read(fetchImpl);

    expect(observation).toEqual({ ok: false, failure: "store_request_failed" });
    expectNoSensitiveValues(observation);
  });

  it("maps a body that fails mid-stream to a transport failure", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("["));
        controller.error(new Error(`reset ${SERVICE_ROLE_KEY}`));
      },
    });
    const { fetchImpl } = stubFetch(() => rawResponse(body));

    const observation = await read(fetchImpl);

    expect(observation).toEqual({ ok: false, failure: "store_request_failed" });
    expectNoSensitiveValues(observation);
  });

  it("maps HTTP errors to a fixed code without exposing the provider body", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse(
        { message: SENSITIVE_VALUES[5], hint: SERVICE_ROLE_KEY, details: SENSITIVE_VALUES[4] },
        { status: 500 },
      ),
    );

    const observation = await read(fetchImpl);

    expect(observation).toEqual({ ok: false, failure: "store_http_error" });
    expectNoSensitiveValues(observation);
    expect(evaluateOperationalJobLiveness(observation, "open").state).toBe("unknown");
  });

  it("refuses to fabricate observed time when the server clock is missing", async () => {
    for (const date of [null, "", "yesterday", "2026-10-02T12:00:00Z"]) {
      const { fetchImpl } = stubFetch(() => jsonResponse([activeRow()], { date }));

      const observation = await read(fetchImpl);

      expect(observation).toEqual({ ok: false, failure: "store_clock_unavailable" });
    }
  });

  it("accepts a body of exactly the byte cap", async () => {
    const body = "[]".padEnd(OPERATIONAL_JOB_MAX_RESPONSE_BYTES, " ");
    const { fetchImpl } = stubFetch(() => rawResponse(body));

    const observation = await read(fetchImpl);

    expect(observation).toEqual({
      ok: true,
      observedAt: "2026-10-02T12:00:00.000Z",
      truncated: false,
      rows: [],
    });
  });

  it("rejects an undeclared body one byte past the cap before parsing it", async () => {
    const body = "[]".padEnd(OPERATIONAL_JOB_MAX_RESPONSE_BYTES + 1, " ");
    const { fetchImpl } = stubFetch(() => rawResponse(body));

    const observation = await read(fetchImpl);

    expect(observation).toEqual({ ok: false, failure: "store_response_too_large" });
    expect(evaluateOperationalJobLiveness(observation, "open").reasons).toEqual([
      "store_unavailable",
    ]);
  });

  it("stops reading an endless body at the cap and cancels it", async () => {
    const chunkBytes = 64 * 1024;
    let pulls = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
        },
        cancel() {
          canceled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const { fetchImpl } = stubFetch(() => rawResponse(body));

    const observation = await read(fetchImpl);

    expect(observation).toEqual({ ok: false, failure: "store_response_too_large" });
    expect(canceled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(OPERATIONAL_JOB_MAX_RESPONSE_BYTES / chunkBytes + 2);
  });

  it("refuses a declared oversize body without reading it", async () => {
    let pulled = false;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode("[]"));
          controller.close();
        },
        cancel() {
          canceled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const { fetchImpl } = stubFetch(() =>
      rawResponse(body, {
        headers: { "content-length": String(OPERATIONAL_JOB_MAX_RESPONSE_BYTES + 1) },
      }),
    );

    const observation = await read(fetchImpl);

    expect(observation).toEqual({ ok: false, failure: "store_response_too_large" });
    expect(pulled).toBe(false);
    expect(canceled).toBe(true);
  });

  it("rejects bodies that are not an array of row objects", async () => {
    for (const body of ["not json", { rows: [] }, [activeRow(), null], [[activeRow()]], ["row"]]) {
      const { fetchImpl } = stubFetch(() => jsonResponse(body));

      const observation = await read(fetchImpl);

      expect(observation).toEqual({ ok: false, failure: "store_invalid_response" });
    }
  });

  it("rejects empty and non-UTF-8 bodies as malformed", async () => {
    for (const respond of [
      () => rawResponse(null),
      () => rawResponse(""),
      () => rawResponse(new Uint8Array([0x5b, 0xff, 0x5d])),
    ]) {
      const { fetchImpl } = stubFetch(respond);

      const observation = await read(fetchImpl);

      expect(observation).toEqual({ ok: false, failure: "store_invalid_response" });
    }
  });

  it("passes missing columns through as absent so evaluation stays unknown", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse([{ state: "leased", lease_expires_at: "2026-10-02T12:04:00+00:00" }]),
    );

    const result = evaluateOperationalJobLiveness(await read(fetchImpl), "open");

    expect(result.state).toBe("unknown");
    expect(result.reasons).toEqual(["row_untrusted"]);
  });

  it("does not read a `status` field as the job state", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse([
        {
          status: "leased",
          available_at: "2026-10-02T11:55:00+00:00",
          lease_expires_at: "2026-10-02T12:04:00+00:00",
          updated_at: "2026-10-02T11:59:45+00:00",
          items_seen: 40,
          items_done: 12,
        },
      ]),
    );

    const observation = await read(fetchImpl);

    expect(observation.ok).toBe(true);
    if (!observation.ok) return;
    expect(observation.rows[0].state).toBeUndefined();
    expect(observation.rows[0]).not.toHaveProperty("status");
    const result = evaluateOperationalJobLiveness(observation, "open");
    expect(result.state).toBe("unknown");
    expect(result.reasons).toEqual(["row_untrusted"]);
  });

  it("treats null progress counters as untrusted, not as zero", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse([activeRow({ items_seen: null, items_done: null })]),
    );

    const result = evaluateOperationalJobLiveness(await read(fetchImpl), "open");

    expect(result.state).toBe("unknown");
    expect(result.reasons).toEqual(["row_untrusted"]);
  });
});
