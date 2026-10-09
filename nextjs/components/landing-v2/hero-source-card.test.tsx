import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HeroSourceCard from "./hero-source-card";
import {
  buildHomeEvidenceCase,
  HOME_RESERVED_CASE,
  type EvidenceCase,
} from "@/lib/home-evidence-view";
import { buildHeroView, buildProofTabs } from "@/lib/landing-v2-runtime";

/** A value as react-dom/server writes it into text or an attribute. */
const escaped = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
/** What a reader sees: tags gone, React's entities turned back into their characters. */
const readable = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (open: string, name: string) => open.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1];

function homeCase(): EvidenceCase {
  const value = buildHomeEvidenceCase(buildHeroView(), buildProofTabs());
  expect(value, "a case bound to the committed hero page").not.toBeNull();
  return value!;
}
const render = (view: EvidenceCase, korean = false) => renderToStaticMarkup(<HeroSourceCard view={view} korean={korean} />);
const buttonsOf = (html: string) => [...html.matchAll(/<button(\s[^>]*)>([\s\S]*?)<\/button>/g)];

describe("the Home workbench -- status truthfulness", () => {
  it.each([false, true])("says the composition is prepared and the passage is existing extracted text (korean: %s)", korean => {
    const html = render(homeCase(), korean);
    const text = readable(html);
    const status = html.match(/<p\s[^>]*data-run="not_run"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    expect(status, "the run status line").toBeDefined();
    expect(readable(status!).trim()).toBe(korean ? "준비된 시연 / 아직 처리를 실행하지 않음" : "Prepared demonstration / processing not yet run");
    expect(text).not.toContain(korean ? "준비된 시연 ·" : "Prepared demonstration ·");
    expect(text).toContain(korean ? "기존 추출 구절" : "Existing extracted passage");
    expect(html).toContain('data-case-status="extracted"');
  });

  it.each([false, true])("drops only the not-run half of the status once a run qualifies (korean: %s)", korean => {
    const html = render({ ...homeCase(), run: "qualified" }, korean);
    const status = html.match(/<p\s[^>]*data-run="qualified"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    expect(readable(status ?? "").trim()).toBe(korean ? "준비된 시연" : "Prepared demonstration");
    expect(readable(html)).not.toContain(korean ? "아직 처리를 실행하지 않음" : "processing not yet run");
  });

  it.each([false, true])("prints no verified-answer badge and no question framing (korean: %s)", korean => {
    const html = render(homeCase(), korean);
    const text = readable(html);
    expect(text).not.toMatch(/verified answer/i);
    // No element whose whole text is a verification badge, in either language.
    expect(html).not.toMatch(/>\s*(verified|검증됨|검증 완료)\s*</i);
    expect(text).not.toContain("검증된 답");
    // The proof tabs' questions were never answered by these passages; none is printed.
    for (const tab of buildProofTabs()) expect(text).not.toContain(tab.question);
    expect(text).not.toContain("Prepared sample · read only");
    expect(html).not.toMatch(/<video|<canvas|autoplay|\/film\//i);
  });

  it("says no claim is published, and context is required for the selected passage", () => {
    const text = readable(render(homeCase()));
    expect(text).toContain("Published claims");
    expect(text).toContain("None. A verified claim needs every region it rests on, its period and unit cited, and a qualified run.");
    expect(text).toContain("Context required.");
  });
});

describe("the Home workbench -- source and passage", () => {
  it.each([false, true])("prints the source name, filing, location and the full digest (korean: %s)", korean => {
    const view = buildHeroView();
    const value = homeCase();
    const source = value.sources[0]!;
    const text = readable(render(value, korean));
    expect(text).toContain(view.source.filename);
    expect(text).toContain(`${source.form} · ${source.filingDate}`);
    expect(text).toContain(korean
      ? `${view.source.pageCount}쪽 중 ${view.source.page}쪽 · ${view.source.qualifierKo}`
      : `page ${view.source.page} of ${view.source.pageCount} · ${view.source.qualifier}`);
    expect(view.source.digest.length).toBeGreaterThan(0);
    expect(text).toContain(view.source.digest);
  });

  it.each([false, true])("quotes the selected passage verbatim, in English, once (korean: %s)", korean => {
    const value = homeCase();
    const selected = value.regions.find(region => region.id === value.selectedRegionId)!;
    const html = render(value, korean);
    const quotes = [...html.matchAll(/<blockquote(\s[^>]*)?>([\s\S]*?)<\/blockquote>/g)];
    expect(quotes).toHaveLength(1);
    expect(quotes[0]![1]).toMatch(/\slang="en"/);
    expect(quotes[0]![2]).toBe(escaped(selected.passage!));
  });

  it("makes the source page the hero's prioritized paint, with every region boxed at its bbox", () => {
    const value = homeCase();
    const image = value.pages[0]!.image!;
    const html = render(value);
    const images = html.match(/<img\s[^>]*>/g) ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toContain(`src="${escaped(image.src)}"`);
    expect(images[0]).toContain(`width="${image.width}"`);
    expect(images[0]).toContain(`height="${image.height}"`);
    expect(images[0]).toMatch(/\sfetchpriority="high"/i);
    expect(images[0]).toMatch(/\sloading="eager"/);
    expect(images[0]).toMatch(/\sdecoding="async"/);
    expect(attr(images[0]!, "alt")).toBeTruthy();
    expect(attr(images[0]!, "alt")).not.toMatch(/\d/);
    for (const region of value.regions) {
      const box = html.match(new RegExp(`<span\\s[^>]*data-region-id="${escaped(region.id)}"[^>]*>`));
      expect(box, `region ${region.id} is drawn on the page`).not.toBeNull();
      expect(box![0]).toContain('aria-hidden="true"');
      const [x, y, x2, y2] = region.bbox1000;
      for (const [edge, size] of [["left", x], ["top", y], ["width", x2 - x], ["height", y2 - y]] as const) {
        expect(box![0]).toContain(`${edge}:${size / 10}%`);
      }
      expect(box![0].includes('data-selected="1"')).toBe(region.id === value.selectedRegionId);
    }
  });

  it.each([false, true])("puts the page straight under the source's name and page, ahead of the passage (korean: %s)", korean => {
    const value = homeCase();
    const source = value.sources[0]!;
    const html = render(value, korean);
    const name = html.indexOf(escaped(source.filename));
    const frame = html.search(/<div\s[^>]*data-page-window=/);
    const passagePane = html.search(/<div\s[^>]*aria-live="polite"/);
    expect(name).toBeGreaterThan(-1);
    expect(frame).toBeGreaterThan(name);
    expect(passagePane).toBeGreaterThan(frame);
    expect(html.indexOf("<img")).toBeGreaterThan(frame);
    expect(html.indexOf("<img")).toBeLessThan(passagePane);
    // Between the name and the page: the one-line location, and none of the provenance prose.
    const between = readable(html.slice(name, frame)).replace(/\s+/g, " ");
    expect(between).toContain(korean ? `${source.pageCount}쪽 중 ` : `page `);
    for (const absent of [`${source.form} · ${source.filingDate}`, korean ? "원본 HTML" : "original HTML", korean ? "구절" : "passage"]) {
      expect(between).not.toContain(absent);
    }
  });

  it("windows the page from the regions' own bboxes and offsets the sheet, not the boxes", () => {
    const value = homeCase();
    const image = value.pages[0]!.image!;
    const html = render(value);
    const open = html.match(/<div\s[^>]*data-page-window="[^"]*"[^>]*>/)![0];
    const [start, end] = attr(open, "data-page-window")!.split(",").map(Number);
    const tops = value.regions.map(region => region.bbox1000[1]);
    const bottoms = value.regions.map(region => region.bbox1000[3]);
    expect(start).toBe(Math.max(0, Math.min(...tops) - 80));
    expect(end).toBe(Math.min(1000, Math.max(...bottoms) + 80));
    // A window of the page, not the page: it starts below the top or ends above the foot.
    expect(start! > 0 || end! < 1000).toBe(true);
    for (const region of value.regions) {
      expect(region.bbox1000[1]).toBeGreaterThanOrEqual(start!);
      expect(region.bbox1000[3]).toBeLessThanOrEqual(end!);
    }
    expect(attr(open, "style")).toBe(`aspect-ratio:${image.width} / ${(image.height * (end! - start!)) / 1000}`);
    const sheet = html.slice(html.indexOf(open) + open.length).match(/^<div\s[^>]*>/)![0];
    expect(attr(sheet, "style")).toBe(`transform:translateY(-${start! / 10}%)`);
  });

  it("keeps the full page and every exact region link reachable as native links", () => {
    const value = homeCase();
    const html = render(value);
    const links = [...html.matchAll(/<a(\s[^>]*)>/g)].map(match => match[1]!);
    const hrefs = links.map(open => attr(open, "href"));
    expect(hrefs).toContain(escaped(value.pages[0]!.image!.src));
    for (const region of value.regions) expect(hrefs).toContain(escaped(region.href!));
    const evidence = links.find(open => /\sdata-hero-evidence/.test(open));
    expect(evidence, "the passage's own region link").toBeDefined();
    expect(attr(evidence!, "href")).toBe(escaped(value.regions.find(region => region.id === value.selectedRegionId)!.href!));
  });

  it("keeps the long hash and the rights record inside a closed Source details disclosure", () => {
    const value = homeCase();
    const html = render(value);
    const details = html.match(/<details(\s[^>]*)?>([\s\S]*?)<\/details>/);
    expect(details, "a Source details disclosure").not.toBeNull();
    expect(details![1] ?? "").not.toMatch(/\sopen(=|\s|$)/);
    const inside = readable(details![2]!);
    expect(inside).toContain("Source details");
    expect(inside).toContain(value.sources[0]!.digest);
    expect(inside).toContain(value.sources[0]!.rights.basis);
    expect(inside).toContain(value.sources[0]!.rights.attribution);
    expect(inside).toContain("Published sample");
    for (const region of value.regions) expect(inside).toContain(region.id);
    // The filing's form, date and provenance prose live here, off the line above the page.
    expect(inside).toContain(`${value.sources[0]!.form} · ${value.sources[0]!.filingDate}`);
    expect(inside).toContain("The original HTML filing, as submitted.");
    // Outside the disclosure the version is the short form only.
    const outside = readable(html.replace(details![0], ""));
    expect(outside).not.toContain(value.sources[0]!.digest);
    expect(outside).toContain(value.sources[0]!.digest.slice(0, 15));
    expect(outside).not.toContain("original HTML");
  });
});

describe("the Home workbench -- region selection", () => {
  it("offers one native button per region, with exactly the selected one pressed", () => {
    const value = homeCase();
    const html = render(value);
    const buttons = buttonsOf(html);
    expect(buttons).toHaveLength(value.regions.length);
    const passageId = html.match(/<div\s[^>]*aria-live="polite"[^>]*>/)?.[0];
    expect(passageId, "the passage pane is a live region").toBeDefined();
    const paneId = attr(passageId!, "id");
    expect(paneId).toBeTruthy();
    const pressed = buttons.filter(([, open]) => attr(open!, "aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    for (const [, open] of buttons) {
      expect(attr(open!, "type")).toBe("button");
      expect(attr(open!, "aria-controls")).toBe(paneId);
      expect(["true", "false"]).toContain(attr(open!, "aria-pressed"));
    }
    expect(readable(pressed[0]![2]!)).toContain("Selected table passage");
  });

  it("moves the passage, its citation link, the pressed button and the page box together", () => {
    const base = homeCase();
    for (const region of base.regions) {
      const html = render({ ...base, selectedRegionId: region.id });
      const quote = html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/)?.[1];
      expect(quote).toBe(escaped(region.passage!));
      const link = html.match(/<a\s[^>]*data-hero-evidence[^>]*>/)?.[0] ?? "";
      expect(attr(link, "href")).toBe(escaped(region.href!));
      const pressed = buttonsOf(html).filter(([, open]) => attr(open!, "aria-pressed") === "true");
      expect(pressed).toHaveLength(1);
      expect(readable(pressed[0]![2]!)).toContain(region.bbox1000.join(","));
      const box = html.match(/<span\s[^>]*data-selected="1"[^>]*>/)?.[0] ?? "";
      expect(attr(box, "data-region-id")).toBe(escaped(region.id));
      const note = region.role === "selected" ? "Context required." : "Shown as printed, for context.";
      expect(readable(html)).toContain(note);
    }
  });
});

describe("the Home workbench -- gates", () => {
  it("renders nothing for the reserved hard case, which has no source, page or passage", () => {
    expect(render(HOME_RESERVED_CASE)).toBe("");
    expect(render(HOME_RESERVED_CASE, true)).toBe("");
  });

  it("renders nothing when the only source is not cleared for display", () => {
    const value = homeCase();
    const blocked: EvidenceCase = {
      ...value,
      sources: value.sources.map(source => ({ ...source, rights: { ...source.rights, publication: "not_cleared" } })),
    };
    expect(render(blocked)).toBe("");
  });

  it("offers a supplied full source when one is committed, and says so in those words", () => {
    const value = homeCase();
    const withFull: EvidenceCase = {
      ...value,
      sources: value.sources.map(source => ({ ...source, fullSourceHref: "/fixture-full-source.pdf" })),
    };
    const html = render(withFull);
    const full = [...html.matchAll(/<a(\s[^>]*)>([\s\S]*?)<\/a>/g)].find(([, open]) => attr(open!, "href") === "/fixture-full-source.pdf");
    expect(full).toBeDefined();
    expect(readable(full![2]!).trim()).toBe("Open full source");
    expect(readable(render(value))).not.toContain("Open full source");
  });
});

/* The SEC URL the default sample's only verified binding names (main2065 sources metadata). */
const SEC_FILING_HREF = "https://www.sec.gov/Archives/edgar/data/320193/000032019326000006/aapl-20251227.htm";
const anchorsOf = (html: string) => [...html.matchAll(/<a(\s[^>]*)>([\s\S]*?)<\/a>/g)];

describe("the Home workbench -- full filing", () => {
  it.each([false, true])("links the full SEC filing beside the page, next to the full page, in so many words (korean: %s)", korean => {
    const value = homeCase();
    const html = render(value, korean);
    const filings = anchorsOf(html).filter(([, open]) => /\sdata-full-filing/.test(open!));
    expect(filings).toHaveLength(1);
    const [whole, open, label] = filings[0]!;
    expect(attr(open!, "href")).toBe(SEC_FILING_HREF);
    expect(readable(label!).replace(/↗/g, "").trim()).toBe(korean ? "전체 공시 열기 (SEC)" : "Open full filing (SEC)");
    /*
      Beside the page: after the page window, in the same link row as the full page, before the
      passage pane, and never inside the closed Source details.
    */
    const at = html.indexOf(whole);
    const passagePane = html.search(/<div\s[^>]*aria-live="polite"/);
    expect(at).toBeGreaterThan(html.indexOf("<img"));
    expect(at).toBeLessThan(passagePane);
    const row = html.slice(html.lastIndexOf("<p", at), html.indexOf("</p>", at));
    expect(row).toContain(`href="${escaped(value.pages[0]!.image!.src)}"`);
    const details = html.match(/<details[\s\S]*?<\/details>/)![0];
    expect(details).not.toContain(SEC_FILING_HREF);
  });

  it.each([false, true])("says in Source details the filing is the original HTML and the page a reference render (korean: %s)", korean => {
    const html = render(homeCase(), korean);
    const details = readable(html.match(/<details[\s\S]*?<\/details>/)![0]);
    expect(details).toContain(korean ? "제출된 그대로의 원본 HTML 공시입니다." : "The original HTML filing, as submitted.");
    expect(details).toContain(korean ? "여기 보이는 페이지는 그 공시의 기준 렌더입니다." : "The page shown here is a reference render of it.");
    // The visible location line still names the page's own representation.
    const outside = readable(html.replace(/<details[\s\S]*?<\/details>/, ""));
    expect(outside).toContain(korean ? "기준 렌더" : "reference render");
  });

  it("keeps the full page and every exact region link alongside the filing", () => {
    const value = homeCase();
    const hrefs = anchorsOf(render(value)).map(([, open]) => attr(open!, "href"));
    expect(hrefs).toContain(SEC_FILING_HREF);
    expect(hrefs).toContain(escaped(value.pages[0]!.image!.src));
    for (const region of value.regions) expect(hrefs).toContain(escaped(region.href!));
    // The filing is not dressed as the page raster, nor the raster as the filing.
    expect(value.pages[0]!.image!.src).not.toBe(SEC_FILING_HREF);
  });

  it("links no filing for a source without a verified binding", () => {
    const value = homeCase();
    const unbound: EvidenceCase = { ...value, sources: value.sources.map(source => ({ ...source, officialFiling: null })) };
    const html = render(unbound);
    expect(html).not.toContain("data-full-filing");
    expect(html).not.toContain("sec.gov");
    expect(readable(html)).not.toContain("Open full filing");
    // Selection, page and region links are unaffected by its absence.
    expect(buttonsOf(html)).toHaveLength(value.regions.length);
    expect(html).toContain("data-hero-evidence");
  });

  it("changes no status, rights or claim wording because a filing is linked", () => {
    const value = homeCase();
    const unbound: EvidenceCase = { ...value, sources: value.sources.map(source => ({ ...source, officialFiling: null })) };
    const strip = (html: string) => readable(html).replace(/\s+/g, " ");
    const linked = render(value);
    const plain = render(unbound);
    for (const html of [linked, plain]) {
      expect(html).toContain('data-case-status="extracted"');
      expect(html).toContain('data-run="not_run"');
      expect(strip(html)).toContain("Published sample");
      expect(strip(html)).toContain("None. A verified claim needs every region it rests on, its period and unit cited, and a qualified run.");
      expect(html).not.toMatch(/>\s*(verified|검증됨|검증 완료)\s*</i);
    }
    // Source details differs by the filing's provenance sentence alone.
    const details = (html: string) => html.match(/<details[\s\S]*?<\/details>/)![0];
    const provenance = " The original HTML filing, as submitted. The page shown here is a reference render of it.";
    expect(details(linked)).toContain(provenance);
    expect(details(linked).replace(provenance, "")).toBe(details(plain));
  });
});
