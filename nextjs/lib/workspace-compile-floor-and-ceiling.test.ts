import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPILE_MAX_DOCUMENTS, CORPUS_MAX_DOCUMENTS, judgeCompileSet } from "./compile-limits";
import { judgeCorpusSet } from "./corpus-batching";

const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
const compileStage = readFileSync(new URL("../components/compile-stage.tsx", import.meta.url), "utf8");
const workspaceCss = readFileSync(new URL("../app/workspace-no1.css", import.meta.url), "utf8");

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

  What moved since: thirteen files are no longer refused at all. The gate is now the run
  ceiling, which matches intake, and a selection above one compile's worth is partitioned into
  parts server-side. The per-compile limit still exists and still gates the synchronous route;
  it is no longer the answer to "how many sources may I choose".

  Both are asserted against the source because they are control-flow facts in a client
  component, and the thing that broke was a comparison operator in one branch.
*/
describe("workspace compile floor and ceiling", () => {
  it("sends a single uploaded document on to compile", () => {
    expect(workspace).not.toContain("ids.length >= 2");
    // The destination changed -- the batch now starts a durable job instead of driving the
    // compile from here -- and the gate it passes through did not.
    expect(workspace).toContain("if (judgeCorpusSet(ids.length).ok) await startDurableCompile(ids);");
  });

  it("refuses an over-ceiling selection before anything is uploaded", () => {
    expect(workspace).toContain("const stagedVerdict = judgeCorpusSet(stagedSelection?.files.length ?? 0);");
    // The button cannot start an upload the compile step would refuse...
    expect(workspace).toContain("!stagedVerdict.ok} onClick={() => void startStagedCompile()}");
    // ...and the handler refuses it too, so the contract does not depend on the disabled prop.
    expect(workspace).toContain("const verdict = judgeCorpusSet(stagedSelection.files.length);");
    // The reason is shown rather than the files being silently dropped.
    expect(workspace).toContain("workspace-preflight-blocked");
  });

  it("moves an authorised staged compile into the real live Sources view before upload begins", () => {
    expect(workspace).toContain('navigateSurface("sources")');
    // Every surface starts at the top now; the anchor map that scrolled past shared blocks is gone.
    expect(workspace).toContain("window.scrollTo({ top: 0 });");
    expect(workspace.indexOf('navigateSurface("sources")')).toBeLessThan(workspace.indexOf("await uploadDocuments(files)"));
  });

  /*
    The same intent as before -- live compilation belongs to Knowledge, and to Home only while a
    run is in flight, and a narrow screen gets one readable stage rather than four slivers --
    now asserted against the 09-17 stage (BQ-083). The width branch is gone because there is no
    longer a wide layout to branch to: one chapter plays at a time at every width, so the phone
    case cannot regress separately from the desktop one.
  */
  it("keeps live compilation on Knowledge (and on Home while a run is in flight) and plays one chapter at a time", () => {
    const sourcesGate = workspace.indexOf('{surface === "sources" ? <>');
    const stageOnSources = workspace.indexOf("{compileBlock}", sourcesGate);
    expect(sourcesGate).toBeGreaterThan(-1);
    expect(stageOnSources).toBeGreaterThan(sourcesGate);
    expect(workspace).toContain("<CompileStage rows={pipelineRows}");

    // One pane, chosen by how far the run has got -- not four columns.
    expect(compileStage).toContain("/* One pane. Not four, and not four with three of them empty. */");
    expect(compileStage).toContain("if (reached === 0) drawSources");
    expect(compileStage).not.toContain("if (width < 760)");
    // The chapter names are the shared vocabulary, not a fifth set of labels.
    expect(compileStage).toContain('import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary"');
    expect(compileStage).toContain("PIPELINE_STAGES.forEach((stage, i)");
    expect(compileStage).not.toContain('const labels = ["SOURCES", "READ", "STRUCTURE", "WORLD"]');
  });

  /*
    D39. The reserved frame is space for a picture. Before a run has drawn one, the pane is a tab
    strip over a short source list, and the reservation left 490px of black under it at 1440
    (workspace-01). Asserted against the source for the same reason the two below are: what has to
    stay true is a branch in a client component and a selector in a sheet no DOM test reads.
  */
  it("reserves the aspect-ratio frame only while a run is playing", () => {
    expect(compileStage).toContain("const framed = reached > 0 || (state !== null && STARTING.includes(state));");
    expect(compileStage).toContain('data-framed={framed ? "true" : "false"}');
    // Idle it carries its own drawn height, and the sheet stops reserving a ratio.
    expect(compileStage).toContain("style={framed || !drawable ? undefined : { height: idleHeight }}");
    expect(workspaceCss).toContain('.compile-stage[data-framed="false"] { aspect-ratio: auto; min-height: 0; }');
  });

  /*
    BQ-021 and BQ-022, as source facts, for the same reason the two above are: they are
    control-flow and colour decisions inside a canvas that no DOM assertion can see.
  */
  it("draws from tokens and from job position, never from a hash of a filename", () => {
    // No hashed hue, no hashed geometry, no private palette.
    expect(compileStage).not.toContain("16777619");
    expect(compileStage).not.toContain("AREA_RGB");
    // No literal paint anywhere the canvas actually draws.
    expect(compileStage).not.toMatch(/(?:fillStyle|strokeStyle) = "(?:#|rgb)/);
    expect(compileStage).toContain("const computed = window.getComputedStyle(section)");
    // A stage that has been passed stays passed: position is the max of observation and record.
    expect(compileStage).toContain("Math.max(observed, state ? STAGE_OF_STATE[state] : 0)");
    expect(compileStage).toContain("const done = settled || i < current;");
    // A canvas with no context reports itself instead of painting nothing.
    expect(compileStage).toContain("setDrawable(false)");
  });

  it("agrees with the shared judgement at both ends", () => {
    expect(judgeCompileSet(1).ok).toBe(true);
    expect(judgeCompileSet(COMPILE_MAX_DOCUMENTS).ok).toBe(true);
    expect(judgeCompileSet(COMPILE_MAX_DOCUMENTS + 1).ok).toBe(false);
    expect(judgeCompileSet(0).ok).toBe(false);
    // And the gate the workspace actually uses accepts the archive-sized selection, which is
    // the whole point: 13 files no longer get read and then refused.
    expect(judgeCorpusSet(COMPILE_MAX_DOCUMENTS + 1).ok).toBe(true);
    expect(judgeCorpusSet(CORPUS_MAX_DOCUMENTS).ok).toBe(true);
    expect(judgeCorpusSet(CORPUS_MAX_DOCUMENTS + 1).ok).toBe(false);
    expect(judgeCorpusSet(0).ok).toBe(false);
  });
});
