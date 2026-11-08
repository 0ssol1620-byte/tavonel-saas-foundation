#!/usr/bin/env node
/**
 * Generate the E1 numeric and unanswerable question sets from SEC 10-K XBRL facts.
 *
 *   TAVONEL_SEC_USER_AGENT="<organisation> <contact email>" \
 *     node eval/ask-quality/gen_xbrl_questions.mjs            # fetch what is not cached, then build
 *   node eval/ask-quality/gen_xbrl_questions.mjs --offline   # build from eval/ask-quality/cache only
 *
 * SEC fair-access policy requires a User-Agent that names the requester and a contact. There is no
 * default: an unset TAVONEL_SEC_USER_AGENT stops the run before any request is made (the same
 * variable research/tavonel_recovery_eval_v1 uses). Requests are spaced 250 ms apart, well under the
 * 10/s ceiling, and every response is cached under cache/ (git-ignored), so a rebuild sends nothing.
 *
 * The matching rule is masterplan v4 §16.4: XBRL is a ground-truth CANDIDATE, and only after the
 * filing's own context, unit and period are matched exactly. So a companyfacts value becomes a
 * question only when the filing's inline XBRL carries a VISIBLE fact with the same concept, a
 * non-dimensional context with the same period, the same unit, and the same scaled value. The span
 * the reader would see (`displayText`, with `htmlCharOffset`, its UTF-16 code-unit index in the
 * decoded filing -- not a byte offset) is what citation
 * precision is scored against. A fact we cannot find in the document is dropped and counted, never
 * reconstructed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, "cache");
const OUT = path.join(HERE, "questions");

/** Pinned filings. Changing this list changes the question-set sha256 and needs a new PREREG. */
export const FILERS = [
  { cik: "0000021344", filings: ["0001628280-26-010047", "0000021344-25-000011"] }, // Coca-Cola
  { cik: "0000200406", filings: ["0000200406-26-000016", "0000200406-25-000038"] }, // Johnson & Johnson
  { cik: "0000789019", filings: ["0001193125-26-323660", "0000950170-25-100235"] }, // Microsoft
  { cik: "0000080424", filings: ["0000080424-26-000103", "0000080424-25-000076"] }, // Procter & Gamble
];

export const RULES = {
  taxonomy: "us-gaap",
  units: ["USD", "USD/shares", "shares"],
  // Fiscal-year durations: 52/53-week years run 364 or 371 days.
  durationDays: [350, 380],
  perFilingCap: 50,
  // A span with fewer digits ("5", "12") is found by accident in any excerpt; it cannot score citations.
  minSpanDigits: 3,
  crossCompanyPerPair: 10,
  otherYearPerFiler: 10,
  otherYearOffsetBelowEarliestTaggedYear: 5,
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- inline XBRL parsing (pure)

const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
function attributes(source) {
  const out = {};
  for (const match of source.matchAll(ATTR)) out[match[1]] = match[2];
  return out;
}

const ENTITIES = { "&nbsp;": " ", "&#160;": " ", "&#xa0;": " ", "&amp;": "&", "&#8212;": "—", "&mdash;": "—", "&#8211;": "–" };
export function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;|&amp;|&#8212;|&mdash;|&#8211;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

const localName = (measure) => measure.trim().split(":").pop();

/**
 * Contexts, units and visible numeric facts of one inline XBRL document.
 * A fact inside <ix:header> is hidden (no reader ever sees it) and is marked so.
 */
export function parseInlineXbrl(html) {
  const contexts = new Map();
  for (const match of html.matchAll(/<(?:[\w-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const id = attributes(match[1]).id;
    const body = match[2];
    const pick = (tag) => body.match(new RegExp(`<(?:[\\w-]+:)?${tag}>\\s*([^<\\s]+)\\s*<`))?.[1] ?? null;
    contexts.set(id, {
      dimensional: /<(?:[\w-]+:)?(?:explicitMember|typedMember)\b/.test(body),
      start: pick("startDate"),
      end: pick("endDate"),
      instant: pick("instant"),
    });
  }
  const units = new Map();
  for (const match of html.matchAll(/<(?:[\w-]+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?unit>/g)) {
    const id = attributes(match[1]).id;
    const measures = [...match[2].matchAll(/<(?:[\w-]+:)?measure>([^<]+)</g)].map((m) => localName(m[1]));
    units.set(id, measures.join("/"));
  }
  const headerStart = html.indexOf("<ix:header>");
  const headerEnd = html.indexOf("</ix:header>");
  const facts = [];
  for (const match of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    // A nested nonFraction would make this lazy match end early; skip it rather than mis-read it.
    if (match[2].includes("<ix:nonFraction")) continue;
    const attrs = attributes(match[1]);
    const offset = match.index;
    facts.push({
      id: attrs.id ?? null,
      name: attrs.name,
      contextRef: attrs.contextRef,
      unitRef: attrs.unitRef ?? null,
      decimals: attrs.decimals ?? null,
      scale: Number(attrs.scale ?? "0"),
      sign: attrs.sign ?? null,
      format: attrs.format ?? null,
      displayText: stripTags(match[2]),
      offset,
      end: offset + match[0].length,
      hidden: headerStart >= 0 && offset > headerStart && offset < headerEnd,
    });
  }
  return { contexts, units, facts };
}

/** The value a fact asserts: its displayed digits, times 10^scale, with its sign. `null` if unreadable. */
export function ixValue(fact) {
  const text = fact.displayText;
  const format = fact.format ?? "";
  let magnitude;
  if (/zero/i.test(format) || /^[—–-]$/.test(text)) magnitude = 0;
  else {
    let cleaned = text.replace(/[^\d.,]/g, "");
    cleaned = /comma-?decimal|numcommadecimal/i.test(format)
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    // Parsing "47061e6" is exact; multiplying 47061 by 1e6 in floating point need not be.
    magnitude = Number(`${cleaned}e${fact.scale}`);
  }
  return fact.sign === "-" ? -magnitude : magnitude;
}

const digitCount = (text) => (text.match(/\d/g) ?? []).length;

/**
 * The visible spans in `parsed` that state the companyfacts fact `cf` (concept, unit, period, value).
 * Period: a duration fact needs a context with the same start and end; an instant fact (no `start`)
 * needs a context whose instant equals `end`. A dimensional context (a segment) never matches.
 */
export function matchSpans(cf, concept, unit, parsed) {
  return parsed.facts.filter((fact) => {
    if (fact.hidden || fact.name !== concept) return false;
    const context = parsed.contexts.get(fact.contextRef);
    if (!context || context.dimensional) return false;
    const samePeriod = cf.start
      ? context.start === cf.start && context.end === cf.end
      : context.instant === cf.end && context.start === null;
    if (!samePeriod) return false;
    if (parsed.units.get(fact.unitRef) !== unit) return false;
    const value = ixValue(fact);
    return value !== null && Math.abs(value - cf.val) <= 1e-9 * Math.max(1, Math.abs(cf.val));
  });
}

/** Every calendar year a non-dimensional context in this document touches. */
export function taggedYears(parsed) {
  const years = new Set();
  for (const context of parsed.contexts.values()) {
    if (context.dimensional) continue;
    for (const date of [context.start, context.end, context.instant]) if (date) years.add(Number(date.slice(0, 4)));
  }
  return years;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function longDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

const UNIT_PHRASE = { USD: "in US dollars", "USD/shares": "in US dollars per share", shares: "in shares" };
export function questionText(entityName, label, unit, period) {
  const when = period.start ? `for the fiscal year ended ${longDate(period.end)}` : `as of ${longDate(period.end)}`;
  return `What was ${entityName}'s ${label} ${when}, ${UNIT_PHRASE[unit]}?`;
}

const daysBetween = (start, end) => (Date.parse(end) - Date.parse(start)) / 86_400_000;

/** Nearest preceding "Item N." heading, read from the raw HTML. A heuristic, and labelled as one. */
function itemHeadingIndex(html) {
  const headings = [];
  for (const match of html.matchAll(/>\s*(Item(?:\s|&#160;|&nbsp;| )*\d{1,2}[A-C]?\.[^<]{0,80})</gi)) {
    headings.push({ offset: match.index, text: stripTags(match[1]) });
  }
  return (offset) => {
    let found = null;
    for (const heading of headings) {
      if (heading.offset > offset) break;
      found = heading.text;
    }
    return found;
  };
}

/**
 * Numeric questions for one filing. Pure over its inputs; `stats` counts every drop by reason.
 */
export function buildFilingQuestions({ cik, entityName, filing, companyfacts, html, rules = RULES }) {
  const parsed = parseInlineXbrl(html);
  const headingAt = itemHeadingIndex(html);
  const stats = { candidates: 0, droppedNoVisibleSpan: 0, droppedZero: 0, droppedShortSpan: 0, droppedAmbiguous: 0, sampledOut: 0, kept: 0 };
  const seen = new Set();
  const built = [];
  const concepts = companyfacts.facts?.[rules.taxonomy] ?? {};
  for (const [name, concept] of Object.entries(concepts)) {
    if (!concept.label) continue;
    for (const unit of rules.units) {
      for (const cf of concept.units?.[unit] ?? []) {
        if (cf.accn !== filing.accession || cf.form !== "10-K" || cf.end !== filing.reportDate) continue;
        if (cf.start) {
          const days = daysBetween(cf.start, cf.end);
          if (days < rules.durationDays[0] || days > rules.durationDays[1]) continue;
        }
        const key = `${name}|${unit}|${cf.start ?? ""}|${cf.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stats.candidates += 1;
        if (cf.val === 0) { stats.droppedZero += 1; continue; }
        const spans = matchSpans(cf, `${rules.taxonomy}:${name}`, unit, parsed);
        if (spans.length === 0) { stats.droppedNoVisibleSpan += 1; continue; }
        const displayTexts = [...new Set(spans.map((span) => span.displayText))];
        if (displayTexts.every((text) => digitCount(text) < rules.minSpanDigits)) { stats.droppedShortSpan += 1; continue; }
        const period = cf.start ? { start: cf.start, end: cf.end } : { end: cf.end };
        const decimals = spans[0].decimals === null || spans[0].decimals === "INF" ? null : Number(spans[0].decimals);
        built.push({
          key: sha256(`${filing.accession}|${key}`),
          question: questionText(entityName, concept.label, unit, period),
          gold: { numeric: { value: cf.val, unit, decimals }, spans: displayTexts.filter((text) => digitCount(text) >= rules.minSpanDigits) },
          provenance: {
            cik, entityName, form: cf.form, accession: cf.accn, filed: cf.filed, fy: cf.fy, fp: cf.fp, frame: cf.frame ?? null,
            concept: `${rules.taxonomy}:${name}`, label: concept.label, unit, period,
            documentUrl: filing.url, documentSha256: filing.sha256,
            spans: spans.map((span) => ({
              factId: span.id, contextRef: span.contextRef, unitRef: span.unitRef, decimals: span.decimals, scale: span.scale,
              // UTF-16 code-unit index into the UTF-8-decoded HTML (String index), not a byte offset.
              htmlCharOffset: span.offset, displayText: span.displayText,
              // Cut at tag boundaries so a half-sliced tag never leaks markup into the reading context.
              before: stripTags(html.slice(Math.max(0, span.offset - 2000), span.offset).replace(/^[^<]*>/, "")).slice(-120),
              after: stripTags(html.slice(span.end, span.end + 2000).replace(/<[^>]*$/, "")).slice(0, 120),
              itemHeadingHeuristic: headingAt(span.offset),
            })),
          },
        });
      }
    }
  }
  // Two facts that render as the same question with different values cannot both be gold.
  const byText = new Map();
  for (const item of built) byText.set(item.question, [...(byText.get(item.question) ?? []), item]);
  const unambiguous = [];
  for (const group of byText.values()) {
    if (new Set(group.map((item) => `${item.gold.numeric.value}|${item.gold.numeric.unit}`)).size > 1) stats.droppedAmbiguous += group.length;
    else unambiguous.push(group[0]);
  }
  // Deterministic sample: order by a hash of the fact, not by concept name, so the cap is not alphabetical.
  unambiguous.sort((left, right) => left.key.localeCompare(right.key));
  const kept = unambiguous.slice(0, rules.perFilingCap);
  stats.sampledOut = unambiguous.length - kept.length;
  stats.kept = kept.length;
  return { questions: kept, stats, taggedYears: taggedYears(parsed) };
}

/** Calibration / holdout, fixed by the id so E2 never tunes and judges on the same questions. */
export const splitOf = (id) => (parseInt(sha256(id).slice(0, 8), 16) % 2 === 0 ? "calibration" : "holdout");

/**
 * Unanswerable questions, by two pre-registered rules:
 *   OTHER_COMPANY  filer B's numeric question asked of filer A's corpus (A ≠ B), first k per pair.
 *   OTHER_YEAR     filer A's numeric question asked of a fiscal year Y = (earliest year any
 *                  non-dimensional context in A's corpus touches) − offset, first k per filer. The
 *                  period is A's REAL fiscal year from companyfacts (an annual 10-K duration whose end
 *                  is nearest the source's month/day in Y), never a date shifted by whole years:
 *                  52/53-week filers end on a different day each year (review R1 m3).
 */
export function fiscalYearPeriods(companyfacts, rules = RULES) {
  const periods = new Map();
  for (const concept of Object.values(companyfacts.facts?.[rules.taxonomy] ?? {})) {
    for (const entries of Object.values(concept.units ?? {})) {
      for (const cf of entries) {
        if (cf.form !== "10-K" || !cf.start) continue;
        const days = daysBetween(cf.start, cf.end);
        if (days >= rules.durationDays[0] && days <= rules.durationDays[1]) periods.set(`${cf.start}|${cf.end}`, { start: cf.start, end: cf.end });
      }
    }
  }
  return [...periods.values()].sort((left, right) => left.end.localeCompare(right.end));
}

export function buildUnanswerable(byFiler, rules = RULES) {
  const out = [];
  for (const target of byFiler) {
    for (const other of byFiler) {
      if (other.cik === target.cik) continue;
      for (const source of other.questions.slice(0, rules.crossCompanyPerPair)) {
        const id = `unans-co-${target.cik.slice(-6)}-${source.id}`;
        out.push({
          id, set: "unanswerable", kind: "unanswerable", answerType: "numeric", split: splitOf(id),
          corpusRef: `sec-10k:${target.cik}`, question: source.question, gold: null,
          generation: { rule: "OTHER_COMPANY", sourceQuestionId: source.id, askedOfCik: target.cik, factBelongsToCik: other.cik },
        });
      }
    }
    const year = Math.min(...target.taggedYears) - rules.otherYearOffsetBelowEarliestTaggedYear;
    for (const source of target.questions.slice(0, rules.otherYearPerFiler)) {
      const anchor = Date.parse(`${year}${source.provenance.period.end.slice(4)}`);
      const nearest = [...target.fiscalYears].sort(
        (left, right) => Math.abs(Date.parse(left.end) - anchor) - Math.abs(Date.parse(right.end) - anchor) || left.end.localeCompare(right.end),
      )[0];
      if (!nearest || Math.abs(Date.parse(nearest.end) - anchor) > 10 * 86_400_000) {
        throw new Error(`${target.cik}: no reported fiscal year ends near ${year}${source.provenance.period.end.slice(4)}`);
      }
      const period = source.provenance.period.start ? { start: nearest.start, end: nearest.end } : { end: nearest.end };
      const id = `unans-yr-${source.id}`;
      out.push({
        id, set: "unanswerable", kind: "unanswerable", answerType: "numeric", split: splitOf(id),
        corpusRef: `sec-10k:${target.cik}`,
        question: questionText(source.provenance.entityName, source.provenance.label, source.provenance.unit, period),
        gold: null,
        generation: {
          rule: "OTHER_YEAR", sourceQuestionId: source.id, askedOfCik: target.cik, period,
          periodSource: "companyfacts annual 10-K duration nearest the anchor", earliestTaggedYear: Math.min(...target.taggedYears),
        },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- fetching (side effects)

async function cached(name, url, { offline, userAgent }) {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return readFileSync(file);
  if (offline) throw new Error(`--offline and ${name} is not cached`);
  await sleep(250);
  const response = await fetch(url, { headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate" } });
  if (!response.ok) throw new Error(`SEC ${response.status} for ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, body);
  return body;
}

async function main() {
  const offline = process.argv.includes("--offline");
  const userAgent = (process.env.TAVONEL_SEC_USER_AGENT ?? "").trim();
  if (!offline && !/\S+\s+\S+@\S+\.\S+/.test(userAgent)) {
    throw new Error("TAVONEL_SEC_USER_AGENT must name the requester and a contact email (SEC fair-access policy)");
  }
  const options = { offline, userAgent };
  const byFiler = [];
  const filerManifest = [];
  for (const filer of FILERS) {
    const submissionsBytes = await cached(`submissions-${filer.cik}.json`, `https://data.sec.gov/submissions/CIK${filer.cik}.json`, options);
    const companyfactsBytes = await cached(`companyfacts-${filer.cik}.json`, `https://data.sec.gov/api/xbrl/companyfacts/CIK${filer.cik}.json`, options);
    const submissions = JSON.parse(submissionsBytes);
    const companyfacts = JSON.parse(companyfactsBytes);
    const recent = submissions.filings.recent;
    const questions = [];
    const years = new Set();
    const filings = [];
    for (const accession of filer.filings) {
      const index = recent.accessionNumber.indexOf(accession);
      if (index < 0 || recent.form[index] !== "10-K") throw new Error(`${accession} is not a 10-K in ${filer.cik} submissions`);
      const primaryDocument = recent.primaryDocument[index];
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(filer.cik)}/${accession.replace(/-/g, "")}/${primaryDocument}`;
      const bytes = await cached(`${filer.cik}-${accession}-${primaryDocument}`, url, options);
      const filing = {
        accession, form: "10-K", reportDate: recent.reportDate[index], filed: recent.filingDate[index],
        primaryDocument, url, sha256: sha256(bytes), bytes: bytes.length,
      };
      const result = buildFilingQuestions({ cik: filer.cik, entityName: companyfacts.entityName, filing, companyfacts, html: bytes.toString("utf8") });
      for (const year of result.taggedYears) years.add(year);
      for (const item of result.questions) {
        const id = `xbrl-${filer.cik.slice(-6)}-${filing.reportDate.slice(0, 4)}-${item.key.slice(0, 10)}`;
        questions.push({
          id, set: "xbrl-numeric", kind: "answerable", answerType: "numeric", split: splitOf(id),
          corpusRef: `sec-10k:${filer.cik}`, question: item.question, gold: item.gold, provenance: item.provenance,
        });
      }
      filings.push({ ...filing, stats: result.stats });
    }
    byFiler.push({ cik: filer.cik, questions, taggedYears: years, fiscalYears: fiscalYearPeriods(companyfacts) });
    // The payloads the questions were built from (review R1 m5). They change as SEC adds filings,
    // so a refetch changes these digests -- and the file's sha256 -- even when no question does.
    filerManifest.push({
      cik: filer.cik, entityName: companyfacts.entityName, corpusRef: `sec-10k:${filer.cik}`,
      payloads: { submissionsSha256: sha256(submissionsBytes), companyfactsSha256: sha256(companyfactsBytes) },
      filings,
    });
  }
  const header = {
    generator: "nextjs/eval/ask-quality/gen_xbrl_questions.mjs",
    matchingRule: "masterplan v4 §16.4: concept + non-dimensional context period + unit + scaled value must equal a VISIBLE inline-XBRL fact in the filing",
    rules: RULES,
    filers: filerManifest,
  };
  const numeric = byFiler.flatMap((filer) => filer.questions);
  const unanswerable = buildUnanswerable(byFiler);
  mkdirSync(OUT, { recursive: true });
  const write = (file, body) => {
    const bytes = `${JSON.stringify(body, null, 1)}\n`;
    writeFileSync(path.join(OUT, file), bytes);
    console.log(`${file}: n=${body.questions.length} sha256=${sha256(bytes)}`);
  };
  write("xbrl-numeric.json", { schema: "tavonel.ask_quality_questions.v1", set: "xbrl-numeric", ...header, questions: numeric });
  write("unanswerable.json", {
    schema: "tavonel.ask_quality_questions.v1", set: "unanswerable", ...header,
    unanswerableRules: {
      OTHER_COMPANY: `for each corpus A and each other filer B, the first ${RULES.crossCompanyPerPair} of B's numeric questions (hash order), asked of A`,
      OTHER_YEAR: `for each corpus A, the first ${RULES.otherYearPerFiler} of A's numeric questions asked of fiscal year Y = (earliest year any non-dimensional context in A's corpus touches) - ${RULES.otherYearOffsetBelowEarliestTaggedYear}, using A's real fiscal-year period from companyfacts (the annual 10-K duration whose end is nearest the source month/day in Y, within 10 days)`,
      limitation: "Absence is established against tagged XBRL contexts only. Untagged prose or tables could still state an OTHER_YEAR figure; a person spot-checks a sample before the set is treated as frozen (PREREG openItems).",
    },
    questions: unanswerable,
  });
  for (const filer of filerManifest) for (const filing of filer.filings) console.log(filer.entityName, filing.accession, JSON.stringify(filing.stats));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
