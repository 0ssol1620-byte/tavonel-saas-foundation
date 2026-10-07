import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CONTRACT_CLAUSES, CONTRACT_STATE, INTEROP_STANDARDS, PACKAGE_FORMATS } from "./compiler-contract";

// Isolate this route's layout from shared chrome and the unchanged five-snapshot timeline.
vi.mock("@/components/public-site-chrome", () => ({ PublicSitePage: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
vi.mock("@/components/breadcrumb-json-ld", () => ({ default: () => null, DocBreadcrumb: () => null }));
vi.mock("@/components/world-recompile-timeline", () => ({ default: () => createElement("figure", { "data-retained-timeline": "" }) }));
import ContinuousKnowledgePage from "../app/product/continuous-knowledge/page";

const html = () => renderToStaticMarkup(createElement(ContinuousKnowledgePage));
const text = (value: string) => renderToStaticMarkup(createElement("span", null, value)).slice(6, -7);

describe("Continuous Knowledge business-first presentation", () => {
  it("leads with the operating summary and a real comparison path before the contract", () => {
    const markup = html();
    expect(markup).toContain("See what changed before you activate it.");
    expect(markup).toContain("Compile a candidate");
    expect(markup).toContain("Compare the versions");
    expect(markup).toContain("Choose what becomes current");
    const summary = markup.indexOf('aria-labelledby="working-summary"');
    const change = markup.indexOf('href="/explore?act=change"', summary);
    const contract = markup.indexOf('id="clauses"');
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(change).toBeGreaterThan(summary);
    expect(contract).toBeGreaterThan(change);
    expect(markup.indexOf('data-state="demonstrated"')).toBeGreaterThan(contract);
    expect(markup).toContain('href="#clauses"');
    expect(markup.match(/data-retained-timeline=""/g)).toHaveLength(1);
    const heading = markup.indexOf("See what changed before you activate it.");
    const timeline = markup.indexOf('data-retained-timeline=""');
    expect(heading).toBeLessThan(summary);
    expect(summary).toBeLessThan(timeline);
  });

  it("keeps every clause anchor, promise and registered state visible before its explanation", () => {
    const markup = html();
    expect(markup.match(/data-contract-clause=""/g)).toHaveLength(CONTRACT_CLAUSES.length);
    for (const clause of CONTRACT_CLAUSES) {
      const row = markup.match(new RegExp(`<li[^>]*id="${clause.id}"[\\s\\S]*?</li>`))?.[0];
      expect(row, clause.id).toBeDefined();
      const detail = row!.indexOf('<details');
      expect(detail).toBeGreaterThan(row!.indexOf(text(clause.promise)));
      expect(row!.slice(0, detail)).toContain(CONTRACT_STATE[clause.state].label);
      expect(row).toContain(text(clause.body));
      expect(row).toContain(text(clause.evidence));
      expect(row).toContain(`Read ${clause.name}: explanation and evidence`);
    }
  });

  it("defaults only long explanations and technical references to native closed disclosures", () => {
    const markup = html();
    const details = [...markup.matchAll(/<details([^>]*)>/g)];
    expect(details).toHaveLength(CONTRACT_CLAUSES.length + 2);
    for (const [, attributes] of details) expect(attributes).not.toMatch(/\bopen(?:=|\s|$)/);
    expect(markup.match(/data-contract-detail=""/g)).toHaveLength(CONTRACT_CLAUSES.length);
    expect(markup).toContain('data-contract-reference="flow"');
    expect(markup).toContain('data-contract-reference="interop"');
    for (const id of ["clauses", "flow", "interop"]) expect(markup).toContain(`id="${id}"`);
    expect(markup).not.toContain("<dialog");
  });

  it("retains the current-runtime and sample qualifications without promoting a direction", () => {
    const markup = html();
    expect(CONTRACT_CLAUSES.find(clause => clause.id === "selective-recompilation")!.state).toBe("direction");
    expect(markup).toContain("Current compilation rebuilds the whole collection.");
    expect(markup).toContain("public timeline compares complete compiles after the fact");
    expect(markup).toContain("Solid is what TAVONEL executes");
    expect(markup).toContain("rebuilds the whole collection it is given into a candidate version a person");
    expect(markup).toContain("Everything dashed");
    expect(markup).not.toContain('data-state="qualified"');
    expect(markup).toContain(`No clause on this page is marked ${CONTRACT_STATE.qualified.label}`);
    const timeline = readFileSync(new URL("../components/world-recompile-timeline.tsx", import.meta.url), "utf8");
    expect(timeline).toContain("Every World above is a complete compile of its corpus, compared after the fact.");
    expect(timeline).toContain("TAVONEL has no selective path");
  });

  it("keeps all flow stages, format records and interchange qualifications available", () => {
    const markup = html();
    expect(markup.match(/data-contract-stage="/g)).toHaveLength(10);
    expect(markup.match(/data-interop-standard=""/g)).toHaveLength(INTEROP_STANDARDS.length);
    for (const [format, path] of PACKAGE_FORMATS) { expect(markup).toContain(text(format)); expect(markup).toContain(text(path)); }
    for (const standard of INTEROP_STANDARDS) { expect(markup).toContain(text(standard.name)); expect(markup).toContain(text(standard.note)); }
    expect(markup).toContain("the check runs offline");
    expect(markup).toContain("fingerprint taken from somewhere other than the archive");
  });
});
