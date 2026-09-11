import { describe, expect, it } from "vitest";
import {
  activationCohorts,
  cohortCounts,
  computableDecisionRows,
  DECISION_TABLE,
  experimentReading,
  exclusionReason,
  UNJOINABLE_READINGS,
  type ActivationRecord,
} from "./activation-cohorts";

const record = (over: Partial<ActivationRecord> = {}): ActivationRecord => ({
  workspaceKey: "pilot-alpha",
  userId: "user-a",
  accessSource: "trial",
  origin: "customer_documents",
  corpusKey: "collection-1",
  step: "candidate_created",
  at: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("activation cohorts", () => {
  it("separates A1 from A2: a candidate is not the core activation", () => {
    const reading = activationCohorts([
      record({ step: "candidate_created" }),
      record({ step: "grounded_answer", at: "2026-09-02T00:00:00.000Z" }),
    ]);
    expect(cohortCounts(reading)).toEqual({ A1: 1, A2: 1, A3: 0, R1: 0 });
    expect(reading.cohorts.A1[0]).toEqual({ workspaceKey: "pilot-alpha", userId: "user-a", firstAt: "2026-09-01T00:00:00.000Z" });
    expect(reading.cohorts.A2[0].firstAt).toBe("2026-09-02T00:00:00.000Z");
  });

  /*
    The one rule §15.3 states outright: the unit is a deduplicated user/workspace cohort and not
    an event count. Eleven grounded answers from one workspace is one A2, and a funnel that
    reported eleven would read as eleven customers.
  */
  it("counts a cohort once however many records it has, keeping the earliest date", () => {
    const reading = activationCohorts([
      record({ step: "grounded_answer", at: "2026-09-05T00:00:00.000Z" }),
      record({ step: "grounded_answer", at: "2026-09-03T00:00:00.000Z" }),
      record({ step: "grounded_answer", at: "2026-09-09T00:00:00.000Z" }),
    ]);
    expect(cohortCounts(reading).A2).toBe(1);
    expect(reading.cohorts.A2[0].firstAt).toBe("2026-09-03T00:00:00.000Z");
  });

  it("keeps two users in the same workspace apart", () => {
    const reading = activationCohorts([
      record({ userId: "user-a", step: "grounded_answer" }),
      record({ userId: "user-b", step: "grounded_answer" }),
    ]);
    expect(cohortCounts(reading).A2).toBe(2);
  });

  it("reads A3 from external consumption only", () => {
    const reading = activationCohorts([record({ step: "external_consumption", at: "2026-09-04T00:00:00.000Z" })]);
    expect(cohortCounts(reading)).toEqual({ A1: 0, A2: 0, A3: 1, R1: 0 });
  });

  it("does not back-fill A1 from a later stage", () => {
    // The candidate happened before the window, not never. A reading that invented it would
    // make the window's own boundary invisible.
    const reading = activationCohorts([record({ step: "grounded_answer" })]);
    expect(cohortCounts(reading).A1).toBe(0);
  });

  describe("R1 repeat value", () => {
    it("needs a second corpus, not a second compile of the first", () => {
      const twice = activationCohorts([
        record({ corpusKey: "collection-1", at: "2026-09-01T00:00:00.000Z" }),
        record({ corpusKey: "collection-1", at: "2026-09-08T00:00:00.000Z" }),
      ]);
      expect(cohortCounts(twice).R1).toBe(0);

      const second = activationCohorts([
        record({ corpusKey: "collection-1", at: "2026-09-01T00:00:00.000Z" }),
        record({ corpusKey: "collection-2", at: "2026-09-08T00:00:00.000Z" }),
      ]);
      expect(cohortCounts(second).R1).toBe(1);
      expect(second.cohorts.R1[0].firstAt).toBe("2026-09-08T00:00:00.000Z");
    });

    it("accepts a real source revision on the first corpus", () => {
      const reading = activationCohorts([
        record({ corpusKey: "collection-1", at: "2026-09-01T00:00:00.000Z" }),
        record({ corpusKey: "collection-1", step: "source_revision", at: "2026-09-06T00:00:00.000Z" }),
      ]);
      expect(cohortCounts(reading).R1).toBe(1);
      expect(reading.cohorts.R1[0].firstAt).toBe("2026-09-06T00:00:00.000Z");
    });
  });

  describe("exclusions", () => {
    it("excludes an operator grant, an internal test account and the public sample", () => {
      const reading = activationCohorts(
        [
          record({ accessSource: "owner", step: "grounded_answer" }),
          record({ userId: "user-team", step: "grounded_answer" }),
          record({ workspaceKey: "pilot-internal", userId: "user-c", step: "grounded_answer" }),
          record({ origin: "public_sample", userId: "user-d", step: "grounded_answer" }),
          record({ origin: "internal_test", userId: "user-e", step: "grounded_answer" }),
          record({ userId: "user-real", step: "grounded_answer" }),
        ],
        { internalUserIds: ["user-team"], internalWorkspaceKeys: ["pilot-internal"] },
      );
      expect(cohortCounts(reading).A2).toBe(1);
      expect(reading.cohorts.A2[0].userId).toBe("user-real");
      expect(reading.excluded).toEqual({
        internal_grant: 1,
        internal_test_account: 3,
        public_sample: 1,
        unparseable_timestamp: 0,
      });
    });

    it("excludes an unparseable timestamp rather than dating it to now", () => {
      expect(exclusionReason(record({ at: "soon" }))).toBe("unparseable_timestamp");
      const reading = activationCohorts([record({ at: "soon" })]);
      expect(cohortCounts(reading).A1).toBe(0);
      expect(reading.excluded.unparseable_timestamp).toBe(1);
    });

    it("names the exclusion by its first matching reason and counts each record once", () => {
      // An owner grant on the public sample is one excluded record, not two.
      const reading = activationCohorts([record({ accessSource: "owner", origin: "public_sample" })]);
      expect(reading.excluded.internal_grant + reading.excluded.public_sample).toBe(1);
    });

    it("leaves an unknown access source in the reading instead of guessing a bucket", () => {
      expect(exclusionReason(record({ accessSource: "unknown" }))).toBeNull();
    });
  });
});

describe("§15.4 decision table", () => {
  it("has all seven rows, each naming the measurements it compares", () => {
    expect(DECISION_TABLE).toHaveLength(7);
    for (const row of DECISION_TABLE) {
      expect(row.inputs.length).toBeGreaterThanOrEqual(2);
      expect(row.priorityAction.length).toBeGreaterThan(20);
      expect(row.availabilityNote.length).toBeGreaterThan(20);
    }
    expect(new Set(DECISION_TABLE.map((row) => row.id)).size).toBe(7);
  });

  /*
    The column that keeps the table honest. Four of the seven rows cannot be computed here --
    two because their halves live in the consent-gated browser domain with no shared identifier,
    two because neither a Search Console property nor a per-workspace cost record exists in this
    deployment -- which leaves three. A row reported as actionable would be answered from
    somebody's impression of the traffic instead.
  */
  it("marks the rows this deployment cannot compute, with a reason", () => {
    const byId = new Map(DECISION_TABLE.map((row) => [row.id, row]));
    expect(byId.get("impressions_without_clicks")?.availability).toBe("needs_founder_access");
    expect(byId.get("visits_without_sample_opens")?.availability).toBe("not_joinable");
    expect(byId.get("samples_without_own_documents")?.availability).toBe("not_joinable");
    expect(byId.get("growth_without_contribution")?.availability).toBe("needs_founder_access");
    expect(computableDecisionRows().map((row) => row.id)).toEqual([
      "starts_without_candidate_or_approval",
      "first_success_without_payment",
      "payment_without_next_month_use",
    ]);
  });

  it("keeps the search-query-to-payer join on the refused list", () => {
    expect(UNJOINABLE_READINGS.map((reading) => reading.id)).toContain("search_query_to_payer");
    expect(UNJOINABLE_READINGS.map((reading) => reading.id)).toContain("small_sample_winner");
  });
});

describe("experiment reading", () => {
  const arms = [
    { arm: "a", exposures: 40, conversions: 4 },
    { arm: "b", exposures: 40, conversions: 9 },
  ];

  it("refuses to read anything without a pre-registered plan", () => {
    const reading = experimentReading(null, arms);
    expect(reading.verdict).toBe("no_registered_plan");
    expect(reading.arms.map((row) => row.rate)).toEqual([0.1, 0.225]);
  });

  it("declares no winner below the pre-registered sample", () => {
    const reading = experimentReading(
      { preRegisteredSampleSizePerArm: 200, analysisWindowDays: 28, registeredAt: "2026-09-01T00:00:00.000Z" },
      arms,
    );
    expect(reading.verdict).toBe("insufficient_sample");
    expect(reading.reason).toContain("200");
  });

  /*
    The failure path that matters: even with the sample reached, the verdict names no arm. The
    rates are reportable and the decision is a person's, so there is no branch of this function
    that returns a winner and no field on the result that could hold one.
  */
  it("declares no winner above it either", () => {
    const reading = experimentReading(
      { preRegisteredSampleSizePerArm: 20, analysisWindowDays: 28, registeredAt: "2026-09-01T00:00:00.000Z" },
      arms,
    );
    expect(reading.verdict).toBe("reportable_without_winner");
    expect(JSON.stringify(reading)).not.toMatch(/winner":\s*"/);
    expect(Object.keys(reading.arms[0]).sort()).toEqual(["arm", "conversions", "exposures", "rate"]);
  });

  it("reports an arm with no exposures as unmeasured, not as a zero rate", () => {
    const reading = experimentReading(null, [{ arm: "c", exposures: 0, conversions: 0 }]);
    expect(reading.arms[0].rate).toBeNull();
  });
});
