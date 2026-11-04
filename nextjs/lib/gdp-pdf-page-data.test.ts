import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
  The chrome reads the current route from the App Router, which is not mounted under
  renderToStaticMarkup. Stubbing it with the route this page is keeps the test about the page.
*/
vi.mock("next/navigation", () => ({ usePathname: () => "/benchmarks/gdp-pdf" }));

import {
  GDP_PDF_ARTIFACT_PATH,
  GDP_PDF_ARTIFACT_SHA256,
  GDP_PDF_PAGE_ARMS,
  GDP_PDF_RUNS,
  gdpPdfCompilerRelease,
  gdpPdfDeltaSentence,
  gdpPdfDesignFigure,
  gdpPdfDeviations,
  gdpPdfFailureNotes,
  gdpPdfHeadline,
  gdpPdfPassFigure,
  gdpPdfPreviousRuns,
  gdpPdfReport,
  gdpPdfVerdict,
  validateGdpPdfReport,
  type GdpPdfRun,
} from "./gdp-pdf-page-data";
import GdpPdfBenchmarkPage from "../app/benchmarks/gdp-pdf/page";
import { metadata } from "../app/benchmarks/gdp-pdf/page";
import sitemap from "../app/sitemap";
import { publicPageLocation } from "./marketing-analytics";
import { COMPILER_RELEASE, COMPILER_RELEASE_1_1, COMPILER_RELEASE_DEFINITION } from "./compiler-release";

/** A run's committed file, from its repository path (`nextjs/...`). */
const runFile = (run: GdpPdfRun) => resolve(import.meta.dirname, "..", run.path.replace(/^nextjs\//, ""));

/* A summary that passes, as the base every refusal case mutates one field of. */
const summary = () => ({
  n: 4,
  macro_all_pass: 0.5,
  macro_all_pass_count: 2,
  micro_mean_criteria: 0.75,
  criteria_passed_total: 30,
  criteria_total: 40,
  subject_failures: 0,
  adapter_failures: 0,
  judge_failures: 0,
  input_tokens_total: 1000,
  input_tokens_reported_for: 4,
  output_tokens_total: 500,
  latency_p50_seconds: 1,
  latency_p95_seconds: 2,
  latency_mean_seconds: 1.5,
  subject_cost_usd_micros_total: 100,
  judge_cost_usd_micros_total: 50,
  cost_complete: true,
});

const armPair = () => ({ native_pdf: summary(), compiled_context_pdf: summary() });

const validReport = () => ({
  arms: armPair(),
  paired: armPair(),
  per_domain: { Legal: armPair() },
  pairwise_delta: { macro_delta_pp: 0, micro_delta_pp: 0, paired_n: 4 },
  manifest: {
    dataset_revision: "a".repeat(40),
    sealed_revision: "b".repeat(40),
    task_set_digest: "c".repeat(64),
    task_count_in_catalog: 100,
    tasks_attempted: 4,
    epoch: 1,
    judge: "test-judge",
    seed: "test-seed",
    official_comparable: false,
    prompt_template_digests: { judge: "d".repeat(64) },
    surface: { surface: "test-surface", declared_model: "test-model", tools: ["Read"], official_comparable: false },
  },
  official_comparable: false,
  cells_recorded: 8,
});

/*
  THE REFUSALS.

  Each case is the shape of a misreport the constitution names, expressed as the one field that
  makes it. The assertion is on the message rather than only on the length, because the message
  is what a build failure has to say to be actionable.
*/
describe("validateGdpPdfReport", () => {
  it("accepts a report that carries every denominator and count", () => {
    expect(validateGdpPdfReport(validReport())).toEqual([]);
  });

  it("refuses a summary with no denominator", () => {
    const report = validReport();
    delete (report.arms.native_pdf as Partial<ReturnType<typeof summary>>).n;
    expect(validateGdpPdfReport(report)).toContain("arms.native_pdf: missing denominator (n)");
  });

  it("refuses a denominator of zero -- a rate over nothing is not a rate", () => {
    const report = validReport();
    report.arms.native_pdf.n = 0;
    expect(validateGdpPdfReport(report)).toContain("arms.native_pdf: missing denominator (n)");
  });

  it("refuses a rate published without the count it was computed from", () => {
    const report = validReport();
    delete (report.arms.compiled_context_pdf as Partial<ReturnType<typeof summary>>).macro_all_pass_count;
    expect(validateGdpPdfReport(report)).toContain(
      "arms.compiled_context_pdf.macro_all_pass: rate without its count (macro_all_pass_count)",
    );
  });

  it("refuses a rate that does not equal its own count over its own denominator", () => {
    const report = validReport();
    report.arms.native_pdf.macro_all_pass = 0.9;
    expect(validateGdpPdfReport(report)).toContain(
      "arms.native_pdf.macro_all_pass: rate does not equal macro_all_pass_count / n",
    );
  });

  it("refuses an arm the page has no label for", () => {
    const report = validReport() as Record<string, unknown>;
    (report.arms as Record<string, unknown>).adaptive_router = summary();
    expect(validateGdpPdfReport(report)).toContain('arms: unknown arm "adaptive_router"');
  });

  it("refuses an unknown arm inside a per-domain block too", () => {
    const report = validReport() as Record<string, unknown>;
    ((report.per_domain as Record<string, Record<string, unknown>>).Legal).fixed_control_retrieval_rerank = summary();
    expect(validateGdpPdfReport(report)).toContain('per_domain.Legal: unknown arm "fixed_control_retrieval_rerank"');
  });

  it("refuses a negative count", () => {
    const report = validReport();
    report.arms.native_pdf.adapter_failures = -1;
    expect(validateGdpPdfReport(report)).toContain("arms.native_pdf.adapter_failures: negative count");
  });

  it("refuses a negative count in a hardest-documents row", () => {
    const report = { ...validReport(), hardest_documents: [{ task_id: "t1", domain: "Legal", pages: -3, criteria: 4, native_pdf_passed: 2 }] };
    expect(validateGdpPdfReport(report)).toContain("hardest_documents[0].pages: negative count");
  });

  it("refuses a pairwise delta with no paired denominator", () => {
    const report = validReport();
    report.pairwise_delta.paired_n = 0;
    expect(validateGdpPdfReport(report)).toContain("pairwise_delta: missing denominator (paired_n)");
  });

  it("refuses a missing arm rather than rendering one column", () => {
    const report = validReport() as Record<string, unknown>;
    delete (report.arms as Record<string, unknown>).compiled_context_pdf;
    expect(validateGdpPdfReport(report)).toContain('arms: missing arm "compiled_context_pdf"');
  });

  it("refuses anything that is not an object", () => {
    expect(validateGdpPdfReport(null)).toEqual(["report: expected an object"]);
  });
});

/*
  THE SENTENCE.

  The page's headline is chosen by sign. All three branches are exercised here so that the two
  the committed artifact does not take are still known to be right, and so that no branch can
  quietly acquire a positive phrasing.
*/
describe("gdpPdfDeltaSentence", () => {
  it("reports a lift as a lift", () => {
    expect(gdpPdfVerdict(12.3)).toBe("improved");
    expect(gdpPdfDeltaSentence(12.3, 10, "the all-criteria pass rate")).toBe(
      "Adding TAVONEL's compiled context to the PDF raised the all-criteria pass rate by 12.3 percentage points over the 10 tasks run in both arms.",
    );
  });

  it("reports no measurable difference as no difference", () => {
    expect(gdpPdfVerdict(0)).toBe("no_difference");
    expect(gdpPdfDeltaSentence(0, 10, "the all-criteria pass rate")).toContain("no measurable difference");
  });

  it("reports a regression as a regression, and says it is the result", () => {
    expect(gdpPdfVerdict(-30)).toBe("worse");
    const sentence = gdpPdfDeltaSentence(-30, 10, "the all-criteria pass rate");
    expect(sentence).toContain("lowered the all-criteria pass rate by 30.0 percentage points");
    expect(sentence).toContain("scored worse than the PDF alone");
  });

  it("never produces a positive phrasing from a negative delta", () => {
    for (const delta of [-0.1, -1, -5.5, -30, -100]) {
      const sentence = gdpPdfDeltaSentence(delta, 10, "the all-criteria pass rate");
      expect(sentence).not.toMatch(/raised|improved|better|lift/i);
    }
  });

  it("titles the page by the same sign, so the h1 cannot outlive its artifact", () => {
    expect(gdpPdfHeadline(12.3)).toBe("Compiled context beat the PDF alone.");
    expect(gdpPdfHeadline(0)).toBe("Compiled context made no measurable difference.");
    expect(gdpPdfHeadline(-30)).toBe("Compiled context did not beat the PDF.");
  });

  it("agrees with itself on the boundary of the floor", () => {
    expect(gdpPdfVerdict(0.04)).toBe("no_difference");
    expect(gdpPdfVerdict(0.06)).toBe("improved");
    expect(gdpPdfVerdict(-0.06)).toBe("worse");
  });
});

/*
  THE RECEIPT.

  The digest in `lib/gdp-pdf-page-data.ts` is the page's claim about which bytes it is rendering.
  This recomputes it. `.gitattributes` pins the artifact to LF, so this is the same number on a
  Windows working tree and on the CI runner; when it is not, the failure prints the value to
  paste.
*/
describe("the committed artifacts", () => {
  it.each(GDP_PDF_RUNS.map((run) => [run.id, run] as const))("%s hashes to the digest the page publishes", (_, run) => {
    const bytes = readFileSync(runFile(run));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(run.sha256);
  });

  it.each(GDP_PDF_RUNS.map((run) => [run.id, run] as const))("%s is stored with LF line endings under content/benchmarks/", (_, run) => {
    expect(run.path).toMatch(/^nextjs\/content\/benchmarks\/[a-z0-9-]+\.json$/);
    expect(readFileSync(runFile(run), "utf8")).not.toContain("\r\n");
  });

  it.each(GDP_PDF_RUNS.map((run) => [run.id, run] as const))("%s passes the validator it is rendered through", (_, run) => {
    expect(() => gdpPdfReport(run)).not.toThrow();
  });

  it("names each run once, and the page's artifact is the newest run's", () => {
    expect(new Set(GDP_PDF_RUNS.map((run) => run.id)).size).toBe(GDP_PDF_RUNS.length);
    expect(new Set(GDP_PDF_RUNS.map((run) => run.path)).size).toBe(GDP_PDF_RUNS.length);
    expect([GDP_PDF_ARTIFACT_PATH, GDP_PDF_ARTIFACT_SHA256]).toEqual([GDP_PDF_RUNS[0]!.path, GDP_PDF_RUNS[0]!.sha256]);
    expect(gdpPdfReport()).toBe(GDP_PDF_RUNS[0]!.report);
  });

  /*
    v2 is historical evidence: the negative two-arm result stays published, under its own name and
    bytes, whatever is added above it. Removing it or rewriting its file fails here.
  */
  it("keeps v2 in the list, oldest, at its own path and digest", () => {
    expect(GDP_PDF_RUNS.at(-1)).toMatchObject({
      id: "v2",
      path: "nextjs/content/benchmarks/gdp-pdf.json",
      sha256: "0302712c8a0570492347d604c00a8090bff13b92cd96190d3844798aa258f953",
    });
  });

  it("refuses a run whose report does not hold, naming the run's own path", () => {
    expect(() => gdpPdfReport({ id: "bad", path: "nextjs/content/benchmarks/bad.json", sha256: "0".repeat(64), report: {} }))
      .toThrow(/^nextjs\/content\/benchmarks\/bad\.json is not a publishable run report/);
  });
});

describe("gdpPdfPreviousRuns", () => {
  const newer: GdpPdfRun = { id: "next", path: "nextjs/content/benchmarks/next.json", sha256: "e".repeat(64), report: validReport() };

  it("is empty while one run is published, so the page prints no table", () => {
    expect(GDP_PDF_RUNS).toHaveLength(1);
    expect(gdpPdfPreviousRuns()).toEqual([]);
  });

  it("lists every run after the newest, each read from its own report with its denominators", () => {
    const v2 = GDP_PDF_RUNS.at(-1)!;
    const report = gdpPdfReport(v2);
    expect(gdpPdfPreviousRuns([newer, v2])).toEqual([{
      id: "v2",
      path: v2.path,
      sha256: v2.sha256,
      seed: report.manifest.seed,
      model: report.manifest.surface.declared_model,
      native: { count: report.arms.native_pdf.macro_all_pass_count, n: report.arms.native_pdf.n },
      compiled: { count: report.arms.compiled_context_pdf.macro_all_pass_count, n: report.arms.compiled_context_pdf.n },
      macroDeltaPp: report.pairwise_delta.macro_delta_pp,
      pairedN: report.pairwise_delta.paired_n,
      deviations: gdpPdfDeviations(report).length,
    }]);
  });

  it("refuses a previous run whose report does not hold, rather than dropping its row", () => {
    expect(() => gdpPdfPreviousRuns([newer, { ...newer, id: "broken", report: { ...validReport(), arms: {} } }])).toThrow(/is not a publishable run report/);
  });
});

/*
  THE FIGURES. Both are drawn from the report, and their alt text is written by the same function,
  so a figure cannot show a count its text does not state.
*/
describe("the two figures", () => {
  const report = gdpPdfReport();

  it("draws the two-arm design from the manifest", () => {
    const figure = gdpPdfDesignFigure(report);
    expect(figure).toMatchObject({ tasks: report.manifest.tasks_attempted, model: report.manifest.surface.declared_model });
    expect(report.manifest.judge.startsWith(figure.judge)).toBe(true);
    expect(figure.alt).toContain(`For each of ${report.manifest.tasks_attempted} tasks`);
    expect(figure.alt).toContain("compiled context");
  });

  it("draws every arm's all-criteria count over its denominator, and the compiled-available subset beside it", () => {
    const figure = gdpPdfPassFigure(report);
    const subset = report.compiled_available_subset!;
    expect(figure.groups.map((group) => [group.id, group.n, group.bars.map((bar) => [bar.arm, bar.count, bar.n])])).toEqual([
      ["all", report.arms.native_pdf.n, GDP_PDF_PAGE_ARMS.map((arm) => [arm, report.arms[arm].macro_all_pass_count, report.arms[arm].n])],
      ["compiled_available", subset.n, GDP_PDF_PAGE_ARMS.map((arm) => [arm, subset[arm]!.macro_all_pass_count, subset[arm]!.n])],
    ]);
    for (const group of figure.groups) for (const bar of group.bars) expect(figure.alt).toContain(`${bar.count} of ${bar.n}`);
  });

  it("drops the subset pair when the report carries no subset counts, rather than inventing them", () => {
    const { compiled_available_subset: _, ...rest } = report;
    expect(gdpPdfPassFigure(rest as typeof report).groups.map((group) => group.id)).toEqual(["all"]);
  });

  it("refuses a subset arm that does not hold", () => {
    const broken = { ...validReport(), compiled_available_subset: { n: 4, native_pdf: { ...summary(), macro_all_pass: 0.9 } } };
    expect(validateGdpPdfReport(broken)).toContain("compiled_available_subset.native_pdf.macro_all_pass: rate does not equal macro_all_pass_count / n");
  });
});

describe("gdpPdfDeviations", () => {
  const deviations = gdpPdfDeviations();

  it("is not empty -- this run is not official-comparable and says why", () => {
    expect(gdpPdfReport().official_comparable).toBe(false);
    expect(deviations.length).toBeGreaterThan(0);
  });

  it("names the surface, the judge and the dataset revision", () => {
    const ids = deviations.map((deviation) => deviation.id);
    expect(ids).toContain("surface");
    expect(ids).toContain("judge");
    expect(ids).toContain("dataset_revision");
  });

  it("reads the actual values from the manifest rather than restating them", () => {
    const manifest = gdpPdfReport().manifest;
    expect(deviations.find((d) => d.id === "judge")?.actual).toBe(manifest.judge);
    expect(deviations.find((d) => d.id === "dataset_revision")?.actual).toBe(manifest.dataset_revision);
  });
});

describe("gdpPdfFailureNotes", () => {
  it("states the adapter failures the committed run produced, with their denominator", () => {
    const notes = gdpPdfFailureNotes();
    const compiled = gdpPdfReport().arms.compiled_context_pdf;
    expect(notes.some((note) => note.includes(`${compiled.adapter_failures} of ${compiled.n}`))).toBe(true);
  });

  it("says the cost figure is incomplete while the report says it is", () => {
    expect(gdpPdfFailureNotes().some((note) => note.includes("understates the run"))).toBe(true);
  });
});

/*
  THE PAGE.

  Rendered, then read for the four things a reader must not be able to lose: the label that it is
  not comparable, the denominator beside the headline rate, the deviation rows, and the absence of
  a claim the artifact does not carry.
*/
describe("the rendered page", () => {
  const html = renderToStaticMarkup(createElement(GdpPdfBenchmarkPage));
  const report = gdpPdfReport();

  it("renders the headline sentence the delta's sign selects", () => {
    expect(html).toContain(
      gdpPdfDeltaSentence(report.pairwise_delta.macro_delta_pp, report.pairwise_delta.paired_n, "the all-criteria pass rate")
        .replace(/'/g, "&#x27;"),
    );
  });

  it("marks the verdict in the DOM so it can be read without parsing prose", () => {
    expect(html).toContain(`data-verdict="${gdpPdfVerdict(report.pairwise_delta.macro_delta_pp)}"`);
  });

  it("titles itself from the delta rather than from copy", () => {
    expect(html).toContain(gdpPdfHeadline(report.pairwise_delta.macro_delta_pp));
  });

  it("states that it is not comparable with published GDP.pdf scores", () => {
    expect(html).toContain("Not comparable with published GDP.pdf scores");
  });

  it("prints every arm rate beside the count it came from", () => {
    for (const arm of GDP_PDF_PAGE_ARMS) {
      const s = report.arms[arm];
      expect(html).toContain(`${s.macro_all_pass_count} of ${s.n}`);
    }
  });

  it("prints every deviation the manifest carries", () => {
    for (const deviation of gdpPdfDeviations(report)) expect(html).toContain(deviation.label);
  });

  it("says the cost figure is a list-price equivalent", () => {
    expect(html).toContain("list-price equivalent");
  });

  it("carries no document title or answer text -- only task ids", () => {
    for (const row of report.hardest_documents ?? []) {
      expect(html).toContain(row.task_id.slice(0, 8));
    }
    /* The restricted run store's own path is not a public fact. */
    expect(html).not.toContain("CodexData");
  });

  it("draws both figures as inline SVG whose alt text states the counts", () => {
    const svgs = [...html.matchAll(/<svg [^>]*role="img"[^>]*aria-label="([^"]*)"[^>]*data-gdp-figure="([a-z]+)"/g)].map((match) => [match[2], match[1]]);
    expect(svgs.map(([id]) => id)).toEqual(["design", "pass"]);
    const unescape = (text: string) => text.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    expect(unescape(svgs[0]![1]!)).toBe(gdpPdfDesignFigure(report).alt);
    expect(unescape(svgs[1]![1]!)).toBe(gdpPdfPassFigure(report).alt);
    // Bar widths are counts over their own denominators, at the drawing's 200-unit scale.
    for (const group of gdpPdfPassFigure(report).groups) for (const bar of group.bars) {
      expect(html).toContain(`width="${(bar.count / bar.n) * 200}" height="14" data-count="${bar.count}" data-n="${bar.n}"`);
    }
    expect(html).not.toContain("<script");
  });

  it("prints no previous-runs table while one run is published", () => {
    expect(html).not.toContain("Previous runs");
    expect(html).not.toContain("data-gdp-previous-run");
  });

  it("claims no lift while the committed delta is not positive", () => {
    if (report.pairwise_delta.macro_delta_pp <= 0) {
      const main = html.slice(html.indexOf('<main id="main"'));
      expect(main).not.toMatch(/outperform|beats the|lift of|improvement of/i);
    }
  });
});

/*
  THE 360px GUARD, as far as a node test can carry it.

  The e2e overflow sweep is the real check and this route is in its list. It cannot run in this
  worktree (`@vercel/functions` is declared but absent from the shared node_modules, so
  `next build` fails before Playwright starts), and a CSS module resolves to `{}` under vitest, so
  the rendered markup carries no class names to assert on.

  What is still checkable is the source invariant that makes the page safe at 360px: every wide
  table sits in a scroll frame of its own, and the 64-character digests carry a break rule. A
  table added without its frame is the exact regression that turns the document sideways, and it
  fails here rather than three CI jobs later.
*/
describe("the page cannot scroll the document sideways", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../app/benchmarks/gdp-pdf/page.tsx"), "utf8");
  const sheet = readFileSync(resolve(import.meta.dirname, "../app/benchmarks/gdp-pdf/gdp-pdf.module.css"), "utf8");

  it("wraps every table in a scroll frame", () => {
    const tables = source.match(/<table className=\{styles\.table\}/g) ?? [];
    const frames = source.match(/<div className=\{styles\.tableScroll\}/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    expect(frames.length).toBe(tables.length);
  });

  it("gives that frame its own overflow and a min-width of zero", () => {
    expect(sheet).toMatch(/\.tableScroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(sheet).toMatch(/\.tableScroll\s*\{[^}]*min-width:\s*0/);
  });

  it("lets a 64-character digest break", () => {
    expect(sheet).toMatch(/\.digest\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});

describe("the route's public surface", () => {
  it("declares its own canonical", () => {
    expect(metadata.alternates?.canonical).toBe("/benchmarks/gdp-pdf");
  });

  it("is advertised in the sitemap", () => {
    expect(sitemap().some((entry) => entry.url.endsWith("/benchmarks/gdp-pdf"))).toBe(true);
  });

  it("is measured, because what is advertised is what is measured", () => {
    expect(publicPageLocation("/benchmarks/gdp-pdf")).toBe("https://tavonel.com/benchmarks/gdp-pdf");
  });
});

/*
  hard-proof 2026-10-27 (FINAL-SPEC-HARD-PROOF §1): the "Compiler release" receipt row renders only
  for a report that names the release its compiled arm ran on. v2 names none, so its page has no
  row; a report naming a release this site does not define is refused, not rendered without it.
*/
describe("the compiler release row", () => {
  it("is absent for v2, which names no release", () => {
    expect(gdpPdfReport().compilerRelease).toBeUndefined();
    expect(gdpPdfCompilerRelease()).toBeNull();
    const html = renderToStaticMarkup(createElement(GdpPdfBenchmarkPage));
    expect(html).not.toContain("data-compiler-release");
    expect(html).not.toContain(COMPILER_RELEASE.name);
  });

  it("names the release, its digest and the definition for a report that carries it", () => {
    const report = { ...validReport(), compilerRelease: "compiler-1" };
    expect(validateGdpPdfReport(report)).toEqual([]);
    expect(gdpPdfCompilerRelease(report as never)).toEqual({
      label: "TAVONEL Compiler 1", digest: COMPILER_RELEASE.digest, definition: COMPILER_RELEASE_DEFINITION.en,
    });
  });

  it("prints the definition of the release the report names, not Compiler 1's", () => {
    const report = { ...validReport(), compilerRelease: "compiler-1-1" };
    expect(validateGdpPdfReport(report)).toEqual([]);
    expect(gdpPdfCompilerRelease(report as never)).toEqual({
      label: "TAVONEL Compiler 1.1", digest: COMPILER_RELEASE_1_1.digest, definition: COMPILER_RELEASE_1_1.definition.en,
    });
  });

  it("refuses a report that names a release this site does not define", () => {
    for (const compilerRelease of ["compiler-2", "T1", "", 1]) {
      expect(validateGdpPdfReport({ ...validReport(), compilerRelease })).toContain("compilerRelease: not a release lib/compiler-release.ts defines");
    }
  });
});
