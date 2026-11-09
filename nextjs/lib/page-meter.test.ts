/**
 * Page meter, application half (Foundation migration 20261109120000).
 *
 * The ledger decides each charge; this file pins what the application sends and which answers it
 * will accept. `supabase/tests/foundation_page_meter.sql` is the half that cannot be mocked:
 * whether the database moves the balance the way these receipts say.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settleFoundationMeteredCompute, type MeteredSettlement } from "./compute-reservation";
import { creditsForMeteredPages, MAX_UNITS_PER_PAGE, STANDARD_UNITS_PER_PAGE } from "./usage-pricing";

const reservationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sent: MeteredSettlement = {
  workspaceKey: "pilot-4444444444444444",
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  outcome: "settled",
  pages: 3,
  complexPages: null,
  sourceSha256: `sha256:${"a".repeat(64)}`,
  reasonCode: "OCR_COMPLETED",
};

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    status: "processed", reservationId, state: "settled", settledCredits: 12, billingSource: "paid",
    meteredPages: 3, meteredComplexPages: null, chargeBasis: "pages", chargeBasisReservationId: null,
    ...overrides,
  };
}

function ledgerAnswers(body: unknown, status = 200) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("credits for metered pages", () => {
  it("charges a standard page 4 and a complex page 6, the quote's own constants", () => {
    expect(creditsForMeteredPages(3, null)).toBe(3 * STANDARD_UNITS_PER_PAGE);
    expect(creditsForMeteredPages(3, 0)).toBe(12);
    expect(creditsForMeteredPages(3, 1)).toBe(2 * STANDARD_UNITS_PER_PAGE + MAX_UNITS_PER_PAGE);
    expect(creditsForMeteredPages(3, 1)).toBe(14);
  });

  it("is the same sum the ledger computes", () => {
    const sql = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/20261109120000_page_meter_settlement.sql"), "utf8");
    expect(sql).toContain(
      `v_metered := (p_pages - v_complex) * ${STANDARD_UNITS_PER_PAGE} + v_complex * ${MAX_UNITS_PER_PAGE};`);
  });
});

describe("metered settlement", () => {
  it("sends the pages, the worker's digest and nothing priced", async () => {
    const fetcher = ledgerAnswers(receipt());
    await expect(settleFoundationMeteredCompute(sent)).resolves.toMatchObject({ ok: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("/rest/v1/rpc/settle_foundation_compute_v4");
    expect(JSON.parse(String(init.body))).toEqual({
      p_workspace_key: sent.workspaceKey, p_document_id: sent.documentId, p_outcome: "settled",
      p_pages: 3, p_complex_pages: null, p_source_sha256: sent.sourceSha256, p_reason_code: "OCR_COMPLETED",
    });
  });

  it("refuses a settled read with no page count before calling the ledger", async () => {
    const fetcher = ledgerAnswers(receipt());
    await expect(settleFoundationMeteredCompute({ ...sent, pages: null })).resolves
      .toEqual({ ok: false, code: "COMPUTE_PAGE_COUNT_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["zero pages", { pages: 0 }], ["a fraction", { pages: 2.5 }], ["NaN", { pages: Number.NaN }],
    ["more complex than pages", { complexPages: 4 }], ["complex without pages", { outcome: "operator_review", pages: null, complexPages: 0 }],
    ["a digest that is not one", { sourceSha256: "sha256:abc" }], ["a release", { outcome: "released" }],
  ])("refuses %s as invalid", async (_label, change) => {
    const fetcher = ledgerAnswers(receipt());
    await expect(settleFoundationMeteredCompute({ ...sent, ...change } as MeteredSettlement)).resolves
      .toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps the ledger's page-count refusal to its own code", async () => {
    ledgerAnswers({ message: "foundation_compute_page_count_required" }, 400);
    await expect(settleFoundationMeteredCompute(sent)).resolves.toEqual({ ok: false, code: "COMPUTE_PAGE_COUNT_REQUIRED" });
  });

  it.each([
    ["processed", receipt()],
    ["duplicate, for a retried settlement", receipt({ status: "duplicate" })],
    ["free for an unchanged source", receipt({ settledCredits: 0, chargeBasis: "unchanged_source", chargeBasisReservationId: reservationId })],
    ["capped at the approval", receipt({ settledCredits: 4, chargeBasis: "pages_capped" })],
  ])("accepts a receipt that is %s", async (_label, body) => {
    ledgerAnswers(body);
    await expect(settleFoundationMeteredCompute(sent)).resolves.toMatchObject({ ok: true, result: body });
  });

  it("accepts a failed read only at zero", async () => {
    ledgerAnswers(receipt({ state: "operator_review", meteredPages: null, settledCredits: 0, chargeBasis: "no_usable_output" }));
    await expect(settleFoundationMeteredCompute({ ...sent, outcome: "operator_review", pages: null, reasonCode: "PAGE_COUNT_UNKNOWN" }))
      .resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["a charge that is not the pages", receipt({ settledCredits: 8 })],
    ["the per-document constant", receipt({ settledCredits: 2, chargeBasis: null })],
    ["another page count", receipt({ meteredPages: 4 })],
    ["a free source with no match", receipt({ settledCredits: 0, chargeBasis: "unchanged_source" })],
    ["a free source that charged", receipt({ settledCredits: 12, chargeBasis: "unchanged_source", chargeBasisReservationId: reservationId })],
    ["a cap above the pages", receipt({ settledCredits: 16, chargeBasis: "pages_capped" })],
    ["a different outcome", receipt({ state: "operator_review" })],
    ["no reservation", receipt({ reservationId: "nope" })],
  ])("refuses a receipt with %s", async (_label, body) => {
    ledgerAnswers(body);
    await expect(settleFoundationMeteredCompute(sent)).resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" });
  });

  it("refuses a charged failed read", async () => {
    ledgerAnswers(receipt({ state: "operator_review", meteredPages: null, settledCredits: 2, chargeBasis: "no_usable_output" }));
    await expect(settleFoundationMeteredCompute({ ...sent, outcome: "operator_review", pages: null }))
      .resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" });
  });
});
