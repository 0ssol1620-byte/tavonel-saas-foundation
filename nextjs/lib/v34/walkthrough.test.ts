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

  it("returns the text unchanged, run by run, and marks nothing in plain words", () => {
    for (const t of texts) expect(identifierRuns(t).map((r) => r.text).join("")).toBe(t);
    expect(ids("Relation: addresses · status: changed")).toEqual([]);
  });
});
