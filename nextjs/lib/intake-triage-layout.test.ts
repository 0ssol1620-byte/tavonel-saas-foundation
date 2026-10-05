import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/workspace-no1.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
const triage = readFileSync(new URL("../components/intake-triage-review.tsx", import.meta.url), "utf8");
const mountedSpec = readFileSync(new URL("../e2e/workspace-intake-triage.spec.ts", import.meta.url), "utf8");
const actions = ".one-path-workspace .workspace-preflight > .workspace-intake-actions";
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("staged intake triage layout", () => {
  it("compares paired statistics from one scroll origin without concealing a real card offset", async () => {
    const marker = "const statBoxes = await preflight.evaluate(region => {";
    const start = mountedSpec.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = mountedSpec.indexOf("\n          });", start);
    expect(end).toBeGreaterThanOrEqual(start);
    // Execute the actual browser probe with a minimal geometry fixture. A scroll frame runs
    // between awaited evaluations, but cannot interrupt the probe's synchronous callback.
    const callback = mountedSpec.slice(start + marker.length, end)
      .replace("querySelectorAll<HTMLElement>", "querySelectorAll")
      .replace("(label: string)", "(label)");
    const measure = runInNewContext(`(region => {${callback}\n})`, {
      getComputedStyle: (element: { visibility?: string }) => ({ visibility: element.visibility ?? "visible", display: "grid" }),
    }) as (region: unknown) => {
      estimated: { x: number; y: number } | null;
      maximum: { x: number; y: number } | null;
    };
    let scrollY = 0;
    const card = (label: string, x: number, offset = 0) => ({
      querySelector: () => ({ textContent: label }),
      getBoundingClientRect: () => ({ x, y: 500 + offset - scrollY, width: 140, height: 60 }),
    });
    const estimated = card("Estimated", 14);
    const maximum = card("Maximum", 155);
    const region = { querySelectorAll: () => [estimated, maximum] };
    for (const delta of [10, 37]) {
      scrollY = 0;
      const sequentialEstimated = estimated.getBoundingClientRect();
      await Promise.resolve().then(() => { scrollY += delta; });
      const sequentialMaximum = maximum.getBoundingClientRect();
      expect(Math.abs(sequentialEstimated.y - sequentialMaximum.y)).toBe(delta);
      const simultaneous = measure(region);
      expect(Math.abs(simultaneous.estimated!.y - simultaneous.maximum!.y)).toBe(0);
      expect(simultaneous.maximum!.x).toBeGreaterThan(simultaneous.estimated!.x);
    }
    const misaligned = measure({ querySelectorAll: () => [estimated, card("Maximum", 155, 10)] });
    expect(Math.abs(misaligned.estimated!.y - misaligned.maximum!.y)).toBe(10);
    expect(measure({ querySelectorAll: () => [estimated] }).maximum).toBeNull();
    const zeroAreaMaximum = { ...maximum, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) };
    expect(measure({ querySelectorAll: () => [estimated, zeroAreaMaximum] }).maximum).toBeNull();
    const hiddenMaximum = { ...maximum, visibility: "hidden" };
    expect(hiddenMaximum.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(measure({ querySelectorAll: () => [estimated, hiddenMaximum] }).maximum).toBeNull();
    expect(() => measure({ querySelectorAll: () => [estimated, maximum, maximum] })).toThrow(/Expected exactly one Maximum statistic card, found 2/);
    expect(() => measure({ querySelectorAll: () => [estimated, estimated, maximum] })).toThrow(/Expected exactly one Estimated statistic card, found 2/);
    expect(mountedSpec).toContain("expect(Math.abs(estimated!.y - maximum!.y)).toBeLessThanOrEqual(1)");
  });

  it("samples Clear, triage, selector and label ranges together while retaining real gap defects", async () => {
    const marker = "const { clearBox, triageBox, inventoryBox, selectBox, labelTextBottom } = await preflight.evaluate(region => {";
    const start = mountedSpec.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = mountedSpec.indexOf("\n        });", start);
    expect(end).toBeGreaterThanOrEqual(start);
    const callback = mountedSpec.slice(start + marker.length, end)
      .replaceAll("querySelector<HTMLElement>", "querySelector")
      .replace("(element: HTMLElement | null)", "(element)");
    let scrollY = 0;
    const textNode = { nodeType: 3, textContent: "Include in quoted set" };
    const measure = runInNewContext(`(region => {${callback}\n})`, {
      Node: { TEXT_NODE: 3 },
      document: { createRange: () => ({
        selectNodeContents: (node: unknown) => { expect(node).toBe(textNode); },
        getBoundingClientRect: () => ({ bottom: 696 - scrollY }),
      }) },
    }) as (region: unknown) => {
      clearBox: { y: number };
      triageBox: { y: number; height: number };
      selectBox: { y: number };
      labelTextBottom: number;
    };
    const rect = (y: number, height: number, width = 300) => ({ x: 14, y: y - scrollY, width, height });
    const label = { childNodes: [textNode] };
    const select = { parentElement: label, getBoundingClientRect: () => rect(700, 44, 200) };
    const triage = { querySelector: () => select, getBoundingClientRect: () => rect(500, 300) };
    const clear = { getBoundingClientRect: () => rect(800, 44, 60) };
    const inventory = { getBoundingClientRect: () => rect(200, 70) };
    const region = { querySelector: (selector: string) => selector.includes("Server source triage") ? triage : selector.endsWith("button") ? clear : inventory };
    for (const delta of [10, 37]) {
      scrollY = 0;
      const oldClear = clear.getBoundingClientRect();
      const oldSelect = select.getBoundingClientRect();
      await Promise.resolve().then(() => { scrollY -= delta; });
      const oldTriage = triage.getBoundingClientRect();
      expect(oldClear.y - (oldTriage.y + oldTriage.height)).toBe(-delta);
      expect(oldSelect.y - (696 - scrollY)).toBe(4 - delta);
      const sampled = measure(region);
      expect(sampled.clearBox.y - (sampled.triageBox.y + sampled.triageBox.height)).toBe(0);
      expect(sampled.selectBox.y - sampled.labelTextBottom).toBe(4);
    }
    const overlappingClear = { getBoundingClientRect: () => rect(790, 44, 60) };
    const overlap = measure({ querySelector: (selector: string) => selector.endsWith("button") ? overlappingClear : region.querySelector(selector) });
    expect(overlap.clearBox.y - (overlap.triageBox.y + overlap.triageBox.height)).toBe(-10);
    const raisedSelect = { ...select, getBoundingClientRect: () => rect(690, 44, 200) };
    const raisedTriage = { ...triage, querySelector: () => raisedSelect };
    const raised = measure({ querySelector: (selector: string) => selector.includes("Server source triage") ? raisedTriage : region.querySelector(selector) });
    expect(raised.selectBox.y - raised.labelTextBottom).toBe(-6);
    expect(mountedSpec).toContain("expect(clearBox!.y).toBeGreaterThanOrEqual(triageBox!.y + triageBox!.height - 1)");
    expect(mountedSpec).toContain("expect(selectBox!.y).toBeGreaterThanOrEqual(labelTextBottom + 4)");
  });

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
