import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  Moved with the change on 2026-09-17, same intent.

  It used to read the workspace half of `app/ux-120-final.css`. The workspace's responsive
  contract now lives in the sheet the workspace owns (`app/workspace-no1.css`), which is where
  the 09-16 redesign put it and where the token pass leaves it; asserting against a shared
  polish sheet meant this guard broke every time somebody folded one sheet into another,
  which is not what it exists to catch.

  What it still protects: content and navigation switch at the same breakpoint, the fixed bar
  reserves the device safe area exactly once, and the things a phone must be able to reach are
  reachable on a phone.
*/
const workspaceCss = readFileSync(new URL("../app/workspace-no1.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../app/workspace/workspace-ultimate.module.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/workspace-ultimate-shell.tsx", import.meta.url), "utf8");

describe("workspace mobile layout contract", () => {
  it("switches workspace content at the same 1023px breakpoint as the bottom rail", () => {
    const mobile = workspaceCss.slice(workspaceCss.indexOf("@media (max-width: 1023px)"));

    expect(mobile).toContain(".workspace-content");
    expect(mobile).toContain("overflow-x: clip");
    expect(mobile).toContain(".workspace-intake-actions");
    expect(mobile).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("reserves device safe area for the fixed navigation once, not twice", () => {
    const railMobile = shellCss.slice(shellCss.indexOf("@media (max-width: 1023px)"));

    expect(railMobile).toContain("padding-bottom: calc(64px + env(safe-area-inset-bottom))");
    expect(railMobile).toContain("height: calc(64px + env(safe-area-inset-bottom))");
    expect(railMobile).toContain("grid-template-columns: repeat(4, 1fr)");
    // BQ-085/BQ-133: the content sheet must not add a second bar-height reserve on top of it.
    const contentMobile = workspaceCss.slice(workspaceCss.indexOf("@media (max-width: 1023px)"));
    expect(contentMobile).not.toContain("padding: 18px 16px calc(96px + env(safe-area-inset-bottom))");
  });

  it("keeps the drop box, its connectors and the session controls reachable on a phone", () => {
    // BQ-023: the connectors are inside the box at every width. The rule that removed them
    // below 768px is the one this line replaces.
    const phone = workspaceCss.slice(workspaceCss.indexOf("@media (max-width: 767px)"));
    expect(phone).toContain(".workspace-source-choices { display: grid;");
    expect(workspaceCss).not.toContain(".workspace-source-choices { display: none; }");

    // BQ-026: sign-out and the privacy exit live in the panel that exists at every width, and
    // not in the rail footer the bottom bar hides.
    expect(shell).toContain("one-path-more-session");
    expect(shell).toContain("Sign out");
    expect(shell).toContain("Hide content");
    expect(shell).not.toContain("styles.railFooter");

    // BQ-094: the mark and the primary act stay in the top bar the whole way down.
    expect(shellCss.slice(shellCss.indexOf("@media (max-width: 560px)"))).not.toContain(".headerAction { display: none; }");
  });

  /*
    TOKEN_CONTRACT_0917: a tap on a phone fires :hover and leaves the control stuck in its hover
    face until something else is tapped. Every :hover these three sheets define sits inside one
    `(hover: hover) and (pointer: fine)` block; focus and selected faces stay outside it.
  */
  it("gates every hover the workspace defines on a real pointer", () => {
    const studioCss = readFileSync(new URL("../components/world-studio-ultimate.module.css", import.meta.url), "utf8");
    const sheets: Array<[string, string]> = [
      ["workspace-no1.css", workspaceCss],
      ["workspace-ultimate.module.css", shellCss],
      ["world-studio-ultimate.module.css", studioCss],
    ];
    for (const [name, css] of sheets) {
      const gate = css.indexOf("@media (hover: hover) and (pointer: fine)");
      expect(gate, `${name} defines no hover gate`).toBeGreaterThan(-1);
      const rules = css.slice(0, gate).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(rules.includes(":hover"), `${name} has an ungated :hover`).toBe(false);
    }
  });

  /*
    BQ-023 / one filled primary per viewport: on a RETURNING workspace the state hero already
    holds the filled control, so the drop box's first action steps back to a ghost. The rule
    changes a button face only -- it must not bring back the compacted 76px box D6 removed.
  */
  it("keeps one filled primary on a returning Home", () => {
    const marker = '.one-path-workspace .workspace-intake[data-existing-documents="1"] .workspace-intake-copy .workspace-intake-actions button:first-child {';
    expect(workspaceCss).toContain(marker);
    const rule = workspaceCss.slice(workspaceCss.indexOf(marker), workspaceCss.indexOf(marker) + marker.length + 180);
    expect(rule).toContain("background: transparent;");
    expect(rule).not.toContain("min-height");
  });

  it("states the surface in the markup instead of reading it off an English button title", () => {
    // BQ-086: layout can no longer break on a copy edit or a translation.
    const polish = readFileSync(new URL("../app/workspace-final-polish.css", import.meta.url), "utf8");
    expect(shell).toContain("data-surface={surface}");
    expect(polish).toContain('.workspace[data-surface="sources"]');
    const rules = polish.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toContain("button[title^=");
  });
});
