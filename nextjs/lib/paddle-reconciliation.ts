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

/** Service-role read of the credit ledger since an instant. `truncated` is true when the page cap cut it. */
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
    const batch = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
    if (!Array.isArray(batch)) return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
    for (const r of batch) {
      rows.push({
        eventId: String(r.event_id), kind: String(r.kind),
        transactionId: typeof r.transaction_id === "string" ? r.transaction_id : null,
        reversalOfTransactionId: typeof r.reversal_of_transaction_id === "string" ? r.reversal_of_transaction_id : null,
        creditDelta: Number(r.credit_delta),
        offerCode: typeof r.offer_code === "string" ? r.offer_code : null,
      });
    }
    if (batch.length < PAGE) return { ok: true as const, rows, truncated: false };
  }
  return { ok: true as const, rows, truncated: true };
}

const PAID = new Set(["completed", "billed"]);
const REVERSING = new Set(["refund", "credit", "chargeback"]);

export type ProcessorDelta = {
  missingInLedger: string[];
  missingAtProcessor: string[];
  creditMismatch: string[];
  reversalMissing: string[];
  reversalUnexpected: string[];
};

const catalogCredits = (code: string | null) =>
  code && Object.hasOwn(BILLING_OFFERS, code) ? BILLING_OFFERS[code as BillingOfferCode].credits : null;

/** Everything is keyed by Paddle transaction id; each bucket is sorted so the output is stable. */
export function processorDelta(
  ledger: readonly LedgerRow[],
  transactions: readonly PaddleTransaction[],
  adjustments: readonly PaddleAdjustment[],
): ProcessorDelta {
  const grants = new Map<string, LedgerRow>();
  const reversed = new Set<string>();
  for (const row of ledger) {
    if (row.kind === "reversed") {
      if (row.reversalOfTransactionId) reversed.add(row.reversalOfTransactionId);
    } else if (row.transactionId) grants.set(row.transactionId, row);
  }
  const processor = new Set(transactions.map((t) => t.id));
  const approvedReversals = new Set(
    adjustments.filter((a) => a.status === "approved" && REVERSING.has(a.action)).map((a) => a.transactionId),
  );
  const sorted = (s: Iterable<string>) => [...new Set(s)].sort();
  return {
    missingInLedger: sorted(transactions.filter((t) => PAID.has(t.status) && !grants.has(t.id)).map((t) => t.id)),
    missingAtProcessor: sorted([...grants.keys()].filter((id) => !processor.has(id))),
    creditMismatch: sorted([...grants].filter(([id, r]) => {
      const expected = catalogCredits(r.offerCode);
      return processor.has(id) && expected !== null && expected !== r.creditDelta;
    }).map(([id]) => id)),
    reversalMissing: sorted([...approvedReversals].filter((id) => grants.has(id) && !reversed.has(id))),
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
