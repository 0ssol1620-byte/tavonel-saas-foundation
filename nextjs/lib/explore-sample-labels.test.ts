import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import secCorpusManifest from "../public/explore-sample/sec-corpus-manifest.json";

/*
  WG-034 / WG-038 / WG-091: the three things /explore has to say about itself.

  The route publishes a capture date, the scope it covers and the words "read-only sample". The
  date has to keep coming from the acquisition manifest rather than from a string somebody typed,
  because a typed date survives a re-acquisition of the sources and silently becomes wrong.

  The last test is the one the blueprint asks for in its §6.1 and the only one that cannot be
  checked by reading rendered output: that nothing on this route pretends to be compiling. A
  simulated progress sequence needs a timer to advance it, and there is no timer on the route --
  which is also the reason exploring the sample costs no processing (WG-091).
*/
const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("the Explore sample says what it is", () => {
  it("reads the capture date off the acquisition manifest", () => {
    const page = read("../app/explore/page.tsx");
    expect(page).toContain("secCorpusManifest.generatedAt.slice(0, 10)");
    // And the manifest still carries one, in the shape the label prints.
    expect(secCorpusManifest.generatedAt.slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("prints the capture date, the scope and the words read-only sample", () => {
    const stage = read("../components/explore/explore-stage.tsx");
    expect(stage).toContain("Read-only sample · sources captured {capturedOn}");
    expect(stage).toContain("{technical.documents.length} public");
  });

  it("never simulates a compile on this route", () => {
    /*
      WG-034 and WG-091: the World is compiled once at build time and the route reads it. A
      progress sequence would need a timer to advance, and there is none in the page or in any
      component of the stage -- which is also why exploring the sample costs no processing.
    */
    const directory = resolve(import.meta.dirname, "../components/explore");
    const sources = [
      read("../app/explore/page.tsx"),
      ...readdirSync(directory)
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => readFileSync(resolve(directory, name), "utf8")),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/setInterval|setTimeout/);
      expect(source).not.toMatch(/Compiling|Processing\.\.\./);
    }
    expect(read("../app/explore/page.tsx")).not.toContain('"use client"');
  });
});
