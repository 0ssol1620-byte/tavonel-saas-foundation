/*
  The /status view of a probe run, kept out of the page so it can be tested.

  The whole point of the section is that a reader can tell two things apart at a glance: the rows
  above it, which say a component is configured and its gate is open, and these rows, which say a
  request was sent through it and what came back. So every sentence this file produces names which
  one it is, and nothing here can render blank:

  - No stored run at all is "Not yet reported". Not an empty cell, not a dash, not "unknown".
  - A history that could not be read is a named failure, never "Not yet reported". "It has not
    run" and "we could not find out" are different facts and the page says which one it has.

  BA-134. The badge value used to be the literal `NOT RUN`, which is one of the tokens the
  public-copy sweep bans -- a snake-case internal enum printed eighteen times on the page a
  procurement reader is sent to. The state vocabulary is unchanged and so is every distinction it
  draws; the word a reader sees is now a sentence fragment in the same voice as the others. The
  raw store error code stopped being printed for the same reason: a reader met
  `PROBE_STORE_NOT_CONFIGURED` in body copy, so it now maps through `ERROR_SENTENCE` like every
  other failure class on this page.
  - A rate carries its denominator, because a campaign rule says so and because "5% failed" over
    twenty runs is a different statement from the same number over two thousand.
*/
import { PROBE_DEPENDENCIES, type ProbeCheck, type ProbeDependency, type ProbeRun } from "./synthetic-probe";
import type { ProbeHistory } from "./synthetic-probe-store";

export const NOT_RUN = "Not yet reported" as const;

const DEPENDENCY_LABEL: Record<ProbeDependency, string> = {
  cdr: "Document sanitizer",
  ocr: "GPU OCR",
  coreV2: "Compiler core",
  r2: "Object storage",
  db: "Database",
  billing: "Billing",
};

const ERROR_SENTENCE: Record<string, string> = {
  not_configured: "no probe target is configured in this deployment",
  gpu_spend_gate: "not probed: a health request would cold-start a GPU worker",
  timeout: "no answer inside the probe's time limit",
  unreachable: "the request did not reach it",
  http_error: "it answered with an error status",
  unexpected_response: "it answered with something this probe does not recognise",
  probe_refused: "the probe could not perform this check",
};

/*
  BA-134(c). A reader met `(PROBE_STORE_NOT_CONFIGURED)` in body copy on the page procurement is
  sent to. The two store outcomes are different facts and both keep their own sentence -- nothing
  is collapsed into "unknown" -- but neither is a raw constant now, and an unrecognised code falls
  back to the honest one rather than printing itself.
*/
const STORE_SENTENCE: Record<string, string> = {
  PROBE_STORE_NOT_CONFIGURED: "Scheduled dependency checks are not reporting to this page yet.",
  PROBE_HISTORY_READ_FAILED: "The stored history of the scheduled checks could not be read.",
};
const STORE_UNRECOGNISED = "The stored history of the scheduled checks could not be read.";

export type ProbeRow = {
  name: ProbeDependency;
  label: string;
  /** Rendered verbatim. `NOT RUN` is a value, not an absence. */
  state: "operational" | "failed" | "not probed" | typeof NOT_RUN;
  detail: string;
};

export type ProbeSection = {
  /** ISO timestamp of the newest run whose `ok` was true, or null for NOT RUN. */
  lastSuccessfulAt: string | null;
  /** ISO timestamp of the newest run of any outcome, or null. */
  lastRunAt: string | null;
  /** Null when nothing has been stored. */
  lastRunOk: boolean | null;
  window: { runs: number; failed: number; sentence: string };
  rows: ProbeRow[];
  /** A named refusal when the stored history could not be read. Null otherwise. */
  unavailable: string | null;
  fixtureE2E: string;
};

function describe(check: ProbeCheck): ProbeRow {
  const label = DEPENDENCY_LABEL[check.name];
  const reason = check.errorClass ? ERROR_SENTENCE[check.errorClass] ?? check.errorClass : "";
  if (check.status === "not_probed") {
    return { name: check.name, label, state: "not probed", detail: reason };
  }
  if (check.kind === "configuration") {
    // Never dressed up as a request. This row is the same kind of fact as the rows above the
    // section, and saying so is the difference the audit asked for.
    return {
      name: check.name,
      label,
      state: check.status === "ok" ? "operational" : "failed",
      detail: "configuration only; no request is sent through it",
    };
  }
  const latency = check.latencyMs === null ? "" : ` in ${check.latencyMs} ms`;
  return check.status === "ok"
    ? { name: check.name, label, state: "operational", detail: `answered${latency}` }
    : { name: check.name, label, state: "failed", detail: reason || `failed${latency}` };
}

/** Every dependency gets a row, including ones a stored run somehow does not mention. */
function rowsFor(run: ProbeRun | null): ProbeRow[] {
  return PROBE_DEPENDENCIES.map((name) => {
    const check = run?.checks.find((candidate) => candidate.name === name);
    return check
      ? describe(check)
      : { name, label: DEPENDENCY_LABEL[name], state: NOT_RUN, detail: "no scheduled check has reported for this dependency yet" };
  });
}

export function buildProbeSection(
  stored: { ok: true; history: ProbeHistory } | { ok: false; code: string },
): ProbeSection {
  if (!stored.ok) {
    return {
      lastSuccessfulAt: null,
      lastRunAt: null,
      lastRunOk: null,
      window: { runs: 0, failed: 0, sentence: STORE_SENTENCE[stored.code] ?? STORE_UNRECOGNISED },
      rows: rowsFor(null),
      unavailable: STORE_SENTENCE[stored.code] ?? STORE_UNRECOGNISED,
      fixtureE2E: "Not reported: the stored history could not be read.",
    };
  }
  const runs = stored.history.runs;
  const latest = runs[0] ?? null;
  const failed = runs.filter((run) => !run.ok).length;
  const fixture = latest?.fixtureE2E;
  return {
    lastSuccessfulAt: runs.find((run) => run.ok)?.startedAt ?? null,
    lastRunAt: latest?.startedAt ?? null,
    lastRunOk: latest ? latest.ok : null,
    window: {
      runs: runs.length,
      failed,
      sentence: runs.length === 0
        ? "No scheduled check has been stored yet."
        : `${failed} of the last ${runs.length} stored run${runs.length === 1 ? "" : "s"} did not pass.`,
    },
    rows: rowsFor(latest),
    unavailable: null,
    /*
      BA-134. The word "fixture" is ours and is on the public-copy ban list; the sentence a reader
      needs is what the scheduled checks do and do not cover, which is what both branches now say.
      Neither branch claims a pass: the first states the scope, and the second states that the
      check reported a failure rather than a result.
    */
    fixtureE2E: !fixture || fixture.status === "not_enabled"
      ? "Not covered. The scheduled checks do not carry a document through the full pipeline, so nothing here reports on sanitization or document reading."
      : "Reported a failure. The scheduled end-to-end check ran and did not complete, so it is not reporting a pass.",
  };
}
