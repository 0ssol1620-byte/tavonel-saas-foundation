import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { failureSentence } from "./workspace-failure-copy";

const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
const connections = readFileSync(new URL("../components/connections-panel.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/compile-job-panel.tsx", import.meta.url), "utf8");

describe("workspace failure copy", () => {
  it("turns a known code into a sentence and never prints the code on its own", () => {
    expect(failureSentence("AUTH_REQUIRED", 401)).toBe("Your session has expired. Sign in again.");
    expect(failureSentence("AUTH_REQUIRED", 401)).not.toContain("AUTH_REQUIRED");
  });

  it("keeps an unmapped code reachable as a reference rather than dropping it", () => {
    const sentence = failureSentence("SOME_NEW_CODE", 500);
    expect(sentence.startsWith("Our servers could not complete this.")).toBe(true);
    expect(sentence).toContain("Reference SOME_NEW_CODE.");
  });

  it("says something useful when there is no code at all", () => {
    expect(failureSentence(null, 429)).toBe("Too many requests at once. Wait a minute and try again.");
    expect(failureSentence(undefined, 404)).not.toContain("Reference");
  });

  /*
    BQ-088 as a source fact: the workspace used to hang `(${json.code ?? response.status})` off
    fifteen otherwise readable lines. One shape, one place, so a new route cannot reintroduce
    the pattern by copying the line above it.
  */
  it("leaves no raw (code ?? status) parenthetical on a customer-facing line", () => {
    for (const [name, source] of [["workspace", workspace], ["connections", connections], ["compile job panel", panel]] as const) {
      expect(source, name).not.toContain("?? response.status})");
      expect(source, name).not.toContain("?? capability.status})");
    }
    expect(workspace).toContain('from "@/lib/workspace-failure-copy"');
  });
});
