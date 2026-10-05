import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/workspace-no1.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
const triage = readFileSync(new URL("../components/intake-triage-review.tsx", import.meta.url), "utf8");
const actions = ".one-path-workspace .workspace-preflight > .workspace-intake-actions";
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("staged intake triage layout", () => {
  it("gives nested triage the inventory width and Clear its own unstretched row", () => {
    expect(workspace).toMatch(/<IntakeTriageReview[\s\S]*?\/>\s*<button[\s\S]*?>Clear<\/button>/);
    expect(triage).toContain('<section className="workspace-preflight" aria-label="Server source triage">');
    expect(rule(actions)).toContain("display: grid;");
    expect(rule(actions)).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule(actions)).toContain("align-items: start;");
    expect(rule(`${actions} > .workspace-preflight`)).toContain("width: 100%;");
    expect(rule(`${actions} > .workspace-preflight`)).toContain("padding: 20px 0 0;");
    const clear = rule(`${actions} > button`);
    expect(clear).toContain("align-self: start;");
    expect(clear).toContain("justify-self: start;");
    expect(clear).toContain("width: auto;");
    expect(clear).toContain("min-height: 44px;");
  });

  it("stacks the source label and a shrinkable 44px selector without hiding overflow", () => {
    const label = rule(`${actions} > .workspace-preflight .workspace-preflight-files label`);
    const select = rule(`${actions} > .workspace-preflight .workspace-preflight-files select`);
    expect(label).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(label).toContain("min-width: 0;");
    expect(select).toContain("width: min(100%, 420px);");
    expect(select).toContain("min-width: 0;");
    expect(select).toContain("min-height: 44px;");
    expect(rule(`${actions} > .workspace-preflight`)).toContain("overflow-wrap: anywhere;");
    for (const selector of [actions, `${actions} > .workspace-preflight`, `${actions} > button`]) {
      expect(rule(selector)).not.toMatch(/overflow(?:-x|-y)?\s*:\s*(?:hidden|clip)|display\s*:\s*none/);
    }
  });
});
