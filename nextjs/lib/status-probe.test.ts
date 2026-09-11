/*
  O02 — what /status is allowed to say about a probe result.

  Three failures this guards, all of them ways a status page lies without anyone editing a
  sentence: a missing result rendering as blank, a failed read rendering as "has not run", and a
  rate quoted without the denominator it was measured over.
*/
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_RUN, buildProbeSection } from "./status-probe";
import { PROBE_RUN_SCHEMA, type ProbeCheck, type ProbeRun } from "./synthetic-probe";

const HISTORY_SCHEMA = "tavonel.synthetic_probe_history.v1" as const;

function run(overrides: Partial<ProbeRun> = {}, checks: Partial<ProbeCheck>[] = []): ProbeRun {
  const base: ProbeCheck[] = [
    { name: "cdr", kind: "request", status: "ok", latencyMs: 120, errorClass: null },
    { name: "ocr", kind: "request", status: "not_probed", latencyMs: null, errorClass: "gpu_spend_gate" },
    { name: "coreV2", kind: "request", status: "ok", latencyMs: 210, errorClass: null },
    { name: "r2", kind: "request", status: "ok", latencyMs: 95, errorClass: null },
    { name: "db", kind: "request", status: "ok", latencyMs: 60, errorClass: null },
    { name: "billing", kind: "configuration", status: "ok", latencyMs: null, errorClass: null },
  ];
  return {
    schemaVersion: PROBE_RUN_SCHEMA,
    startedAt: "2026-09-11T01:00:00.000Z",
    durationMs: 500,
    ok: true,
    fixtureE2E: { enabled: false, status: "not_enabled", code: null },
    ...overrides,
    checks: base.map((check) => ({ ...check, ...checks.find((entry) => entry.name === check.name) })),
  };
}

function stored(runs: ProbeRun[]) {
  return { ok: true as const, history: { schemaVersion: HISTORY_SCHEMA, runs } };
}

describe("the /status synthetic probe section", () => {
  it("reports the newest passing run separately from the newest run of any outcome", () => {
    const failedLater = run({ startedAt: "2026-09-11T02:00:00.000Z", ok: false }, [
      { name: "db", status: "failed", errorClass: "timeout", latencyMs: 5_000 },
    ]);
    const section = buildProbeSection(stored([failedLater, run()]));
    expect(section.lastRunAt).toBe("2026-09-11T02:00:00.000Z");
    expect(section.lastRunOk).toBe(false);
    // "Last successful" is the question the audit asked for, and it is not the same row.
    expect(section.lastSuccessfulAt).toBe("2026-09-11T01:00:00.000Z");
    expect(section.window.sentence).toBe("1 of the last 2 stored runs did not pass.");
    expect(section.rows.find((row) => row.name === "db")).toMatchObject({
      state: "failed",
      detail: "no answer inside the probe's time limit",
    });
  });

  it("renders an empty history as NOT RUN on every row, never as blank", () => {
    const section = buildProbeSection(stored([]));
    expect(section.lastSuccessfulAt).toBeNull();
    expect(section.lastRunAt).toBeNull();
    expect(section.lastRunOk).toBeNull();
    expect(section.window).toEqual({ runs: 0, failed: 0, sentence: "No synthetic probe run has been stored yet." });
    expect(section.rows).toHaveLength(6);
    for (const row of section.rows) {
      expect(row.state).toBe(NOT_RUN);
      expect(row.detail.length).toBeGreaterThan(0);
      expect(row.label.length).toBeGreaterThan(0);
    }
  });

  it("says a read failed rather than saying the probe has not run", () => {
    const section = buildProbeSection({ ok: false, code: "PROBE_HISTORY_READ_FAILED" });
    expect(section.unavailable).toBe("PROBE_HISTORY_READ_FAILED");
    expect(section.window.sentence).toContain("PROBE_HISTORY_READ_FAILED");
    // The distinction: "we could not find out" is not "it has not run", and neither is green.
    expect(section.window.sentence).not.toContain("has been stored yet");
    expect(section.rows.every((row) => row.state === NOT_RUN)).toBe(true);
    expect(section.fixtureE2E).toContain("could not be read");
  });

  it("never lets a configuration row read as a request that succeeded", () => {
    const billing = buildProbeSection(stored([run()])).rows.find((row) => row.name === "billing")!;
    expect(billing.state).toBe("operational");
    expect(billing.detail).toBe("configuration only; no request is sent through it");
  });

  it("gives an unprobed dependency its reason and keeps it out of pass and fail", () => {
    const rows = buildProbeSection(stored([run()])).rows;
    expect(rows.find((row) => row.name === "ocr")).toMatchObject({
      state: "not probed",
      detail: "not probed: a health request would cold-start a GPU worker",
    });
  });

  it("names the fixture end-to-end run as refused when it was switched on", () => {
    const section = buildProbeSection(stored([
      run({ ok: false, fixtureE2E: { enabled: true, status: "refused", code: "PROBE_FIXTURE_E2E_NOT_IMPLEMENTED" } }),
    ]));
    expect(section.fixtureE2E).toContain("PROBE_FIXTURE_E2E_NOT_IMPLEMENTED");
    expect(section.fixtureE2E).toContain("not implemented");
    expect(section.lastSuccessfulAt).toBeNull();
  });

  it("says plainly that nothing here proves sanitization or OCR read a document", () => {
    expect(buildProbeSection(stored([run()])).fixtureE2E).toContain("nothing here proves sanitization");
  });

  /*
    The colour a failure lands on (ops CROSS-LANE 3).

    `.status-list article > span` is green by default, so a `data-state` value with no rule in
    tavonel.css renders a failed probe in the colour of a passing one. A failure used to borrow
    `closed`, which made a request that came back wrong look exactly like a capability
    deliberately switched off. Both files are read here because either half alone is useless.
  */
  it("gives a failed probe its own style instead of borrowing a configuration state", () => {
    const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
    const page = read("app/status/page.tsx");
    expect(page, "the page passes the state through").toContain('row.state === "failed" ? "failed"');
    expect(page, "a failure no longer renders as closed").not.toContain('row.state === "failed" ? "closed"');
    expect(read("app/tavonel.css"), "and the stylesheet has a rule for it")
      .toContain('.status-list article[data-state="failed"] > span');
  });
});
