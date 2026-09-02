import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, `../${path}`), "utf8");

describe("workspace privacy mode", () => {
  it("hides customer content surfaces while leaving status controls outside the sensitive contract", () => {
    const css = read("app/workspace/workspace-ultimate.module.css");
    expect(css).toContain('.shell[data-privacy="true"] :global([data-sensitive="content"])');
    for (const path of [
      "components/compile-stage.tsx",
      "components/pipeline-board.tsx",
      "components/pdf-evidence-viewer.tsx",
      "components/world-studio-ultimate.tsx",
      "app/workspace/page.tsx",
    ]) expect(read(path), path).toContain('data-sensitive="content"');
    expect(read("components/workspace-ultimate-shell.tsx")).toContain("Hide content");
  });
});
