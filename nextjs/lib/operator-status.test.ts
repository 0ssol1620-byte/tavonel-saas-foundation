import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OPERATOR_STATUS_SCHEMA,
  buildOperatorStatusV1,
  createOperatorStatusHandler,
  unconfiguredOperatorAuthorizer,
  type OperationalStatusSource,
} from "./operator-status";

const NOW = "2026-09-20T12:00:00.000Z";

function source(overrides: Partial<OperationalStatusSource> = {}): OperationalStatusSource {
  return {
    state: "available",
    evaluatedAt: NOW,
    freshness: { lastRunAt: "2026-09-20T11:59:00.000Z", ageMs: 60_000, ttlMs: 600_000 },
    availability: { passing: 3, total: 3 },
    window: {
      passingRuns: 11,
      totalRuns: 12,
      ratio: 11 / 12,
      successfulRequestLatencyP95Ms: 240,
      latencySamples: 36,
    },
    alerts: [],
    ...overrides,
  };
}

describe("B06 authenticated operator status", () => {
  it("fails closed when no operator identity adapter is configured", async () => {
    const readOperationalStatus = vi.fn(() => source());
    const GET = createOperatorStatusHandler({
      authorize: unconfiguredOperatorAuthorizer,
      readOperationalStatus,
    });

    const response = await GET(new Request("https://tavonel.com/api/operator/status/v1", {
      headers: { authorization: "Bearer any-presented-value" },
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "OPERATOR_AUTH_UNAVAILABLE" });
    expect(readOperationalStatus).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before reading operational evidence", async () => {
    const readOperationalStatus = vi.fn(() => source());
    const GET = createOperatorStatusHandler({
      authorize: async () => ({ ok: false, status: 401, code: "OPERATOR_AUTH_REQUIRED" }),
      readOperationalStatus,
    });

    const response = await GET(new Request("https://tavonel.com/api/operator/status/v1"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: "OPERATOR_AUTH_REQUIRED" });
    expect(readOperationalStatus).not.toHaveBeenCalled();
  });

  it("returns the separate operator projection to an authorized caller", async () => {
    const GET = createOperatorStatusHandler({
      authorize: async () => ({ ok: true, subject: "operator:alice" }),
      readOperationalStatus: async () => source(),
    });

    const response = await GET(new Request("https://tavonel.com/api/operator/status/v1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(body).toMatchObject({
      schemaVersion: OPERATOR_STATUS_SCHEMA,
      overallState: "available",
      evidence: { freshness: "fresh", ageMs: 60_000, ttlMs: 600_000 },
      requiredChecks: { passing: 3, total: 3 },
      recentWindow: { passingRuns: 11, totalRuns: 12, latencySamples: 36 },
      alerts: [],
    });
    expect(body).not.toHaveProperty("availableActions");
    expect(body).not.toHaveProperty("service");
  });

  it("redacts secrets, prompts, raw errors, providers, URLs, and router details by projection", () => {
    const hostile = Object.assign(source({
      alerts: [
        { severity: "critical", reason: "history_unavailable" },
        { severity: "critical", reason: "raw-provider-error: secret-value" },
      ],
    }), {
      env: { OPERATOR_TOKEN: "secret-value" },
      prompt: "private-system-prompt",
      provider: "sensitive-provider",
      bucket: "private-bucket",
      router: { route: "/internal/model/router", model: "private-model" },
      url: "https://private.example.invalid",
      rawError: "Bearer secret-value",
    });

    const encoded = JSON.stringify(buildOperatorStatusV1(hostile));

    for (const forbidden of [
      "secret-value", "private-system-prompt", "sensitive-provider", "private-bucket",
      "/internal/model/router", "private-model", "private.example.invalid", "raw-provider-error",
      "env", "prompt", "provider", "bucket", "router", "url", "rawError",
    ]) expect(encoded).not.toContain(forbidden);
  });

  it("distinguishes fresh, stale, missing, and unavailable evidence", () => {
    expect(buildOperatorStatusV1(source()).evidence.freshness).toBe("fresh");
    expect(buildOperatorStatusV1(source({
      state: "stale",
      freshness: { lastRunAt: "2026-09-20T11:40:00.000Z", ageMs: 1_200_000, ttlMs: 600_000 },
      alerts: [{ severity: "critical", reason: "freshness_ttl_exceeded" }],
    })).evidence.freshness).toBe("stale");
    expect(buildOperatorStatusV1(source({
      state: "blocked",
      freshness: { lastRunAt: null, ageMs: null, ttlMs: 600_000 },
      alerts: [{ severity: "critical", reason: "observation_missing" }],
    })).evidence.freshness).toBe("missing");
    expect(buildOperatorStatusV1(source({
      state: "blocked",
      freshness: { lastRunAt: null, ageMs: null, ttlMs: 600_000 },
      alerts: [{ severity: "critical", reason: "history_unavailable" }],
    }))).toMatchObject({
      overallState: "blocked",
      evidence: { freshness: "unavailable", observedAt: null, ageMs: null },
      alerts: [{ severity: "critical", reason: "history_unavailable" }],
    });
  });

  it("projects paid-provider breaker state and drops anything outside the vocabulary", () => {
    const status = buildOperatorStatusV1(source({
      alerts: [
        { severity: "warning", reason: "model_provider_circuit_open" },
        { severity: "warning", reason: "provider_endpoint_url" },
      ],
      modelProviders: [
        { provider: "runpod", status: "open", correlatedFailures: 5 },
        { provider: "runpod", status: "state_unavailable", correlatedFailures: 1 },
        { provider: "https://x.api.runpod.ai/v2/abc", status: "closed", correlatedFailures: 0 },
      ],
    }));

    expect(status.modelProviders).toEqual([{ provider: "runpod", status: "open", correlatedFailures: 5 }]);
    expect(status.alerts).toEqual([{ severity: "warning", reason: "model_provider_circuit_open" }]);
    expect(JSON.stringify(status)).not.toContain("api.runpod.ai");
  });

  it("emits an empty provider list rather than omitting the field when nothing is read", () => {
    expect(buildOperatorStatusV1(source()).modelProviders).toEqual([]);
  });

  it("keeps the deployed route separate from the public DTO and disabled by default", () => {
    const route = readFileSync(resolve(import.meta.dirname, "../app/api/operator/status/v1/route.ts"), "utf8");
    expect(route).toContain("unconfiguredOperatorAuthorizer");
    expect(route).toContain("evaluateOperationalSli");
    expect(route).toContain("readProbeHistory");
    expect(route).toContain("readModelProviderCircuitSnapshot");
    expect(route).not.toContain("public-status");
    expect(route).not.toContain("PUBLIC_STATUS_SCHEMA");
  });
});
