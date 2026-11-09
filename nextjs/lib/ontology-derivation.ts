import { createHash } from "node:crypto";

/*
  C1 (PROGRAM-2026-11-04 §4.C): schema derivation -- the "derive" of derive -> certify -> use.

  One deriver ships here, the deterministic baseline (`deriveBaselineSchema`): no model, no prompt,
  no network. It reads capitalised multi-word names in the evidence units, groups them by their last
  word ("The Nasdaq Stock Market" -> Market), and proposes a class for a head word with enough
  distinct names; it proposes a property for a short lower-case phrase that joins two such names in
  one unit ("... Inc. is listed on The Nasdaq Stock Market" -> listed_on, Organization -> Market).
  It is the floor any model-backed deriver has to beat, measured the same way. A model-backed
  deriver is not part of this repository; the store accepts one only with a prompt digest pinned.

  Every derivation is checked by one deterministic rule before anything is stored (§4.C step 2): every
  evidence quote must occur verbatim in the unit it names, on that unit's document, page and box.
  A quote that does not is dropped and counted; a candidate left without evidence is dropped. No
  text, page or box is invented to fill a gap.

  Nothing here certifies anything. Candidates leave this module `proposed` by construction: there is
  no state field on them at all, and the database writes `proposed` whatever it is sent.

  No relative imports, on purpose: `scripts/ontology-derivation-arena.mjs` runs this file under
  `node --experimental-strip-types`.
*/

export type EvidenceUnit = Readonly<{
  evidenceId: string;
  documentId: string;
  page: number;
  bbox: readonly [number, number, number, number];
  text: string;
}>;

export type CandidateEvidence = {
  evidenceId: string;
  documentId: string;
  page: number;
  bbox: [number, number, number, number];
  quote: string;
};

export type SchemaCandidate = {
  kind: "class" | "property";
  key: string;
  label: string;
  description: string;
  domainKey?: string;
  rangeKey?: string;
  /** Internal only: how many mentions backed the candidate. Never in a public DTO. */
  support: number;
  evidence: CandidateEvidence[];
};

export type DerivationReceipt = {
  schema: "tavonel.ontology_derivation_receipt.v1";
  deriver: "baseline" | "model";
  deriverVersion: string;
  modelId: string;
  modelRevision: string;
  promptSha256: string | null;
  schemaSha256: string;
  priceSnapshot: Record<string, string | number>;
  inputsSha256: string;
  outputSha256: string;
  units: number;
  documents: number;
  classes: number;
  properties: number;
  droppedEvidence: number;
  droppedCandidates: number;
};

export type Derivation = { receipt: DerivationReceipt; receiptSha256: string; candidates: SchemaCandidate[] };

export const BASELINE_DERIVER_VERSION = "baseline-frequency:1";
export const BASELINE_MODEL_ID = "tavonel:ontology-baseline-frequency";
export const MAX_CLASSES = 25;
export const MAX_PROPERTIES = 40;
const MAX_EVIDENCE = 3;
const MAX_QUOTE = 300;

/** The output contract a derivation meets; its digest is the run's schema_sha256. */
export const CANDIDATE_OUTPUT_SCHEMA = Object.freeze({
  $id: "tavonel.ontology_candidates.output.v1",
  type: "array",
  maxItems: MAX_CLASSES + MAX_PROPERTIES,
  items: {
    type: "object",
    required: ["kind", "key", "label", "description", "support", "evidence"],
    properties: {
      kind: { enum: ["class", "property"] },
      key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
      label: { type: "string", minLength: 1, maxLength: 120 },
      description: { type: "string", maxLength: 600 },
      domainKey: { type: "string" },
      rangeKey: { type: "string" },
      support: { type: "integer", minimum: 1 },
      evidence: {
        type: "array", minItems: 1, maxItems: MAX_EVIDENCE,
        items: { type: "object", required: ["evidenceId", "documentId", "page", "bbox", "quote"] },
      },
    },
  },
});

/** Sorted-key JSON, so a digest does not depend on insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Of(value: unknown): string {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex")}`;
}

/** The digest of what a deriver read: units sorted by id, so input order cannot change a run. */
export function inputsDigest(units: readonly EvidenceUnit[]): string {
  return sha256Of([...units].sort((a, b) => cmp(a.evidenceId, b.evidenceId))
    .map(({ evidenceId, documentId, page, bbox, text }) => ({ evidenceId, documentId, page, bbox: [...bbox], text })));
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ----------------------------------------------------------------------------- the shared check */

/**
 * §4.C step 2: an evidence item stands only if its quote is in the named unit's text, verbatim,
 * and its document, page and box are that unit's. Returns the evidence that stands.
 */
export function verifiedEvidence(evidence: readonly CandidateEvidence[], units: ReadonlyMap<string, EvidenceUnit>) {
  return evidence.filter((item) => {
    const unit = units.get(item.evidenceId);
    return Boolean(unit) && item.quote.length > 0 && item.quote.length <= MAX_QUOTE && unit!.text.includes(item.quote)
      && unit!.documentId === item.documentId && unit!.page === item.page
      && unit!.bbox.every((value, index) => value === item.bbox[index]);
  });
}

function evidenceFrom(unit: EvidenceUnit, quote: string): CandidateEvidence {
  return { evidenceId: unit.evidenceId, documentId: unit.documentId, page: unit.page, bbox: [...unit.bbox] as CandidateEvidence["bbox"], quote };
}

/* ------------------------------------------------------------------------------- the baseline */

type Mention = { unit: EvidenceUnit; start: number; end: number; name: string; head: string };

const TOKEN = /[A-Za-z][A-Za-z0-9.&'’-]*/g;
const CONNECTORS = new Set(["of", "and", "for", "&"]);
// Heads that name a time, a place in the document or a filing artefact rather than a kind of thing.
const HEAD_STOP = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
  "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "item", "part", "page",
  "table", "contents", "section", "note", "exhibit", "form", "index", "the", "a", "an", "inc", "llc", "ltd", "co",
  "for", "to", "in", "on", "at", "by", "with", "from", "as", "or", "and", "of", "per", "our", "its", "this", "that",
]);
const ORGANIZATION_SUFFIX = new Set(["inc", "inc.", "llc", "ltd", "ltd.", "corporation", "corp", "corp.", "plc", "n.a.", "co.", "company"]);
const AUXILIARIES = new Set(["is", "are", "was", "were", "be", "been", "being", "the", "a", "an", "its", "their", "has", "have", "had"]);
const GENERIC_PREDICATE = new Set(["and", "or", "of", "for", "to", "in", "on", "at", "by", "with", "from", "as", "nor"]);
// ponytail: naive capitalisation heuristic, English only; a Korean corpus needs its own baseline (§4.C risk).
const MIN_DISTINCT_NAMES = 3;
const MIN_PROPERTY_UNITS = 2;
const MAX_GAP_CHARS = 40;

function headOf(token: string): string | null {
  const lower = token.toLowerCase().replace(/[.’']+$/g, "");
  if (ORGANIZATION_SUFFIX.has(token.toLowerCase()) || ORGANIZATION_SUFFIX.has(lower)) return "organization";
  // An all-capitals token is an acronym or a shouted heading, not a kind of thing.
  if (!/^[a-z][a-z-]*$/.test(lower) || lower.length < 3 || HEAD_STOP.has(lower) || token === token.toUpperCase()) return null;
  // ponytail: plural folding by suffix only ("Notes" -> note); irregular plurals stay distinct.
  if (lower.length > 4 && lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}

function mentionsIn(unit: EvidenceUnit): Mention[] {
  const tokens = [...unit.text.matchAll(TOKEN)].map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
  const mentions: Mention[] = [];
  let index = 0;
  while (index < tokens.length) {
    if (!/^[A-Z]/.test(tokens[index]!.text)) { index += 1; continue; }
    let last = index;
    let next = index + 1;
    while (next < tokens.length) {
      const gap = unit.text.slice(tokens[next - 1]!.end, tokens[next]!.start);
      if (!/^[ \t]{1,2}$/.test(gap)) break;
      if (/^[A-Z]/.test(tokens[next]!.text)) { last = next; next += 1; continue; }
      if (CONNECTORS.has(tokens[next]!.text) && next + 1 < tokens.length && /^[A-Z]/.test(tokens[next + 1]!.text)) { next += 1; continue; }
      break;
    }
    let first = index;
    if (tokens[first]!.text === "The" && last > first) first += 1;
    const capitalised = tokens.slice(first, last + 1).filter((token) => /^[A-Z]/.test(token.text)).length;
    const head = headOf(tokens[last]!.text);
    if (capitalised >= 2 && head) {
      const start = tokens[first]!.start;
      const end = tokens[last]!.end;
      mentions.push({ unit, start, end, name: unit.text.slice(start, end), head });
    }
    index = last + 1;
  }
  return mentions;
}

function titleCase(key: string) {
  return key.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

/** A verbatim window round [start, end) in the unit text, cut at spaces, at most MAX_QUOTE chars. */
function quoteAround(text: string, start: number, end: number): string {
  let from = Math.max(0, start - 60);
  let to = Math.min(text.length, end + 60);
  if (from > 0) { const space = text.indexOf(" ", from); if (space !== -1 && space < start) from = space + 1; }
  if (to < text.length) { const space = text.lastIndexOf(" ", to); if (space > end) to = space; }
  const quote = text.slice(from, to).trim();
  return quote.length <= MAX_QUOTE ? quote : text.slice(start, Math.min(end, start + MAX_QUOTE));
}

export function deriveBaselineSchema(input: readonly EvidenceUnit[]): Derivation {
  const units = [...input].sort((a, b) => cmp(a.evidenceId, b.evidenceId));
  const mentions = units.flatMap(mentionsIn);

  // Classes: a head word with enough distinct names.
  const byHead = new Map<string, Map<string, Mention[]>>();
  for (const mention of mentions) {
    const names = byHead.get(mention.head) ?? new Map<string, Mention[]>();
    names.set(mention.name, [...(names.get(mention.name) ?? []), mention]);
    byHead.set(mention.head, names);
  }
  const classes: SchemaCandidate[] = [...byHead.entries()]
    .filter(([, names]) => names.size >= MIN_DISTINCT_NAMES)
    .map(([head, names]) => {
      const ranked = [...names.entries()].sort((a, b) => b[1].length - a[1].length || cmp(a[0], b[0]));
      const examples = ranked.slice(0, MAX_EVIDENCE).map(([name]) => `“${name}”`).join(", ");
      return {
        kind: "class" as const,
        key: head.replace(/-/g, "_").slice(0, 64),
        label: titleCase(head.replace(/-/g, "_")),
        description: `Names in the sources that end in “${titleCase(head)}”, such as ${examples}.`,
        support: ranked.reduce((sum, [, list]) => sum + list.length, 0),
        evidence: ranked.slice(0, MAX_EVIDENCE).map(([, list]) => {
          const first = list[0]!;
          return evidenceFrom(first.unit, quoteAround(first.unit.text, first.start, first.end));
        }),
        distinct: names.size,
      };
    })
    .sort((a, b) => b.distinct - a.distinct || b.support - a.support || cmp(a.key, b.key))
    .slice(0, MAX_CLASSES)
    .map(({ distinct: _distinct, ...candidate }) => candidate);
  const classKeys = new Set(classes.map((candidate) => candidate.key));

  // Properties: a short lower-case phrase joining two class names inside one unit.
  const byPredicate = new Map<string, { domain: string; range: string; predicate: string; hits: Array<{ unit: EvidenceUnit; start: number; end: number }> }>();
  const byUnit = new Map<string, Mention[]>();
  for (const mention of mentions) byUnit.set(mention.unit.evidenceId, [...(byUnit.get(mention.unit.evidenceId) ?? []), mention]);
  for (const list of byUnit.values()) {
    for (let index = 0; index + 1 < list.length; index += 1) {
      const left = list[index]!;
      const right = list[index + 1]!;
      const domain = left.head.replace(/-/g, "_");
      const range = right.head.replace(/-/g, "_");
      if (!classKeys.has(domain) || !classKeys.has(range)) continue;
      const gap = left.unit.text.slice(left.end, right.start);
      if (gap.length > MAX_GAP_CHARS || !/^\s+[a-z]+(?:\s+[a-z]+){0,3}\s+(?:[Tt]he\s+)?$/.test(gap)) continue;
      const words = gap.trim().toLowerCase().split(/\s+/).filter((word) => !AUXILIARIES.has(word));
      if (words.length === 0 || (words.length === 1 && GENERIC_PREDICATE.has(words[0]!))) continue;
      const predicate = words.join("_");
      const key = `${domain}_${predicate}_${range}`.slice(0, 64);
      const entry = byPredicate.get(key) ?? { domain, range, predicate, hits: [] };
      entry.hits.push({ unit: left.unit, start: left.start, end: right.end });
      byPredicate.set(key, entry);
    }
  }
  const properties: SchemaCandidate[] = [...byPredicate.entries()]
    .map(([key, entry]) => ({ key, entry, units: new Set(entry.hits.map((hit) => hit.unit.evidenceId)).size }))
    .filter(({ units: count }) => count >= MIN_PROPERTY_UNITS)
    .sort((a, b) => b.units - a.units || b.entry.hits.length - a.entry.hits.length || cmp(a.key, b.key))
    .slice(0, MAX_PROPERTIES)
    .map(({ key, entry }) => {
      const seen = new Set<string>();
      const evidence = entry.hits.filter((hit) => !seen.has(hit.unit.evidenceId) && seen.add(hit.unit.evidenceId))
        .slice(0, MAX_EVIDENCE).map((hit) => evidenceFrom(hit.unit, quoteAround(hit.unit.text, hit.start, hit.end)));
      const phrase = entry.predicate.replace(/_/g, " ");
      return {
        kind: "property" as const,
        key,
        label: phrase,
        description: `${titleCase(entry.domain)} “${phrase}” ${titleCase(entry.range)}, as joined in one sentence of the sources.`,
        domainKey: entry.domain,
        rangeKey: entry.range,
        support: entry.hits.length,
        evidence,
      };
    });

  return finish({
    deriver: "baseline",
    deriverVersion: BASELINE_DERIVER_VERSION,
    modelId: BASELINE_MODEL_ID,
    modelRevision: "1",
    promptSha256: null,
    priceSnapshot: { usd: 0, basis: "deterministic code in this repository; no model call" },
  }, units, [...classes, ...properties], 0, 0);
}

function finish(
  pins: Pick<DerivationReceipt, "deriver" | "deriverVersion" | "modelId" | "modelRevision" | "promptSha256" | "priceSnapshot">
    & { schemaSha256?: string },
  units: readonly EvidenceUnit[],
  proposed: SchemaCandidate[],
  droppedEvidence: number,
  droppedCandidates: number,
): Derivation {
  const index = new Map(units.map((unit) => [unit.evidenceId, unit]));
  let dropped = droppedEvidence;
  let droppedWhole = droppedCandidates;
  const candidates: SchemaCandidate[] = [];
  for (const candidate of proposed) {
    const evidence = verifiedEvidence(candidate.evidence, index);
    dropped += candidate.evidence.length - evidence.length;
    if (evidence.length === 0) { droppedWhole += 1; continue; }
    candidates.push({ ...candidate, evidence });
  }
  const receipt: DerivationReceipt = {
    schema: "tavonel.ontology_derivation_receipt.v1",
    ...pins,
    schemaSha256: pins.schemaSha256 ?? sha256Of(CANDIDATE_OUTPUT_SCHEMA),
    inputsSha256: inputsDigest(units),
    outputSha256: sha256Of(candidates),
    units: units.length,
    documents: new Set(units.map((unit) => unit.documentId)).size,
    classes: candidates.filter((candidate) => candidate.kind === "class").length,
    properties: candidates.filter((candidate) => candidate.kind === "property").length,
    droppedEvidence: dropped,
    droppedCandidates: droppedWhole,
  };
  return { receipt, receiptSha256: sha256Of(receipt), candidates };
}
