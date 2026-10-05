import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), request: vi.fn(), fingerprint: vi.fn() }));

vi.mock("@/lib/intake-triage-rollout", () => ({ INTAKE_TRIAGE_ROLLOUT_ENABLED: false }));
vi.mock("@/lib/supabase-admin", () => ({ readSupabaseAdminConfig: mocks.config, supabaseAdminRequest: mocks.request }));
vi.mock("@/lib/usage-pricing", () => ({ intakePricingFingerprint: mocks.fingerprint }));

import { assertFoundationIntakeCompileSet } from "./compute-reservation";

describe("disabled triage compile compatibility", () => {
  it("runs the baseline compile-set RPC without requiring the versioned triage RPC", async () => {
    mocks.config.mockReturnValue({ endpoint: "synthetic" });
    mocks.request.mockResolvedValue(new Response(JSON.stringify({ allowed: true, approvalRequired: false }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const result = await assertFoundationIntakeCompileSet({
      workspaceKey: "pilot-abc123", userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      documentIds: ["33333333-3333-4333-8333-333333333333"],
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]![1]).toBe("/rest/v1/rpc/assert_foundation_intake_compile_set");
  });
});
