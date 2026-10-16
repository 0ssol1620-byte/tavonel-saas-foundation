import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), request: vi.fn() }));

vi.mock("@/lib/intake-triage-rollout", () => ({ INTAKE_TRIAGE_ROLLOUT_ENABLED: true }));
vi.mock("@/lib/supabase-admin", () => ({ readSupabaseAdminConfig: mocks.config, supabaseAdminRequest: mocks.request }));

import { createFoundationIntakeApproval } from "./compute-reservation";

describe("server-on/database-off rollout mismatch", () => {
  it("returns the database gate refusal without retrying legacy approval RPC", async () => {
    mocks.config.mockReturnValue({ endpoint: "synthetic" });
    mocks.request.mockResolvedValue(new Response(JSON.stringify({ message: "foundation_intake_triage_rollout_disabled" }), {
      status: 400, headers: { "content-type": "application/json" },
    }));
    const result = await createFoundationIntakeApproval({
      workspaceKey: "pilot-abc123", userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      attemptKey: "attempt_0123456789abcdef", clientManifestDigest: `sha256:${"a".repeat(64)}`,
      pricingFingerprint: `sha256:${"b".repeat(64)}`, triageReceiptId: "11111111-1111-4111-8111-111111111111",
      triageVersion: "tavonel-intake-triage-v1", triageInventoryDigest: `sha256:${"c".repeat(64)}`,
      configurationRevision: "triage-config-1", aggregateMaximumCredits: 1,
      files: [{ fileKey: "fk_12345678", contentSha256: `sha256:${"d".repeat(64)}`, byteLength: 1024,
        mimeType: "application/pdf", pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 1, maximumCredits: 1 }],
    });
    expect(result).toMatchObject({ ok: false, code: "INTAKE_TRIAGE_ROLLOUT_DISABLED", status: 503 });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]![1]).toBe("/rest/v1/rpc/create_foundation_intake_approval_v2");
  });
});
