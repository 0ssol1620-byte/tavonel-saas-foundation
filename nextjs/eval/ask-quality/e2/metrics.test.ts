import { describe, expect, it } from "vitest";
import {
  buildCorpusArtifact,
  chooseThreshold,
  chunkDocument,
  CHUNK_MAX_CHARS,
  holdoutReport,
  htmlBlocks,
  replayQuestion,
  THRESHOLD_GRID,
  type Replay,
} from "./e2";
import type { EvalQuestion } from "../score";

/*
  E2 offline replay (PREREG-E2.json): the corpus build, the calibration rule, the holdout metrics and
  the verdict, on synthetic input. Nothing here reads a gold question or a 10-K.
*/

const TABLE = `<table><tr><td>December 31,</td></tr><tr><td></td><td>2025</td><td>2024</td></tr>
${Array.from({ length: 30 }, (_, i) => `<tr><td>Line item number ${i} with a long label</td><td>$</td><td>1,${String(100 + i)}</td><td>9${i}</td></tr>`).join("\n")}
</table>`;
const HTML = `<html><body><div style="display:none"><ix:header><ix:hidden>SECRET-HIDDEN-FACT 99,999</ix:hidden></ix:header></div>
<script>var x = "script text";</script><style>.a{}</style><!-- comment text -->
<p>Coca&#8209;Cola &amp; partners reported results.</p><p>Second&nbsp;paragraph.</p>${TABLE}<div>After the table.</div></body></html>`;

describe("corpus build", () => {
  it("keeps visible text only: no ix:header, script, style or comment", () => {
    const text = JSON.stringify(htmlBlocks(HTML));
    for (const hidden of ["SECRET-HIDDEN-FACT", "script text", ".a{}", "comment text"]) expect(text).not.toContain(hidden);
    expect(text).toContain(`Coca${String.fromCodePoint(0x2011)}Cola & partners reported results.`);
  });

  it("chunks at most 400 characters, tables apart from text, every table chunk repeating the year header", () => {
    const chunks = chunkDocument(HTML);
    expect(chunks.every(chunk => chunk.length <= CHUNK_MAX_CHARS)).toBe(true);
    const table = chunks.filter(chunk => chunk.includes("Line item"));
    expect(table.length).toBeGreaterThan(2);
    expect(table.every(chunk => chunk.startsWith("2025 2024 "))).toBe(true);
    expect(chunks.some(chunk => chunk.includes("Line item") && chunk.includes("reported results"))).toBe(false);
    expect(chunks.at(-1)).toBe("After the table.");
  });

  it("splits a block longer than the limit on word boundaries and loses no word", () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`);
    const chunks = chunkDocument(`<p>${words.join(" ")}</p>`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ").split(" ")).toEqual(words);
  });

  it("refuses a corpus the Ask path could not read (empty, or over its row limit)", () => {
    expect(() => buildCorpusArtifact("sec-10k:0", [{ accession: "a", html: "<html></html>" }])).toThrow(/outside the artifact limits/);
  });
});

const question = (id: string, kind: "answerable" | "unanswerable", text: string, spans: string[] = []): EvalQuestion => ({
  id, set: kind === "answerable" ? "xbrl-numeric" : "unanswerable", kind, answerType: "numeric", split: "holdout",
  corpusRef: "sec-10k:1", question: text,
  gold: kind === "answerable" ? { numeric: { value: 1, unit: "USD", decimals: 0 }, spans } : null,
} as EvalQuestion);

describe("replay through the production Ask path", () => {
  const artifact = buildCorpusArtifact("sec-10k:1", [{
    accession: "0000000001-25-000001",
    html: `<p>Marketable securities were 1,934 million as of December 31, 2025.</p><p>Inventories were 4,000 million.</p>`,
  }]);

  it("records the baseline's own answer, its full-text evidence and a gold-span hit", () => {
    const replay = replayQuestion(question("q1", "answerable", "What were marketable securities as of December 31, 2025, in US dollars?", ["1,934"]), artifact);
    expect(replay.baselineAnswered).toBe(true);
    expect(replay.goldHit).toBe(true);
    expect(replay.evidence.map(item => item.text).join(" ")).toContain("1,934");
  });

  it("a gold span the citations do not carry is not a hit; an unanswerable question has no hit at all", () => {
    expect(replayQuestion(question("q2", "answerable", "What were marketable securities in US dollars?", ["7,777"]), artifact).goldHit).toBe(false);
    expect(replayQuestion(question("q3", "unanswerable", "What were inventories in 2019, in US dollars?"), artifact).goldHit).toBeNull();
  });

  it("an operational refusal of the Ask path throws instead of being scored as an abstention", () => {
    expect(() => replayQuestion(question("q4", "answerable", "x", ["1"]), artifact)).toThrow(/refused/);
  });
});

const replay = (id: string, kind: Replay["kind"], text: string, evidence: string[], extra: Partial<Replay> = {}): Replay => ({
  id, kind, rule: kind === "unanswerable" ? "OTHER_YEAR" : null, corpusRef: "sec-10k:1", question: text,
  baselineAnswered: evidence.length > 0, baselineReason: null, goldHit: kind === "answerable" ? true : null,
  evidence: evidence.map((item, i) => ({ evidenceId: `ev-${id}-${i}`, text: item })), ...extra,
});

describe("calibration rule", () => {
  it("picks the threshold refusing the most unanswerable questions at <= 5% refused answerable; ties go low", () => {
    // Answerable: full coverage. Unanswerable: coverage 2/3 (one term missing, years present).
    const rows: Replay[] = [
      ...Array.from({ length: 20 }, (_, i) => replay(`a${i}`, "answerable", "alpha beta gamma", ["alpha beta gamma 5"])),
      ...Array.from({ length: 10 }, (_, i) => replay(`u${i}`, "unanswerable", "alpha beta delta", ["alpha beta 5"])),
    ];
    const chosen = chooseThreshold(rows);
    expect(chosen.constraintMet).toBe(true);
    // Every threshold above 2/3 refuses all 10 unanswerable and no answerable; the smallest such is 0.675.
    expect(chosen.threshold).toBe(0.675);
    expect(chosen.table.find(row => row.threshold === 0.675)).toMatchObject({ refusedUnanswerable: 10, refusedAnswerable: 0, feasible: true });
  });

  it("falls back to 0 and says so when no threshold keeps refused answerable within 5%", () => {
    const rows: Replay[] = [
      ...Array.from({ length: 10 }, (_, i) => replay(`a${i}`, "answerable", "how much in 2019", ["no year here 5"])),
      replay("u", "unanswerable", "how much in 2019", ["nothing 5"]),
    ];
    const chosen = chooseThreshold(rows);
    expect([chosen.threshold, chosen.constraintMet]).toEqual([0, false]);
  });

  it("the grid is 0 plus 0.500 to 1.000 in steps of 0.025, exactly", () => {
    expect(THRESHOLD_GRID.length).toBe(22);
    expect([THRESHOLD_GRID[0], THRESHOLD_GRID[1], THRESHOLD_GRID[2], THRESHOLD_GRID.at(-1)]).toEqual([0, 0.5, 0.525, 1]);
  });
});

describe("holdout report and verdict", () => {
  const answerable = (n: number, covered: boolean) =>
    Array.from({ length: n }, (_, i) => replay(`a${covered}${i}`, "answerable", "alpha beta", [covered ? "alpha beta 5" : "alpha 5"]));
  const unanswerable = (n: number, refused: boolean) =>
    Array.from({ length: n }, (_, i) => replay(`u${refused}${i}`, "unanswerable", "alpha beta", [refused ? "alpha 5" : "alpha beta 5"]));

  it("SUPPORTED only when all three criteria pass, with every rate's numerator and denominator", () => {
    const report = holdoutReport([...answerable(200, true), ...unanswerable(80, true)], 0.9);
    expect(report.criteria.map(criterion => criterion.result)).toEqual(["PASS", "PASS", "PASS"]);
    expect(report.verdict).toBe("SUPPORTED");
    const recall = report.metrics.find(metric => metric.id === "refuse_recall")!;
    expect([recall.numerator, recall.denominator, recall.value]).toEqual([80, 80, 1]);
    expect(report.metrics.every(metric => Number.isInteger(metric.denominator))).toBe(true);
  });

  it("NOT_SUPPORTED when the gate refuses too many answerable questions, even with perfect recall", () => {
    const report = holdoutReport([...answerable(150, true), ...answerable(50, false), ...unanswerable(80, true)], 0.9);
    expect(report.criteria.map(criterion => criterion.result)).toEqual(["PASS", "FAIL", "FAIL"]);
    expect(report.verdict).toBe("NOT_SUPPORTED");
  });

  it("NOT_SUPPORTED when the wrong-answer rate does not fall with a CI margin", () => {
    const report = holdoutReport([...answerable(200, true), ...unanswerable(5, true), ...unanswerable(75, false)], 0.9);
    expect(report.criteria[0]).toMatchObject({ id: "C1", result: "FAIL" });
    expect(report.verdict).toBe("NOT_SUPPORTED");
  });

  it("a criterion with a zero denominator is NOT_EVALUABLE and the verdict is NOT_SUPPORTED, never a pass", () => {
    const report = holdoutReport(answerable(50, true), 0.9);
    expect(report.criteria[0]).toMatchObject({ id: "C1", result: "NOT_EVALUABLE" });
    expect(report.metrics.find(metric => metric.id === "refuse_recall")).toMatchObject({ denominator: 0, value: null, wilson95: null });
    expect(report.verdict).toBe("NOT_SUPPORTED");
  });
});
