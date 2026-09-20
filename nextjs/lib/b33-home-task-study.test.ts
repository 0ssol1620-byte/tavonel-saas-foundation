import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  B33_FOUNDER_REVIEW,
  B33_REQUIRED_VIEWPORTS,
  B33_STUDY_ID,
  B33_STUDY_SCHEMA,
  validateB33HomeTaskStudy,
} from "./b33-home-task-study";

const statusUrl = new URL("../docs/research/b33-home-task-study.status.json", import.meta.url);
const prepared = JSON.parse(readFileSync(statusUrl, "utf8"));

function completeRecord() {
  return {
    ...structuredClone(prepared),
    status: "COMPLETE",
    participant_count: 1,
    participants: [{
      participant_id: "P-001",
      segment: "knowledge-operations",
      consent_recorded: true,
      started_at: "2026-09-20T01:00:00.000Z",
      completed_at: "2026-09-20T01:04:00.000Z",
      session_context: {
        locale: "en",
        viewport_width_px: 1440,
        reduced_motion: false,
        input_mode: "pointer",
        build_id: "test-build",
        network_profile: "unthrottled",
      },
      tasks: [
        {
          task_id: "COMPREHENSION_30S",
          time_limit_seconds: 30,
          elapsed_seconds: 29,
          outcome: "PASS",
          evidence: {
            response_verbatim: "It structures source material and lets me trace a result to its page and region.",
            outcome_identified: true,
            verification_mechanism_identified: true,
            moderator_prompted: false,
            observer_notes: "Unaided response recorded at the timer stop.",
          },
        },
        {
          task_id: "PROOF_VERIFICATION_2M",
          time_limit_seconds: 120,
          elapsed_seconds: 96,
          outcome: "PASS",
          evidence: {
            reached_path: "/explore?claim=sec-revenue-2025",
            proof_item_id: "sec-revenue-2025",
            source_document_id: "sec-public-world",
            source_page_number: 31,
            source_region_ref: "page-31:bbox-04",
            source_region_opened: true,
            observer_notes: "Participant opened the highlighted source region.",
          },
        },
      ],
    }],
    aggregate_results: {
      participant_count: 1,
      completed_session_count: 1,
      comprehension: { pass_count: 1, fail_count: 0, not_attempted_count: 0 },
      proof_verification: { pass_count: 1, fail_count: 0, not_attempted_count: 0 },
      limitations: {
        incomplete_session_count: 0,
        not_attempted_task_count: 0,
        observed_fail_count: 0,
        notes: ["Single-participant pilot; no population conclusion is permitted."],
      },
    },
  };
}

describe("B33 home task study", () => {
  it("records the zero-participant state honestly", () => {
    expect(validateB33HomeTaskStudy(prepared)).toEqual([]);
    expect(prepared.schema).toBe(B33_STUDY_SCHEMA);
    expect(prepared.study_id).toBe(B33_STUDY_ID);
    expect(prepared.status).toBe("PREPARED_NOT_RUN");
    expect(prepared.participant_count).toBe(0);
    expect(prepared.participants).toEqual([]);
    expect(prepared.aggregate_results).toBeNull();
    expect(prepared.verification_plan.viewport_widths_px).toEqual(B33_REQUIRED_VIEWPORTS);
    expect(prepared.verification_plan.reduced_motion).toBe(true);
    expect(prepared.founder_visual_review).toBe(B33_FOUNDER_REVIEW);
  });

  it("accepts a complete record only when task evidence supports each pass", () => {
    expect(validateB33HomeTaskStudy(completeRecord())).toEqual([]);
  });

  it("rejects a comprehension pass that was prompted or exceeded 30 seconds", () => {
    const record = completeRecord();
    const task = record.participants[0].tasks[0];
    task.elapsed_seconds = 31;
    task.evidence.moderator_prompted = true;
    const errors = validateB33HomeTaskStudy(record);
    expect(errors).toContain("participants[0].tasks[0] cannot PASS after the 30 second limit");
    expect(errors).toContain("participants[0].tasks[0] PASS requires moderator_prompted=false");
  });

  it("rejects a proof pass without an opened and identified source region", () => {
    const record = completeRecord();
    const task = record.participants[0].tasks[1];
    task.evidence.source_region_opened = false;
    task.evidence.source_region_ref = null;
    const errors = validateB33HomeTaskStudy(record);
    expect(errors).toContain("participants[0].tasks[1] PASS requires source_region_ref");
    expect(errors).toContain("participants[0].tasks[1] PASS requires source_region_opened=true");
  });

  it("rejects a proof pass on a route outside the canonical public proof surfaces", () => {
    const record = completeRecord();
    record.participants[0].tasks[1].evidence.reached_path = "/demo/dart";
    expect(validateB33HomeTaskStudy(record)).toContain(
      "participants[0].tasks[1] PASS requires a reached_path under /explore or /evidence",
    );
  });

  it("rejects invented results when no participant exists", () => {
    const record = {
      ...structuredClone(prepared),
      status: "COMPLETE",
      aggregate_results: completeRecord().aggregate_results,
    };
    const errors = validateB33HomeTaskStudy(record);
    expect(errors).toContain("a zero-participant record must remain PREPARED_NOT_RUN");
    expect(errors).toContain("aggregate_results must be null until a real participant exists");
  });

  it("derives aggregate counts and limitation counts from participant outcomes", () => {
    const record = completeRecord();
    record.aggregate_results.comprehension.pass_count = 0;
    record.aggregate_results.limitations.observed_fail_count = 1;
    const errors = validateB33HomeTaskStudy(record);
    expect(errors).toContain("aggregate_results.comprehension.pass_count must equal the recorded participant outcomes");
    expect(errors).toContain("aggregate_results.limitations.observed_fail_count must equal recorded outcomes");
  });

  it("requires a substantive limitation disclosure", () => {
    const record = completeRecord();
    record.aggregate_results.limitations.notes = ["none"];
    expect(validateB33HomeTaskStudy(record)).toContain(
      "aggregate_results.limitations.notes must disclose at least one substantive limitation",
    );
  });
});
