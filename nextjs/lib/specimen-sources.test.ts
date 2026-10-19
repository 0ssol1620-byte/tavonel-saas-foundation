import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpecimenStrip from "../components/landing-v2/specimen-strip";
import {
  COMMITTED_SPECIMENS,
  MAX_CROP_BYTES,
  cropDigestProblem,
  homeSpecimens,
  isFixtureServer,
  readSpecimens,
  specimenProblem,
  type Specimen,
  type SpecimenReceipt,
} from "./specimen-sources";

/*
  P2-08 (UX-PLAN-2026-10-17 §3.4, §3.7; PHASE1-CRITIC-2026-10-17 §3.2, §5.4): the specimen contract
  refuses what it cannot vouch for, and Home renders no cell without a committed reader receipt.
*/

const FIXTURE_DIR = new URL("../e2e/fixtures/specimens/", import.meta.url);
const fixtureFiles = readdirSync(FIXTURE_DIR).filter(name => name.endsWith(".json")).sort();
const fixtures = (): SpecimenReceipt[] =>
  fixtureFiles.map(name => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), "utf8")) as SpecimenReceipt);
const cropBytes = (path: string) => readFileSync(new URL(path, FIXTURE_DIR));
const FIXTURE_ENV = { PLAYWRIGHT_LOCAL_HTTP: "1" };

/** A fixture with one change, for the failure paths. */
function changed(edit: (receipt: SpecimenReceipt & Record<string, unknown>) => void): SpecimenReceipt {
  const receipt = structuredClone(fixtures()[0]!) as SpecimenReceipt & Record<string, unknown>;
  edit(receipt);
  return receipt;
}

afterEach(() => vi.restoreAllMocks());

describe("the committed specimens", () => {
  it("are none today, so a production build renders no specimen cell and no strip", () => {
    // P2-32 commits the reader-run receipts; until then this list is empty and stays empty.
    expect(COMMITTED_SPECIMENS).toEqual([]);
    expect(homeSpecimens()).toEqual([]);
    expect(homeSpecimens({ fixtures: true }, {})).toEqual([]);
    expect(renderToStaticMarkup(createElement(SpecimenStrip, { specimens: homeSpecimens() }))).toBe("");
  });

  it("each parse as production receipts and name the exact crop bytes under public/", () => {
    const { specimens, rejected } = readSpecimens(COMMITTED_SPECIMENS, "production");
    expect(rejected).toEqual([]);
    for (const specimen of specimens) {
      const bytes = readFileSync(join(process.cwd(), "public", specimen.crop.path));
      expect(cropDigestProblem(specimen, bytes), specimen.specimenId).toBeNull();
    }
  });
});

describe("the fixture gate", () => {
  it("opens only on the local Playwright server, never on a deployment", () => {
    expect(isFixtureServer(FIXTURE_ENV)).toBe(true);
    expect(isFixtureServer({})).toBe(false);
    expect(isFixtureServer({ PLAYWRIGHT_LOCAL_HTTP: "0" })).toBe(false);
    expect(isFixtureServer({ PLAYWRIGHT_LOCAL_HTTP: "1", VERCEL: "1" })).toBe(false);
  });

  it("renders the three fixtures only when the request asks and the server is the test server", () => {
    expect(homeSpecimens({ fixtures: false }, FIXTURE_ENV)).toEqual([]);
    expect(homeSpecimens({ fixtures: true }, { PLAYWRIGHT_LOCAL_HTTP: "1", VERCEL: "1" })).toEqual([]);
    const cells = homeSpecimens({ fixtures: true }, FIXTURE_ENV);
    expect(cells.map(cell => cell.slot)).toEqual(["degraded_scan", "table", "korean"]);
    expect(cells.every(cell => cell.synthetic && cell.cropSrc.startsWith("data:image/svg+xml;base64,"))).toBe(true);
  });

  it("never lets a fixture through as a production receipt", () => {
    const { specimens, rejected } = readSpecimens(fixtures(), "production");
    expect(specimens).toEqual([]);
    expect(rejected.map(entry => entry.reason)).toEqual(
      fixtures().map(() => "representationKind is not page_extract (production)"),
    );
  });
});

describe("a receipt that does not hold is not rendered", () => {
  const cases: [string, (receipt: SpecimenReceipt & Record<string, unknown>) => void, string][] = [
    ["no extract digest", r => { delete (r as Partial<SpecimenReceipt>).extractedPdfSha256; }, "extractedPdfSha256 is not a sha256 digest"],
    ["no original digest", r => { r.originalSha256 = "sha256:abc"; }, "originalSha256 is not a sha256 digest"],
    ["empty reader text", r => { r.extractedText = "  \n"; }, "extractedText is empty"],
    ["CRLF in the reader text", r => { r.extractedText = "line one\r\nline two"; }, "extractedText holds a carriage return"],
    ["an unknown slot", r => { r.slot = "chart" as never; }, "slot is not one of degraded_scan, table, korean"],
    ["a Korean cell whose text is not Korean", r => { r.slot = "korean"; r.lang = "en"; }, "the korean slot's text is not lang ko"],
    ["a table cell without the manifest's table limit", r => { r.slot = "table"; r.limitationTokens = []; }, "the table slot does not carry no_table_or_formula_extraction"],
    ["a limitation the PDF entry does not carry", r => { r.limitationTokens = ["accurate_tables"]; }, "a limitation token is not one the PDF manifest entry carries"],
    ["a region outside the crop window", r => { r.region.bbox1000 = [50, 280, 820, 440]; }, "the reader region is not inside the crop window"],
    ["a region that is not a box", r => { r.region.bbox1000 = [820, 280, 180, 440]; }, "region is not a reader region"],
    ["a crop over the per-cell budget", r => { r.crop.bytes = MAX_CROP_BYTES + 1; }, `crop is over ${MAX_CROP_BYTES} bytes`],
    ["a crop path outside the fixture set", r => { r.crop.path = "../../../package.json"; }, "crop.path is not a fixture crop path"],
    ["a board-level licence marking", r => { r.rights.licence.markingScope = "board" as never; }, "rights.licence.markingScope is not item, site or site+statute"],
    ["no attribution", r => { r.rights.attribution = ""; }, "rights.attribution is empty"],
    ["a publication other than public_sample", r => { r.rights.publication = "cleared" as never; }, "rights.publication is not public_sample"],
    ["no licence snapshot", r => { r.rights.licence.snapshotSha256 = ""; }, "rights.licence.snapshotSha256 is not a sha256 digest"],
    ["another reader", r => { r.reader.id = "other_reader" as never; }, "reader is not the pinned OCR image"],
    ["a page past the original", r => { r.page = 2; }, "page is not a page of the original"],
    ["a run time that is not an instant", r => { r.runAt = "2026-10-19"; }, "runAt is not a UTC instant"],
    ["nothing it must not imply", r => { r.mustNotImply = []; }, "mustNotImply is empty"],
    ["a receipt link that is neither https nor a site path", r => { r.runReceiptUrl = "javascript:alert(1)"; }, "runReceiptUrl is neither https nor a site path"],
    // B-04: a protocol-relative URL, and one the browser normalises to it, point at another host.
    ["a protocol-relative receipt link", r => { r.runReceiptUrl = "//attacker.example/receipt.json"; }, "runReceiptUrl is neither https nor a site path"],
    ["a backslash receipt link the browser reads as another host", r => { r.runReceiptUrl = "/\\attacker.example/receipt.json"; }, "runReceiptUrl is neither https nor a site path"],
    // B-06 M2/M2b: a date of the right shape that is not a day of the calendar is not a date.
    ["M2: a run day that does not exist", r => { r.runAt = "2026-02-31T00:00:00Z"; }, "runAt is not a UTC instant"],
    ["M2b: a capture month that does not exist", r => { r.capturedOn = "2026-13-45"; }, "capturedOn is not a date"],
    ["M2b: a licence retrieval day zero", r => { r.rights.licence.retrievedOn = "2026-00-00"; }, "rights.licence.retrievedOn is not a date"],
  ];

  it.each(cases)("%s", (_, edit, reason) => {
    expect(specimenProblem(changed(edit), "fixture")).toBe(reason);
    const { specimens, rejected } = readSpecimens([changed(edit), ...fixtures().slice(1)], "fixture", cropBytes);
    expect(rejected).toEqual([{ id: "fixture-korean-p001", reason }]);
    expect(specimens).toHaveLength(2);
  });

  it("refuses a crop whose bytes are not the receipt's", () => {
    const tampered = (path: string) => Buffer.concat([cropBytes(path), Buffer.from(" ")]);
    const { specimens, rejected } = readSpecimens(fixtures(), "fixture", tampered);
    expect(specimens).toEqual([]);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]!.reason).toMatch(/^crop is \d+ bytes, the receipt says \d+$/);
    const sameLength = (path: string) => { const bytes = Buffer.from(cropBytes(path)); bytes[10] ^= 1; return bytes; };
    expect(readSpecimens(fixtures(), "fixture", sameLength).rejected[0]!.reason).toMatch(/^crop digest sha256:[0-9a-f]{64} is not the receipt's/);
  });

  it("keeps one cell a slot", () => {
    const [first] = fixtures();
    const { specimens, rejected } = readSpecimens([first, { ...first!, specimenId: "second" }], "fixture", cropBytes);
    expect(specimens).toHaveLength(1);
    expect(rejected).toEqual([{ id: "second", reason: "a second receipt for slot korean" }]);
  });

  it("says why on the server log instead of dropping a cell in silence", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // A test server pointed at a folder with no fixtures renders nothing and says so.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(join(process.cwd(), "no-such-root"));
    expect(homeSpecimens({ fixtures: true }, FIXTURE_ENV)).toEqual([]);
    cwd.mockRestore();
    expect(log.mock.calls[0]![0]).toBe("[TAVONEL] specimen fixtures could not be read; none render");
  });
});

describe("the specimen strip", () => {
  const cells = (): Specimen[] => readSpecimens(fixtures(), "fixture", cropBytes).specimens;
  const html = (korean = false) => renderToStaticMarkup(createElement(SpecimenStrip, { specimens: cells(), korean }));

  it("prints each reader text as one text node, exactly as the receipt holds it", () => {
    const markup = html();
    for (const cell of cells()) {
      const escaped = cell.extractedText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;");
      expect(markup).toContain(`lang="${cell.lang}" data-specimen-text="" data-derived="1">${escaped}</p>`);
    }
  });

  it("labels the reader output as unedited and the crop as the source as printed, in both languages", () => {
    expect(html()).toContain("Reader output, unedited");
    expect(html()).toContain("As printed · Source: ");
    expect(html(true)).toContain("원문 그대로 · 출처: ");
    expect(html(true)).toContain("판독기 출력, 수정 없음");
  });

  it("carries the crop window, the region's coordinates and the run line, and draws the region inside the window", () => {
    const markup = html();
    expect(markup).toContain('data-crop-window="100,200,900,520"');
    // [180,280,820,440] inside [100,200,900,520]: 10% / 25% / 80% / 50% of the window.
    expect(markup).toContain('style="left:10.000%;top:25.000%;width:80.000%;height:50.000%"');
    expect(markup).toContain("<code>p.1 · [180,280 → 820,440]</code> <span>page 1 · region A</span>");
    expect(markup).toMatch(/2026-10-19 · receipt 0{8}<\/a>/);
  });

  it("puts the manifest's own label on the table cell, and no table structure anywhere", () => {
    const markup = html();
    const table = markup.slice(markup.indexOf('data-slot="table"'), markup.indexOf('data-slot="korean"'));
    expect(table).toContain(">No table or formula extraction</p>");
    expect(markup).not.toMatch(/<table|role="grid"|role="cell"|accuracy|정확도/i);
  });

  it("ships no script and opens no scene of its own", () => {
    const markup = html();
    expect(markup).not.toContain("<script");
    // Scenes are sliced <section> to <section> (lib/landing-v2-page.test.ts); the strip is not one.
    expect(markup).not.toContain("<section");
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
  });

  it("marks a synthetic fixture as one", () => {
    expect(html().match(/ · synthetic fixture/g)).toHaveLength(3);
    expect(html(true).match(/ · 합성 픽스처/g)).toHaveLength(3);
  });
});
