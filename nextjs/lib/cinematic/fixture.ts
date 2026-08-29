/**
 * Comprehension World — declared sample fixture.
 *
 * SPEC §3.1 asks for a fictional fixture that is run through the real compiler with its event
 * stream recorded, and labelled `SAMPLE WORLD · FICTIONAL CONTENT · REAL COMPILER RUN`.
 *
 * That label cannot be used yet, and this file must not pretend otherwise. Two prerequisites
 * are missing: the canonical ProductEvent schema (`packages/contracts/product-event.schema.json`
 * in the Core Engine) does not exist, and no compiler run of this material has been recorded.
 * So this is an authored projection, and the site labels it
 * `SAMPLE SEQUENCE · FICTIONAL CONTENT · NOT A COMPILER RUN`.
 *
 * The shape below is the replacement contract. When a real recording exists, it produces the
 * same `WorldProjection` and every consumer keeps working unchanged — nothing in the scene
 * components reads a literal number. SPEC §3.3: all displayed counts bind to projection fields.
 *
 * SPEC §3.2 also bars proper nouns from the 0–14.5s timelapse, so subjects here stay generic
 * (`Launch Program`, `Launch date`) rather than naming a project or a person.
 */

export type SourceKind = "pdf" | "doc" | "note" | "sheet" | "cal" | "mail" | "scan" | "code";

export type SourceFile = {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKind;
  readonly group: string;
  /** §8.4 — the route chosen at CLASSIFICATION, not derived from the extension. */
  readonly route: "native" | "layout" | "ocr" | "structured";
};

export type Candidate = {
  readonly id: string;
  readonly label: string;
  readonly origin: string;
  readonly authority: "approved" | "draft" | "note";
  readonly state: "current" | "superseded" | "unapproved";
};

export type WorldUnit = {
  readonly id: number;
  /** Only these are recomputed at S16. Everything else must visibly stay still. */
  readonly affected: boolean;
};

export type WorldProjection = {
  readonly label: string;
  readonly discovery: {
    readonly filesDiscovered: number;
    readonly groups: number;
    readonly formats: number;
    readonly spanYears: string;
  };
  readonly read: { readonly pagesRead: number; readonly scannedPages: number; readonly regions: number };
  readonly identity: { readonly candidates: number; readonly entitiesResolved: number; readonly heldForReview: number };
  readonly worldTotals: { readonly entities: number; readonly relations: number; readonly units: number };
  readonly recompile: { readonly recompiled: number; readonly worldUnitsTotal: number; readonly inherited: number };
  readonly versions: { readonly before: string; readonly after: string };
};

/** §3.1's recommended source set. Generic subjects only. */
export const SOURCES: readonly SourceFile[] = [
  { id: "s1", name: "approved-launch-plan.pdf", kind: "pdf", group: "Projects", route: "layout" },
  { id: "s2", name: "proposal-draft.docx", kind: "doc", group: "Projects", route: "native" },
  { id: "s3", name: "meeting-notes.md", kind: "note", group: "Notes", route: "native" },
  { id: "s4", name: "roadmap.xlsx", kind: "sheet", group: "Projects", route: "structured" },
  { id: "s5", name: "schedule.ics", kind: "cal", group: "Notes", route: "structured" },
  { id: "s6", name: "customer-update.eml", kind: "mail", group: "Notes", route: "native" },
  { id: "s7", name: "scanned-approval.png", kind: "scan", group: "Policies", route: "ocr" },
  { id: "s8", name: "product-spec.pdf", kind: "pdf", group: "Research", route: "layout" },
  { id: "s9", name: "docs/release.md", kind: "code", group: "Research", route: "native" },
];

/**
 * The four source groups and the share of discovered files each holds. The share exists because
 * dividing the discovered total evenly printed the same number four times down the rail, which
 * reads as a placeholder rather than a world. Shares sum to exactly 1.
 */
export type SourceGroup = { readonly name: string; readonly share: number };

export const SOURCE_GROUPS: readonly SourceGroup[] = [
  { name: "Projects", share: 0.41 },
  { name: "Research", share: 0.27 },
  { name: "Notes", share: 0.19 },
  { name: "Policies", share: 0.13 },
];

/**
 * Allocate a running discovered total across the groups so the parts always sum to the whole.
 * Rounding each share independently loses or gains files at most tick; taking the difference of
 * cumulative rounds cannot.
 */
export function groupCounts(total: number): number[] {
  let prev = 0;
  let acc = 0;
  return SOURCE_GROUPS.map((g, i) => {
    acc += g.share;
    const upto = i === SOURCE_GROUPS.length - 1 ? total : Math.round(total * acc);
    const n = upto - prev;
    prev = upto;
    return n;
  });
}

/** §6.9 — the routes a file can be sent down, with the label shown at S03. */
export const ROUTE_LABELS: Record<SourceFile["route"], string> = {
  native: "native text",
  layout: "layout model",
  ocr: "scan + OCR",
  structured: "structured rows",
};

/** S06 — the same logical thing written three ways, converging on one entity. */
export const IDENTITY_CANDIDATES: readonly string[] = [
  "Launch Program",
  "launch program (Q4)",
  "LP-01",
];
export const IDENTITY_RESOLVED = "Launch Program";

/** S07 / S12 — three candidate answers, one governing. §3.2 keeps the subject generic. */
export const DATE_CANDIDATES: readonly Candidate[] = [
  { id: "c1", label: "Sep 01", origin: "superseded launch plan", authority: "approved", state: "superseded" },
  { id: "c2", label: "Sep 15", origin: "meeting note", authority: "note", state: "unapproved" },
  { id: "c3", label: "Oct 15", origin: "approved launch plan", authority: "approved", state: "current" },
];
export const CURRENT_BEFORE = "Oct 15";
export const CURRENT_AFTER = "Nov 03";

/** S15 — the dependency hops the change actually travels, drawn at 130ms per hop, one pass. */
export const IMPACT_PATH: readonly string[] = [
  "Launch date",
  "Release checklist",
  "Customer update",
  "Roadmap milestone",
  "Support readiness",
];

/** S19 — where the answer comes from. Locator is exact, as the evidence contract requires. */
export const EVIDENCE = {
  file: "approved-launch-plan.pdf",
  page: 4,
  locator: "page 4 · table 2 · row 3",
  field: "Launch date",
} as const;

const TOTAL_UNITS = 112;
const AFFECTED_UNIT_IDS = new Set([17, 28, 41, 54, 63, 78, 95]);

/**
 * §3.1 requires 100+ unrelated units. The signature beat only reads as restraint when the
 * units that do not move visibly outnumber the ones that do.
 */
export const WORLD_UNITS: readonly WorldUnit[] = Array.from({ length: TOTAL_UNITS }, (_, i) => ({
  id: i,
  affected: AFFECTED_UNIT_IDS.has(i),
}));

export const AFFECTED_COUNT = WORLD_UNITS.filter((u) => u.affected).length;

export const PROJECTION: WorldProjection = {
  label: "SAMPLE SEQUENCE · FICTIONAL CONTENT · NOT A COMPILER RUN",
  discovery: { filesDiscovered: 12841, groups: SOURCE_GROUPS.length, formats: 8, spanYears: "2019–2026" },
  read: { pagesRead: 39420, scannedPages: 1806, regions: 214370 },
  identity: { candidates: 6117, entitiesResolved: 4182, heldForReview: 149 },
  worldTotals: { entities: 4182, relations: 21407, units: TOTAL_UNITS },
  recompile: { recompiled: AFFECTED_COUNT, worldUnitsTotal: TOTAL_UNITS, inherited: TOTAL_UNITS - AFFECTED_COUNT },
  versions: { before: "WORLD v1", after: "WORLD v2" },
};

/** Micro feed rows (§8.2). Verb + object, newest first, never more than seven visible. */
export type FeedRow = { readonly at: number; readonly verb: string; readonly object: string; readonly tone?: "held" | "read" | "merged" };

export const FEED: readonly FeedRow[] = [
  { at: 1.6, verb: "Found", object: "Projects/", tone: "read" },
  { at: 1.9, verb: "Found", object: "Research/", tone: "read" },
  { at: 2.2, verb: "Found", object: "Notes/", tone: "read" },
  { at: 2.5, verb: "Found", object: "Policies/", tone: "read" },
  { at: 2.8, verb: "Read", object: "roadmap.xlsx", tone: "read" },
  { at: 3.3, verb: "Routed", object: "scanned-approval.png → OCR", tone: "read" },
  { at: 4.4, verb: "Read", object: "scanned-approval.png", tone: "read" },
  { at: 5.2, verb: "Bound", object: "region → page 4, table 2", tone: "read" },
  { at: 6.1, verb: "Extracted", object: "Launch date", tone: "read" },
  { at: 7.4, verb: "Merged", object: "launch program / LP-01", tone: "merged" },
  { at: 8.2, verb: "Held", object: "ambiguous owner reference", tone: "held" },
  { at: 8.9, verb: "Superseded", object: "Sep 01 launch date", tone: "merged" },
  { at: 9.6, verb: "Held", object: "conflicting policy", tone: "held" },
  { at: 10.6, verb: "Linked", object: "release checklist → launch date", tone: "read" },
  { at: 11.4, verb: "Linked", object: "customer update → launch date", tone: "read" },
  { at: 13.2, verb: "Verified", object: "world candidate", tone: "merged" },
  { at: 26.4, verb: "Changed", object: "approved-launch-plan.pdf", tone: "read" },
  { at: 29.1, verb: "Classified", object: "semantic change · value", tone: "read" },
  { at: 30.4, verb: "Impacted", object: "5 dependency hops", tone: "held" },
  { at: 32.8, verb: "Recompiling", object: "7 affected units", tone: "held" },
  { at: 35.6, verb: "Inherited", object: "105 unchanged units", tone: "read" },
  { at: 37.4, verb: "Verified", object: "candidate world", tone: "merged" },
  { at: 38.8, verb: "Activated", object: "WORLD v2", tone: "merged" },
];

/** §8.1 — the six compiler stages, and the beat at which each becomes active / done. */
export const RAIL_STAGES = [
  { id: "DISCOVER", from: 0.65, to: 3.1 },
  { id: "READ", from: 3.1, to: 5.8 },
  { id: "RESOLVE", from: 5.8, to: 10.1 },
  { id: "COMPILE", from: 10.1, to: 12.75 },
  { id: "VERIFY", from: 12.75, to: 13.9 },
  { id: "ACTIVATE", from: 13.9, to: 14.5 },
] as const;
