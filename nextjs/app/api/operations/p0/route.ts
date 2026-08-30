import { NextResponse } from "next/server";
import { LARGE_DOCUMENT_POLICY } from "@/lib/operations-p0";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      schemaVersion: "tavonel.operations_p0.v1",
      generatedAt: new Date().toISOString(),
      largeDocument: LARGE_DOCUMENT_POLICY,
      creditRelease: {
        terminalStates: ["failed_terminal", "operator_review"],
        outcome: "released",
        actualCredits: 0,
        retryPolicy: "new_reservation_required",
      },
      evidence: {
        deletion: "tavonel.deletion_evidence.v1",
        restore: "tavonel.restore_evidence.v1",
        alert: "tavonel.operations_alert.v1",
      },
      decisionGates: {
        promotion: "four-eyes-human-approval",
        rollback: "four-eyes-human-approval",
        candidatePromotionAutomatic: false,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
