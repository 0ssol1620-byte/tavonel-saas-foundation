import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WALKTHROUGH_ANSWER_LABEL, WALKTHROUGH_LABEL, WALKTHROUGH_STEPS,
} from "./walkthrough";
import { identifierRuns } from "@/components/v34/walkthrough/identifiers";

const OFFICIAL_HOSTS = new Set(["nist.gov", "csrc.nist.gov"]);
const texts = WALKTHROUGH_STEPS.flatMap((s) => [
  s.label, s.heading, s.body, s.nextLabel,
  s.record.kind, s.record.title, s.record.meta, s.record.linkLabel,
]);

describe("home reference walkthrough data", () => {
  it("has exactly four steps in lifecycle order", () => {
    expect(WALKTHROUGH_STEPS.map((s) => s.label)).toEqual(["Connect", "Compile", "Keep current", "Use with AI"]);
  });

  it("links only to https pages on official NIST domains", () => {
    for (const { record } of WALKTHROUGH_STEPS) {
      const url = new URL(record.url);
      expect(url.protocol).toBe("https:");
      expect(OFFICIAL_HOSTS.has(url.hostname)).toBe(true);
    }
  });

  it("chains next labels to the following step and wraps on the last", () => {
    WALKTHROUGH_STEPS.forEach((s, i) => {
      const next = WALKTHROUGH_STEPS[i + 1];
      expect(s.nextLabel).toBe(next ? `Next: ${next.label}` : "Start again");
    });
  });

  it("labels the final answer as a reference answer", () => {
    expect(WALKTHROUGH_LABEL).toBe("Reference walkthrough");
    expect(WALKTHROUGH_STEPS[3]?.record.kind).toBe(WALKTHROUGH_ANSWER_LABEL);
  });

  it("carries no internal identifiers and no disclaimer sentences", () => {
    for (const t of texts) {
      expect(t).not.toMatch(/\b(?:D|U|EG)\d{2,}\b/);
      expect(t).not.toMatch(/\bnot an?\b/i);
      expect(t).not.toMatch(/isn['’]t|aren['’]t|\bnot established\b/i);
    }
  });
});

describe("identifiers in the walkthrough's record text", () => {
  const ids = (t: string) => identifierRuns(t).filter((r) => r.id).map((r) => r.text);

  it("keeps each standard identifier whole, with what names it", () => {
    expect(ids("NIST SP 800-53 / Rev. 5")).toEqual(["NIST SP 800-53", "Rev. 5"]);
    expect(ids("SA-24 · Design for Cyber Resiliency")).toEqual(["SA-24"]);
    expect(ids("Release 5.2.0 → SA-24")).toEqual(["Release 5.2.0", "SA-24"]);
  });

  it("leaves a sentence-final period outside the identifier", () => {
    expect(ids("Release 5.2.0.")).toEqual(["Release 5.2.0"]);
    expect(ids("See NIST SP 800-53.")).toEqual(["NIST SP 800-53"]);
    expect(identifierRuns("Release 5.2.0.").map((r) => r.text)).toEqual(["Release 5.2.0", "."]);
  });

  it("leaves a hyphen dangling before that period outside it too", () => {
    expect(ids("See SP 800-53-. Then")).toEqual(["SP 800-53"]);
    expect(identifierRuns("see 800-. next").map((r) => r.text)).toEqual(["see ", "800", "-. next"]);
  });

  it("returns the text unchanged, run by run, and marks nothing in plain words", () => {
    for (const t of texts) expect(identifierRuns(t).map((r) => r.text).join("")).toBe(t);
    expect(ids("Relation: addresses · status: changed")).toEqual([]);
  });
});

/*
  A regular-expression lookbehind is a SyntaxError when the module is parsed on Safari and iOS
  before 16.4, which takes the whole client chunk down with it. No source under app, components or
  lib uses one, except a server module that imports a node: builtin: no browser bundle can hold
  that module, so its lookbehind never reaches a browser. Those are named below, so a new one is a
  decision rather than a pass. Test files run in Node only and are not scanned.
*/
describe("no lookbehind in code that can reach a browser", () => {
  const nextjs = join(import.meta.dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const sources = ["app", "components", "lib"]
    .flatMap((dir) => walk(join(nextjs, dir)))
    .filter((file) => /\.(?:tsx?|jsx?|mjs)$/.test(file) && !/\.(?:test|spec)\.[jt]sx?$/.test(file))
    .map((file) => ({ name: relative(nextjs, file).replaceAll("\\", "/"), text: readFileSync(file, "utf8") }));
  const lookbehind = sources.filter((f) => f.text.includes("(?<=") || f.text.includes("(?<!"));
  const serverOnly = (text: string) => /^import [^;]* from "node:[\w/]+";/m.test(text);

  it("scans every source under app, components and lib, the V34 ones included", () => {
    for (const name of ["components/v34/walkthrough/identifiers.ts", "components/docs/code-tokens.tsx", "components/landing-v2/hero-statement.tsx", "app/page.tsx"]) {
      expect(sources.some((f) => f.name === name), name).toBe(true);
    }
  });

  it("finds none outside server modules", () => {
    expect(lookbehind.filter((f) => !serverOnly(f.text)).map((f) => f.name)).toEqual([]);
  });

  it("excuses exactly the server modules that import a node: builtin", () => {
    expect(lookbehind.filter((f) => serverOnly(f.text)).map((f) => f.name).sort()).toEqual([
      "lib/collection-compiler.ts",
      "lib/library-methods.ts",
      "lib/r2-objects.ts",
    ]);
  });
});
