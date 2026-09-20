import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminConfig, adminRequest } = vi.hoisted(() => ({ adminConfig: vi.fn(), adminRequest: vi.fn() }));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: adminConfig, supabaseAdminRequest: adminRequest }));

import {
  commitModelProviderCircuitAdmission,
  commitModelProviderCircuitOutcome,
  initializeModelProviderCircuit,
  readModelProviderCircuitSnapshot,
  setModelProviderCircuitEnabled,
} from "./model-provider-circuit-store";
import {
  createClosedModelProviderCircuit,
  proposeModelProviderCircuitAdmission,
  proposeModelProviderCircuitOutcome,
  type ModelProviderAdmissionProposal,
  type ModelProviderOutcomeProposal,
} from "./model-provider-circuit";

const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48) };
const provider = "runpod";
const now = new Date("2026-09-20T00:00:00.000Z");

function admission() {
  return proposeModelProviderCircuitAdmission({ ok: true, state: createClosedModelProviderCircuit(provider, now) }, {
    provider, admissionId: "admission-0001", accountingReady: true, now,
  }) as ModelProviderAdmissionProposal;
}

describe("model-provider circuit service-role store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminConfig.mockReturnValue({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  });

  it("reads the exact pure-contract snapshot and fails closed on missing, disabled, or malformed state", async () => {
    const state = createClosedModelProviderCircuit(provider, now);
    adminRequest.mockResolvedValueOnce(Response.json({ state }));
    await expect(readModelProviderCircuitSnapshot(provider, env)).resolves.toEqual({ ok: true, state });

    adminRequest.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(readModelProviderCircuitSnapshot(provider, env)).resolves.toEqual({ ok: false, code: "state_unavailable" });

    adminRequest.mockResolvedValueOnce(Response.json({ state: { ...state, revision: "1" } }));
    await expect(readModelProviderCircuitSnapshot(provider, env)).resolves.toEqual({ ok: false, code: "state_unavailable" });

    adminConfig.mockReturnValueOnce(null);
    await expect(readModelProviderCircuitSnapshot(provider, env)).resolves.toEqual({ ok: false, code: "state_missing" });
  });

  it("commits admission state, event, and receipt through the admission CAS RPC", async () => {
    const proposal = admission();
    adminRequest.mockResolvedValue(Response.json({ status: "committed",
      committedRevision: proposal.nextState.revision, eventId: proposal.event.eventId }));
    await expect(commitModelProviderCircuitAdmission(proposal, env)).resolves.toEqual({
      ok: true, committedRevision: 1, eventId: "admission:admission-0001",
    });
    const [, path, init] = adminRequest.mock.calls[0];
    expect(path).toBe("/rest/v1/rpc/commit_model_provider_circuit_admission_v1");
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({
      p_provider: provider, p_expected_revision: 0, p_next_state: proposal.nextState,
      p_event: proposal.event, p_receipt: proposal.receipt,
    }));
  });

  it("commits an outcome without an admission receipt and validates the exact CAS receipt", async () => {
    const admitted = admission();
    const proposal = proposeModelProviderCircuitOutcome({ ok: true, state: admitted.nextState }, admitted.receipt,
      { kind: "failure", scope: "provider_operational", code: "UPSTREAM_TIMEOUT" },
      { now: new Date(now.getTime() + 1) }) as ModelProviderOutcomeProposal;
    adminRequest.mockResolvedValueOnce(Response.json({ status: "replayed",
      committedRevision: proposal.nextState.revision, eventId: proposal.event.eventId }));
    await expect(commitModelProviderCircuitOutcome(proposal, env)).resolves.toMatchObject({ ok: true });
    const [, path, init] = adminRequest.mock.calls[0];
    expect(path).toBe("/rest/v1/rpc/commit_model_provider_circuit_outcome_v1");
    expect(JSON.parse(init.body)).not.toHaveProperty("p_receipt");

    adminRequest.mockResolvedValueOnce(Response.json({ status: "committed",
      committedRevision: proposal.nextState.revision + 1, eventId: proposal.event.eventId }));
    await expect(commitModelProviderCircuitOutcome(proposal, env)).resolves.toEqual({
      ok: false, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED",
    });
  });

  it("bootstraps disabled and requires a separate explicit enable operation", async () => {
    adminRequest.mockResolvedValueOnce(Response.json({ status: "initialized", provider, enabled: false }));
    await expect(initializeModelProviderCircuit(provider, env)).resolves.toEqual({
      ok: true, status: "initialized", provider, enabled: false,
    });
    adminRequest.mockResolvedValueOnce(Response.json({ status: "configured", provider, enabled: true }));
    await expect(setModelProviderCircuitEnabled(provider, true, env)).resolves.toEqual({
      ok: true, provider, enabled: true,
    });
  });

  it("never leaks store failures or accepts an unbound commit receipt", async () => {
    const proposal = admission();
    adminRequest.mockRejectedValueOnce(new Error("secret-bearing database detail"));
    await expect(commitModelProviderCircuitAdmission(proposal, env)).resolves.toEqual({
      ok: false, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED",
    });
    adminRequest.mockResolvedValueOnce(Response.json({ status: "committed",
      committedRevision: proposal.nextState.revision, eventId: "admission:someone-else" }));
    await expect(commitModelProviderCircuitAdmission(proposal, env)).resolves.toEqual({
      ok: false, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED",
    });
  });
});

describe("model-provider circuit migration contract", () => {
  const sql = readFileSync(resolve(import.meta.dirname,
    "../../supabase/migrations/20260920131200_model_provider_circuit.sql"), "utf8");

  it("requires explicit disabled bootstrap and refuses unreadable or disabled admission", () => {
    expect(sql).toContain("enabled boolean not null default false");
    expect(sql).toContain("initialize_model_provider_circuit_v1");
    expect(sql).toContain("model_provider_circuit_disabled");
    expect(sql).toContain("model_provider_circuit_state_unavailable");
  });

  it("serializes provider-wide transitions and compares the expected revision", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("v_state.revision <> p_expected_revision");
    expect(sql).toContain("model_provider_circuit_revision_conflict");
    expect(sql).toContain("commit_model_provider_circuit_admission_v1");
    expect(sql).toContain("commit_model_provider_circuit_outcome_v1");
  });

  it("persists immutable events and admission receipts atomically with state", () => {
    const eventInsert = sql.indexOf("insert into public.model_provider_circuit_events");
    const stateUpdate = sql.indexOf("update public.model_provider_circuit_states", eventInsert);
    expect(eventInsert).toBeGreaterThan(0);
    expect(stateUpdate).toBeGreaterThan(eventInsert);
    expect(sql).toContain("model_provider_circuit_events_immutable");
    expect(sql).toContain("receipt jsonb");
    expect(sql).toContain("model_provider_circuit_event_id_conflict");
  });

  it("keeps tables private and exposes RPCs only to service_role", () => {
    expect(sql).toMatch(/revoke all on public\.model_provider_circuit_states[\s\S]*from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.commit_model_provider_circuit_admission_v1[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant execute on function public\.commit_model_provider_circuit_admission_v1[\s\S]*to (anon|authenticated)/i);
  });
});
