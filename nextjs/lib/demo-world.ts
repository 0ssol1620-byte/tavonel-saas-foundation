/**
 * The single source of truth for every figure the landing page prints.
 *
 * The page makes arithmetic claims in six different places -- the chaos census, the compile
 * pipeline, the rebuild console, the impact meters, the architecture tree and the publish
 * record. Before this module they were six independent literals, and one restructure was
 * enough to leave a stale `1,808` in the instrument bar contradicting the `128,470` printed
 * four sections away. Everything is derived here instead, and `demo-world.test.ts` asserts the
 * identities that have to hold, so a drift fails the test run rather than shipping.
 *
 * SPEC note: these are declared fictional demonstration figures. They describe no customer and
 * no measured run. The page says so on screen, in the footer, and in the scene-02 source
 * ledger -- see `DISCLOSURE` below, which is the copy those surfaces use.
 */

/* ------------------------------------------------------------------ the mess (scene 01) */

export const SOURCE_CENSUS = {
  files: 37_842,
  bytes: "18.4 GB",
  systems: 6,
  nearDuplicates: 2_190,
  competingVersions: 4_417,
  scansWithoutTextLayer: 9_006,
  archivesUnpacked: 1_104,
} as const;

/* ------------------------------------------------------------ the compiled world (03, 05) */

export const WORLD = {
  facts: 128_470,
  entities: 22_914,
  relations: 412_900,
  taxonomies: 34,
  hierarchies: 1_206,
  checksPassed: 26,
  checksTotal: 26,
  buildNumber: 4_192,
  versionBefore: 184,
  versionAfter: 185,
} as const;

/** Facts per area. The list is the tree in scene 05 and the cluster set in the canvas field. */
export const AREAS = [
  { name: "Contracts & Policy", facts: 1_240 },
  { name: "Finance", facts: 18_406 },
  { name: "Operations", facts: 12_204 },
  { name: "Legal", facts: 9_830 },
  { name: "Support", facts: 14_760 },
  { name: "Engineering", facts: 17_560 },
  { name: "Product", facts: 31_552 },
  { name: "Customers", facts: 22_918 },
] as const;

/* -------------------------------------------------------------------- the change (06--08) */

/**
 * One contract revision. `changed` facts are the origins; `affected` are reached through the
 * dependency graph; `held` is the single fact with two readings that is kept out of the live
 * world. Everything else is proven untouched and carried across unchanged -- which is the
 * claim the whole back half of the page rests on, so it is computed, never typed.
 */
export const CHANGE = {
  document: "Services Agreement 2026.pdf",
  revisionFrom: 17,
  revisionTo: 18,
  documentFacts: 1_240,
  /** Pages in the amended agreement. The reading demonstration counts against this. */
  documentPages: 18,
  changed: 3,
  affected: 39,
  held: 1,
  documentsRegenerated: 7,
  levels: [12, 15, 12],
} as const;

/** 3 origins + 39 reached. */
export const REBUILT = CHANGE.changed + CHANGE.affected;
/** Everything the wavefront never reached, and that is not being held for review. */
export const KEPT = WORLD.facts - REBUILT - CHANGE.held;

/* --------------------------------------------------------------------- formatting helpers */

/** Grouped with commas in every locale, so server and client render the same string. */
export function n(value: number): string {
  return value.toLocaleString("en-US");
}

/* --------------------------------------------------------------------------- disclosure */

/**
 * The page must not imply that a demonstration is a measured run, and must not imply that a
 * capability is shipping. These strings are the only place that boundary is worded, so it
 * cannot drift between the sections that carry it.
 */
export const DISCLOSURE = {
  fixture:
    "Declared fictional demonstration data. Every source, fact, version, timestamp and figure on this page is invented to show the shape of a compile. It is not a recording of a compiler run and describes no customer.",
  staged:
    "The demonstration on this page is a deterministic staged sequence. It reads no file, uploads nothing, and no data leaves this page.",
  ontology:
    "TAVONEL derives the structure shown here as part of the compile. Automatic ontology design tuned to a specific customer domain is a direction, not a shipped capability, and is labelled as one below.",
} as const;
