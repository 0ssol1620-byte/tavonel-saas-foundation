import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const finalCss = readFileSync(new URL("../app/ux-120-final.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../app/workspace/workspace-ultimate.module.css", import.meta.url), "utf8");

describe("workspace mobile layout contract", () => {
  it("switches workspace content at the same 820px breakpoint as the bottom rail", () => {
    const mobile = finalCss.slice(finalCss.lastIndexOf("@media (max-width: 820px)"));

    expect(mobile).toContain(".workspace-content");
    expect(mobile).toContain(".workspace .workspace-body > header > div:first-child { display: none; }");
    expect(mobile).toContain("overflow-x: clip");
    expect(mobile).toContain(".workspace-intake-actions");
    expect(mobile).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(mobile).toContain(".workspace-source-choices { display: none; }");
  });

  it("reserves device safe area for the fixed navigation instead of covering content", () => {
    const railMobile = shellCss.slice(shellCss.indexOf("@media (max-width: 820px)"));

    expect(railMobile).toContain("padding-bottom: calc(64px + env(safe-area-inset-bottom))");
    expect(railMobile).toContain("height: calc(64px + env(safe-area-inset-bottom))");
    expect(railMobile).toContain(".brand, .railFooter, .workspaceIdentity { display: none; }");
    expect(railMobile).toContain("grid-template-columns: repeat(2, minmax(0, 1fr)) 48px");
  });
});