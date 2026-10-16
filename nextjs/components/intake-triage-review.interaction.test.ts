import { describe, expect, it, vi } from "vitest";
import { confirmLegacyFallback, createLegacyFallbackGate, stageTriage } from "@/lib/intake-triage-client";

describe("feature-off legacy approval interactions", () => {
  it("does not start legacy processing from the review-only click", async () => {
    const approveLegacy = vi.fn();
    const gate = createLegacyFallbackGate();
    const probe = await stageTriage([], "session-token", async () => new Response(
      JSON.stringify({ code: "INTAKE_TRIAGE_DISABLED" }), { status: 404 },
    ));

    if (probe.kind === "disabled") gate.markDisabled();
    expect(probe.kind).toBe("disabled");
    expect(approveLegacy).not.toHaveBeenCalled();
    expect(confirmLegacyFallback(gate, false, false, approveLegacy)).toBe(false);
    expect(confirmLegacyFallback(gate, true, false, approveLegacy)).toBe(true);
    expect(approveLegacy).toHaveBeenCalledTimes(1);
  });

  it("starts the full-scope legacy path at most once on a double click", () => {
    const approveLegacy = vi.fn();
    const gate = createLegacyFallbackGate();
    gate.markDisabled();
    gate.markDisabled();
    const clickApprove = () => confirmLegacyFallback(gate, true, false, approveLegacy);

    expect(clickApprove()).toBe(true);
    expect(clickApprove()).toBe(false);
    expect(approveLegacy).toHaveBeenCalledTimes(1);
  });
});
