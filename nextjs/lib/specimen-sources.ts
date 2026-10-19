import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";
import type { Bbox1000, SourceRights } from "./home-evidence-view";
import { isSourceRegionBox } from "./source-region-box";
import committedReceipts from "./specimen-sources.json";

/*
  P2-08 (UX-PLAN-2026-10-17 §3.4 and §8.2 UX-L4; PHASE1-CRITIC-2026-10-17 §3.2 and §5.4): the one
  contract for a Home specimen cell, and the loader that refuses anything short of it.

  The critic found two contracts -- UX's `lib/specimens.ts` with run fields and the specimen scout's
  `lib/specimen-sources.json` with source and rights fields -- and asked for one. This is the scout's
  receipt (`SourceRights`, the licence marking and its snapshot) with UX's run fields added
  (`extractedText`, `reader.imageDigest`, `runReceiptSha256`, `limitationTokens`), and two the critic
  added: the digest of the one-page extract the reader actually ran on (V22: the 92-page original
  is over the 80-page CDR ceiling), and the crop window, so the reader's region is drawn inside a
  window of the source rather than stretched to the slot's ratio.

  FAIL CLOSED. A receipt missing any field, or with a field that does not hold, is not rendered --
  that cell is dropped and the reason is logged; with no cell left the strip does not mount.

  P2-31/P2-32 (register D-03-D-06): two receipts are committed in `specimen-sources.json`, one
  degraded scan and one Korean page (D-04: no table cell until D-29), each read by the deployed OCR
  image on a one-page extract (run receipts under public/proof-collection/specimens/). They render
  only where `SPECIMEN_STRIP_ROLLOUT` lets them (see `specimenStripLive`). Production renders none.

  FIXTURES. The synthetic receipts in `e2e/fixtures/specimens/` render only on the local test
  server (`PLAYWRIGHT_LOCAL_HTTP=1`, which no deployment sets) and only for a request that asks for
  them with `SPECIMEN_FIXTURE_COOKIE`. They say `synthetic_fixture` and production refuses that
  word, so a fixture cannot become a specimen by being copied into the committed list either.
*/

export const SPECIMEN_SLOTS = ["degraded_scan", "table", "korean"] as const;
export type SpecimenSlot = (typeof SPECIMEN_SLOTS)[number];
export type SpecimenMode = "production" | "fixture";

export type SpecimenReceipt = {
  specimenId: string;
  slot: SpecimenSlot;
  documentId: string;
  title: string;
  /** The language of `extractedText`, printed as its `lang`. */
  lang: "en" | "ko";
  sourcePageUrl: string;
  sourceUrl: string;
  acquiredFrom: string;
  /** `page_extract`: the one-page PDF cut from the original that the reader ran on. */
  representationKind: "page_extract" | "synthetic_fixture";
  originalSha256: string;
  extractedPdfSha256: string;
  pageCount: number;
  /** The page in the original, not in the extract. */
  page: number;
  capturedOn: string;
  rights: SourceRights & {
    publication: "public_sample";
    licence: {
      id: string;
      markingScope: "item" | "site" | "site+statute";
      markingText: string;
      markingUrl: string;
      retrievedOn: string;
      snapshotSha256: string;
    };
  };
  mustNotImply: string[];
  /** D-06: a one-line source beside the crop, and the approved full line (§4.4) under "Show full text". */
  caption: Record<"en" | "ko", { short: string; full: string }>;
  /** D-05: what must stay out of the crop (insignia, symbols, third-party matter); the window may meet none. */
  avoidInCrop: { label: string; bbox1000: Bbox1000 }[];
  /** The reader's own region, as it returned it. Never widened to fit the crop. */
  region: { regionId: string; bbox1000: Bbox1000 };
  /** A window of the source page in the cell's ratio, holding the region. */
  crop: { path: string; sha256: string; width: number; height: number; bytes: number; window1000: Bbox1000 };
  /** The reader's output for the region, byte for byte: errors and spacing are not corrected. */
  extractedText: string;
  reader: { id: "foundation_ocr_gpu_v1"; imageDigest: string };
  runAt: string;
  runReceiptSha256: string;
  runReceiptUrl: string;
  /** Capability manifest tokens, printed through `capabilityTokenLabel`. */
  limitationTokens: string[];
};

export type Specimen = SpecimenReceipt & { cropSrc: string; synthetic: boolean };
export type SpecimenRejection = { id: string; reason: string };

/** The committed receipts (P2-32), read as untrusted until `specimenProblem` passes them. */
export const COMMITTED_SPECIMENS: readonly unknown[] = committedReceipts;

/*
  The rollout switch for the committed cells (P2-32). Code-owned: turning them on everywhere is a
  reviewed one-line change to "on", made after the founder has seen a preview deployment.

  "preview" (today): Vercel preview deployments render the committed cells, so the founder can see
  them live; Vercel production renders none, and neither does any other server -- except the
  Playwright test server for a request that asks with SPECIMEN_FIXTURE_COOKIE=committed. Both of
  Vercel's own variables must say so (VERCEL=1, VERCEL_ENV=preview): a missing one is not a preview,
  and the unit-test runner, which sets VERCEL_ENV=preview alone (vitest.config.ts), renders nothing.
*/
export const SPECIMEN_STRIP_ROLLOUT: "off" | "preview" | "on" = "preview";

export function specimenStripLive(
  env: Record<string, string | undefined> = process.env,
  rollout: "off" | "preview" | "on" = SPECIMEN_STRIP_ROLLOUT,
): boolean {
  return rollout === "on" || (rollout === "preview" && env.VERCEL === "1" && env.VERCEL_ENV === "preview");
}

/*
  The OCR images a production cell may name (SYNTHESIS-2026-10-19 §7: the check used to read the
  shape only). One digest: the deployed foundation-ocr-gpu image (RunPod cohlugjzf0dk9i, source
  aa6b85dd) that P2-31 ran on 2026-10-19. Another image joins this list with its own reader run.
*/
export const QUALIFIED_OCR_IMAGE_DIGESTS: readonly string[] = [
  "sha256:8e6f6fa777fd9949745ce67b25d04f0a1aa74dfbf791204baf2b6b16c3931bd8",
];

/** D-05 / SPECIMEN-CANDIDATES §0.1: the licences a production cell may carry. */
const PRODUCTION_LICENCES = new Set(["US-GOV-WORK", "KOGL-0", "KOGL-1"]);

export const SPECIMEN_FIXTURE_COOKIE = "tavonel.specimen-fixture";

/** UX §3.4: at most 45 KB a cell. */
export const MAX_CROP_BYTES = 45_000;

const SHA = /^sha256:[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const CROP_PATH: Record<SpecimenMode, RegExp> = {
  // P2-32: beside its extract and run receipt; public/landing/v2 is claimed file by file by its own manifest.
  production: /^\/proof-collection\/specimens\/[a-z0-9-]+\.(?:webp|avif)$/,
  fixture: /^fixture-[a-z0-9-]+\.svg$/,
};
const MARKING_SCOPES = new Set(["item", "site", "site+statute"]);
const PDF_LIMITATIONS = new Set<string>(
  CAPABILITY_MANIFEST.entries.find(entry => entry.mime === "application/pdf")?.knownLimitations ?? [],
);

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
// B-06: the calendar decides, not the shape. Date.parse rolls 2026-02-31 into March, and toISOString
// throws on an Invalid Date (readSpecimens does not catch), so NaN is filtered first and nothing throws.
const realDay = (value: unknown): boolean => {
  const time = DAY.test(String(value)) ? Date.parse(`${String(value)}T00:00:00Z`) : Number.NaN;
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const https = (value: unknown) => filled(value) && /^https:\/\/\S+$/.test(value);
const integerBox = (value: unknown): value is Bbox1000 =>
  Array.isArray(value) && value.every(Number.isInteger) && isSourceRegionBox(value);
const inside = (inner: Bbox1000, outer: Bbox1000) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
const meets = (a: Bbox1000, b: Bbox1000) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Why a receipt may not render, or null when every field holds. */
export function specimenProblem(raw: unknown, mode: SpecimenMode): string | null {
  const s = rec(raw);
  if (!s) return "the receipt is not an object";
  for (const key of ["specimenId", "documentId", "title", "acquiredFrom", "extractedText"]) {
    if (!filled(s[key])) return `${key} is empty`;
  }
  // The page parses CRLF as LF, so such a text could never be shown byte for byte.
  if ((s.extractedText as string).includes("\r")) return "extractedText holds a carriage return";
  if (!SPECIMEN_SLOTS.includes(s.slot as SpecimenSlot)) return `slot is not one of ${SPECIMEN_SLOTS.join(", ")}`;
  if (s.lang !== "en" && s.lang !== "ko") return "lang is not en or ko";
  if (s.slot === "korean" && s.lang !== "ko") return "the korean slot's text is not lang ko";
  if (!https(s.sourcePageUrl) || !https(s.sourceUrl)) return "a source URL is not https";
  // B-04: a site path is one slash then neither a slash nor a backslash; "//host" and "/\host" leave the site.
  if (!https(s.runReceiptUrl) && !(filled(s.runReceiptUrl) && /^\/(?![\/\\])\S+$/.test(s.runReceiptUrl))) {
    return "runReceiptUrl is neither https nor a site path";
  }
  const kind = mode === "fixture" ? "synthetic_fixture" : "page_extract";
  if (s.representationKind !== kind) return `representationKind is not ${kind} (${mode})`;
  for (const key of ["originalSha256", "extractedPdfSha256", "runReceiptSha256"]) {
    if (!SHA.test(String(s[key]))) return `${key} is not a sha256 digest`;
  }
  const pageCount = s.pageCount, page = s.page;
  if (!Number.isInteger(pageCount) || !Number.isInteger(page) || (page as number) < 1 || (page as number) > (pageCount as number)) {
    return "page is not a page of the original";
  }
  if (!realDay(s.capturedOn)) return "capturedOn is not a date";
  if (!INSTANT.test(String(s.runAt)) || Number.isNaN(Date.parse(String(s.runAt))) || !realDay(String(s.runAt).slice(0, 10))) return "runAt is not a UTC instant";

  const rights = rec(s.rights), licence = rec(rights?.licence);
  if (!rights || !licence) return "rights or rights.licence is missing";
  for (const key of ["basis", "jurisdiction", "attribution"]) if (!filled(rights[key])) return `rights.${key} is empty`;
  if (rights.publication !== "public_sample") return "rights.publication is not public_sample";
  for (const key of ["id", "markingText"]) if (!filled(licence[key])) return `rights.licence.${key} is empty`;
  // D-05: a board-level marking is not accepted for the strip; only one on the item or the site.
  if (!MARKING_SCOPES.has(String(licence.markingScope))) return "rights.licence.markingScope is not item, site or site+statute";
  if (!https(licence.markingUrl)) return "rights.licence.markingUrl is not https";
  if (!realDay(licence.retrievedOn)) return "rights.licence.retrievedOn is not a date";
  if (!SHA.test(String(licence.snapshotSha256))) return "rights.licence.snapshotSha256 is not a sha256 digest";
  if (mode === "production" && !PRODUCTION_LICENCES.has(String(licence.id))) return "rights.licence.id is not a licence the strip may show";
  const caption = rec(s.caption);
  for (const lang of ["en", "ko"]) {
    const line = rec(caption?.[lang]);
    if (!line || !filled(line.short) || !filled(line.full)) return `caption.${lang} is not a short and a full source line`;
  }
  if (!Array.isArray(s.mustNotImply) || s.mustNotImply.length === 0 || !s.mustNotImply.every(filled)) {
    return "mustNotImply is empty";
  }

  const region = rec(s.region), crop = rec(s.crop);
  if (!region || !filled(region.regionId) || !integerBox(region.bbox1000)) return "region is not a reader region";
  if (!crop) return "crop is missing";
  if (!CROP_PATH[mode].test(String(crop.path))) return `crop.path is not a ${mode} crop path`;
  if (!SHA.test(String(crop.sha256))) return "crop.sha256 is not a sha256 digest";
  for (const key of ["width", "height", "bytes"]) {
    if (!Number.isInteger(crop[key]) || (crop[key] as number) < 1) return `crop.${key} is not a positive integer`;
  }
  if ((crop.bytes as number) > MAX_CROP_BYTES) return `crop is over ${MAX_CROP_BYTES} bytes`;
  if (!integerBox(crop.window1000)) return "crop.window1000 is not a region box";
  if (!inside(region.bbox1000, crop.window1000)) return "the reader region is not inside the crop window";
  const avoid = s.avoidInCrop;
  if (!Array.isArray(avoid) || !avoid.every(item => filled(rec(item)?.label) && integerBox(rec(item)?.bbox1000))) {
    return "avoidInCrop is not a list of labelled boxes";
  }
  if (mode === "production" && avoid.length === 0) return "avoidInCrop is empty";
  const met = (avoid as { label: string; bbox1000: Bbox1000 }[]).find(item => meets(item.bbox1000, crop.window1000 as Bbox1000));
  if (met) return `the crop window meets ${met.label}`;

  const reader = rec(s.reader);
  if (reader?.id !== "foundation_ocr_gpu_v1" || !SHA.test(String(reader.imageDigest))) return "reader is not the pinned OCR image";
  if (mode === "production" && !QUALIFIED_OCR_IMAGE_DIGESTS.includes(String(reader.imageDigest))) {
    return "reader.imageDigest is not a qualified OCR image";
  }
  const tokens = s.limitationTokens;
  if (!Array.isArray(tokens) || !tokens.every(token => typeof token === "string" && PDF_LIMITATIONS.has(token))) {
    return "a limitation token is not one the PDF manifest entry carries";
  }
  // The table cell shows a page with a table, and the reader returns its lines, never its cells.
  if (s.slot === "table" && !tokens.includes("no_table_or_formula_extraction")) {
    return "the table slot does not carry no_table_or_formula_extraction";
  }
  return null;
}

/** Why a crop file is not the one its receipt names, or null. */
export function cropDigestProblem(receipt: Pick<SpecimenReceipt, "crop">, bytes: Uint8Array): string | null {
  if (bytes.length !== receipt.crop.bytes) return `crop is ${bytes.length} bytes, the receipt says ${receipt.crop.bytes}`;
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return digest === receipt.crop.sha256 ? null : `crop digest ${digest} is not the receipt's ${receipt.crop.sha256}`;
}

/**
 * The cells that may render, in slot order, one per slot; and every receipt refused, with why.
 *
 * `cropBytes` is given for fixtures, whose crops are read here and inlined. A committed crop is a
 * public file the server function cannot read, so `specimen-sources.test.ts` checks its bytes.
 */
export function readSpecimens(
  raws: readonly unknown[],
  mode: SpecimenMode,
  cropBytes?: (path: string) => Uint8Array,
): { specimens: Specimen[]; rejected: SpecimenRejection[] } {
  const specimens: Specimen[] = [];
  const rejected: SpecimenRejection[] = [];
  for (const raw of raws) {
    const id = String(rec(raw)?.specimenId ?? "(no specimenId)");
    let reason = specimenProblem(raw, mode);
    const receipt = raw as SpecimenReceipt;
    let cropSrc = receipt.crop?.path;
    if (!reason && cropBytes) {
      try {
        const bytes = cropBytes(receipt.crop.path);
        reason = cropDigestProblem(receipt, bytes);
        cropSrc = `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
      } catch (error) {
        reason = `crop could not be read: ${(error as Error).message}`;
      }
    }
    if (!reason && specimens.some(cell => cell.slot === receipt.slot)) reason = `a second receipt for slot ${receipt.slot}`;
    if (reason) rejected.push({ id, reason });
    else specimens.push({ ...receipt, cropSrc, synthetic: receipt.representationKind === "synthetic_fixture" });
  }
  specimens.sort((a, b) => SPECIMEN_SLOTS.indexOf(a.slot) - SPECIMEN_SLOTS.indexOf(b.slot));
  return { specimens, rejected };
}

/** The local Playwright server, which no deployment is. */
export function isFixtureServer(env: Record<string, string | undefined> = process.env): boolean {
  return env.PLAYWRIGHT_LOCAL_HTTP === "1" && !env.VERCEL;
}

/*
  The fixture folder is joined to a root passed in, never to `process.cwd()` in place. Next traces
  every file a server module may read into the deployed function (@vercel/nft), and a path built
  from `process.cwd()` in the same expression is one it can follow: the first build of this lane
  traced 1,791 files into the Home function that way, every e2e spec and fixture among them. A root
  that arrives as an argument is one it cannot: the same build then traces 24 files and none under
  e2e/, so no fixture is packaged with a deployment.
*/
function readFixtureSpecimens(root: string) {
  const dir = join(root, "e2e", "fixtures", "specimens");
  const receipts = readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .sort()
    .map(name => JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown);
  return readSpecimens(receipts, "fixture", path => readFileSync(join(dir, path)));
}

/**
 * The specimen cells Home renders for this request. Refusals are logged, never silent.
 * `fixtures` and `committed` are what the request asked for with SPECIMEN_FIXTURE_COOKIE ("1" and
 * "committed"); only the local test server honours either.
 */
export function homeSpecimens(
  { fixtures = false, committed = false }: { fixtures?: boolean; committed?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
): Specimen[] {
  let result: ReturnType<typeof readSpecimens>;
  if (fixtures && isFixtureServer(env)) {
    try {
      result = readFixtureSpecimens(process.cwd());
    } catch (error) {
      console.error("[TAVONEL] specimen fixtures could not be read; none render", error);
      return [];
    }
  } else if (specimenStripLive(env) || (committed && isFixtureServer(env))) {
    result = readSpecimens(COMMITTED_SPECIMENS, "production");
  } else {
    return [];
  }
  for (const { id, reason } of result.rejected) console.error(`[TAVONEL] specimen ${id} is not rendered: ${reason}`);
  return result.specimens;
}
