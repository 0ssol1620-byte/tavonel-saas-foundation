/**
 * The measurement band under the Home hero (Release 3, 2026-10-15, brief move 7).
 *
 * Every judge of Release 2 named the same gap: no customer logos. There are no customers to show,
 * so the honest substitute is the thing a logo stands in for -- evidence -- printed as a figure, its
 * denominator and the receipt it came from.
 *
 * WHERE EACH NUMBER COMES FROM
 * `content/evidence/public-claims-pack.json` is a byte-identical copy of the generated claims pack
 * (`docs/evidence/folynta-public-claims-pack.json` in the evidence repository; sha256 pinned below
 * and re-hashed by `home-measures.test.ts`). A measure names an approved claim by id; the claim's
 * `evidence_sha256` must be the digest of a receipt this site already serves from
 * `public/research/receipts/` (`lib/evidence-record.ts`), or this module throws and the page does
 * not build. Headline figures are read from the claim's `numbers`; denominators the claim does not
 * carry are read from the receipt bytes the claim is bound to. No figure is typed here.
 *
 * WHAT EACH FACT MUST SAY
 * Each fact ends on its claim's `must_say_en` / `must_say`, read from the pack and printed verbatim
 * (decision.md A-11: the constraint wording is part of the generated evidence, so writing it here
 * would author the constraint rather than carry it). A claim on the band without both is refused.
 * A number inside a must-say is printed as a figure of that claim, so the entry-page digit walk
 * binds it like any other, and it must be a value the claim carries or the module throws.
 *
 * WHAT IS NOT ON THE BAND, AND WHY
 * - Completion (99.98%) and recovery (99.94% of 1,797): both approved, but their receipt -- the
 *   completion ledger -- is not served by this site. Its bytes name recovery trees and rounds, and
 *   the recovery mechanism is on the disclosure registry's publication freeze with
 *   `review_before_publish: true`. A figure whose receipt a reader cannot fetch does not go on Home.
 * - Raw GPU cost per 1,000 pages: a conditional claim that needs its two conditions beside it and
 *   must never sit near a price; Home links to Pricing.
 * - GDP.pdf 27 vs 31: a different evaluation; it lives on /benchmarks/gdp-pdf.
 */
import pack from "../content/evidence/public-claims-pack.json";
import r01 from "../public/research/receipts/R-01-recovery-counterfactual-olmocr-2026-08-08.json";
import r02 from "../public/research/receipts/R-02-knowledge-compilation-properties-2026-08-08.json";
import { EVIDENCE, type EvidenceReceipt } from "./evidence-record";

/** sha256 of `content/evidence/public-claims-pack.json` as generated (evidence repository, cf53916). */
export const CLAIMS_PACK_SHA256 = "ff6f9f6b17b7845c545c1c76c0c9ef7396bc329c92bc1152c0108aae69d3065e";

/** A figure: a number from a claim or its receipt, and how many decimals it is printed with. */
export type Figure = { readonly n: number; readonly d: number };
export type Part = string | Figure;
export type MeasureCopy = { readonly figure: Part[]; readonly label: Part[]; readonly detail: Part[] };
export type HomeMeasure = {
  /** The claims-pack id the figures are bound to. */
  readonly claim: string;
  readonly receipt: EvidenceReceipt;
  readonly en: MeasureCopy;
  readonly ko: MeasureCopy;
};

type PackClaim = { id: string; status: string; evidence_sha256?: string | string[]; numbers?: unknown; must_say?: string; must_say_en?: string };

const fig = (n: number, d = 0): Figure => ({ n, d });

function numericLeaves(value: unknown, into: number[] = []): number[] {
  if (typeof value === "number") into.push(value);
  else if (value && typeof value === "object") for (const child of Object.values(value)) numericLeaves(child, into);
  return into;
}

/** A must-say as the pack states it, each number in it turned into a figure the claim carries. */
export function carried(id: string, text: string, values: readonly number[]): Part[] {
  return text.split(/(\d[\d,]*(?:\.\d+)?)/).filter(piece => piece !== "").map(piece => {
    if (!/^\d/.test(piece)) return piece;
    const n = Number(piece.replaceAll(",", "")), d = piece.split(".")[1]?.length ?? 0;
    const printed = formatFigure(fig(n, d));
    if (!values.includes(n) || printed !== piece) throw new Error(`Home measure: "${piece}" in the must-say of "${id}" is not a figure of the claim`);
    return fig(n, d);
  });
}

/** The approved claim `id`, provided its evidence is the receipt `receiptId` this site serves. */
function bound<T>(id: string, receiptId: string): { numbers: T; receipt: EvidenceReceipt; mustSay: { en: Part[]; ko: Part[] } } {
  const claim = (pack.claims as PackClaim[]).find(entry => entry.id === id);
  const receipt = EVIDENCE.find(entry => entry.receipt?.id === receiptId)?.receipt;
  if (claim?.status !== "approved") throw new Error(`Home measure: "${id}" is not an approved claim`);
  if (!receipt || claim.evidence_sha256 !== `sha256:${receipt.digest}`) {
    throw new Error(`Home measure: receipt ${receiptId} is not the evidence of claim "${id}"`);
  }
  if (!claim.must_say_en || !claim.must_say) throw new Error(`Home measure: claim "${id}" has no must-say in both languages`);
  const values = numericLeaves(claim.numbers);
  return { numbers: claim.numbers as T, receipt, mustSay: { en: carried(id, claim.must_say_en, values), ko: carried(id, claim.must_say, values) } };
}

/** How every figure on the band is printed: one formatter, so a receipt value cannot be restyled into another number. */
export const formatFigure = ({ n, d }: Figure) => (d > 0 ? n.toFixed(d) : n.toLocaleString("en-US"));

type TypeRow = { label_en: string; accuracy_percent: number; checks_passed: number; checks_total: number };
const structure = bound<{ broken_links_in_output: number; documents_exercised: number }>("compilation-guarantees", "R-02");
const recovery = bound<{ with_recovery: number; without_recovery: number }>("recovery-contribution-olmocr", "R-01");
const byType = bound<TypeRow[]>("accuracy-by-document-type", "R-03");
const row = (label: string) => {
  const found = byType.numbers.find(entry => entry.label_en === label);
  if (!found) throw new Error(`Home measure: claims pack has no "${label}" row`);
  return found;
};
const weakest = row("Low-quality scans");
const standard = row("Standard digital documents");
const vault = r02.vault_compilation;

export const HOME_MEASURES: readonly HomeMeasure[] = [
  {
    claim: "compilation-guarantees",
    receipt: structure.receipt,
    en: {
      figure: [fig(structure.numbers.broken_links_in_output)],
      label: ["broken links in compiled output"],
      detail: [
        "Of ", fig(structure.numbers.documents_exercised), " documents offered, ", fig(vault.documents_compiled),
        " compiled and ", fig(vault.documents_refused_for_broken_links),
        " were refused for a link that could not be resolved. ", ...structure.mustSay.en,
      ],
    },
    ko: {
      figure: [fig(structure.numbers.broken_links_in_output)],
      label: ["컴파일 결과에 남은 깨진 링크"],
      detail: [
        "제공된 문서 ", fig(structure.numbers.documents_exercised), "건 중 ", fig(vault.documents_compiled),
        "건을 컴파일했고, 확인할 수 없는 링크가 있는 ", fig(vault.documents_refused_for_broken_links),
        "건은 내보내지 않고 거부했습니다. ", ...structure.mustSay.ko,
      ],
    },
  },
  {
    claim: "recovery-contribution-olmocr",
    receipt: recovery.receipt,
    en: {
      figure: [fig(recovery.numbers.with_recovery, 1)],
      label: ["olmOCR-Bench score with recovery; ", fig(recovery.numbers.without_recovery, 1), " with only recovery switched off"],
      detail: [
        fig(r01.held_constant.input_count), " documents, ", fig(r01.held_constant.test_count), " checks. ", ...recovery.mustSay.en,
      ],
    },
    ko: {
      figure: [fig(recovery.numbers.with_recovery, 1)],
      label: ["복구를 켠 olmOCR-Bench 점수. 복구만 끄면 ", fig(recovery.numbers.without_recovery, 1)],
      detail: [
        "문서 ", fig(r01.held_constant.input_count), "건, 검사 ", fig(r01.held_constant.test_count), "개. ", ...recovery.mustSay.ko,
      ],
    },
  },
  {
    claim: "accuracy-by-document-type",
    receipt: byType.receipt,
    en: {
      figure: [fig(weakest.accuracy_percent, 1), "%"],
      label: ["of checks passed on low-quality scans"],
      detail: [
        fig(weakest.checks_passed), " of ", fig(weakest.checks_total), " checks on low-quality scans; ",
        fig(standard.checks_passed), " of ", fig(standard.checks_total), " on standard digital documents. ", ...byType.mustSay.en,
      ],
    },
    ko: {
      figure: [fig(weakest.accuracy_percent, 1), "%"],
      label: ["저품질 스캔본에서 통과한 검사 비율"],
      detail: [
        "저품질 스캔본 검사 ", fig(weakest.checks_total), "개 중 ", fig(weakest.checks_passed), "개, 표준 디지털 문서 ",
        fig(standard.checks_total), "개 중 ", fig(standard.checks_passed), "개. ", ...byType.mustSay.ko,
      ],
    },
  },
];
