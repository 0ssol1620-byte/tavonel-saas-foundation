import { NextResponse } from "next/server";
import { reconcileModelProviderSpend } from "@/lib/model-provider-spend";
import { authorizeSyntheticCanary } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const HEADERS = { "Cache-Control": "no-store" };

/*
  Resolves one reservation that `runGovernedModelProviderCall` parked as
  `pending_reconciliation` -- a provider call whose outcome was ambiguous, so the hold was kept
  rather than settled as a proven zero.

  Three properties this route exists to hold, and one it deliberately does not add.

  POST only, and no GET. Every other internal route here answers both verbs because a scheduler
  drives it. This one must not be schedulable: the actual units come off a provider invoice a
  person read. A cron hitting it gets 405, which is the intended answer.

  The units are supplied, never inferred. There is no "estimate from duration" path, because an
  invented number in an immutable cost ledger is worse than an unresolved hold -- the hold is
  visibly unresolved, the invention is not.

  No second audit write. `reconcile_model_provider_spend_v1` inserts the ledger row and resolves
  the reconciliation row in one transaction, and `model_provider_spend_ledger` is append-only by
  trigger (`reject_model_provider_ledger_mutation`). An audit event written from here would be a
  non-transactional second record that can disagree with the ledger it claims to describe. The
  reason code the operator supplies is carried into both rows, which is the auditable fact.
*/
function authorized(request: Request): boolean {
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 32);
  return configured.some((secret) =>
    authorizeSyntheticCanary(request.headers.get("authorization"), secret));
}

const STATUS: Record<string, number> = {
  MODEL_PROVIDER_RECONCILIATION_INVALID: 400,
  MODEL_PROVIDER_RESERVATION_NOT_FOUND: 404,
  MODEL_PROVIDER_RECONCILIATION_NOT_FOUND: 404,
  MODEL_PROVIDER_RESERVATION_NOT_ACTIVE: 409,
  MODEL_PROVIDER_RECONCILIATION_CONFLICT: 409,
  MODEL_PROVIDER_RESERVED_COST_EXCEEDED: 409,
};

function integer(value: unknown): number {
  return Number.isSafeInteger(value) ? (value as number) : -1;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json(
      { code: "MODEL_PROVIDER_RECONCILE_NOT_AUTHORIZED" },
      { status: 401, headers: HEADERS },
    );
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { code: "MODEL_PROVIDER_RECONCILIATION_INVALID" },
      { status: 400, headers: HEADERS },
    );
  }

  // Defaulting an unrecognised outcome to "settled" would charge a customer because a field was
  // misspelled. It is refused instead.
  if (body.outcome !== "settled" && body.outcome !== "released") {
    return NextResponse.json(
      { code: "MODEL_PROVIDER_RECONCILIATION_INVALID" },
      { status: 400, headers: HEADERS },
    );
  }

  // Every remaining field is re-validated by reconcileModelProviderSpend against the same
  // regexes the RPC enforces, so this only carries the shapes across without widening them.
  const result = await reconcileModelProviderSpend({
    tenantId: String(body.tenantId ?? ""),
    reservationId: String(body.reservationId ?? ""),
    outcome: body.outcome,
    actualUnits: integer(body.actualUnits),
    reasonCode: String(body.reasonCode ?? ""),
  });

  if (!result.ok) {
    return NextResponse.json({ code: result.code }, {
      status: STATUS[result.code] ?? 503,
      headers: HEADERS,
    });
  }

  const receipt = result.receipt as Record<string, unknown>;
  return NextResponse.json({
    code: receipt.status === "duplicate"
      ? "MODEL_PROVIDER_RECONCILIATION_REPLAYED"
      : "MODEL_PROVIDER_RECONCILIATION_RESOLVED",
    reservationId: receipt.reservationId,
    state: receipt.state,
    actualUnits: receipt.actualUnits,
    actualMicrousd: receipt.actualMicrousd,
    reconciliationStatus: receipt.reconciliationStatus,
  }, { headers: HEADERS });
}
