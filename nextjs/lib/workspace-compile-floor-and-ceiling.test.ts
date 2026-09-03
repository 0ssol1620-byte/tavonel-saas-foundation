import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPILE_MAX_DOCUMENTS, judgeCompileSet } from "./compile-limits";

const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

/*
  Two limits, both of which were wrong on the primary intake path while every other layer
  had already been corrected.

  The floor: the compile route, the compiler and the preflight panel all accepted one
  document, but `uploadDocuments` still ended with `ids.length >= 2`. A visitor who dropped a
  single PDF watched it upload, sanitize and get read, and then nothing happened -- no error,
  the batch just ended.

  The ceiling: intake structurally accepts 128 files so a folder or archive can be inspected
  whole, and the compile ceiling was checked only at the end. Thirteen files could be
  authorised, uploaded, sanitized and read before the last step refused them, with the
  processing already spent. The masterplan names that exact state as forbidden.

  Both are asserted against the source because they are control-flow facts in a client
  component, and the thing that broke was a comparison operator in one branch.
*/
describe("workspace compile floor and ceiling", () => {
  it("sends a single uploaded document on to compile", () => {
    expect(workspace).not.toContain("ids.length >= 2");
    expect(workspace).toContain("if (judgeCompileSet(ids.length).ok) await waitForOcrAndCompile(ids);");
  });

  it("refuses an over-ceiling selection before anything is uploaded", () => {
    expect(workspace).toContain("const stagedVerdict = judgeCompileSet(stagedSelection?.files.length ?? 0);");
    // The button cannot start an upload the compile step would refuse...
    expect(workspace).toContain("!stagedVerdict.ok} onClick={() => void startStagedCompile()}");
    // ...and the handler refuses it too, so the contract does not depend on the disabled prop.
    expect(workspace).toContain("const verdict = judgeCompileSet(stagedSelection.files.length);");
    // The reason is shown rather than the files being silently dropped.
    expect(workspace).toContain("workspace-preflight-blocked");
  });

  it("agrees with the shared judgement at both ends", () => {
    expect(judgeCompileSet(1).ok).toBe(true);
    expect(judgeCompileSet(COMPILE_MAX_DOCUMENTS).ok).toBe(true);
    expect(judgeCompileSet(COMPILE_MAX_DOCUMENTS + 1).ok).toBe(false);
    expect(judgeCompileSet(0).ok).toBe(false);
  });
});
