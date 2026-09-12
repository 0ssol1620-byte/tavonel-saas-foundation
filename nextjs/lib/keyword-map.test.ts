import { describe, expect, it } from "vitest";
import {
  COOKBOOK_WORKFLOW_IDS,
  HARD_GATES,
  KEYWORD_CTAS,
  KEYWORD_MEASUREMENT_GAPS,
  KEYWORD_SEEDS,
  hardGateBlockers,
  rankByDemand,
  validateKeywordRecord,
  type KeywordRecord,
} from "./keyword-map";

/*
  The failure this file exists to catch is a plausible number.

  A keyword map is the one artifact in a growth campaign where a guess costs nothing to write and
  is indistinguishable from a measurement a week later. So the assertions below are mostly about
  absence: every numeric field is null, every row says UNMEASURED, and the validator refuses a row
  that carries a figure without naming the tool, the engine, the period and the day it was read.

  The second failure is a keyword map that quietly re-opens a gate the product has not opened.
  Three assertions are about that: a work package whose end state is an approved World may not be
  marked `live` while promote requires the Team plan, a not_live capability may not carry a sales
  CTA, and a draft cookbook may not be cited as evidence.
*/

const seed = (overrides: Partial<KeywordRecord> = {}): KeywordRecord => ({
  ...KEYWORD_SEEDS[0],
  ...overrides,
});

describe("keyword seeds", () => {
  it("holds 24 Korean and 24 English rows", () => {
    expect(KEYWORD_SEEDS).toHaveLength(48);
    expect(KEYWORD_SEEDS.filter((record) => record.language === "ko")).toHaveLength(24);
    expect(KEYWORD_SEEDS.filter((record) => record.language === "en")).toHaveLength(24);
  });

  it("validates every row", () => {
    const failures = KEYWORD_SEEDS.map((record) => [record.query, validateKeywordRecord(record)] as const).filter(([, problems]) => problems.length > 0);
    expect(failures).toEqual([]);
  });

  it("invents no demand figure anywhere", () => {
    for (const record of KEYWORD_SEEDS) {
      expect(record.measurement, record.query).toBe("UNMEASURED");
      expect(record.monthly_searches, record.query).toBeNull();
      expect(record.range, record.query).toBeNull();
      expect(record.competition_type, record.query).toBeNull();
      expect(record.source_tool, record.query).toBeNull();
      expect(record.measured_period, record.query).toBeNull();
      expect(record.measured_at, record.query).toBeNull();
      expect(record.SERP_page_types, record.query).toEqual([]);
    }
  });

  it("gives one intent exactly one owning page", () => {
    const owners = new Map<string, string>();
    for (const record of KEYWORD_SEEDS) {
      const key = `${record.workflow_id}::${record.intent}`;
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, record.canonical_owner);
      else expect(record.canonical_owner, `${key} (${record.query})`).toBe(owner);
    }
    expect(owners.size).toBeGreaterThan(0);
  });

  it("keeps every work-package row behind the Team-plan activation entitlement", () => {
    for (const record of KEYWORD_SEEDS) {
      if (COOKBOOK_WORKFLOW_IDS.includes(record.workflow_id as (typeof COOKBOOK_WORKFLOW_IDS)[number])) {
        expect(record.product_ready, record.query).not.toBe("live");
      }
    }
  });

  it("offers no self-serve trial destination while promote is contact-only", () => {
    expect(KEYWORD_CTAS as readonly string[]).not.toContain("start_trial");
    expect(KEYWORD_SEEDS.some((record) => record.CTA === "contact_team_plan" || record.CTA === "compare_plans")).toBe(true);
  });
});

describe("validateKeywordRecord", () => {
  it("refuses a figure on an unmeasured row", () => {
    expect(validateKeywordRecord(seed({ monthly_searches: 1200 }))).toContain("UNMEASURED row carries a monthly_searches figure");
    expect(validateKeywordRecord(seed({ range: "1K-10K" }))).toContain("UNMEASURED row carries a range");
    expect(validateKeywordRecord(seed({ competition_type: "ads_auction" }))).toContain("UNMEASURED row names a competition figure");
    expect(validateKeywordRecord(seed({ SERP_page_types: ["tutorial"] }))).toContain("UNMEASURED row asserts SERP page types no review produced");
  });

  it("refuses a measured row with no tool, period or figure", () => {
    const problems = validateKeywordRecord(seed({ measurement: "MEASURED" }));
    expect(problems).toContain("MEASURED row carries no figure");
    expect(problems).toContain("MEASURED row names no source tool");
    expect(problems).toContain("MEASURED row carries no period or date");
  });

  it("refuses both a point estimate and a range in one row", () => {
    const problems = validateKeywordRecord(
      seed({ measurement: "MEASURED", monthly_searches: 10, range: "10-100", source_tool: "keyword_planner", measured_period: "2026-03..2026-08", measured_at: "2026-09-11" }),
    );
    expect(problems).toContain("MEASURED row carries both a point and a range");
  });

  it("accepts a measured row that names its tool, window and day", () => {
    expect(
      validateKeywordRecord(
        seed({ measurement: "MEASURED", monthly_searches: 0, source_tool: "keyword_planner", measured_period: "2026-03..2026-08", measured_at: "2026-09-11" }),
      ),
    ).toEqual([]);
  });

  it("refuses a Naver figure recorded in a Google row", () => {
    expect(
      validateKeywordRecord(
        seed({ measurement: "MEASURED", monthly_searches: 90, source_tool: "naver_keyword_tool", measured_period: "2026-03..2026-08", measured_at: "2026-09-11" }),
      ),
    ).toContain("naver_keyword_tool does not measure google");
  });

  it("refuses an owner that is not a route", () => {
    expect(validateKeywordRecord(seed({ canonical_owner: "/cookbooks/does-not-exist" }))).toContain("canonical_owner /cookbooks/does-not-exist is not a known route");
  });

  it("refuses a sales CTA on a capability that is not live", () => {
    expect(validateKeywordRecord(seed({ product_ready: "not_live", CTA: "contact_team_plan" }))).toContain("a not_live capability may not carry a sales CTA");
  });

  it("refuses a work package marked live", () => {
    // The rule is unchanged by FD-02 -- a work package still ends at an approved World and no
    // free reader reaches one -- so only the sentence naming the bar moved with the entitlement.
    expect(validateKeywordRecord(seed({ workflow_id: "documents-to-grounded-work", product_ready: "live" }))).toContain(
      "a work package that ends at an approved World cannot be product_ready live while promote requires a paid plan (Developer as workspace owner, or Team)",
    );
  });

  it("refuses evidence on a draft cookbook, and an evidence CTA without evidence", () => {
    expect(
      validateKeywordRecord(seed({ canonical_owner: "/cookbooks/manual-grounded-support-answers", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "read_docs" })),
    ).toContain("a draft cookbook has had no run and cannot be cited as evidence");
    expect(validateKeywordRecord(seed({ evidence_available: false, CTA: "read_evidence" }))).toContain("CTA points at evidence this row says does not exist");
  });

  it("refuses a query that was rewritten rather than recorded", () => {
    expect(validateKeywordRecord(seed({ query: "Ground An LLM In My Own Documents" }))).toContain("query is not recorded as typed (lower-case)");
    expect(validateKeywordRecord(seed({ query: "" }))).toContain("query is empty or padded");
  });
});

describe("rankByDemand", () => {
  it("refuses to order unmeasured demand instead of scoring it zero", () => {
    const { ranked, unrankable } = rankByDemand(KEYWORD_SEEDS);
    expect(ranked).toEqual([]);
    expect(unrankable).toHaveLength(48);
    expect(unrankable[0].reason).toBe("demand is UNMEASURED; ranking it would score it as zero");
  });

  it("orders rows measured under one condition, and keeps a measured zero in the ranking", () => {
    const measured = (query: string, monthly_searches: number) =>
      seed({ query, monthly_searches, measurement: "MEASURED", source_tool: "keyword_planner", measured_period: "2026-03..2026-08", measured_at: "2026-09-11" });
    const { ranked, unrankable } = rankByDemand([measured("low", 0), measured("high", 40), seed({ query: "unknown" })]);
    expect(ranked.map((record) => record.query)).toEqual(["high", "low"]);
    expect(unrankable.map(({ record }) => record.query)).toEqual(["unknown"]);
  });

  it("refuses to rank two different measurement conditions together", () => {
    const base = { measurement: "MEASURED", source_tool: "keyword_planner", measured_at: "2026-09-11" } as const;
    const { ranked, unrankable } = rankByDemand([
      seed({ query: "us", ...base, monthly_searches: 10, measured_period: "2026-03..2026-08" }),
      seed({ query: "kr", ...base, monthly_searches: 90, language: "ko", country: "KR", measured_period: "2025-03..2025-08" }),
    ]);
    expect(ranked).toEqual([]);
    expect(unrankable).toHaveLength(2);
    expect(unrankable[0].reason).toContain("cannot be ranked together");
  });

  it("does not order a range against a point estimate", () => {
    const { ranked, unrankable } = rankByDemand([
      seed({ query: "bucketed", measurement: "MEASURED", range: "1K-10K", source_tool: "keyword_planner", measured_period: "2026-03..2026-08", measured_at: "2026-09-11" }),
    ]);
    expect(ranked).toEqual([]);
    expect(unrankable[0].reason).toContain("ranges are not ordered against point estimates");
  });
});

describe("hardGateBlockers", () => {
  it("always names the two external gates, whatever the record says", () => {
    for (const record of KEYWORD_SEEDS) {
      const blockers = hardGateBlockers(record);
      expect(blockers, record.query).toContain("source_rights_cleared");
      expect(blockers, record.query).toContain("security_gate_open");
    }
  });

  /*
    The loop above is true of every record by construction -- rights and the security gate are
    pushed unconditionally -- so on its own it proves nothing about the two gates that *are*
    record-derived. These six rows are the whole branch table of `product_ready` x
    `evidence_available`: each one fails if either condition is dropped, inverted, or made to
    depend on the other. `activation_needs_team_plan` is the value every real seed carries and
    is not "live", which is the case a `=== "not_live"` test would have missed.
  */
  it.each([
    ["not_live", false, ["product_capability_live", "journey_completed_end_to_end"]],
    ["not_live", true, ["product_capability_live"]],
    ["activation_needs_team_plan", false, ["product_capability_live", "journey_completed_end_to_end"]],
    ["activation_needs_team_plan", true, ["product_capability_live"]],
    ["live", false, ["journey_completed_end_to_end"]],
    ["live", true, []],
  ] as const)("derives the record gates from product_ready=%s and evidence_available=%s alone", (product_ready, evidence_available, expected) => {
    // `category-and-trust` because a cookbook workflow may not be `live`: every row here is a
    // record the validator accepts, not a combination the map is barred from holding.
    const record = seed({ workflow_id: "category-and-trust", product_ready, evidence_available });
    expect(validateKeywordRecord(record)).toEqual([]);
    expect(hardGateBlockers(record)).toEqual([...expected, "source_rights_cleared", "security_gate_open"]);
  });

  it("clears a row only when the external gates are named as verified", () => {
    const ready = seed({ workflow_id: "category-and-trust", product_ready: "live", evidence_available: true, CTA: "read_docs" });
    expect(hardGateBlockers(ready, ["source_rights_cleared", "security_gate_open"])).toEqual([]);
    expect(HARD_GATES).toHaveLength(4);
  });
});

describe("KEYWORD_MEASUREMENT_GAPS", () => {
  it("names every account-gated collection and fills no field from Trends", () => {
    expect(KEYWORD_MEASUREMENT_GAPS.map((gap) => gap.id)).toEqual(["WG-068", "WG-069", "WG-070", "WG-071", "WG-072"]);
    expect(KEYWORD_MEASUREMENT_GAPS.find((gap) => gap.id === "WG-071")?.fields).toEqual([]);
    expect(KEYWORD_MEASUREMENT_GAPS.find((gap) => gap.id === "WG-072")?.fields).toEqual(["SERP_page_types"]);
  });
});
