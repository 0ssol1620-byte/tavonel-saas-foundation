/**
 * One page of the demonstration document, as a reader would have reported it.
 *
 * B5 -- the reading view is the most persuasive thing in this product and it was behind a
 * sign-in. It is the one screen that shows the machine doing the work rather than describing the
 * work, and a visitor who has not signed up has no reason to believe the description. So the
 * landing page shows the view itself -- the same component the workspace renders, unchanged --
 * fed by the fixture below.
 *
 * This is declared fictional data, on exactly the same terms as every other figure on that page.
 * It is not a recording of an OCR run and no file is read to produce it. What is real is the
 * shape: these are the fields a reader actually reports, in the units it reports them, and the
 * view drawing them here is the view that draws a real read.
 *
 * Two details are deliberate. The regions are in reading order, because the numbering shared
 * between the page and the lines is the whole argument the view makes. And one region -- an
 * ink stamp in the margin -- comes back at 0.57, because a reader that never reports uncertainty
 * cannot later be believed when it says a document needs a person.
 */

import type { OcrProgress, ProgressBox } from "@/lib/ocr-progress";
import { CHANGE } from "@/lib/demo-world";

type Region = [ProgressBox["bbox1000"], number, string];

/** Page 7: the section the demonstration's amendment changes. */
const PAGE_7: Region[] = [
  [[80, 58, 300, 86], 0.97, "SERVICES AGREEMENT 2026"],
  [[706, 58, 920, 86], 0.96, `Page 7 of ${CHANGE.documentPages}`],
  [[80, 128, 430, 164], 0.98, "§3.2  Payment terms"],
  [[80, 188, 920, 216], 0.97, "Payment is due within 30 days of receipt of a valid invoice,"],
  [[80, 220, 898, 248], 0.97, "reduced from 45 under the previous schedule."],
  [[80, 280, 920, 308], 0.96, "An invoice is valid when it names the purchase order it draws"],
  [[80, 312, 862, 340], 0.95, "on and itemises the work delivered in the billing period."],
  [[80, 372, 920, 400], 0.94, "Late payment accrues interest at the rate stated in §7.3 from"],
  [[80, 404, 700, 432], 0.93, "the first day after the due date."],
  [[80, 464, 920, 492], 0.96, "Exceptions to this schedule may be approved in writing by"],
  [[80, 496, 884, 524], 0.95, "the account manager, or under §9.6, by the contract owner."],
  [[616, 548, 930, 590], 0.57, "RECEIVED 04 MAR 2026"],
  [[80, 616, 470, 648], 0.96, "§3.3  Invoicing address"],
  [[80, 664, 908, 692], 0.95, "Invoices are delivered to the address in Schedule B unless"],
  [[80, 696, 762, 724], 0.94, "the parties agree otherwise in writing."],
];

/** Regions the reader had already reported from pages 1-6, so the running total is not a guess. */
const REGIONS_BEFORE = 96;

const PAGE_NUMBER = 7;

function box(region: Region, index: number): ProgressBox {
  const [bbox1000, confidence, text] = region;
  return { bbox1000, confidence, text, regionId: `p${PAGE_NUMBER}-r${String(index + 1).padStart(2, "0")}` };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** The total region count, so the demo cannot claim more regions than it draws. */
export const DEMO_REGION_COUNT = PAGE_7.length;

/**
 * The reader's report after `revealed` of this page's regions have come back.
 *
 * Reports arrive as whole regions, so the demo steps a region at a time rather than easing a
 * bar: what is on screen is always something the reader said, never an interpolation between
 * two things it said.
 */
export function demoProgress(revealed: number): OcrProgress {
  const shown = PAGE_7.slice(0, Math.max(0, Math.min(revealed, PAGE_7.length)));
  const boxes = shown.map(box);
  return {
    state: revealed >= PAGE_7.length ? "read" : "reading",
    pagesRead: PAGE_NUMBER,
    pageCount: CHANGE.documentPages,
    regionsFound: REGIONS_BEFORE + boxes.length,
    pages: boxes.length === 0 ? [] : [{
      pageNumber1: PAGE_NUMBER,
      pageCount: CHANGE.documentPages,
      path: "ocr",
      regionCount: PAGE_7.length,
      meanConfidence: mean(boxes.map((b) => b.confidence)),
      boxes,
    }],
  };
}
