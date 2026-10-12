/*
  Type-only on purpose: the workbench is a client component that imports this module's pure
  checks, and a value import of the runtime would ship the whole committed snapshot with it. The
  server composition passes `buildHeroView()` and `buildProofTabs()` in.
*/
import type { buildHeroView, buildProofTabs } from "./landing-v2-runtime";
import { isSourceRegionBox } from "./source-region-box";

/*
  The Home workbench's evidence projection: source -> region -> passage -> (optional) claim.

  It is a flat, serializable value so the server can build it from the committed snapshot and a
  client component can render and select within it without importing the corpus. Three statuses
  are kept apart on purpose, because the page used to blur them:

    prepared   the arrangement exists (a layout, a reserved slot), but nothing was run for it
    extracted  a passage is the source's own text, bound to a digest, page and bbox
    verified   every material claim is cited to complete regions, with its period/unit or
               serial/version conditions cited too, from a qualified run on cleared rights

  The default Home case only ever reaches "extracted": it is built from passages the published
  sample World already holds, and it carries no claim. Nothing here writes a value, period or
  unit; a region's passage is the extractor's text, unchanged.
*/

export type Bbox1000 = readonly [number, number, number, number];

export type SourceRights = {
  /** Why this source may be shown at all. */
  basis: string;
  /** Where that basis was assessed. "Not assessed" is an acceptable, honest value. */
  jurisdiction: string;
  attribution: string;
  /**
   * `public_sample` may be displayed as an existing passage; only `cleared` may back a verified
   * claim. A raster existing locally is not a rights basis.
   */
  publication: "cleared" | "public_sample" | "not_cleared";
};

export type EvidenceSource = {
  id: string;
  filename: string;
  /** The source's own content digest; every page and region below must repeat it. */
  digest: string;
  form: string | null;
  filingDate: string | null;
  pageCount: number | null;
  /** "original" or "reference_render", as the snapshot records it. */
  representation: string;
  /** The complete source document, when one is committed. Null is stated, not papered over. */
  fullSourceHref: string | null;
  /**
   * The filing as its issuer submitted it, from `officialFilingFor` only. A different thing from
   * the representation above: a reference render is a PDF raster this site made, the filing is
   * the original document it was rendered from. Null for every source without a verified binding.
   */
  officialFiling: OfficialFiling | null;
  rights: SourceRights;
};

export type OfficialFiling = {
  href: string;
  /** The original's own format. Never the render's: an HTML filing is not the PDF beside it. */
  mediaType: "text/html";
  authority: "SEC";
};

export type EvidencePage = {
  sourceId: string;
  digest: string;
  page: number;
  image: { src: string; width: number; height: number } | null;
};

export type RegionStatus = "prepared" | "extracted";

export type EvidenceRegion = {
  id: string;
  sourceId: string;
  digest: string;
  page: number;
  bbox1000: Bbox1000;
  /** What the region is on the page, as a reader can check by looking at it. */
  role: "selected" | "statement-heading" | "column-headings";
  /** The extractor's text, verbatim. Null for a prepared region that was never extracted. */
  passage: string | null;
  passageTruncated: boolean;
  status: RegionStatus;
  /** Exact deep link to this region; null only for a prepared region. */
  href: string | null;
};

export type ConditionKind = "period" | "unit" | "serial" | "version";

export type ClaimCondition = { kind: ConditionKind; value: string; regionId: string };

export type EvidenceClaim = {
  id: string;
  text: string;
  status: "unverified" | "verified";
  /** Region ids. Every material part of `text` must be supported by one of them. */
  citations: string[];
  /** The conditions this claim is meaningless without (a number needs its period and unit). */
  required: ConditionKind[];
  conditions: ClaimCondition[];
};

export type EvidenceCase = {
  schema: "tavonel.home-evidence.v1";
  id: string;
  /** The composition is always prepared; the run is what may or may not have happened. */
  presentation: "prepared_demonstration";
  run: "not_run" | "qualified";
  sources: EvidenceSource[];
  pages: EvidencePage[];
  regions: EvidenceRegion[];
  claims: EvidenceClaim[];
  /** Must name an extracted region; null only when the case has none to show. */
  selectedRegionId: string | null;
  /** A reserved case says what it is for, never what its answer is. */
  intent?: { question: string; scope: string };
};

export type CaseStatus = "prepared" | "extracted" | "verified";

/* ------------------------------------------------------------------------------- validation */

/**
 * Reject a case whose bindings disagree. Throws rather than repairs: a region quoted against the
 * wrong digest or page is a wrong citation, and there is no safe default for one.
 */
export function assertEvidenceCase(value: EvidenceCase): EvidenceCase {
  const fail = (reason: string): never => {
    throw new Error(`Invalid home evidence case ${value.id}: ${reason}`);
  };
  const unique = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length) fail(`duplicate ${what} id`);
  };
  unique(value.sources.map(source => source.id), "source");
  unique(value.regions.map(region => region.id), "region");
  unique(value.claims.map(claim => claim.id), "claim");

  const sources = new Map(value.sources.map(source => [source.id, source]));
  for (const source of value.sources) {
    if (source.officialFiling && source.officialFiling.href !== officialFilingFor(source)?.href) {
      fail(`source ${source.id} names an official filing it has no verified binding to`);
    }
  }
  for (const page of value.pages) {
    const source = sources.get(page.sourceId) ?? fail(`page ${page.page} has no source`);
    if (page.digest !== source.digest) fail(`page ${page.page} digest mismatch`);
    if (!Number.isInteger(page.page) || page.page < 1 ||
        (source.pageCount !== null && page.page > source.pageCount)) {
      fail(`page ${page.page} is outside ${source.filename}`);
    }
  }
  for (const region of value.regions) {
    const source = sources.get(region.sourceId) ?? fail(`region ${region.id} has no source`);
    if (region.digest !== source.digest) fail(`region ${region.id} digest mismatch`);
    if (!value.pages.some(page => page.sourceId === region.sourceId && page.page === region.page)) {
      fail(`region ${region.id} page mismatch`);
    }
    if (!isSourceRegionBox(region.bbox1000)) fail(`region ${region.id} has an invalid bbox`);
    if (region.status === "extracted" && (!region.passage?.trim() || !region.href)) {
      fail(`extracted region ${region.id} has no passage or citation link`);
    }
    if (region.status === "prepared" && region.passage !== null) {
      fail(`prepared region ${region.id} carries passage text`);
    }
  }
  const regionIds = new Set(value.regions.map(region => region.id));
  for (const claim of value.claims) {
    for (const id of [...claim.citations, ...claim.conditions.map(condition => condition.regionId)]) {
      if (!regionIds.has(id)) fail(`claim ${claim.id} cites unknown region ${id}`);
    }
    if (claim.status === "verified") {
      const { reasons } = claimPublication(value, claim);
      if (reasons.length) fail(`claim ${claim.id} is marked verified: ${reasons.join("; ")}`);
    }
  }
  if (value.selectedRegionId !== null) {
    const selected = value.regions.find(region => region.id === value.selectedRegionId);
    if (selected?.status !== "extracted") fail("the selected region is not an extracted passage");
  }
  return value;
}

/* ------------------------------------------------------------------------------- publication */

/**
 * Whether one claim may be published as verified, and every reason it may not.
 *
 * Complete means: the run is qualified, every cited region is an extracted, untruncated passage
 * from a cleared source, the claim declares the conditions it depends on, and each one is stated
 * AND cited to one of the claim's own regions. Missing any one of those, it stays unpublished.
 */
export function claimPublication(value: EvidenceCase, claim: EvidenceClaim): { publishable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (value.run !== "qualified") reasons.push("run is not qualified");
  if (!claim.text.trim()) reasons.push("claim has no text");
  if (claim.citations.length === 0) reasons.push("claim cites no region");
  for (const id of claim.citations) {
    const region = value.regions.find(item => item.id === id);
    const source = value.sources.find(item => item.id === region?.sourceId);
    if (!region || region.status !== "extracted" || !region.passage) reasons.push(`region ${id} is not extracted`);
    else if (region.passageTruncated) reasons.push(`region ${id} passage is incomplete`);
    if (source && source.rights.publication !== "cleared") reasons.push(`source ${source.id} rights are not cleared`);
  }
  /* A claim that states no condition at all is not specific enough to verify. */
  if (claim.required.length === 0) reasons.push("claim declares no period/unit or serial/version condition");
  for (const kind of claim.required) {
    const condition = claim.conditions.find(item => item.kind === kind);
    if (!condition?.value.trim()) reasons.push(`missing ${kind} condition`);
    else if (!claim.citations.includes(condition.regionId)) reasons.push(`${kind} condition is not cited`);
  }
  return { publishable: reasons.length === 0, reasons };
}

/** Claims that may be shown as verified. The default Home case has none. */
export function publishableClaims(value: EvidenceCase): EvidenceClaim[] {
  return value.claims.filter(claim => claim.status === "verified" && claimPublication(value, claim).publishable);
}

/** Regions whose source rights allow showing the passage at all. */
export function displayableRegions(value: EvidenceCase): EvidenceRegion[] {
  return value.regions.filter(region => {
    const source = value.sources.find(item => item.id === region.sourceId);
    return region.status === "extracted" && source !== undefined && source.rights.publication !== "not_cleared";
  });
}

export function caseStatus(value: EvidenceCase): CaseStatus {
  if (value.run === "qualified" && value.claims.length > 0 &&
      value.claims.every(claim => claimPublication(value, claim).publishable)) {
    return "verified";
  }
  return displayableRegions(value).length > 0 ? "extracted" : "prepared";
}

/**
 * The replaceable slot: the first candidate with something real to show. A reserved case with no
 * displayable region is skipped however promising its intent, so it can never lead the page.
 */
export function selectHomeCase(candidates: readonly (EvidenceCase | null)[]): EvidenceCase | null {
  for (const candidate of candidates) {
    if (candidate && displayableRegions(assertEvidenceCase(candidate)).length > 0) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------------------ the default */

/*
  The two other regions of the same page the selected passage cannot be read without: where the
  statement names its unit, and where the table prints its period headings. Named by the World's
  own region ids; a region missing from the snapshot is dropped, never re-created.
*/
const CONTEXT_REGIONS: readonly { id: string; role: EvidenceRegion["role"] }[] = [
  { id: "evidence-274e80464ffc891ce2ed3077e7d67934:chunk-80ffb9ca9af382babdfdaf00cd735d01", role: "statement-heading" },
  { id: "evidence-274e80464ffc891ce2ed3077e7d67934:chunk-b51f1e7299e0b66328a3337d9c3a5b93", role: "column-headings" },
];

const PUBLIC_SAMPLE_RIGHTS: SourceRights = {
  basis: "Public SEC filing, already published in this site's sample World",
  jurisdiction: "Not separately assessed for this preview",
  attribution: "Apple Inc., as filed with the U.S. Securities and Exchange Commission",
  publication: "public_sample",
};

/*
  Official filings, one verified entry per representation. The record is the existing main2065
  `explore-sample.sources.json` entry for documentId apple-2026-q1-10-q (its `sourceUrl` and
  `secUrl` agree; `officialUrl` is null), checked against its provenance blob. It is typed here
  rather than imported because that file belongs to the corpus build, which the client bundle
  must not reach.

  Every key is the representation's: the reference render's digest and filename, as the snapshot
  binds the page to them, and the filing's form and date. The original HTML has a digest of its own
  (sha256:52d955e2...) that no page here is bound to, so it is not a key. A source that disagrees on
  any one field gets no link: a URL is never guessed from a filename, and the 2025 10-K's SEC page
  in the snapshot's record belongs to a different filing.
*/
const VERIFIED_FILINGS: readonly {
  readonly digest: string;
  readonly filename: string;
  readonly form: string;
  readonly filingDate: string;
  readonly representation: string;
  readonly filing: Readonly<OfficialFiling>;
}[] = Object.freeze([
  Object.freeze({
    digest: "sha256:7fe2683c59e0b48f6c112bc17b3900d907f64236c138d1dd32f40d544b1ba89f",
    filename: "apple-2026-q1-10-q-reference.pdf",
    form: "10-Q",
    filingDate: "2026-01-30",
    representation: "reference_render",
    filing: Object.freeze({
      href: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000006/aapl-20251227.htm",
      mediaType: "text/html",
      authority: "SEC",
    } as const),
  }),
]);

/** The verified official filing for exactly this representation, or null. */
export function officialFilingFor(
  source: Pick<EvidenceSource, "digest" | "filename" | "form" | "filingDate" | "representation">,
): OfficialFiling | null {
  const entry = VERIFIED_FILINGS.find(item =>
    item.digest === source.digest && item.filename === source.filename && item.form === source.form &&
    item.filingDate === source.filingDate && item.representation === source.representation);
  return entry ? { ...entry.filing } : null;
}

type HeroView = ReturnType<typeof buildHeroView>;
type ProofTabs = ReturnType<typeof buildProofTabs>;

/**
 * The default case: one committed page, the proof tab's passage on it, and its context regions.
 *
 * The tab supplies form, filing date and page count; it is only joined when its digest, page,
 * filename, region id, bbox, link and untruncated passage all agree with the page view. Returns
 * null rather than a partial case when no tab agrees.
 */
export function buildHomeEvidenceCase(view: HeroView, tabs: ProofTabs): EvidenceCase | null {
  const sourceId = view.source.digest;
  const match = tabs.find(tab => {
    if (tab.source.digest !== view.source.digest || tab.source.page !== view.source.page ||
        tab.source.filename !== view.source.filename || tab.answerTruncated) return false;
    const region = view.regions.find(item => item.id === tab.region.id);
    return Boolean(region && !region.excerptTruncated && region.excerpt === tab.answerExcerpt &&
      region.href === tab.openHref && region.bbox1000.join() === tab.region.bbox1000.join());
  });
  if (!match) return null;

  const pick = (id: string, role: EvidenceRegion["role"]): EvidenceRegion | null => {
    const region = view.regions.find(item => item.id === id);
    if (!region || !isSourceRegionBox(region.bbox1000)) return null;
    return {
      id: region.id,
      sourceId,
      digest: view.source.digest,
      page: view.source.page,
      bbox1000: region.bbox1000,
      role,
      passage: region.excerpt,
      passageTruncated: region.excerptTruncated,
      status: "extracted",
      href: region.href,
    };
  };
  const selected = pick(match.region.id, "selected");
  if (!selected) return null;
  const regions = [selected, ...CONTEXT_REGIONS.map(item => pick(item.id, item.role))]
    .filter((region): region is EvidenceRegion => region !== null);

  const identity = {
    filename: view.source.filename,
    digest: view.source.digest,
    form: match.source.form,
    filingDate: match.source.filingDate,
    representation: match.source.representationKind,
  };
  return assertEvidenceCase({
    schema: "tavonel.home-evidence.v1",
    id: `home:${match.region.id}`,
    presentation: "prepared_demonstration",
    run: "not_run",
    sources: [{
      id: sourceId,
      ...identity,
      pageCount: view.source.pageCount,
      fullSourceHref: null,
      // A link to the filing changes nothing about its rights, the run or any claim.
      officialFiling: officialFilingFor(identity),
      rights: PUBLIC_SAMPLE_RIGHTS,
    }],
    pages: [{ sourceId, digest: view.source.digest, page: view.source.page, image: view.image }],
    regions,
    claims: [],
    selectedRegionId: selected.id,
  });
}

/*
  The reserved hard case. Its packet could not be transferred, so nothing from it has been viewed,
  extracted, processed or rights-cleared: no source, no page, no region, and therefore no way for
  `selectHomeCase` to put it on the page. Replacing it means supplying real bindings, not text.
*/
export const HOME_RESERVED_CASE: EvidenceCase = {
  schema: "tavonel.home-evidence.v1",
  id: "reserved:cloud-flag",
  presentation: "prepared_demonstration",
  run: "not_run",
  sources: [],
  pages: [],
  regions: [],
  claims: [],
  selectedRegionId: null,
  intent: {
    question: "Does Cloud = No mean a clear observation?",
    scope: "Historical Collection 1, November 2019",
  },
};
