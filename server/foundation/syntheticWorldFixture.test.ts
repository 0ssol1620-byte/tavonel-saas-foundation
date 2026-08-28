import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type SyntheticWorldFixture = {
  schemaVersion: string;
  privacyPolicy: string;
  worlds: {
    v1: { worldStateId: string; parentWorldStateId: string | null; rules: Array<{ ruleId: string; statement: string }> };
    v2: { worldStateId: string; parentWorldStateId: string | null; rules: Array<{ ruleId: string; statement: string }> };
  };
  diff: { changedRuleIds: string[]; changeKind: string };
};

describe("synthetic world fixture", () => {
  it("encodes exactly one deterministic rule change between v1 and v2", () => {
    const fixturePath = path.resolve(process.cwd(), "docs/fixtures/synthetic-world-v1-v2.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as SyntheticWorldFixture;
    expect(fixture.schemaVersion).toBe("tavonel.synthetic_world_fixture.v1");
    expect(fixture.privacyPolicy).toBe("foundation_synthetic_only");
    expect(fixture.worlds.v2.parentWorldStateId).toBe(fixture.worlds.v1.worldStateId);
    expect(fixture.diff.changedRuleIds).toEqual(["rule_retention"]);
    expect(fixture.diff.changeKind).toBe("one_rule_change");
    expect(fixture.worlds.v1.rules[0]?.statement).not.toBe(fixture.worlds.v2.rules[0]?.statement);
    const ledger = JSON.parse(readFileSync(path.resolve(process.cwd(), "docs/fixtures/synthetic-cost-ledger.json"), "utf8")) as { usdSpent: number; gpuSeconds: number; syntheticCredits: number };
    expect(ledger.usdSpent).toBe(0);
    expect(ledger.gpuSeconds).toBe(0);
    expect(ledger.syntheticCredits).toBe(0);
  });
});
