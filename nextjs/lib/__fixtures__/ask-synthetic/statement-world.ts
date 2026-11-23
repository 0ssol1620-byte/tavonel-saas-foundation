/*
  A synthetic World shaped like the case observed on build 1 (WO-ASK-0): twelve one-page
  statement-like documents of invented companies, each read as three long evidence regions of
  label/value text in no particular column order, and one question naming one company, one year
  and one line item. Every name and figure here is invented; no corpus text is used.

  The shape that matters: the asked company's line-item region is long (many distinct tokens),
  while another company has a short highlights region that repeats only the generic line item and
  the year. Length normalisation alone then ranks the other company first.
*/

const COMPANIES = [
  "Quillmore Dynamics", "Brakewell Holdings", "Corvanta Foods", "Dunmerrow Textiles",
  "Elsfield Robotics", "Farrowgate Mining", "Glenhart Logistics", "Hollisbrook Media",
  "Ivenridge Pharma", "Jastemere Energy", "Kelbourne Retail", "Lorvane Shipping",
] as const;

export const SYNTHETIC_COLLECTION_ID = "collection-5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";
export const SYNTHETIC_MANIFEST_DIGEST = `sha256:${"5a".repeat(32)}`;
export const SYNTHETIC_QUESTION = "What was Quillmore Dynamics revenue in 2023?";
export const ASKED_COMPANY_SOURCE = "source-quillmore";
/** The asked line, verbatim as it sits in the asked company's statement region. */
export const ASKED_LINE = "Revenue 48,215 44,907 41,330";
/** The other company whose short highlights region the unmodified scorer ranks first. */
export const DISTRACTOR_SOURCE = "source-brakewell";

const LINE_ITEMS = [
  "Cost of goods sold", "Selling, general and administrative", "Research and development",
  "Depreciation and amortization", "Interest expense, net", "Other income (expense)",
  "Income before income taxes", "Provision for income taxes", "Net income attributable",
  "Basic earnings per share", "Diluted earnings per share", "Weighted average shares basic",
  "Weighted average shares diluted", "Restructuring charges", "Impairment of intangible assets",
  "Gain on disposal of equipment", "Foreign exchange translation", "Share-based compensation",
] as const;

function slug(name: string) {
  return name.split(" ")[0]!.toLowerCase();
}

// Deterministic invented figures: no randomness, so the fixture is byte-stable.
function figure(company: number, row: number, column: number) {
  const value = 1_000 + ((company + 3) * 7_919 + (row + 5) * 104_729 + column * 1_299_709) % 89_000;
  return value.toLocaleString("en-US");
}

function statementRegion(index: number, name: string) {
  // Unordered label/value lines: each company lists its rows in a different rotation, the way a
  // table read as text loses its column order.
  const rows = LINE_ITEMS.map((label, row) => `${label} ${figure(index, row, 0)} ${figure(index, row, 1)} ${figure(index, row, 2)}`);
  const rotated = [...rows.slice(index % rows.length), ...rows.slice(0, index % rows.length)];
  const revenue = index === 0 ? ASKED_LINE : `Revenue ${figure(index, 99, 0)} ${figure(index, 99, 1)} ${figure(index, 99, 2)}`;
  rotated.splice(9, 0, revenue);
  return [
    `${name} consolidated statement of operations (in thousands)`,
    ...rotated,
    `Segment detail for ${name.split(" ")[1]} operating units ${figure(index, 50, 0)} ${figure(index, 51, 0)}`,
  ].join("\n");
}

function headerRegion(name: string) {
  return [
    name,
    "Fiscal years ended December 31, 2024, 2023 and 2022",
    "Amounts in thousands of invented currency units, except per share data",
    "Prepared for a synthetic test fixture; no figure here describes a real company.",
    "Columns are presented in descending order of fiscal year and may be read out of order.",
    "Statement captions follow the presentation adopted by the reporting entity for the period.",
    "Certain prior-period amounts were reclassified to conform to the current presentation.",
    "Totals may not foot because of rounding to the nearest thousand units.",
    "The accompanying notes are an integral part of these consolidated statements.",
  ].join("\n");
}

function notesRegion(index: number, name: string) {
  return [
    `Notes to the statements of ${name}`,
    `Note 1. Basis of presentation for ${slug(name)} reporting entities and consolidated subsidiaries.`,
    `Note 2. Inventories are stated at the lower of cost and net realizable value ${figure(index, 60, 0)}.`,
    `Note 3. Leases recognised as right-of-use assets ${figure(index, 61, 0)} and liabilities ${figure(index, 61, 1)}.`,
    `Note 4. Commitments and contingencies disclosed under the applicable framework.`,
    `Note 5. Goodwill tested for impairment annually at the reporting unit level ${figure(index, 62, 0)}.`,
    `Note 6. Long-term debt maturities over the next five fiscal periods ${figure(index, 63, 0)} ${figure(index, 63, 1)}.`,
    `Note 7. Income taxes reconciled to the statutory rate with valuation allowances ${figure(index, 64, 0)}.`,
    `Note 8. Subsequent events evaluated through the date the statements were issued.`,
  ].join("\n");
}

export type SyntheticRegion = {
  chunkId: string;
  sourceId: string;
  company: string;
  text: string;
};

export function syntheticRegions(): SyntheticRegion[] {
  const regions: SyntheticRegion[] = [];
  COMPANIES.forEach((name, index) => {
    const sourceId = `source-${slug(name)}`;
    const push = (part: string, text: string) =>
      regions.push({ chunkId: `chunk-${slug(name)}-${part}`, sourceId, company: name, text });
    push("a-header", headerRegion(name));
    push("b-statement", statementRegion(index, name));
    push("c-notes", notesRegion(index, name));
    if (`source-${slug(name)}` === DISTRACTOR_SOURCE) {
      // A short highlights block: only the generic line item and the year, repeated.
      push("d-highlights", "Revenue 2023 highlights\nRevenue 2023 compared with 2022\nNet sales 2023");
    }
  });
  return regions;
}

/** The regions as the fallback path reads them: `rag/chunks.jsonl` of a promoted artifact. */
export function syntheticArtifact(regions: SyntheticRegion[] = syntheticRegions()) {
  const rows = regions.map((region, index) => ({
    chunkId: region.chunkId,
    logicalId: `logical-${region.chunkId}`,
    text: region.text,
    sourceId: region.sourceId,
    sourceVersionId: `version-${region.sourceId}`,
    evidenceId: `evidence-${region.chunkId}`,
    pageNumber1: 1,
    bbox1000: [40, 60 + (index % 3) * 300, 960, 340 + (index % 3) * 300],
    authority: "regulatory_filing",
    claimIds: [],
    entityIds: [],
    entityNames: [],
    languages: ["en"],
    temporalRefs: [],
  }));
  return {
    collectionId: SYNTHETIC_COLLECTION_ID,
    manifestDigest: SYNTHETIC_MANIFEST_DIGEST,
    package: { files: [{ path: "rag/chunks.jsonl", content: `${rows.map(row => JSON.stringify(row)).join("\n")}\n` }] },
  };
}
