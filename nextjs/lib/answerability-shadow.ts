import { questionSha256 } from "./answer-receipt-signing";
import { evaluateAnswerability, type AnswerabilityInput } from "./answerability";

/*
  E2 shadow wiring (PROGRAM-2026-11-04 §4.E, appendix A).

  TAVONEL_ASK_ANSWERABILITY_MODE, default off:
    off     nothing is computed: the input builder is never called.
    shadow  the verdict is computed and logged as one internal telemetry line bound to the answer
            receipt (outputSha256 and the question's sha256). The served answer, its receipt and its
            signed receipt are unchanged -- the signed receipt's `answerability` stays null.
  Anything else, `on` included, reads as off and logs a configuration error. `on` (abstain inside the
  cohort) is not built: it waits for a SUPPORTED holdout verdict (eval/ask-quality/e2) and a reviewed
  change. A shadow failure is logged and never reaches the caller.

  The log line carries counts, never the question's words: covered and missing terms ARE the
  question, and the receipt deliberately holds only its hash.
*/

export const ANSWERABILITY_SHADOW_EVENT = "tavonel.answerability_shadow.v1" as const;

/*
  Set from the E1 calibration split by the pre-registered rule (eval/ask-quality/e2/PREREG-E2.json,
  receipts/calibration-*.json). Not calibrated in the CalibrationTable sense: one corpus, one retriever.
*/
export const ANSWERABILITY_COVERAGE_THRESHOLD = 0;

type Env = Readonly<Record<string, string | undefined>>;
export type AnswerabilityMode = "off" | "shadow";

function log(level: "info" | "error", line: Record<string, unknown>) {
  try {
    console[level](JSON.stringify(line));
  } catch { /* telemetry never changes an answer */ }
}

export function answerabilityMode(env: Env = process.env): AnswerabilityMode {
  const raw = env.TAVONEL_ASK_ANSWERABILITY_MODE?.trim() ?? "";
  if (raw === "" || raw === "off") return "off";
  if (raw === "shadow") return "shadow";
  log("error", { event: "answerability_misconfigured", code: "TAVONEL_ASK_ANSWERABILITY_MODE_INVALID", onBuilt: false });
  return "off";
}

export function recordAnswerabilityShadow(input: {
  collectionId: string;
  question: string;
  retrievalPath: "compiled-retrieval-v1" | "excerpt-concatenation-fallback";
  answer: { status: string; receipt: { outputSha256: string } };
  build: () => Omit<AnswerabilityInput, "question">;
  env?: Env;
}): void {
  if (answerabilityMode(input.env) !== "shadow") return;
  try {
    const started = performance.now();
    const verdict = evaluateAnswerability({ ...input.build(), question: input.question }, { coverageThreshold: ANSWERABILITY_COVERAGE_THRESHOLD });
    log("info", {
      event: ANSWERABILITY_SHADOW_EVENT,
      collectionId: input.collectionId,
      questionSha256: questionSha256(input.question),
      outputSha256: input.answer.receipt.outputSha256,
      retrievalPath: input.retrievalPath,
      servedStatus: input.answer.status,
      status: verdict.status,
      reason: verdict.reason,
      termCount: verdict.coveredTerms.length + verdict.missingTerms.length,
      coveredTermCount: verdict.coveredTerms.length,
      termCoverage: verdict.termCoverage,
      coverageThreshold: verdict.coverageThreshold,
      evidenceCount: verdict.evidenceCount,
      numericQuestion: verdict.numericQuestion,
      numericAnchor: verdict.numericAnchor,
      conflicts: verdict.conflicts,
      worldCoverage: verdict.worldCoverage,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    });
  } catch (error) {
    log("error", { event: "answerability_shadow_failed", code: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN" });
  }
}
