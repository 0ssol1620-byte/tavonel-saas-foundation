import { describe, expect, it } from "vitest";
import {
  assertEvidenceCase,
  buildHomeEvidenceCase,
  caseStatus,
  claimPublication,
  displayableRegions,
  HOME_RESERVED_CASE,
  officialFilingFor,
  publishableClaims,
  selectHomeCase,
  type EvidenceCase,
  type EvidenceClaim,
  type EvidenceRegion,
} from "./home-evidence-view";
import { buildHeroView, buildProofTabs } from "./landing-v2-runtime";

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
