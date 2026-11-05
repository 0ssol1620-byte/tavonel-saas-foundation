import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildUnanswerable, ixValue, matchSpans, parseInlineXbrl, questionText } from "./gen_xbrl_questions.mjs";
import { checkHost, createEvidenceExcerptsAnswerer } from "./live-adapter";
import { loadQuestionSets } from "./run_eval.mjs";
import {
  buildReceipt,
  classifyAbstention,
  containsSpan,
  createFixtureAnswerer,
  extractNumbers,
  numericExactMatch,
  renderMarkdown,
  runEval,
  scoreQuestion,
  summarize,
  validateReceipt,
  wilson,
  type EvalQuestion,
  type QuestionSetRef,
} from "./score";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("wilson", () => {
  // Reference values worked by hand from the closed form, z = 1.96, to four places.
  it.each([
    [0, 10, 0, 0.2775],
    [5, 10, 0.2366, 0.7634],
    [10, 10, 0.7225, 1],
    [81, 263, 0.2553, 0.3662],
  ])("%i/%i", (k, n, low, high) => {
    const interval = wilson(k, n);
    expect(interval?.low).toBeCloseTo(low, 4);
    expect(interval?.high).toBeCloseTo(high, 4);
  });
  it("has no interval without a denominator, and refuses impossible counts", () => {
    expect(wilson(0, 0)).toBeNull();
    expect(() => wilson(3, 2)).toThrow();
    expect(() => wilson(1.5, 4)).toThrow();
  });
});

describe("numeric exact match", () => {
  const revenue = { value: 394_328_000_000, unit: "USD", decimals: -6 };
  it("matches a structured value at the reported precision and no further", () => {
    expect(numericExactMatch(revenue, { answer: "", numeric: { value: 394_328_000_000, unit: "USD" } }).match).toBe(true);
    expect(numericExactMatch(revenue, { answer: "", numeric: { value: 394_328_400_000, unit: "USD" } }).match).toBe(true);
    expect(numericExactMatch(revenue, { answer: "", numeric: { value: 394_328_500_000, unit: "USD" } }).reason).toBe("VALUE_MISMATCH");
    expect(numericExactMatch(revenue, { answer: "", numeric: { value: 394_300_000_000, unit: "USD" } }).reason).toBe("VALUE_MISMATCH");
  });
  it("reads one number from text with its scale word and ignores a year", () => {
    expect(numericExactMatch(revenue, { answer: "In fiscal 2025 revenue was $394,328 million." }).match).toBe(true);
    expect(numericExactMatch(revenue, { answer: "$394.3 billion" }).reason).toBe("VALUE_MISMATCH");
    expect(extractNumbers("(334) million")[0].value).toBe(-334_000_000);
  });
  it("refuses an excerpt that states several numbers, an empty answer and a wrong unit", () => {
    expect(numericExactMatch(revenue, { answer: "Net sales 394,328 383,285 365,817" }).reason).toBe("NOT_A_SINGLE_VALUE");
    expect(numericExactMatch(revenue, { answer: "not stated" }).reason).toBe("NO_VALUE");
    expect(numericExactMatch(revenue, { answer: "394,328 million shares" }).reason).toBe("UNIT_MISMATCH");
    const eps = { value: 6.97, unit: "USD/shares", decimals: 2 };
    expect(numericExactMatch(eps, { answer: "$6.97 per diluted share" }).match).toBe(true);
    expect(numericExactMatch(eps, { answer: "$6.97" }).reason).toBe("UNIT_MISMATCH");
  });
  // PREREG v2, review R1 M1: dates, form names and document references are not amounts.
  it("ignores the question's own date, the form name and document references", () => {
    const microsoft = { value: 281_724_000_000, unit: "USD", decimals: -6 };
    expect(numericExactMatch(microsoft, { answer: "$281,724 million" }).match).toBe(true);
    expect(numericExactMatch(microsoft, { answer: "Microsoft's revenue for the fiscal year ended June 30, 2025 was $281,724 million." }).match).toBe(true);
    expect(numericExactMatch(microsoft, { answer: "Per the Form 10-K, revenue was $281,724 million." }).match).toBe(true);
    expect(numericExactMatch(microsoft, { answer: "As of Dec. 28, 2025 (Item 8, Note 12; 8-K/A filed 2026-02-11): $281,724 million" }).match).toBe(true);
    // A date never hides a second real amount.
    expect(numericExactMatch(microsoft, { answer: "On June 30, 2025 revenue was $281,724 million and costs $90,000 million" }).reason).toBe("NOT_A_SINGLE_VALUE");
  });
  it("demands equality when decimals is INF", () => {
    const exact = { value: 1234, unit: "shares", decimals: null };
    expect(numericExactMatch(exact, { answer: "", numeric: { value: 1234.4, unit: "shares" } }).match).toBe(false);
  });
});

describe("spans and abstention", () => {
  it("matches a numeric span only as a whole number", () => {
    expect(containsSpan("total $ 15,819 $ 8,063", "15,819")).toBe(true);
    expect(containsSpan("total 1,394,328", "394,328")).toBe(false);
    expect(containsSpan("total 394,328.5", "394,328")).toBe(false);
    expect(containsSpan("The first APT-equipped   satellite was TIROS VIII", "tiros viii")).toBe(true);
  });
  it("counts an explicit abstention and an empty, uncited answer as abstained", () => {
    expect(classifyAbstention({ abstained: true, answer: "text kept", citations: [{ text: "x" }] })).toBe(true);
    expect(classifyAbstention({ abstained: false, answer: "  ", citations: [] })).toBe(true);
    expect(classifyAbstention({ abstained: false, answer: "", citations: [{ text: "x" }] })).toBe(false);
  });
  it("refuses a contradictory question rather than scoring it", () => {
    const response = { answer: "", citations: [], abstained: true, latencyMs: 1 };
    const base = { id: "q", set: "xbrl-numeric", answerType: "numeric", corpusRef: "c", question: "?" } as const;
    expect(() => scoreQuestion({ ...base, kind: "unanswerable", gold: { spans: ["1"] } }, response)).toThrow(/carries gold/);
    expect(() => scoreQuestion({ ...base, kind: "answerable", gold: { spans: ["123"] } }, response)).toThrow(/numeric gold/);
    expect(() => scoreQuestion({ ...base, kind: "unanswerable", gold: null }, { ...response, latencyMs: Number.NaN })).toThrow(/latency/);
  });
  // PREREG v2, review R1 M2: abstaining on everything must be visible, not free.
  it("makes an answerer that abstains on every answerable question visible", () => {
    const question: EvalQuestion = {
      id: "q", set: "xbrl-numeric", kind: "answerable", answerType: "numeric", corpusRef: "c", question: "?",
      gold: { numeric: { value: 1000, unit: "USD", decimals: 0 }, spans: ["1,000"] },
    };
    const silent = summarize([scoreQuestion(question, { answer: "", citations: [], abstained: true, latencyMs: 1 })]);
    const row = (id: string) => silent.find((metric) => metric.id === id);
    expect(row("abstained_over_answerable.xbrl-numeric")).toMatchObject({ numerator: 1, denominator: 1, value: 1 });
    expect(row("gold_span_recall.xbrl-numeric")).toMatchObject({ numerator: 0, denominator: 1, value: 0 });
    const cited = summarize([scoreQuestion(question, { answer: "", citations: [{ text: "total 1,000" }, { text: "x" }], abstained: true, latencyMs: 1 })]);
    expect(cited.find((metric) => metric.id === "gold_span_recall.xbrl-numeric")).toMatchObject({ numerator: 1, denominator: 1 });
    expect(cited.find((metric) => metric.id === "citation_precision_4plus_digit_spans.xbrl-numeric")).toMatchObject({ numerator: 1, denominator: 2 });
    const short = { ...question, gold: { numeric: { value: 212, unit: "USD", decimals: 0 }, spans: ["212"] } };
    const stratum = summarize([scoreQuestion(short, { answer: "", citations: [{ text: "212" }], abstained: true, latencyMs: 1 })]);
    expect(stratum.find((metric) => metric.id === "citation_precision_4plus_digit_spans.xbrl-numeric")).toMatchObject({ denominator: 0, value: null });
  });
  it("reports a rate with no denominator as null", () => {
    const human = summarize([]).find((row) => row.id === "correct_over_answerable.human");
    expect(human).toMatchObject({ numerator: 0, denominator: 0, value: null, ci95: null });
  });
});

const IXBRL = `
<ix:header><ix:hidden><ix:nonFraction name="us-gaap:Revenues" contextRef="d" unitRef="usd" scale="6" decimals="-6">999</ix:nonFraction></ix:hidden>
<ix:resources>
<xbrli:context id="d"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="seg"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="srt:SegmentAxis">a:B</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="i"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period></xbrli:context>
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
<xbrli:unit id="eps"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
</ix:resources></ix:header>
<td>$<ix:nonFraction name="us-gaap:Revenues" contextRef="d" unitRef="usd" scale="6" decimals="-6" format="ixt:num-dot-decimal" id="f1">47,061</ix:nonFraction></td>
<td><ix:nonFraction name="us-gaap:Revenues" contextRef="seg" unitRef="usd" scale="6" decimals="-6" id="f2">47,061</ix:nonFraction></td>
<td>(<ix:nonFraction name="us-gaap:IncreaseDecreaseInAccountsReceivable" contextRef="d" unitRef="usd" scale="6" sign="-" id="f3">334</ix:nonFraction>)</td>
<td><ix:nonFraction name="us-gaap:EarningsPerShareDiluted" contextRef="d" unitRef="eps" decimals="2" id="f4">2.47</ix:nonFraction></td>
<td><ix:nonFraction name="us-gaap:Assets" contextRef="i" unitRef="usd" scale="6" id="f5">100,549</ix:nonFraction></td>`;

describe("inline XBRL context / unit / period matching (v4 §16.4)", () => {
  const parsed = parseInlineXbrl(IXBRL);
  it("reads units, contexts, scale and sign", () => {
    expect(parsed.units.get("eps")).toBe("USD/shares");
    expect(parsed.contexts.get("seg")?.dimensional).toBe(true);
    const receivable = parsed.facts.find((fact) => fact.id === "f3");
    expect(receivable && ixValue(receivable)).toBe(-334_000_000);
  });
  it("matches only a visible, non-dimensional fact of the same period, unit and value", () => {
    const duration = { start: "2025-01-01", end: "2025-12-31", val: 47_061_000_000 };
    expect(matchSpans(duration, "us-gaap:Revenues", "USD", parsed).map((fact: { id: string | null }) => fact.id)).toEqual(["f1"]);
    expect(matchSpans({ ...duration, val: 999_000_000 }, "us-gaap:Revenues", "USD", parsed)).toEqual([]); // hidden only
    expect(matchSpans({ ...duration, start: "2024-01-01" }, "us-gaap:Revenues", "USD", parsed)).toEqual([]);
    expect(matchSpans(duration, "us-gaap:Revenues", "USD/shares", parsed)).toEqual([]);
    expect(matchSpans({ ...duration, val: 47_060_000_000 }, "us-gaap:Revenues", "USD", parsed)).toEqual([]);
  });
  it("keeps instants and durations apart", () => {
    const instant = { end: "2025-12-31", val: 100_549_000_000 };
    expect(matchSpans(instant, "us-gaap:Assets", "USD", parsed).map((fact: { id: string | null }) => fact.id)).toEqual(["f5"]);
    expect(matchSpans({ start: "2025-01-01", ...instant }, "us-gaap:Assets", "USD", parsed)).toEqual([]);
    expect(matchSpans({ start: "2025-01-01", end: "2025-12-31", val: 2.47 }, "us-gaap:EarningsPerShareDiluted", "USD/shares", parsed)).toHaveLength(1);
  });
  // Review R1 m3: a 52/53-week filer's year ends on a different day each year; use the reported one.
  it("asks an OTHER_YEAR question of a real reported fiscal year outside every tagged year", () => {
    const source = {
      id: "xbrl-1", question: "q", provenance: { entityName: "ACME", label: "Revenues", unit: "USD", period: { start: "2024-12-30", end: "2025-12-28" } },
    };
    const fiscalYears = [{ start: "2012-01-02", end: "2012-12-30" }, { start: "2012-12-31", end: "2013-12-29" }, { start: "2013-12-30", end: "2014-12-28" }];
    const [moved] = buildUnanswerable([{ cik: "0000000001", questions: [source], taggedYears: new Set([2018, 2025]), fiscalYears }]);
    expect(moved.generation.period).toEqual({ start: "2012-12-31", end: "2013-12-29" });
    expect(moved.question).toBe(questionText("ACME", "Revenues", "USD", { start: "2012-12-31", end: "2013-12-29" }));
    expect(() => buildUnanswerable([{ cik: "0000000001", questions: [source], taggedYears: new Set([2018]), fiscalYears: [] }])).toThrow(/no reported fiscal year/);
  });
});

describe("question sets and receipt", () => {
  const loaded = loadQuestionSets(path.join(HERE, "PREREG.json"));
  const questions = loaded.questions as EvalQuestion[];
  const run = async () =>
    buildReceipt({
      preregSha256: loaded.preregSha256,
      questionSets: loaded.sets as QuestionSetRef[],
      answerer: { id: "fixture-v1", kind: "fixture" },
      gitSha: "0000000",
      gitDirty: false,
      runStartedAt: "2026-11-04T00:00:00.000Z",
      rows: await runEval(questions, createFixtureAnswerer(questions)),
    });

  it("loads exactly the pre-registered sets, at the pre-registered sha256 and size", () => {
    expect(loaded.sets.map((set: { id: string; status: string }) => `${set.id}:${set.status}`)).toEqual([
      "xbrl-numeric:FROZEN", "unanswerable:FROZEN", "human:NOT_FROZEN",
    ]);
    expect(questions.filter((question) => question.set === "xbrl-numeric")).toHaveLength(400);
    expect(questions.filter((question) => question.kind === "unanswerable")).toHaveLength(160);
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
  });

  // Review R1 m1: exercise the refusal paths, not just the happy one.
  it("refuses a question file whose sha256 or size is not the pre-registered one", () => {
    const prereg = JSON.parse(readFileSync(path.join(HERE, "PREREG.json"), "utf8"));
    expect(prereg.questionSets[0].sha256).toBe(
      createHash("sha256").update(readFileSync(path.join(HERE, prereg.questionSets[0].path))).digest("hex"),
    );
    const dir = mkdtempSync(path.join(tmpdir(), "ask-quality-prereg-"));
    let index = 0;
    const variant = (change: (entry: { sha256: string; n: number; path: string }) => void) => {
      const copy = JSON.parse(JSON.stringify(prereg));
      for (const entry of copy.questionSets) entry.path = path.join(HERE, entry.path);
      change(copy.questionSets[0]);
      index += 1;
      const file = path.join(dir, `prereg-${index}.json`);
      writeFileSync(file, JSON.stringify(copy));
      return file;
    };
    expect(() => loadQuestionSets(variant(() => undefined))).not.toThrow();
    expect(() => loadQuestionSets(variant((entry) => { entry.sha256 = `0${entry.sha256.slice(1)}`; }))).toThrow(/is not the pre-registered/);
    expect(() => loadQuestionSets(variant((entry) => { entry.n += 1; }))).toThrow(/PREREG says 401/);
  });

  it("produces the same receipt twice from the fixture answerer", async () => {
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
    expect(second.receiptSha256).toBe(first.receiptSha256);
  });

  it("validates its own receipt and rejects a tampered one", async () => {
    const receipt = await run();
    expect(validateReceipt(receipt)).toEqual([]);
    const metrics = receipt.metrics.map((row, index) => (index === 0 ? { ...row, denominator: 0 } : row));
    expect(validateReceipt({ ...receipt, metrics })).toEqual(expect.arrayContaining(["metrics.correct_over_answerable.xbrl-numeric.counts", "receiptSha256"]));
    expect(validateReceipt({ ...receipt, schema: "other" })).toContain("schema");
    expect(validateReceipt({ ...receipt, metrics: receipt.metrics.filter((row) => !row.id.startsWith("abstained_over_answerable")) })).toContain("metrics");
  });

  it("writes a markdown table in which every metric row names its denominator", async () => {
    const receipt = await run();
    const rows = renderMarkdown(receipt).split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| metric"));
    expect(rows).toHaveLength(receipt.metrics.length + 1);
    for (const metric of receipt.metrics) {
      expect(rows.some((line) => line.includes(metric.label) && line.includes(`| ${metric.denominator} (${metric.denominatorLabel})`))).toBe(true);
    }
  });
});

describe("evidence_excerpts adapter", () => {
  const collections = { "sec-10k:1": "collection-0123456789abcdef0123456789abcdef" };
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const make = (fetchImpl: typeof fetch, baseUrl = "http://localhost:3000") =>
    createEvidenceExcerptsAnswerer({ baseUrl, token: "t", collections, fetchImpl });

  // Review R1 m2: an allowlist. Loopback by default, other hosts only by exact name, production never.
  it("allows loopback only, other hosts only when named, production never; needs a token", () => {
    expect(checkHost("http://127.0.0.1:3000")).toBe("127.0.0.1");
    expect(() => checkHost("https://staging.example.test")).toThrow(/--allow-host/);
    expect(checkHost("https://staging.example.test", ["staging.example.test"])).toBe("staging.example.test");
    expect(() => make(reply(200, {}), "https://tavonel.com")).toThrow(/production/);
    expect(() => checkHost("https://tavonel.com./", ["tavonel.com.", "tavonel.com"])).toThrow(/production/);
    expect(() => checkHost("https://tavonel.com../", ["tavonel.com..", "tavonel.com"])).toThrow(/production/);
    expect(checkHost("http://localhost.:3000")).toBe("localhost");
    expect(() => checkHost("https://www.tavonel.com", ["www.tavonel.com"])).toThrow(/production/);
    expect(() => checkHost("https://tavonel-saas-foundation-abc123-team.vercel.app", ["tavonel-saas-foundation-abc123-team.vercel.app"])).toThrow(/production/);
    expect(() => createEvidenceExcerptsAnswerer({ baseUrl: "http://localhost:3000", token: "", collections })).toThrow(/TOKEN/);
  });

  it("maps a grounded and an abstained answer", async () => {
    const grounded = await make(reply(200, {
      status: "grounded", answer: "Revenue 47,061", answerMode: "evidence_excerpts", retrievalPath: "compiled-retrieval-v1",
      citations: [{ excerpt: "Revenue $ 47,061", evidenceId: "ev-1", pageNumber1: 3 }],
    })).ask("q", "sec-10k:1");
    expect(grounded).toMatchObject({ abstained: false, numeric: null, citations: [{ text: "Revenue $ 47,061", evidenceId: "ev-1" }] });
    const declined = await make(reply(200, { status: "abstained", answer: "", answerMode: "evidence_excerpts", citations: [] })).ask("q", "sec-10k:1");
    expect(declined.abstained).toBe(true);
  });

  it("aborts on an operational failure, another answer mode or an unmapped corpus", async () => {
    await expect(make(reply(503, { code: "SIGNER_NOT_CONFIGURED" })).ask("q", "sec-10k:1")).rejects.toThrow(/503 SIGNER_NOT_CONFIGURED/);
    await expect(make(reply(200, { status: "grounded", answerMode: "grounded_generation" })).ask("q", "sec-10k:1")).rejects.toThrow(/answerMode/);
    await expect(make(reply(200, {})).ask("q", "sec-10k:2")).rejects.toThrow(/no collection/);
  });
});
