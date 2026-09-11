/*
  The /status view of a probe run, kept out of the page so it can be tested.

  The whole point of the section is that a reader can tell two things apart at a glance: the rows
  above it, which say a component is configured and its gate is open, and these rows, which say a
  request was sent through it and what came back. So every sentence this file produces names which
  one it is, and nothing here can render blank:

  - No stored run at all is "NOT RUN". Not an empty cell, not a dash, not "unknown".
  - A history that could not be read is a named failure, never NOT RUN. "It has not run" and "we
    could not find out" are different facts and the page says which one it has.
  - A rate carries its denominator, because a campaign rule says so and because "5% failed" over
    twenty runs is a different statement from the same number over two thousand.
*/
import { PROBE_DEPENDENCIES, type ProbeCheck, type ProbeDependency, type ProbeRun } from "./synthetic-probe";
import type { ProbeHistory } from "./synthetic-probe-store";

export const NOT_RUN = "NOT RUN" as const;

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
      : { name, label: DEPENDENCY_LABEL[name], state: NOT_RUN, detail: "no probe result is stored for this dependency" };
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
      window: { runs: 0, failed: 0, sentence: `The probe history could not be read (${stored.code}).` },
      rows: rowsFor(null),
      unavailable: stored.code,
      fixtureE2E: "Unknown: the probe history could not be read.",
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
        ? "No synthetic probe run has been stored yet."
        : `${failed} of the last ${runs.length} stored run${runs.length === 1 ? "" : "s"} did not pass.`,
    },
    rows: rowsFor(latest),
    unavailable: null,
    fixtureE2E: !fixture || fixture.status === "not_enabled"
      ? "Off. No document is put through the real pipeline by this probe, so nothing here proves sanitization or OCR read a file."
      : `Enabled and refused (${fixture.code}). The end-to-end fixture run is not implemented, so this probe is reporting failure rather than a pass.`,
  };
}
