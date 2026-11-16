import { BILLING_OFFERS, type BillingOfferCode } from "./billing-catalog";
import type { PaddleAdjustment, PaddlePrice, PaddleTransaction } from "./paddle-api";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export type LedgerRow = {
  eventId: string;
  kind: string;
  transactionId: string | null;
  reversalOfTransactionId: string | null;
  creditDelta: number;
  offerCode: string | null;
};

const PAGE = 1000;
const MAX_PAGES = 10;
const KINDS = new Set(["purchased", "allowance", "reversed", "allowance_expired"]);
const GRANTS = new Set(["purchased", "allowance"]);
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/**
 * A row the delta cannot key or count: no "undefined" id, no 0 credits, no unkeyed grant or reversal.
 * The reader and the pure delta both route through this one check, so neither path can drop such a row silently.
 */
function isKeyable(row: unknown): row is LedgerRow {
  if (!row || typeof row !== "object") return false;
  const { eventId, kind, transactionId, reversalOfTransactionId: reversalOf, creditDelta, offerCode } = row as Record<string, unknown>;
  if (typeof eventId !== "string" || !eventId || typeof kind !== "string" || !KINDS.has(kind) || !Number.isSafeInteger(creditDelta)
    || !strOrNull(transactionId) || !strOrNull(reversalOf) || !strOrNull(offerCode)) return false;
  return !((GRANTS.has(kind) && !transactionId) || (kind === "reversed" && !reversalOf));
}

/** A stored row is refused, never coerced. */
function parseLedgerRow(raw: unknown): LedgerRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const row = {
    eventId: r.event_id, kind: r.kind, transactionId: r.transaction_id, reversalOfTransactionId: r.reversal_of_transaction_id,
    creditDelta: r.credit_delta, offerCode: r.offer_code,
  };
  return isKeyable(row) ? row : null;
}

/** Service-role read of the credit ledger since an instant. The result names that instant; `truncated` is true when the page cap cut it. */
export async function readLedgerForReconciliation(sinceIso: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  const rows: LedgerRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      select: "event_id,kind,transaction_id,reversal_of_transaction_id,credit_delta,offer_code",
      created_at: `gte.${sinceIso}`,
      order: "created_at.asc,id.asc",
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    let response: Response;
    try {
      response = await supabaseAdminRequest(config, `/rest/v1/foundation_credit_ledger?${query}`);
    } catch {
      return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
    }
    if (!response.ok) return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
    const batch = await response.json().catch(() => null) as unknown;
    if (!Array.isArray(batch)) return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
    for (const raw of batch) {
      const row = parseLedgerRow(raw);
      if (!row) return { ok: false as const, code: "BILLING_STORE_READ_INVALID" };
      rows.push(row);
    }
    if (batch.length < PAGE) return { ok: true as const, since: sinceIso, rows, truncated: false };
  }
  return { ok: true as const, since: sinceIso, rows, truncated: true };
}

// Same sources as the webhook: grants only on transaction.completed; ADVERSE_ADJUSTMENT_ACTIONS in paddle-billing-event.ts.
const PAID = new Set(["completed"]);
const REVERSING = new Set(["refund", "credit", "chargeback", "chargeback_warning"]);

/**
 * What the inputs cover: the ledger's `created_at >= ledgerSince`, Paddle's `updated_at > processorUpdatedAfter`,
 * and whether any of the three reads hit its page cap. An empty delta means agreement inside this window only.
 */
export type ReconciliationWindow = { ledgerSince: string; processorUpdatedAfter: string; truncated: boolean };

export type ProcessorDelta = {
  window: ReconciliationWindow;
  missingInLedger: string[];
  missingAtProcessor: string[];
  creditMismatch: string[];
  reversalMissing: string[];
  reversalUnexpected: string[];
};

const catalogCredits = (code: string | null) =>
  code && Object.hasOwn(BILLING_OFFERS, code) ? BILLING_OFFERS[code as BillingOfferCode].credits : null;

/**
 * Everything is keyed by Paddle transaction id; each bucket is sorted so the output is stable.
 * Fail closed: an input this cannot match is reported, never read as agreement. The ledger window is not
 * the processor's, so no bucket is gated on the other side being in its window: a refund whose grant is
 * older than `since` still needs its reversal row, and a grant the catalog cannot price is a mismatch.
 * A ledger row it cannot key, or a window that does not name its range, is a TypeError, never a skip.
 */
export function processorDelta(
  ledger: readonly LedgerRow[],
  transactions: readonly PaddleTransaction[],
  adjustments: readonly PaddleAdjustment[],
  window: ReconciliationWindow,
): ProcessorDelta {
  if (typeof window?.ledgerSince !== "string" || typeof window.processorUpdatedAfter !== "string" || typeof window.truncated !== "boolean") {
    throw new TypeError("processorDelta: the window it read is required");
  }
  const grants = new Map<string, LedgerRow[]>();
  const reversed = new Set<string>();
  for (const row of ledger) {
    if (!isKeyable(row)) throw new TypeError("processorDelta: a ledger row cannot be keyed or counted");
    if (row.kind === "reversed") reversed.add(row.reversalOfTransactionId!);
    else if (GRANTS.has(row.kind)) grants.set(row.transactionId!, [...grants.get(row.transactionId!) ?? [], row]);
  }
  const paid = new Set(transactions.filter((t) => PAID.has(t.status)).map((t) => t.id));
  const approvedReversals = new Set(
    adjustments.filter((a) => a.status === "approved" && REVERSING.has(a.action)).map((a) => a.transactionId),
  );
  const sorted = (s: Iterable<string>) => [...new Set(s)].sort();
  return {
    window: { ledgerSince: window.ledgerSince, processorUpdatedAfter: window.processorUpdatedAfter, truncated: window.truncated },
    missingInLedger: sorted([...paid].filter((id) => !grants.has(id))),
    // A grant the processor does not have as a completed transaction (absent, or billed/past_due).
    missingAtProcessor: sorted([...grants.keys()].filter((id) => !paid.has(id))),
    // One grant per transaction, for its offer's catalog credits; a second grant or an unknown offer is a mismatch.
    creditMismatch: sorted([...grants].filter(([, rs]) => rs.length !== 1 || catalogCredits(rs[0].offerCode) !== rs[0].creditDelta).map(([id]) => id)),
    reversalMissing: sorted([...approvedReversals].filter((id) => !reversed.has(id))),
    reversalUnexpected: sorted([...reversed].filter((id) => !approvedReversals.has(id))),
  };
}

export type PriceBookDelta = { offerCode: string; priceId: string | null; problems: string[] };

/** `paddlePrices` maps a price id to the read price, or to null when it could not be read. */
export function priceBookDelta(
  offers: ReadonlyArray<{ code: string; priceId: string | null; priceUsd: number }>,
  paddlePrices: ReadonlyMap<string, PaddlePrice | null>,
): PriceBookDelta[] {
  const out: PriceBookDelta[] = [];
  for (const offer of offers) {
    const problems: string[] = [];
    if (!offer.priceId) problems.push("price_id_not_configured");
    else {
      const price = paddlePrices.get(offer.priceId);
      if (!price) problems.push("price_unreadable");
      else {
        if (price.status !== "active") problems.push("price_not_active");
        if (price.amount !== String(Math.round(offer.priceUsd * 100))) problems.push("amount_mismatch");
        if (price.currency !== "USD") problems.push("currency_mismatch");
        if (price.interval !== "month" || price.frequency !== 1) problems.push("interval_mismatch");
      }
    }
    if (problems.length) out.push({ offerCode: offer.code, priceId: offer.priceId, problems });
  }
  return out;
}
