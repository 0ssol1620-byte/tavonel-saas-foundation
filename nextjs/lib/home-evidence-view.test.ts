import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HeroSourceCard from "../components/landing-v2/hero-source-card";
import { CROP_MARGIN_PX, SourceRegionCrop } from "../components/landing-v2/source-region";
import { WorkbenchEvidenceLine, workbenchLineGeometry } from "../components/landing-v2/evidence-connector";
import {
  assertEvidenceCase,
  buildHomeEvidenceCase,
  caseStatus,
  claimPublication,
  displayableRegions,
  evidenceLineLabel,
  HOME_RESERVED_CASE,
  isBoilerplateClaim,
  isClaimWithoutHeadingRunOn,
  isRepresentativeClaim,
  officialFilingFor,
  publishableClaims,
  selectHomeCase,
  selectReceiveClaim,
  type EvidenceCase,
  type EvidenceClaim,
  type EvidenceRegion,
} from "./home-evidence-view";
import { buildEvidenceRecord, buildHeroView, buildProofTabs } from "./landing-v2-runtime";

/*
  The Home evidence projection. Two halves:

  - the default case is read off the committed snapshot, so every expectation compares it with
    `buildHeroView()` / `buildProofTabs()` rather than with typed strings;
  - the gates (binding validation, claim publication, rights, the reserved slot) run over small
    fixtures whose text is obviously a fixture, so no test here asserts a fact about a filing.
*/

function homeCase(): EvidenceCase {
  const value = buildHomeEvidenceCase(buildHeroView(), buildProofTabs());
  expect(value, "a case bound to the committed hero page").not.toBeNull();
  return value!;
}

/* ---------------------------------------------------------------------------------- fixtures */

const DIGEST_A = "sha256:aaaa";
const DIGEST_B = "sha256:bbbb";

function region(overrides: Partial<EvidenceRegion> & Pick<EvidenceRegion, "id">): EvidenceRegion {
  return {
    sourceId: "a",
    digest: DIGEST_A,
    page: 3,
    bbox1000: [100, 100, 900, 200],
    role: "selected",
    passage: `Fixture passage ${overrides.id}`,
    passageTruncated: false,
    status: "extracted",
    href: `/explore?act=evidence&evidence=${overrides.id}`,
    ...overrides,
  };
}

/** Two sources, three pages, four regions: a multi-page, multi-source case on cleared rights. */
function fixture(overrides: Partial<EvidenceCase> = {}): EvidenceCase {
  return {
    schema: "tavonel.home-evidence.v1",
    id: "fixture",
    presentation: "prepared_demonstration",
    run: "qualified",
    sources: [
      {
        id: "a", filename: "fixture-a.pdf", digest: DIGEST_A, form: null, filingDate: null, pageCount: 10,
        representation: "original", fullSourceHref: "/fixture-a.pdf", officialFiling: null,
        rights: { basis: "Fixture", jurisdiction: "Fixture", attribution: "Fixture", publication: "cleared" },
      },
      {
        id: "b", filename: "fixture-b.pdf", digest: DIGEST_B, form: null, filingDate: null, pageCount: 5,
        representation: "original", fullSourceHref: null, officialFiling: null,
        rights: { basis: "Fixture", jurisdiction: "Fixture", attribution: "Fixture", publication: "cleared" },
      },
    ],
    pages: [
      { sourceId: "a", digest: DIGEST_A, page: 3, image: null },
      { sourceId: "a", digest: DIGEST_A, page: 4, image: null },
      { sourceId: "b", digest: DIGEST_B, page: 1, image: null },
    ],
    regions: [
      region({ id: "value" }),
      region({ id: "period", role: "column-headings", page: 4, bbox1000: [100, 50, 900, 90] }),
      region({ id: "unit", role: "statement-heading", page: 4, bbox1000: [100, 10, 900, 40] }),
      region({ id: "other", sourceId: "b", digest: DIGEST_B, page: 1 }),
    ],
    claims: [],
    selectedRegionId: "value",
    ...overrides,
  };
}

function claim(overrides: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: "claim",
    text: "Fixture claim",
    status: "unverified",
    citations: ["value", "period", "unit"],
    required: ["period", "unit"],
    conditions: [
      { kind: "period", value: "fixture period", regionId: "period" },
      { kind: "unit", value: "fixture unit", regionId: "unit" },
    ],
    ...overrides,
  };
}

/* ----------------------------------------------------------------------------- default case */

describe("the default Home case", () => {
  it("binds every region to the hero page's own source digest, page, bbox and link", () => {
    const view = buildHeroView();
    const value = homeCase();
    expect(value.sources).toHaveLength(1);
    const [source] = value.sources;
    expect(source!.digest).toBe(view.source.digest);
    expect(source!.filename).toBe(view.source.filename);
    expect(value.pages).toEqual([
      { sourceId: source!.id, digest: view.source.digest, page: view.source.page, image: view.image },
    ]);
    for (const item of value.regions) {
      const original = view.regions.find(candidate => candidate.id === item.id);
      expect(original, `region ${item.id} exists on the hero page`).toBeDefined();
      expect(item.digest).toBe(view.source.digest);
      expect(item.page).toBe(view.source.page);
      expect([...item.bbox1000]).toEqual([...original!.bbox1000]);
      expect(item.href).toBe(original!.href);
      // The extractor's words, unchanged -- never a rewrite.
      expect(item.passage).toBe(original!.excerpt);
      expect(item.passageTruncated).toBe(original!.excerptTruncated);
      expect(item.status).toBe("extracted");
    }
  });

  it("selects the passage a proof tab already quotes, and carries several regions of that page", () => {
    const value = homeCase();
    const selected = value.regions.find(item => item.id === value.selectedRegionId);
    expect(selected?.role).toBe("selected");
    const tab = buildProofTabs().find(item => item.region.id === selected!.id);
    expect(tab, "the selected passage is a committed proof tab's region").toBeDefined();
    expect(selected!.passage).toBe(tab!.answerExcerpt);
    expect(value.sources[0]!.form).toBe(tab!.source.form);
    expect(value.sources[0]!.filingDate).toBe(tab!.source.filingDate);
    // Multiple regions, each with a distinct role; none invented beyond the page view.
    expect(value.regions.length).toBeGreaterThan(1);
    expect(new Set(value.regions.map(item => item.role)).size).toBe(value.regions.length);
  });

  it("stays at extracted: not run, no claim, nothing publishable, rights only a public sample", () => {
    const value = homeCase();
    expect(value.presentation).toBe("prepared_demonstration");
    expect(value.run).toBe("not_run");
    expect(value.claims).toEqual([]);
    expect(publishableClaims(value)).toEqual([]);
    expect(caseStatus(value)).toBe("extracted");
    expect(value.sources[0]!.rights.publication).toBe("public_sample");
    expect(value.sources[0]!.fullSourceHref).toBeNull();
    expect(displayableRegions(value)).toHaveLength(value.regions.length);
  });

  it("is a plain serializable value", () => {
    const value = homeCase();
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it("returns null rather than a partial case when no proof tab agrees with the page", () => {
    const view = buildHeroView();
    const tabs = buildProofTabs().map(tab => ({ ...tab, source: { ...tab.source, digest: "sha256:other" } }));
    expect(buildHomeEvidenceCase(view, tabs)).toBeNull();
    const truncated = buildProofTabs().map(tab => ({ ...tab, answerTruncated: true }));
    expect(buildHomeEvidenceCase(view, truncated)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- official filing */

/*
  The one verified binding: main2065 `explore-sample.sources.json`, documentId apple-2026-q1-10-q,
  whose `sourceUrl` and `secUrl` are this URL. Typed out here on purpose -- this is the expectation
  the helper is held to, so it may not be read back from the helper.
*/
const SEC_FILING = {
  href: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000006/aapl-20251227.htm",
  mediaType: "text/html",
  authority: "SEC",
} as const;
const REPRESENTATION = {
  digest: "sha256:7fe2683c59e0b48f6c112bc17b3900d907f64236c138d1dd32f40d544b1ba89f",
  filename: "apple-2026-q1-10-q-reference.pdf",
  form: "10-Q",
  filingDate: "2026-01-30",
  representation: "reference_render",
};

describe("the official filing link", () => {
  it("resolves the default prepared sample to its exact SEC HTML filing", () => {
    const [source] = homeCase().sources;
    // The binding's keys are the representation the page is actually bound to.
    expect({
      digest: source!.digest,
      filename: source!.filename,
      form: source!.form,
      filingDate: source!.filingDate,
      representation: source!.representation,
    }).toEqual(REPRESENTATION);
    expect(source!.officialFiling).toEqual(SEC_FILING);
    expect(officialFilingFor(REPRESENTATION)).toEqual(SEC_FILING);
    // The filing is the original HTML, not the PDF raster beside it and not a committed file.
    expect(source!.officialFiling!.href).not.toMatch(/\.pdf(#|$)/);
    expect(source!.fullSourceHref).toBeNull();
  });

  it.each([
    ["the original HTML's own digest", { digest: "sha256:52d955e28dcd11351814607d748217babc68cdf364387c1ff05ed62c3842c7cc" }],
    ["another digest", { digest: DIGEST_A }],
    ["the original HTML's filename", { filename: "sec-source/apple-2026-q1-10-q.html" }],
    ["a filename without the reference suffix", { filename: "apple-2026-q1-10-q.pdf" }],
    ["another form", { form: "10-K" }],
    ["no form", { form: null }],
    ["another filing date", { filingDate: "2026-01-31" }],
    ["no filing date", { filingDate: null }],
    ["the original representation", { representation: "original" }],
  ] as const)("fails closed on %s", (_label, change) => {
    expect(officialFilingFor({ ...REPRESENTATION, ...change })).toBeNull();
  });

  it("does not lend this filing to the unrelated 2025 10-K the snapshot also carries", () => {
    const tab = buildProofTabs().find(item => item.source.form === "10-K");
    expect(tab, "the snapshot's 10-K tab").toBeDefined();
    const tenK = tab!.source;
    expect(officialFilingFor({
      digest: tenK.digest,
      filename: tenK.filename,
      form: tenK.form,
      filingDate: tenK.filingDate,
      representation: tenK.representationKind,
    })).toBeNull();
  });

  it("leaves status, run, claims and rights exactly where they are without the link", () => {
    const linked = homeCase();
    const unlinked: EvidenceCase = { ...linked, sources: linked.sources.map(source => ({ ...source, officialFiling: null })) };
    expect(linked.sources[0]!.officialFiling).not.toBeNull();
    for (const value of [linked, unlinked]) {
      expect(caseStatus(value)).toBe("extracted");
      expect(value.run).toBe("not_run");
      expect(value.presentation).toBe("prepared_demonstration");
      expect(publishableClaims(value)).toEqual([]);
      expect(value.sources[0]!.rights.publication).toBe("public_sample");
    }
    expect(linked.sources[0]!.rights).toEqual(unlinked.sources[0]!.rights);
    expect(displayableRegions(linked)).toEqual(displayableRegions(unlinked));
  });

  it("refuses a case that names a filing its source has no verified binding to", () => {
    const invented = fixture();
    invented.sources[0] = { ...invented.sources[0]!, officialFiling: { ...SEC_FILING } };
    expect(() => assertEvidenceCase(invented)).toThrow(/no verified binding/);
    const value = homeCase();
    const moved: EvidenceCase = {
      ...value,
      sources: value.sources.map(source => ({ ...source, officialFiling: { ...SEC_FILING, href: `${SEC_FILING.href}?x` } })),
    };
    expect(() => assertEvidenceCase(moved)).toThrow(/no verified binding/);
    const renamed: EvidenceCase = {
      ...value,
      sources: value.sources.map(source => ({ ...source, filename: "apple-2026-q1-10-q.html" })),
    };
    expect(() => assertEvidenceCase(renamed)).toThrow(/no verified binding/);
  });

  it("hands out a copy, so a caller cannot rewrite the binding", () => {
    const first = officialFilingFor(REPRESENTATION)!;
    first.href = "https://example.invalid/";
    expect(officialFilingFor(REPRESENTATION)).toEqual(SEC_FILING);
  });
});

/* -------------------------------------------------------------------------------- validation */

describe("binding validation", () => {
  it("accepts a multi-source, multi-page case", () => {
    expect(() => assertEvidenceCase(fixture())).not.toThrow();
  });

  it("rejects a region whose digest is not its source's", () => {
    const value = fixture();
    value.regions[0] = { ...value.regions[0]!, digest: DIGEST_B };
    expect(() => assertEvidenceCase(value)).toThrow(/digest mismatch/);
  });

  it("rejects a region on a page the case does not carry", () => {
    const value = fixture();
    value.regions[0] = { ...value.regions[0]!, page: 7 };
    expect(() => assertEvidenceCase(value)).toThrow(/page mismatch/);
  });

  it("rejects a page whose digest is not its source's, or that lies outside the source", () => {
    const wrongDigest = fixture();
    wrongDigest.pages[0] = { ...wrongDigest.pages[0]!, digest: DIGEST_B };
    expect(() => assertEvidenceCase(wrongDigest)).toThrow(/digest mismatch/);
    const outside = fixture();
    outside.pages[2] = { ...outside.pages[2]!, page: 6 };
    expect(() => assertEvidenceCase(outside)).toThrow(/outside/);
  });

  it("rejects an invalid box, an empty extracted passage and text on a prepared region", () => {
    const box = fixture();
    box.regions[0] = { ...box.regions[0]!, bbox1000: [900, 100, 100, 200] };
    expect(() => assertEvidenceCase(box)).toThrow(/bbox/);
    const empty = fixture();
    empty.regions[0] = { ...empty.regions[0]!, passage: "  " };
    expect(() => assertEvidenceCase(empty)).toThrow(/no passage/);
    const prepared = fixture();
    prepared.regions[3] = { ...prepared.regions[3]!, status: "prepared" };
    expect(() => assertEvidenceCase(prepared)).toThrow(/prepared region/);
  });

  it("rejects a selected region that is not an extracted passage, and an unknown citation", () => {
    expect(() => assertEvidenceCase(fixture({ selectedRegionId: "missing" }))).toThrow(/selected region/);
    expect(() => assertEvidenceCase(fixture({ claims: [claim({ citations: ["missing"] })] }))).toThrow(/unknown region/);
  });
});

/* ------------------------------------------------------------------------------- publication */

describe("claim publication", () => {
  it("publishes a claim only with complete regions, cited conditions, cleared rights and a qualified run", () => {
    const value = fixture({ claims: [claim({ status: "verified" })] });
    expect(() => assertEvidenceCase(value)).not.toThrow();
    expect(claimPublication(value, value.claims[0]!)).toEqual({ publishable: true, reasons: [] });
    expect(publishableClaims(value)).toHaveLength(1);
    expect(caseStatus(value)).toBe("verified");
  });

  it("withholds a claim from a run that was not qualified", () => {
    const value = fixture({ run: "not_run", claims: [claim()] });
    expect(claimPublication(value, value.claims[0]!).reasons).toContain("run is not qualified");
    expect(caseStatus(value)).toBe("extracted");
  });

  it("withholds a claim missing a required condition, or whose condition region is not cited", () => {
    const missing = fixture({ claims: [claim({ conditions: [{ kind: "period", value: "fixture period", regionId: "period" }] })] });
    expect(claimPublication(missing, missing.claims[0]!).reasons).toContain("missing unit condition");
    const uncited = fixture({ claims: [claim({ citations: ["value", "period"] })] });
    expect(claimPublication(uncited, uncited.claims[0]!).reasons).toContain("unit condition is not cited");
    const serial = fixture({ claims: [claim({ required: ["period", "unit", "serial"] })] });
    expect(claimPublication(serial, serial.claims[0]!).reasons).toContain("missing serial condition");
    const unconditioned = fixture({ claims: [claim({ required: [], conditions: [] })] });
    expect(claimPublication(unconditioned, unconditioned.claims[0]!).reasons)
      .toContain("claim declares no period/unit or serial/version condition");
  });

  it("withholds a claim with no citation, or resting on a truncated passage", () => {
    const none = fixture({ claims: [claim({ citations: [], required: [], conditions: [] })] });
    expect(claimPublication(none, none.claims[0]!).reasons).toContain("claim cites no region");
    const value = fixture({ claims: [claim()] });
    value.regions[0] = { ...value.regions[0]!, passageTruncated: true };
    expect(claimPublication(value, value.claims[0]!).reasons).toContain("region value passage is incomplete");
  });

  it("withholds a claim whose source rights are only a public sample", () => {
    const value = fixture({ claims: [claim()] });
    value.sources[0] = { ...value.sources[0]!, rights: { ...value.sources[0]!.rights, publication: "public_sample" } };
    expect(claimPublication(value, value.claims[0]!).reasons).toContain("source a rights are not cleared");
  });

  it("refuses to construct a case that marks an incomplete claim verified", () => {
    const value = fixture({ run: "not_run", claims: [claim({ status: "verified" })] });
    expect(() => assertEvidenceCase(value)).toThrow(/marked verified/);
    const noUnit = fixture({ claims: [claim({ status: "verified", required: ["period", "unit"], conditions: [] })] });
    expect(() => assertEvidenceCase(noUnit)).toThrow(/missing period condition/);
  });
});

/* -------------------------------------------------------------------------- rights and slot */

describe("rights and the replaceable slot", () => {
  it("never displays a region whose source is not rights-cleared for display", () => {
    const value = fixture();
    value.sources[1] = { ...value.sources[1]!, rights: { ...value.sources[1]!.rights, publication: "not_cleared" } };
    const shown = displayableRegions(value).map(item => item.id);
    expect(shown).toEqual(["value", "period", "unit"]);
    expect(shown).not.toContain("other");
  });

  it("keeps the reserved hard case prepared, empty and off the page", () => {
    expect(() => assertEvidenceCase(HOME_RESERVED_CASE)).not.toThrow();
    expect(caseStatus(HOME_RESERVED_CASE)).toBe("prepared");
    expect(HOME_RESERVED_CASE.run).toBe("not_run");
    expect(HOME_RESERVED_CASE.sources).toEqual([]);
    expect(HOME_RESERVED_CASE.pages).toEqual([]);
    expect(HOME_RESERVED_CASE.regions).toEqual([]);
    expect(HOME_RESERVED_CASE.claims).toEqual([]);
    expect(HOME_RESERVED_CASE.intent?.question).toBeTruthy();
    expect(selectHomeCase([HOME_RESERVED_CASE])).toBeNull();
    expect(selectHomeCase([null, HOME_RESERVED_CASE])).toBeNull();
    // Even listed first, the reserved case yields to the case that has real passages.
    expect(selectHomeCase([HOME_RESERVED_CASE, homeCase()])).toEqual(homeCase());
  });

  it("does not let a case lead the page because its image exists, without a displayable region", () => {
    const imageOnly = fixture({
      regions: [],
      claims: [],
      selectedRegionId: null,
      pages: [{ sourceId: "a", digest: DIGEST_A, page: 3, image: { src: "/fixture.webp", width: 10, height: 10 } }],
    });
    expect(caseStatus(imageOnly)).toBe("prepared");
    expect(selectHomeCase([imageOnly])).toBeNull();
  });

  it("validates every candidate it is offered, so a mis-bound case cannot be selected", () => {
    const broken = fixture();
    broken.regions[0] = { ...broken.regions[0]!, digest: DIGEST_B };
    expect(() => selectHomeCase([broken])).toThrow(/digest mismatch/);
  });
});

/* ------------------------------------------------------------------- brief move 8: the example */

describe("the What you receive claim rule", () => {
  it("rejects the claim Home quotes today, whose heading runs into its sentence", () => {
    const label = buildEvidenceRecord().claim.label;
    expect(isClaimWithoutHeadingRunOn(label)).toBe(false);
    expect(selectReceiveClaim([{ label }])).toBeNull();
  });

  it.each([
    ["two capitalised opening words", "Fixture Heading The fixture sentence ends here."],
    ["a detached mark", "The fixture ® line ends here."],
    ["two sentences", "The fixture ends here. Another fixture follows."],
    ["a closing quote, then a second sentence", "The fixture says “stop.” Another fixture follows."],
    ["a cut at an abbreviation", "The fixture belongs to Fixture Inc."],
    ["a lowercase opening", "and the fixture continues here."],
    ["no sentence end", "The fixture never ends"],
  ])("rejects %s", (_reason, text) => {
    expect(isClaimWithoutHeadingRunOn(text)).toBe(false);
  });

  it.each([
    ["forward-looking language", "The fixture sentence here says that these fixture lines are forward-looking statements."],
    ["a safe harbor", "The fixture sentence here relies on the safe harbor for every fixture line it prints."],
    ["the Reform Act", "The fixture sentence here cites the Private Securities Litigation Reform Act of the fixture."],
    ["undue reliance", "The fixture sentence here warns readers not to place undue reliance on any fixture line."],
    ["an example fragment", "For example, the fixture sentence here runs on for well more than twelve words in all."],
    ["a list fragment", "Such as the fixture sentence here, which runs on for well more than twelve words in all."],
    ["fewer than twelve words", "The fixture sentence here has exactly eleven words in it now."],
  ])("treats %s as boilerplate, even in one clean sentence", (_reason, text) => {
    expect(isBoilerplateClaim(text)).toBe(true);
    expect(isRepresentativeClaim(text)).toBe(false);
    expect(selectReceiveClaim([{ label: text }])).toBeNull();
  });

  it("accepts one plain sentence, and selects the first passing candidate in the order given", () => {
    expect(isClaimWithoutHeadingRunOn("For example, the fixture sentence ends here.")).toBe(true);
    expect(isClaimWithoutHeadingRunOn("The fixture says “stop.”")).toBe(true);
    const twelve = "The fixture sentence here has exactly twelve words in it right now.";
    expect(isBoilerplateClaim(twelve)).toBe(false);
    expect(isRepresentativeClaim(twelve)).toBe(true);
    const picked = selectReceiveClaim([
      { id: 1, label: "Fixture Heading The fixture sentence ends here, after more than twelve words in all." },
      { id: 2, label: "For example, the second fixture runs on for well more than twelve words in all." },
      { id: 3, label: "The third fixture is the first one here that runs on for twelve words or more." },
      { id: 4, label: "The fourth fixture also passes, and it too runs on for twelve words or more." },
    ]);
    expect(picked?.id).toBe(3);
  });
});

describe("the workbench passage and its crop", () => {
  const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
  const unescape = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

  it("renders every passage byte-for-byte as the snapshot records it", () => {
    const value = homeCase();
    const regions = displayableRegions(value);
    expect(regions.length).toBeGreaterThan(1);
    for (const region of regions) {
      const record = buildHeroView().regions.find(item => item.id === region.id);
      expect(region.passage).toBe(record?.excerpt);
      const markup = html(createElement(HeroSourceCard, { view: { ...value, selectedRegionId: region.id } }));
      const quoted = markup.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/)?.[1];
      expect(quoted, region.id).toBeDefined();
      expect(unescape(quoted!)).toBe(record!.excerpt);
    }
  });

  it("crops the page at exactly the record's bbox, from the page image the case already serves", () => {
    const value = homeCase();
    const image = value.pages[0]!.image!;
    for (const region of displayableRegions(value)) {
      const record = buildHeroView().regions.find(item => item.id === region.id)!;
      const markup = html(createElement(SourceRegionCrop, { src: image.src, width: image.width, height: image.height, bbox1000: region.bbox1000, marginPx: 0 }));
      expect(markup).toContain(`data-bbox1000="${record.bbox1000.join(",")}"`);
      // A background of the served raster, not a new image element or asset.
      expect(markup).not.toContain("<img");
      expect(unescape(markup)).toContain(`background-image:url("${image.src}")`);
      const [x0, y0, x1, y1] = record.bbox1000;
      const [w, h] = [x1 - x0, y1 - y0];
      expect(markup).toContain(`background-size:${100000 / w}% ${100000 / h}%`);
      expect(markup).toContain(`background-position:${(100 * x0) / (1000 - w)}% ${(100 * y0) / (1000 - h)}%`);
      expect(markup).toContain(`aspect-ratio:${(w * image.width) / (h * image.height)}`);
    }
  });

  /*
    The extractor's box for the selected passage ends inside its last printed row, so the crop shows
    a display margin around it. The margin changes what is shown, never what is cited.
  */
  it("shows a display margin around the box while its data attributes keep the record's bbox", () => {
    const value = homeCase();
    const image = value.pages[0]!.image!;
    expect(CROP_MARGIN_PX).toBeGreaterThanOrEqual(8);
    for (const region of displayableRegions(value)) {
      const record = buildHeroView().regions.find(item => item.id === region.id)!;
      const markup = html(createElement(SourceRegionCrop, { src: image.src, width: image.width, height: image.height, bbox1000: region.bbox1000 }));
      expect(markup).toContain(`data-bbox1000="${record.bbox1000.join(",")}"`);
      expect(region.bbox1000).toEqual(record.bbox1000);
      const crop = markup.match(/data-crop1000="([^"]+)"/)?.[1]?.split(",").map(Number);
      const [x0, y0, x1, y1] = record.bbox1000;
      const mx = (1000 * CROP_MARGIN_PX) / image.width;
      const my = (1000 * CROP_MARGIN_PX) / image.height;
      expect(crop).toEqual([Math.max(0, x0 - mx), Math.max(0, y0 - my), Math.min(1000, x1 + mx), Math.min(1000, y1 + my)]);
      // At least eight raster pixels below the box's bottom edge, where the last row's glyphs end.
      expect((crop![3]! - y1) * image.height / 1000).toBeGreaterThanOrEqual(Math.min(8, (1000 - y1) * image.height / 1000));
      const [w, h] = [crop![2]! - crop![0]!, crop![3]! - crop![1]!];
      expect(markup).toContain(`background-size:${100000 / w}% ${100000 / h}%`);
      expect(markup).toContain(`aspect-ratio:${(w * image.width) / (h * image.height)}`);
    }
  });

  it("clamps the display margin to the page", () => {
    const markup = html(createElement(SourceRegionCrop, { src: "/fixture.webp", width: 100, height: 100, bbox1000: [0, 10, 1000, 990], marginPx: 16 }));
    expect(markup).toContain('data-bbox1000="0,10,1000,990"');
    expect(markup).toContain('data-crop1000="0,0,1000,1000"');
    expect(markup).toContain("background-size:100% 100%");
  });

  it("offsets nothing along an axis the box spans in full", () => {
    const markup = html(createElement(SourceRegionCrop, { src: "/fixture.webp", width: 10, height: 10, bbox1000: [0, 100, 1000, 300], marginPx: 0 }));
    expect(markup).toContain("background-size:100% 500%");
    expect(markup).toContain("background-position:0% 12.5%");
  });

  it("draws nothing for a box that is not a region", () => {
    expect(html(createElement(SourceRegionCrop, { src: "/fixture.webp", width: 10, height: 10, bbox1000: [500, 10, 400, 20] }))).toBe("");
  });
});

/* ---------------------------------------------------------- brief move 5: the Evidence Line */

describe("the Evidence Line", () => {
  it("labels every workbench region with the snapshot record's form, page and bbox", () => {
    const value = homeCase();
    const source = value.sources[0]!;
    const tab = buildProofTabs().find(item => item.region.id === value.selectedRegionId)!;
    expect(source.form).toBe(tab.source.form);
    displayableRegions(value).forEach((region, index) => {
      const record = buildHeroView().regions.find(item => item.id === region.id)!;
      const [x0, y0, x1, y1] = record.bbox1000;
      const mark = String.fromCharCode(65 + index);
      const label = evidenceLineLabel(source, region, mark);
      expect(label.coordinates).toBe(`SOURCE · ${tab.source.form} · p.${buildHeroView().source.page} · [${x0},${y0} → ${x1},${y1}]`);
      expect(label.human).toBe(`page ${buildHeroView().source.page} · region ${mark}`);
      expect(evidenceLineLabel(source, region, mark, true).human).toBe(`${buildHeroView().source.page}쪽 · 영역 ${mark}`);
    });
  });

  it("leaves out a form the source does not state, rather than inventing one", () => {
    expect(evidenceLineLabel({ form: null }, { page: 3, bbox1000: [1, 2, 3, 4] }, "A").coordinates).toBe("SOURCE · p.3 · [1,2 → 3,4]");
  });

  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width });

  it("runs from the passage card's left edge to the box's right edge, relative to the overlay", () => {
    const line = workbenchLineGeometry(rect(100, 1000, 1200, 800), rect(900, 1100, 400, 300), rect(150, 1400, 500, 60));
    expect(line).toEqual({ ax: 800, ay: 128, bx: 550, by: 430, top: 400 });
  });

  it("draws nothing when the layout is stacked or an end has no size", () => {
    const root = rect(0, 0, 800, 2000);
    expect(workbenchLineGeometry(root, rect(0, 900, 800, 300), rect(40, 400, 700, 60))).toBeNull();
    expect(workbenchLineGeometry(root, rect(600, 100, 0, 300), rect(40, 400, 300, 60))).toBeNull();
    expect(workbenchLineGeometry(root, rect(600, 100, 200, 300), rect(40, 400, 300, 0))).toBeNull();
  });

  it("renders an empty, hidden, absolutely positioned overlay until a region is hovered or focused", () => {
    const markup = renderToStaticMarkup(createElement(WorkbenchEvidenceLine, { labels: {} }));
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-evidence-line="none"');
    expect(markup).toContain("position:absolute");
    expect(markup).not.toContain("<line");
  });
});
