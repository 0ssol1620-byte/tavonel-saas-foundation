import { describe, expect, it } from "vitest";
import {
  WALKTHROUGH_ANSWER_LABEL, WALKTHROUGH_LABEL, WALKTHROUGH_STEPS,
} from "./walkthrough";

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
