import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import HomeReaderGuide from "../components/landing-v2/home-reader-guide";
import SpecimenStrip from "../components/landing-v2/specimen-strip";
import {
  COMMITTED_SPECIMENS,
  MAX_CROP_BYTES,
  QUALIFIED_OCR_IMAGE_DIGESTS,
  SPECIMEN_STRIP_ROLLOUT,
  cropDigestProblem,
  homeSpecimens,
  isFixtureServer,
  readSpecimens,
  specimenProblem,
  specimenStripLive,
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

const PRODUCTION_ENV = { VERCEL: "1", VERCEL_ENV: "production" };
const PREVIEW_ENV = { VERCEL: "1", VERCEL_ENV: "preview" };
const committed = () => structuredClone(COMMITTED_SPECIMENS) as (SpecimenReceipt & Record<string, unknown>)[];
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const publicFile = (path: string) => readFileSync(join(process.cwd(), "public", path));

describe("the committed specimens", () => {
  it("are two (D-04: a degraded scan and a Korean page, no table cell), and production renders neither", () => {
    expect(COMMITTED_SPECIMENS.map(receipt => (receipt as SpecimenReceipt).specimenId)).toEqual(["naca-rm-l50c03-p001", "kma-2026-09-climate-p001"]);
    // The posture: Vercel production, a server with no VERCEL_ENV, and any request that is not the test server's.
    expect(SPECIMEN_STRIP_ROLLOUT).toBe("preview");
    for (const env of [PRODUCTION_ENV, {}, { VERCEL: "1" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }]) {
      expect(homeSpecimens({}, env), JSON.stringify(env)).toEqual([]);
      expect(homeSpecimens({ committed: true }, env), JSON.stringify(env)).toEqual([]);
      expect(homeSpecimens({ fixtures: true }, env), JSON.stringify(env)).toEqual([]);
    }
    expect(homeSpecimens({ committed: true }, { ...FIXTURE_ENV, VERCEL: "1", VERCEL_ENV: "production" })).toEqual([]);
    expect(renderToStaticMarkup(createElement(SpecimenStrip, { specimens: homeSpecimens({}, PRODUCTION_ENV) }))).toBe("");
    expect(renderToStaticMarkup(createElement(HomeReaderGuide, { faqOnly: true }))).not.toContain("data-specimen-faq");
  });

  it("render on a preview deployment, and on the test server only for a request that asks", () => {
    const ids = (cells: Specimen[]) => cells.map(cell => cell.specimenId);
    expect(ids(homeSpecimens({}, PREVIEW_ENV, "preview"))).toEqual(["naca-rm-l50c03-p001", "kma-2026-09-climate-p001"]);
    expect(ids(homeSpecimens({ committed: true }, FIXTURE_ENV, "preview"))).toEqual(["naca-rm-l50c03-p001", "kma-2026-09-climate-p001"]);
    expect(homeSpecimens({}, FIXTURE_ENV, "preview")).toEqual([]);
    expect(homeSpecimens({ committed: true }, PREVIEW_ENV, "preview").every(cell => !cell.synthetic)).toBe(true);
    // The test server's cookie gate holds with the switch off, and "on" renders the committed cells to every request.
    expect(homeSpecimens({}, FIXTURE_ENV, "off")).toEqual([]);
    expect(ids(homeSpecimens({ committed: true }, FIXTURE_ENV, "off"))).toEqual(["naca-rm-l50c03-p001", "kma-2026-09-climate-p001"]);
    for (const env of [PRODUCTION_ENV, {}, PREVIEW_ENV]) expect(homeSpecimens({}, env, "off"), JSON.stringify(env)).toEqual([]);
    for (const env of [PRODUCTION_ENV, {}, PREVIEW_ENV, FIXTURE_ENV]) expect(ids(homeSpecimens({}, env, "on")), JSON.stringify(env)).toEqual(["naca-rm-l50c03-p001", "kma-2026-09-climate-p001"]);
  });

  it("follow the switch: off renders nowhere, on everywhere, preview on Vercel preview only", () => {
    for (const env of [PREVIEW_ENV, PRODUCTION_ENV, {}]) {
      expect(specimenStripLive(env, "off")).toBe(false);
      expect(specimenStripLive(env, "on")).toBe(true);
    }
    // { VERCEL_ENV: "preview" } alone is the unit-test runner (vitest.config.ts), not a deployment.
    expect([PREVIEW_ENV, PRODUCTION_ENV, {}, { VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL: "1", VERCEL_ENV: "development" }].map(env => specimenStripLive(env, "preview")))
      .toEqual([true, false, false, false, false, false]);
  });

  it("hold their contract rows: source, licence, reader, region, crop and the approved source lines (D-05, D-06)", () => {
    const [scan, korean] = committed();
    const row = (r: SpecimenReceipt) => ({
      slot: r.slot, lang: r.lang, page: r.page, pageCount: r.pageCount, sourcePageUrl: r.sourcePageUrl,
      licence: [r.rights.licence.id, r.rights.licence.markingScope, r.rights.licence.markingText, r.rights.licence.snapshotSha256],
      jurisdiction: r.rights.jurisdiction, caption: r.caption, reader: r.reader.imageDigest,
      region: [r.region.regionId, ...r.region.bbox1000], text: r.extractedText, crop: [r.crop.path, r.crop.width, r.crop.height, ...r.crop.window1000],
      limits: r.limitationTokens, receipt: r.runReceiptUrl,
    });
    expect(row(scan!)).toEqual({
      slot: "degraded_scan", lang: "en", page: 1, pageCount: 92, sourcePageUrl: "https://ntrs.nasa.gov/citations/19930086148",
      licence: ["US-GOV-WORK", "item", "Work of the US Gov. Public Use Permitted.", "sha256:9107cd70f084d9f836bfb98221dc6d47e8c969bfb44aa6de08c34a51c38c0eb5"],
      jurisdiction: "Public domain in the United States; status abroad not separately assessed",
      caption: {
        en: { short: "NACA RM L50C03 (1950)", full: "Source: NACA RM L50C03 (1950), NASA Technical Reports Server. U.S. government work." },
        ko: { short: "NACA RM L50C03(1950)", full: "출처: NACA RM L50C03(1950), NASA 기술보고서 서버(NTRS). 미국 연방정부 저작물." },
      },
      reader: QUALIFIED_OCR_IMAGE_DIGESTS[0],
      region: ["ocr-p0001-l00015", 77, 600, 469, 623], text: "CLASSIFICATIONCANCELLED",
      crop: ["/proof-collection/specimens/naca-rm-l50c03-p001-960.webp", 960, 384, 19, 551, 600, 730],
      limits: [], receipt: "/proof-collection/specimens/naca-rm-l50c03-p001.run.json",
    });
    expect(row(korean!)).toEqual({
      slot: "korean", lang: "ko", page: 1, pageCount: 32, sourcePageUrl: "https://www.kma.go.kr/kma/news/press.jsp?bid=press&mode=view&num=1194749",
      licence: ["KOGL-1", "item", "공공누리 1유형(출처명시) 공공저작물 자유이용허락", "sha256:7b2b75fcf4953f94cf236a18dacca3347669491f4f38b3ce76d48a6156d03fe7"],
      jurisdiction: "Republic of Korea public work released under KOGL Type 1; status abroad not separately assessed",
      caption: {
        en: { short: "KMA press release (2026)", full: "Source: Korea Meteorological Administration, \"September 2026 climate characteristics\" press release (2026), KOGL Type 1." },
        ko: { short: "기상청 보도자료(2026)", full: "본 저작물은 '기상청'에서 '2026년' 작성하여 공공누리 제1유형으로 개방한 '[2026년 9월 기후특성] 보도자료(작성자: 기상청 기후변화감시과)'를 이용하였으며, 해당 저작물은 '기상청, www.kma.go.kr'에서 무료로 다운받으실 수 있습니다." },
      },
      reader: QUALIFIED_OCR_IMAGE_DIGESTS[0],
      region: ["ocr-p0001-l00004", 370, 187, 640, 212], text: "[2026년9월 기후특성]",
      crop: ["/proof-collection/specimens/kma-2026-09-climate-p001-960.webp", 960, 384, 90, 152, 906, 383],
      limits: [], receipt: "/proof-collection/specimens/kma-2026-09-climate-p001.run.json",
    });
    // The fixture's 2.5:1 crop, which the phone layout's sheet margin was measured against (SYNTHESIS §7).
    for (const r of [scan!, korean!]) expect(r.crop.width / r.crop.height).toBe(2.5);
  });

  it("are bound to the served run receipt, the served extract and the reader's own region, chosen by the rule fixed before the run", () => {
    for (const receipt of committed()) {
      const bytes = publicFile(receipt.runReceiptUrl);
      expect(digest(bytes), receipt.specimenId).toBe(receipt.runReceiptSha256);
      // One line: git's line-ending conversion has nothing to rewrite, so the digest holds on every checkout.
      expect(bytes.includes(0x0a), receipt.specimenId).toBe(false);
      const run = JSON.parse(bytes.toString("utf8")) as {
        specimenId: string; source: { sha256: string; pages: number }; extract: { path: string; sha256: string };
        reader: { imageDigest: string }; run: { runAt: string; httpStatus: number; resultStatus: string };
        regions: { regionId: string; bbox1000: number[]; text: string }[];
        selection: { regionId: string; draftWindow1000: number[] }; crop: { sha256: string; window1000: number[] }; notClaimed: string[];
      };
      expect([run.specimenId, run.source.sha256, run.source.pages, run.extract.sha256, run.reader.imageDigest, run.run.runAt, run.run.httpStatus, run.run.resultStatus, run.crop.sha256, run.crop.window1000])
        .toEqual([receipt.specimenId, receipt.originalSha256, receipt.pageCount, receipt.extractedPdfSha256, receipt.reader.imageDigest, receipt.runAt, 200, "ok", receipt.crop.sha256, receipt.crop.window1000]);
      expect(digest(publicFile(run.extract.path)), receipt.specimenId).toBe(receipt.extractedPdfSha256);
      // The rule: the first region, in the reader's order, that meets the draft recorded on 2026-10-17.
      const [d0, d1, d2, d3] = run.selection.draftWindow1000 as [number, number, number, number];
      const first = run.regions.find(({ bbox1000: [a, b, c, e] }) => a! < d2 && d0 < c! && b! < d3 && d1 < e!)!;
      expect([first.regionId, first.bbox1000, first.text]).toEqual([receipt.region.regionId, receipt.region.bbox1000, receipt.extractedText]);
      expect(run.selection.regionId).toBe(receipt.region.regionId);
      expect(run.notClaimed).toContain("any accuracy figure");
      // A public DTO: no reader confidence, no worker-internal fields.
      expect(Object.keys(run.regions[0]!).sort()).toEqual(["bbox1000", "pageNumber1", "regionId", "text"]);
    }
  });

  it("each parse as production receipts and name the exact crop bytes under public/", () => {
    const { specimens, rejected } = readSpecimens(COMMITTED_SPECIMENS, "production");
    expect(rejected).toEqual([]);
    for (const specimen of specimens) {
      const bytes = readFileSync(join(process.cwd(), "public", specimen.crop.path));
      expect(cropDigestProblem(specimen, bytes), specimen.specimenId).toBeNull();
      // P2-32 LCP: the AVIF encodings <picture> offers first, each the file its receipt names.
      expect(specimen.crop.sources!.map(source => [source.width, source.height])).toEqual([[720, 288], [960, 384]]);
      for (const source of specimen.crop.sources!) {
        const file = readFileSync(join(process.cwd(), "public", source.path));
        expect([file.length, digest(file)], source.path).toEqual([source.bytes, source.sha256]);
      }
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
    expect(homeSpecimens({ fixtures: false }, FIXTURE_ENV, "preview")).toEqual([]);
    expect(homeSpecimens({ fixtures: true }, { PLAYWRIGHT_LOCAL_HTTP: "1", VERCEL: "1" }, "preview")).toEqual([]);
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

describe("a production receipt that does not hold is not rendered", () => {
  const cases: [string, (receipt: SpecimenReceipt & Record<string, unknown>) => void, string][] = [
    ["a reader image outside the qualified list", r => { r.reader.imageDigest = `sha256:${"1".repeat(64)}`; }, "reader.imageDigest is not a qualified OCR image"],
    ["a licence the strip may not show", r => { r.rights.licence.id = "KOGL-2"; }, "rights.licence.id is not a licence the strip may show"],
    ["nothing listed to keep out of the crop", r => { r.avoidInCrop = []; }, "avoidInCrop is empty"],
    ["a crop window that meets an avoided box", r => { r.avoidInCrop = [{ label: "NACA library stamp", bbox1000: [590, 665, 890, 730] }]; }, "the crop window meets NACA library stamp"],
    ["an avoided box that is not a box", r => { r.avoidInCrop = [{ label: "emblem", bbox1000: [750, 120, 270, 235] }]; }, "avoidInCrop is not a list of labelled boxes"],
    ["no Korean source line", r => { delete (r.caption as Partial<SpecimenReceipt["caption"]>).ko; }, "caption.ko is not a short and a full source line"],
    ["an empty full source line", r => { r.caption.en.full = " "; }, "caption.en is not a short and a full source line"],
    ["a board-level licence marking", r => { r.rights.licence.markingScope = "board" as never; }, "rights.licence.markingScope is not item, site or site+statute"],
    ["a run receipt link off the site", r => { r.runReceiptUrl = "//attacker.example/receipt.json"; }, "runReceiptUrl is neither https nor a site path"],
    ["a crop source at another aspect ratio", r => { r.crop.sources![0]!.height = 300; }, "a crop source is not the crop's aspect ratio"],
    ["a crop source that is not AVIF", r => { r.crop.sources![0]!.path = "/proof-collection/specimens/naca-rm-l50c03-p001-720.webp"; }, "a crop source is not a production AVIF path"],
    ["a crop source off the specimen folder", r => { r.crop.sources![0]!.path = "/landing/v2/naca-720.avif"; }, "a crop source is not a production AVIF path"],
    ["two crop sources of one width", r => { r.crop.sources![1]!.width = 720; r.crop.sources![1]!.height = 288; }, "two crop sources share a width"],
    ["a crop source over the per-cell budget", r => { r.crop.sources![1]!.bytes = MAX_CROP_BYTES + 1; }, `a crop source is over ${MAX_CROP_BYTES} bytes`],
  ];

  it("accepts both committed receipts as they are", () => {
    expect(readSpecimens(committed(), "production")).toMatchObject({ rejected: [] });
    expect(readSpecimens(committed(), "production").specimens).toHaveLength(2);
  });

  it.each(cases)("%s", (_, edit, reason) => {
    const [scan, korean] = committed();
    edit(scan!);
    expect(specimenProblem(scan, "production")).toBe(reason);
    const { specimens, rejected } = readSpecimens([scan, korean], "production");
    expect(rejected).toEqual([{ id: "naca-rm-l50c03-p001", reason }]);
    expect(specimens.map(cell => cell.specimenId)).toEqual(["kma-2026-09-climate-p001"]);
  });

  it("refuses a committed crop or run receipt whose bytes moved", () => {
    const [scan] = committed();
    const crop = Buffer.from(publicFile(scan!.crop.path));
    crop[100] ^= 1;
    expect(cropDigestProblem(scan!, crop)).toMatch(/^crop digest sha256:[0-9a-f]{64} is not the receipt's/);
    const receipt = Buffer.concat([publicFile(scan!.runReceiptUrl), Buffer.from("\n")]);
    expect(digest(receipt)).not.toBe(scan!.runReceiptSha256);
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
    ["a fixture crop with encodings", r => { r.crop.sources = [{ path: "/proof-collection/specimens/fixture-720.avif", type: "image/avif", sha256: `sha256:${"0".repeat(64)}`, width: 720, height: 288, bytes: 1 }]; }, "a fixture crop carries no sources"],
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

  it("prints the committed cells' short source line, the approved full line under the toggle, and fetches the first crop first", () => {
    const real = homeSpecimens({}, PREVIEW_ENV);
    const en = renderToStaticMarkup(createElement(SpecimenStrip, { specimens: real }));
    const ko = renderToStaticMarkup(createElement(SpecimenStrip, { specimens: real, korean: true }));
    expect(en).toContain('data-specimen-source="" data-derived="1">NACA RM L50C03 (1950)</a>');
    expect(en).toContain('data-specimen-source="" data-derived="1">KMA press release (2026)</a>');
    expect(ko).toContain('data-specimen-source="" data-derived="1">기상청 보도자료(2026)</a>');
    // Home contract rule 4: no digit in an alt.
    for (const alt of [...en.matchAll(/alt="([^"]*)"/g), ...ko.matchAll(/alt="([^"]*)"/g)].map(match => match[1])) expect(alt).not.toMatch(/\d/);
    expect(en).toContain("Source: Korea Meteorological Administration, &quot;September 2026 climate characteristics&quot; press release (2026), KOGL Type 1.</p>");
    expect(ko).toContain("본 저작물은 &#x27;기상청&#x27;에서 &#x27;2026년&#x27; 작성하여 공공누리 제1유형으로 개방한");
    // Only the first crop is high priority, and the rest load lazily. Inside <picture> React hoists no preload;
    // the browser's preload scanner finds the <source> (Lighthouse: requested with the document's first bytes).
    const tags = en.match(/<(?:link|img|source)\b[^>]*>/g)!;
    expect(tags.filter(tag => /fetchpriority="high"/i.test(tag)).map(tag => tag.slice(1, 5) + (tag.includes("naca-rm-l50c03-p001-960") ? " naca" : " other")))
      .toEqual(["img  naca"]);
    expect(en).toContain('<picture><source type="image/avif" sizes="(min-width: 1024px) 50vw, calc(100vw - 32px)" srcSet="/proof-collection/specimens/naca-rm-l50c03-p001-720.avif 720w, /proof-collection/specimens/naca-rm-l50c03-p001-960.avif 960w"/><img src="/proof-collection/specimens/naca-rm-l50c03-p001-960.webp" width="960" height="384"');
    expect(tags.filter(tag => /<link\b[^>]*preload/.test(tag))).toEqual([]);
    expect(tags.filter(tag => tag.startsWith("<img") && tag.includes("kma-2026-09-climate-p001-960"))).toEqual([expect.stringMatching(/^<img [^>]*loading="lazy"/)]);
    expect(tags.filter(tag => tag.startsWith("<source") && tag.includes("kma-2026-09-climate-p001-720.avif 720w"))).toHaveLength(1);
    expect(en).toContain('href="/proof-collection/specimens/naca-rm-l50c03-p001.run.json"');
    expect(en).not.toMatch(/synthetic fixture|accuracy|정확도/i);
    const faq = renderToStaticMarkup(createElement(HomeReaderGuide, { faqOnly: true, korean: true, specimenSources: real.map(cell => cell.caption.ko.full) }));
    expect(faq).toContain("data-specimen-faq");
    expect(faq).toContain('<p data-derived="1">출처: NACA RM L50C03(1950), NASA 기술보고서 서버(NTRS). 미국 연방정부 저작물.</p>');
  });

  it("marks a synthetic fixture as one", () => {
    expect(html().match(/ · synthetic fixture/g)).toHaveLength(3);
    expect(html(true).match(/ · 합성 픽스처/g)).toHaveLength(3);
  });
});
