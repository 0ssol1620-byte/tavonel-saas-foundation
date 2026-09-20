export const B33_STUDY_SCHEMA = "tavonel.home_task_study.v1.1" as const;
export const B33_STUDY_ID = "B33_HOME_OUTCOME_IA" as const;
export const B33_FOUNDER_REVIEW = "FOUNDER VISUAL REVIEW REQUIRED" as const;
export const B33_REQUIRED_VIEWPORTS = [1920, 1440, 1280, 1024, 768, 390, 360] as const;

export const B33_TASKS = {
  comprehension: {
    id: "COMPREHENSION_30S",
    timeLimitSeconds: 30,
    startPath: "/",
  },
  proofVerification: {
    id: "PROOF_VERIFICATION_2M",
    timeLimitSeconds: 120,
    startPath: "/",
  },
} as const;

export type B33TaskId = (typeof B33_TASKS)[keyof typeof B33_TASKS]["id"];
export type B33TaskOutcome = "PASS" | "FAIL" | "NOT_ATTEMPTED";
export type B33StudyStatus = "PREPARED_NOT_RUN" | "IN_PROGRESS" | "COMPLETE";

type CountSet = {
  pass_count: number;
  fail_count: number;
  not_attempted_count: number;
};

type B33AggregateResults = {
  participant_count: number;
  completed_session_count: number;
  comprehension: CountSet;
  proof_verification: CountSet;
  limitations: {
    incomplete_session_count: number;
    not_attempted_task_count: number;
    observed_fail_count: number;
    notes: string[];
  };
};

export type B33HomeTaskStudyRecord = {
  schema: typeof B33_STUDY_SCHEMA;
  study_id: typeof B33_STUDY_ID;
  protocol_version: "1.1";
  status: B33StudyStatus;
  prepared_at: string;
  route: "/";
  locales: ("en" | "ko")[];
  verification_plan: {
    viewport_widths_px: number[];
    reduced_motion: true;
  };
  participant_count: number;
  participants: unknown[];
  aggregate_results: B33AggregateResults | null;
  founder_visual_review: typeof B33_FOUNDER_REVIEW;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isCanonicalProofPath(value: unknown): value is string {
  return typeof value === "string" && /^\/(?:explore|evidence)(?:[?#]|$)/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateCountSet(
  value: unknown,
  expected: CountSet,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  for (const key of ["pass_count", "fail_count", "not_attempted_count"] as const) {
    if (!isNonNegativeInteger(value[key])) errors.push(`${prefix}.${key} must be a non-negative integer`);
    if (value[key] !== expected[key]) errors.push(`${prefix}.${key} must equal the recorded participant outcomes`);
  }
}

function validateNotAttempted(
  task: Record<string, unknown>,
  evidence: Record<string, unknown>,
  prefix: string,
  errors: string[],
): void {
  if (task.elapsed_seconds !== null) errors.push(`${prefix}.elapsed_seconds must be null for NOT_ATTEMPTED`);
  if (!isNonEmpty(evidence.observer_notes)) {
    errors.push(`${prefix}.evidence.observer_notes must explain why the task was not attempted`);
  }
}

function validateComprehensionTask(
  task: Record<string, unknown>,
  prefix: string,
  errors: string[],
): void {
  if (task.time_limit_seconds !== B33_TASKS.comprehension.timeLimitSeconds) {
    errors.push(`${prefix}.time_limit_seconds must be 30`);
  }
  if (!isRecord(task.evidence)) {
    errors.push(`${prefix}.evidence must be an object`);
    return;
  }
  const evidence = task.evidence;
  const keys = [
    "response_verbatim",
    "outcome_identified",
    "verification_mechanism_identified",
    "moderator_prompted",
    "observer_notes",
  ] as const;
  if (!hasExactKeys(evidence, keys)) errors.push(`${prefix}.evidence must contain the required comprehension fields only`);
  const outcome = task.outcome as B33TaskOutcome;
  if (outcome === "NOT_ATTEMPTED") {
    validateNotAttempted(task, evidence, prefix, errors);
    for (const key of ["response_verbatim", "outcome_identified", "verification_mechanism_identified", "moderator_prompted"]) {
      if (evidence[key] !== null) errors.push(`${prefix}.evidence.${key} must be null for NOT_ATTEMPTED`);
    }
    return;
  }
  if (typeof task.elapsed_seconds !== "number" || !Number.isFinite(task.elapsed_seconds) || task.elapsed_seconds < 0) {
    errors.push(`${prefix}.elapsed_seconds must be recorded for an attempted task`);
  }
  if (!isNonEmpty(evidence.response_verbatim)) {
    errors.push(`${prefix}.evidence.response_verbatim is required for an attempted comprehension task`);
  }
  if (typeof evidence.outcome_identified !== "boolean") {
    errors.push(`${prefix}.evidence.outcome_identified must be boolean for an attempted task`);
  }
  if (typeof evidence.verification_mechanism_identified !== "boolean") {
    errors.push(`${prefix}.evidence.verification_mechanism_identified must be boolean for an attempted task`);
  }
  if (typeof evidence.moderator_prompted !== "boolean") {
    errors.push(`${prefix}.evidence.moderator_prompted must be boolean for an attempted task`);
  }
  if (!isNonEmpty(evidence.observer_notes)) {
    errors.push(`${prefix}.evidence.observer_notes is required for an attempted task`);
  }
  if (outcome === "PASS") {
    if (typeof task.elapsed_seconds === "number" && task.elapsed_seconds > 30) {
      errors.push(`${prefix} cannot PASS after the 30 second limit`);
    }
    if (evidence.outcome_identified !== true) errors.push(`${prefix} PASS requires outcome_identified=true`);
    if (evidence.verification_mechanism_identified !== true) {
      errors.push(`${prefix} PASS requires verification_mechanism_identified=true`);
    }
    if (evidence.moderator_prompted !== false) errors.push(`${prefix} PASS requires moderator_prompted=false`);
  }
  const qualifiesForPass =
    typeof task.elapsed_seconds === "number" &&
    task.elapsed_seconds <= 30 &&
    isNonEmpty(evidence.response_verbatim) &&
    evidence.outcome_identified === true &&
    evidence.verification_mechanism_identified === true &&
    evidence.moderator_prompted === false;
  if (outcome === "FAIL" && qualifiesForPass) {
    errors.push(`${prefix} FAIL conflicts with recorded comprehension pass evidence`);
  }
}

function validateProofTask(
  task: Record<string, unknown>,
  prefix: string,
  errors: string[],
): void {
  if (task.time_limit_seconds !== B33_TASKS.proofVerification.timeLimitSeconds) {
    errors.push(`${prefix}.time_limit_seconds must be 120`);
  }
  if (!isRecord(task.evidence)) {
    errors.push(`${prefix}.evidence must be an object`);
    return;
  }
  const evidence = task.evidence;
  const keys = [
    "reached_path",
    "proof_item_id",
    "source_document_id",
    "source_page_number",
    "source_region_ref",
    "source_region_opened",
    "observer_notes",
  ] as const;
  if (!hasExactKeys(evidence, keys)) errors.push(`${prefix}.evidence must contain the required proof fields only`);
  const outcome = task.outcome as B33TaskOutcome;
  if (outcome === "NOT_ATTEMPTED") {
    validateNotAttempted(task, evidence, prefix, errors);
    for (const key of ["reached_path", "proof_item_id", "source_document_id", "source_page_number", "source_region_ref", "source_region_opened"]) {
      if (evidence[key] !== null) errors.push(`${prefix}.evidence.${key} must be null for NOT_ATTEMPTED`);
    }
    return;
  }
  if (typeof task.elapsed_seconds !== "number" || !Number.isFinite(task.elapsed_seconds) || task.elapsed_seconds < 0) {
    errors.push(`${prefix}.elapsed_seconds must be recorded for an attempted task`);
  }
  if (!isNonEmpty(evidence.observer_notes)) {
    errors.push(`${prefix}.evidence.observer_notes is required for an attempted task`);
  }
  if (outcome === "PASS") {
    if (typeof task.elapsed_seconds === "number" && task.elapsed_seconds > 120) {
      errors.push(`${prefix} cannot PASS after the 120 second limit`);
    }
    if (!isCanonicalProofPath(evidence.reached_path)) {
      errors.push(`${prefix} PASS requires a reached_path under /explore or /evidence`);
    }
    if (!isNonEmpty(evidence.proof_item_id)) errors.push(`${prefix} PASS requires proof_item_id`);
    if (!isNonEmpty(evidence.source_document_id)) errors.push(`${prefix} PASS requires source_document_id`);
    if (!Number.isInteger(evidence.source_page_number) || Number(evidence.source_page_number) < 1) {
      errors.push(`${prefix} PASS requires a positive source_page_number`);
    }
    if (!isNonEmpty(evidence.source_region_ref)) errors.push(`${prefix} PASS requires source_region_ref`);
    if (evidence.source_region_opened !== true) errors.push(`${prefix} PASS requires source_region_opened=true`);
  }
  const qualifiesForPass =
    typeof task.elapsed_seconds === "number" &&
    task.elapsed_seconds <= 120 &&
    isCanonicalProofPath(evidence.reached_path) &&
    isNonEmpty(evidence.proof_item_id) &&
    isNonEmpty(evidence.source_document_id) &&
    Number.isInteger(evidence.source_page_number) &&
    Number(evidence.source_page_number) >= 1 &&
    isNonEmpty(evidence.source_region_ref) &&
    evidence.source_region_opened === true;
  if (outcome === "FAIL" && qualifiesForPass) {
    errors.push(`${prefix} FAIL conflicts with recorded proof pass evidence`);
  }
}

export function validateB33HomeTaskStudy(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["record must be an object"];

  if (value.schema !== B33_STUDY_SCHEMA) errors.push(`schema must be ${B33_STUDY_SCHEMA}`);
  if (value.study_id !== B33_STUDY_ID) errors.push(`study_id must be ${B33_STUDY_ID}`);
  if (value.protocol_version !== "1.1") errors.push("protocol_version must be 1.1");
  if (!isIsoDateTime(value.prepared_at)) errors.push("prepared_at must be an ISO date-time");
  if (value.route !== "/") errors.push("route must be /");
  if (value.founder_visual_review !== B33_FOUNDER_REVIEW) {
    errors.push(`founder_visual_review must be ${B33_FOUNDER_REVIEW}`);
  }

  const statuses: B33StudyStatus[] = ["PREPARED_NOT_RUN", "IN_PROGRESS", "COMPLETE"];
  if (!statuses.includes(value.status as B33StudyStatus)) errors.push("status is invalid");
  if (
    !Array.isArray(value.locales) ||
    value.locales.length !== 2 ||
    new Set(value.locales).size !== 2 ||
    !value.locales.includes("en") ||
    !value.locales.includes("ko")
  ) {
    errors.push("locales must contain en and ko exactly once");
  }
  const verificationPlan = isRecord(value.verification_plan) ? value.verification_plan : null;
  const viewportWidths = verificationPlan?.viewport_widths_px;
  if (
    !verificationPlan ||
    !Array.isArray(viewportWidths) ||
    viewportWidths.length !== B33_REQUIRED_VIEWPORTS.length ||
    !B33_REQUIRED_VIEWPORTS.every((width, index) => viewportWidths[index] === width) ||
    verificationPlan.reduced_motion !== true
  ) {
    errors.push("verification_plan must preserve all seven widths and reduced motion");
  }

  if (!Array.isArray(value.participants)) {
    errors.push("participants must be an array");
    return errors;
  }
  if (!Number.isInteger(value.participant_count) || value.participant_count !== value.participants.length) {
    errors.push("participant_count must equal participants.length");
  }

  if (value.participants.length === 0) {
    if (value.status !== "PREPARED_NOT_RUN") errors.push("a zero-participant record must remain PREPARED_NOT_RUN");
    if (value.aggregate_results !== null) errors.push("aggregate_results must be null until a real participant exists");
    return errors;
  }
  if (value.status === "PREPARED_NOT_RUN") errors.push("PREPARED_NOT_RUN cannot contain participant records");

  const participantIds = new Set<string>();
  const outcomeCounts: Record<B33TaskId, CountSet> = {
    COMPREHENSION_30S: { pass_count: 0, fail_count: 0, not_attempted_count: 0 },
    PROOF_VERIFICATION_2M: { pass_count: 0, fail_count: 0, not_attempted_count: 0 },
  };
  let completedSessionCount = 0;

  for (const [participantIndex, participant] of value.participants.entries()) {
    const prefix = `participants[${participantIndex}]`;
    if (!isRecord(participant)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmpty(participant.participant_id)) {
      errors.push(`${prefix}.participant_id is required`);
    } else if (participantIds.has(participant.participant_id)) {
      errors.push(`${prefix}.participant_id must be unique`);
    } else {
      participantIds.add(participant.participant_id);
    }
    if (!isNonEmpty(participant.segment)) errors.push(`${prefix}.segment is required`);
    if (participant.consent_recorded !== true) errors.push(`${prefix}.consent_recorded must be true`);
    if (!isIsoDateTime(participant.started_at)) errors.push(`${prefix}.started_at must be an ISO date-time`);
    if (participant.completed_at !== null && !isIsoDateTime(participant.completed_at)) {
      errors.push(`${prefix}.completed_at must be null or an ISO date-time`);
    } else if (isIsoDateTime(participant.completed_at)) {
      completedSessionCount += 1;
      if (isIsoDateTime(participant.started_at) && Date.parse(participant.completed_at) < Date.parse(participant.started_at)) {
        errors.push(`${prefix}.completed_at must not precede started_at`);
      }
    }
    if (!isRecord(participant.session_context)) {
      errors.push(`${prefix}.session_context is required`);
    } else {
      const context = participant.session_context;
      if (context.locale !== "en" && context.locale !== "ko") errors.push(`${prefix}.session_context.locale is invalid`);
      if (!isNonNegativeInteger(context.viewport_width_px) || Number(context.viewport_width_px) < 320) {
        errors.push(`${prefix}.session_context.viewport_width_px must be a realistic integer width`);
      }
      if (typeof context.reduced_motion !== "boolean") errors.push(`${prefix}.session_context.reduced_motion must be boolean`);
      if (!["pointer", "keyboard", "touch"].includes(String(context.input_mode))) {
        errors.push(`${prefix}.session_context.input_mode is invalid`);
      }
      if (!isNonEmpty(context.build_id)) errors.push(`${prefix}.session_context.build_id is required`);
      if (!isNonEmpty(context.network_profile)) errors.push(`${prefix}.session_context.network_profile is required`);
    }
    if (!Array.isArray(participant.tasks) || participant.tasks.length !== 2) {
      errors.push(`${prefix}.tasks must contain the two protocol tasks`);
      continue;
    }

    const seen = new Set<B33TaskId>();
    for (const [taskIndex, task] of participant.tasks.entries()) {
      const taskPrefix = `${prefix}.tasks[${taskIndex}]`;
      if (!isRecord(task) || (task.task_id !== B33_TASKS.comprehension.id && task.task_id !== B33_TASKS.proofVerification.id)) {
        errors.push(`${taskPrefix}.task_id is invalid`);
        continue;
      }
      const taskId = task.task_id as B33TaskId;
      if (seen.has(taskId)) errors.push(`${taskPrefix}.task_id must be unique per participant`);
      seen.add(taskId);
      if (!["PASS", "FAIL", "NOT_ATTEMPTED"].includes(String(task.outcome))) {
        errors.push(`${taskPrefix}.outcome is invalid`);
        continue;
      }
      const countKey = task.outcome === "PASS" ? "pass_count" : task.outcome === "FAIL" ? "fail_count" : "not_attempted_count";
      outcomeCounts[taskId][countKey] += 1;
      if (taskId === B33_TASKS.comprehension.id) validateComprehensionTask(task, taskPrefix, errors);
      else validateProofTask(task, taskPrefix, errors);
    }
    for (const taskId of [B33_TASKS.comprehension.id, B33_TASKS.proofVerification.id]) {
      if (!seen.has(taskId)) errors.push(`${prefix} is missing ${taskId}`);
    }
  }

  if (value.status === "IN_PROGRESS" && value.aggregate_results !== null) {
    errors.push("IN_PROGRESS aggregate_results must remain null");
  }
  if (value.status === "COMPLETE") {
    if (completedSessionCount !== value.participants.length) {
      errors.push("COMPLETE requires completed_at for every participant");
    }
    if (!isRecord(value.aggregate_results)) {
      errors.push("COMPLETE requires aggregate_results from recorded sessions");
    } else {
      const aggregate = value.aggregate_results;
      if (aggregate.participant_count !== value.participants.length) {
        errors.push("aggregate_results.participant_count must equal participants.length");
      }
      if (aggregate.completed_session_count !== completedSessionCount) {
        errors.push("aggregate_results.completed_session_count must equal completed sessions");
      }
      validateCountSet(aggregate.comprehension, outcomeCounts.COMPREHENSION_30S, "aggregate_results.comprehension", errors);
      validateCountSet(aggregate.proof_verification, outcomeCounts.PROOF_VERIFICATION_2M, "aggregate_results.proof_verification", errors);
      if (!isRecord(aggregate.limitations)) {
        errors.push("aggregate_results.limitations must be an object");
      } else {
        const expectedIncomplete = value.participants.length - completedSessionCount;
        const expectedNotAttempted =
          outcomeCounts.COMPREHENSION_30S.not_attempted_count + outcomeCounts.PROOF_VERIFICATION_2M.not_attempted_count;
        const expectedFailed = outcomeCounts.COMPREHENSION_30S.fail_count + outcomeCounts.PROOF_VERIFICATION_2M.fail_count;
        if (aggregate.limitations.incomplete_session_count !== expectedIncomplete) {
          errors.push("aggregate_results.limitations.incomplete_session_count must equal recorded sessions");
        }
        if (aggregate.limitations.not_attempted_task_count !== expectedNotAttempted) {
          errors.push("aggregate_results.limitations.not_attempted_task_count must equal recorded outcomes");
        }
        if (aggregate.limitations.observed_fail_count !== expectedFailed) {
          errors.push("aggregate_results.limitations.observed_fail_count must equal recorded outcomes");
        }
        if (
          !Array.isArray(aggregate.limitations.notes) ||
          aggregate.limitations.notes.length === 0 ||
          aggregate.limitations.notes.some((note) => !isNonEmpty(note) || /^(none|n\/a|no limitations)$/i.test(note.trim()))
        ) {
          errors.push("aggregate_results.limitations.notes must disclose at least one substantive limitation");
        }
      }
    }
  }
  return errors;
}

export function assertB33HomeTaskStudy(value: unknown): asserts value is B33HomeTaskStudyRecord {
  const errors = validateB33HomeTaskStudy(value);
  if (errors.length > 0) throw new Error(`Invalid B33 home task study record:\n- ${errors.join("\n- ")}`);
}
