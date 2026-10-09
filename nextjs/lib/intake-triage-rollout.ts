/**
 * Coordinated server rollout switch for the triage workflow.
 * Keep disabled until the client and versioned RPC migration are deployed together.
 * This is intentionally code-owned: it does not read environment or secret values.
 */
export const INTAKE_TRIAGE_ROLLOUT_ENABLED = false;

export function intakeTriageDisabledResponse() {
  return Response.json({ code: "INTAKE_TRIAGE_DISABLED" }, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
