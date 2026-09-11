import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOURNEY_STEPS,
  NOT_APPLICABLE_ALLOWED,
  PACKAGE_CONTRACT,
  STATUSES,
  journeyFromReceipt,
  planLines,
  receiptKind,
  rollUp,
  validateReceipt,
} from "../scripts/journey/acceptance-checker.mjs";
import { REQUIRED_PACKAGE_PATHS } from "./collection-download";
import { AI_PACKAGE_CONTENTS } from "./ai-package-guidance";

/*
  WG-032/033/055. The 18-step journey model, checked against the only real receipts that exist.

  `scripts/journey/receipt-fixtures/` holds 12 receipts written by the 2026-09-06 run of this
  harness (D:\CodexProjects\uskc-lanes\e2e\receipts, read-only source), copied byte-for-byte
  except that the R2 account host in the presigned PUT path is replaced with
  `r2-account-redacted`. They are the whole point of the checker: a status vocabulary nobody has
  run a real receipt through is a vocabulary, not a check.

  What those 12 receipts do NOT contain is the reason most of this file is about refusals. Not one
  of them reached WORLD or ASK, because promotion is browser-session-only and no person promoted
  a candidate that day. So every assertion below about steps 8-17 is an assertion that the model
  reports an unreached step honestly -- NOT_RUN or HELD -- rather than quietly passing it.
*/

const FIXTURE_DIR = resolve(import.meta.dirname, "../scripts/journey/receipt-fixtures");
const FIXTURES = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).sort();
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));

/** The 18 steps, in the order the lane contract fixes them. */
const CONTRACT_ORDER = [
  "login_permission",
  "full_input",
  "security_processing",
  "real_read",
  "uncertainty",
  "structuring",
  "candidate_validation",
  "human_approval",
  "active_world",
  "ask",
  "source_locator",
  "live_external_consumption",
  "file_consumption",
  "revision_input",
  "change_approval",
  "post_change_use",
  "previous_result_preserved",
  "accounting",
];

describe("journey model", () => {
  it("is the contract's 18 steps, in order, numbered 1..18", () => {
    expect(JOURNEY_STEPS.map((s: { step: string }) => s.step)).toEqual(CONTRACT_ORDER);
    expect(JOURNEY_STEPS.map((s: { n: number }) => s.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("uses exactly the six-word status vocabulary", () => {
    expect(STATUSES).toEqual(["PASS", "FAIL", "NOT_RUN", "NOT_APPLICABLE", "HELD", "PARTIAL"]);
  });

  it("lets only `uncertainty` be NOT_APPLICABLE", () => {
    // Blueprint §5: an input that needed no human review makes that step inapplicable. A step
    // nobody built does not become inapplicable, it stays NOT_RUN.
    expect([...NOT_APPLICABLE_ALLOWED]).toEqual(["uncertainty"]);
  });

  it("plans every step without a credential", () => {
    const lines = planLines();
    expect(lines).toHaveLength(18);
    // The plan is what somebody reads before authorising a run, so the three steps that do not
    // exist have to say so there rather than only in a report.
    const unimplemented = JOURNEY_STEPS.filter((s: { implemented: boolean }) => !s.implemented).map((s: { step: string }) => s.step);
    expect(unimplemented).toEqual(["revision_input", "change_approval", "post_change_use"]);
    for (const line of lines) expect(line).not.toMatch(/tvnl_live_[A-Za-z0-9]/);
  });
});

describe("rollUp", () => {
  const of = (execution: string, semantic: string, task: string) => rollUp({ execution, semantic, task });

  it("is worst-wins over the dimensions that apply", () => {
    expect(of("PASS", "PASS", "PASS")).toBe("PASS");
    expect(of("PASS", "FAIL", "NOT_APPLICABLE")).toBe("FAIL");
    expect(of("PASS", "PARTIAL", "NOT_APPLICABLE")).toBe("PARTIAL");
    expect(of("HELD", "NOT_RUN", "NOT_APPLICABLE")).toBe("HELD");
    expect(of("NOT_RUN", "NOT_RUN", "NOT_APPLICABLE")).toBe("NOT_RUN");
  });

  it("passes a step whose task dimension does not apply, without calling the step inapplicable", () => {
    // Every intermediate step has task=NOT_APPLICABLE. If that leaked into the roll-up, a
    // successful upload would report as a step that did not apply.
    expect(of("PASS", "PASS", "NOT_APPLICABLE")).toBe("PASS");
    expect(of("NOT_APPLICABLE", "NOT_APPLICABLE", "NOT_APPLICABLE")).toBe("NOT_APPLICABLE");
  });

  it("refuses a word outside the vocabulary", () => {
    expect(() => of("PASS", "OK", "NOT_APPLICABLE")).toThrow(/unknown status OK/);
  });
});

describe("the 12 real receipts", () => {
  it("are the 12 that were copied", () => {
    expect(FIXTURES).toHaveLength(12);
  });

  it("validate against receipt.schema.json", () => {
    for (const name of FIXTURES) {
      const result = validateReceipt(read(name));
      expect(result.errors, name).toEqual([]);
      expect(result.ok, name).toBe(true);
    }
  });

  it("carry no key, bearer header or presigned signature", () => {
    for (const name of FIXTURES) {
      const text = readFileSync(join(FIXTURE_DIR, name), "utf8");
      expect(text, name).not.toMatch(/tvnl_live_[A-Za-z0-9]/);
      expect(text, name).not.toMatch(/X-Amz-(Signature|Credential)/i);
      expect(text, name).not.toMatch(/"authorization"/i);
      // The presigned query is dropped by the harness; the account host is redacted on copy.
      expect(text, name).not.toMatch(/[0-9a-f]{16,}\.r2\.cloudflarestorage\.com/);
    }
  });

  it("each produce all 18 rows with a vocabulary status", () => {
    for (const name of FIXTURES.filter((f) => receiptKind(read(f)) === "journeyReceipt")) {
      const rows = journeyFromReceipt(read(name));
      expect(rows.map((r) => r.step), name).toEqual(CONTRACT_ORDER);
      for (const row of rows) {
        expect(STATUSES, `${name} ${row.step}`).toContain(row.status);
        expect(row.evidence.length, `${name} ${row.step}`).toBeGreaterThan(0);
      }
    }
  });

  it("never report an unreached step as inapplicable", () => {
    for (const name of FIXTURES.filter((f) => receiptKind(read(f)) === "journeyReceipt")) {
      const rows = journeyFromReceipt(read(name));
      const inapplicable = rows.filter((r) => r.status === "NOT_APPLICABLE").map((r) => r.step);
      for (const step of inapplicable) expect(NOT_APPLICABLE_ALLOWED.has(step), `${name} ${step}`).toBe(true);
    }
  });

  it("report step 8 onward as unreached, because no candidate was ever promoted", () => {
    // The campaign fact this whole lane exists downstream of: no *_resume_* receipt exists, so
    // no World, no answer, no locator check, no consumer. The model must not soften that.
    for (const name of FIXTURES.filter((f) => receiptKind(read(f)) === "journeyReceipt")) {
      const rows = journeyFromReceipt(read(name));
      const by = (step: string) => rows.find((r) => r.step === step)!;
      expect(["HELD", "NOT_RUN"], `${name} human_approval`).toContain(by("human_approval").status);
      for (const step of ["active_world", "ask", "source_locator", "live_external_consumption", "file_consumption"]) {
        expect(["HELD", "NOT_RUN"], `${name} ${step}`).toContain(by(step).status);
      }
      expect(by("source_locator").task, name).not.toBe("PASS");
    }
  });

  it("read the furthest receipt exactly as far as it went", () => {
    const rows = journeyFromReceipt(read("docx_2026-09-06T10-06-50-060Z.json"));
    const status = (step: string) => rows.find((r) => r.step === step)!.status;
    expect(status("full_input")).toBe("PASS");
    expect(status("security_processing")).toBe("PASS");
    // ocr.json exists and its size is recorded; nothing checks what it says, so semantic is partial.
    expect(status("real_read")).toBe("PARTIAL");
    expect(status("uncertainty")).toBe("NOT_APPLICABLE");
    expect(status("structuring")).toBe("PASS");
    expect(status("human_approval")).toBe("HELD");
    expect(rows.find((r) => r.step === "human_approval")!.evidence).toMatch(/browser-session-only/);
  });

  it("read a held read as HELD and a compile refusal as FAIL", () => {
    const held = journeyFromReceipt(read("pdf_2026-09-06T09-56-53-368Z.json"));
    expect(held.find((r) => r.step === "real_read")!.status).toBe("HELD");
    // A document the reader was not confident about is a safety pass for step 5 and not a
    // completed job: the task dimension stays out of it.
    expect(held.find((r) => r.step === "uncertainty")!.status).toBe("PASS");
    expect(held.find((r) => r.step === "uncertainty")!.task).toBe("NOT_APPLICABLE");

    const failed = journeyFromReceipt(read("xlsx_2026-09-06T10-06-50-060Z.json"));
    expect(failed.find((r) => r.step === "structuring")!.status).toBe("FAIL");
    expect(failed.find((r) => r.step === "structuring")!.evidence).toMatch(/review_required/);
  });

  it("say cost is unmeasured on receipts that predate the cost field", () => {
    const rows = journeyFromReceipt(read("pptx_2026-09-06T10-50-46-560Z.json"));
    const accounting = rows.find((r) => r.step === "accounting")!;
    expect(accounting.status).toBe("PARTIAL");
    expect(accounting.evidence).toMatch(/cost field absent/);
    // No figure, measured or invented, may appear in an accounting row.
    expect(accounting.evidence).not.toMatch(/[$€₩]|USD|KRW/);
  });

  it("treat the unauthenticated probe as its own artifact, not a journey", () => {
    const probe = read("unauthenticated_probe.json");
    expect(receiptKind(probe)).toBe("unauthenticatedProbe");
    expect(validateReceipt(probe).ok).toBe(true);
    expect(probe.allGuardedRoutesRefused).toBe(true);
  });
});

describe("validateReceipt refuses a receipt that claims more than it holds", () => {
  const base = () => read("docx_2026-09-06T10-06-50-060Z.json");

  it("rejects PROVEN_E2E without the token in evidence", () => {
    const receipt = { ...base(), verdict: "PROVEN_E2E", reachedStep: "ASK", tokenFoundInEvidence: null };
    expect(validateReceipt(receipt).errors).toContain("verdict PROVEN_E2E but tokenFoundInEvidence is not true");
  });

  it("rejects PROVEN_E2E that stopped earlier", () => {
    const receipt = { ...base(), verdict: "PROVEN_E2E", tokenFoundInEvidence: true };
    expect(validateReceipt(receipt).errors).toContain("verdict PROVEN_E2E but reachedStep is COLLECTION");
  });

  it("rejects a missing required field", () => {
    const receipt = base();
    delete receipt.sha256;
    expect(validateReceipt(receipt).errors).toContain("journeyReceipt: missing required field sha256");
  });

  it("rejects a status word outside the vocabulary", () => {
    const receipt = { ...base(), journey: [{ n: 1, step: "full_input", status: "OK", execution: "PASS", semantic: "PASS", task: "PASS", evidence: "x" }] };
    expect(validateReceipt(receipt).errors.join("\n")).toMatch(/"OK" is not one of PASS, FAIL/);
  });

  it("rejects NOT_APPLICABLE claimed for an unimplemented step", () => {
    // The misclassification the lane contract bars by name: relabelling a step nobody built.
    const receipt = { ...base(), notApplicable: { change_approval: "we do not need this" } };
    expect(validateReceipt(receipt).errors.join("\n")).toMatch(/notApplicable names change_approval: only uncertainty/);
  });

  it("rejects NOT_APPLICABLE for a step that is not in the model at all", () => {
    const receipt = { ...base(), notApplicable: { invoice_extraction: "no tables" } };
    expect(validateReceipt(receipt).errors.join("\n")).toMatch(/is not one of the 18 steps/);
  });

  it("rejects a NOT_APPLICABLE with no reason", () => {
    const receipt = { ...base(), notApplicable: { uncertainty: "   " } };
    expect(validateReceipt(receipt).errors).toContain("notApplicable.uncertainty needs a reason");
  });

  it("downgrades a NOT_APPLICABLE roll-up on a step that may not have one", () => {
    // Belt to the validator's braces: even if a derivation produced one, the table may not show
    // NOT_APPLICABLE anywhere but step 5.
    const rows = journeyFromReceipt({ calls: [], notApplicable: { post_change_use: "not needed" } });
    const row = rows.find((r) => r.step === "post_change_use")!;
    expect(row.status).toBe("NOT_RUN");
  });
});

describe("step 13 package contract", () => {
  it("is every file the download route writes, and nothing invented", () => {
    // WG-055. The harness copy cannot import TypeScript, so this is the test that keeps it from
    // drifting from the two modules that actually write the archive.
    const aiEntryFiles = ["README.md", "AGENTS.md", "manifest/ai-entrypoint.json"];
    expect(PACKAGE_CONTRACT).toEqual([...aiEntryFiles, ...REQUIRED_PACKAGE_PATHS]);
    for (const path of PACKAGE_CONTRACT) {
      expect(AI_PACKAGE_CONTENTS.map((f) => f.path), path).toContain(path);
    }
  });

  it("is reported as unverified, never as verified, when nothing verified it", () => {
    const rows = journeyFromReceipt({
      calls: [],
      filePackage: { via: "GET /api/v1/collections/{id}/download", status: 200, sha256: "a".repeat(64), bytes: 10, verified: null, missingContractPaths: null },
    });
    const row = rows.find((r) => r.step === "file_consumption")!;
    expect(row.execution).toBe("PASS");
    expect(row.semantic).toBe("NOT_RUN");
    expect(row.task).toBe("NOT_RUN");
    expect(row.status).toBe("PARTIAL");
  });

  it("fails the step when the archive is missing a contract path", () => {
    const rows = journeyFromReceipt({
      calls: [],
      filePackage: { via: "GET", status: 200, sha256: "a".repeat(64), bytes: 10, verified: true, missingContractPaths: ["AGENTS.md"] },
    });
    const row = rows.find((r) => r.step === "file_consumption")!;
    expect(row.semantic).toBe("FAIL");
    expect(row.status).toBe("FAIL");
    expect(row.evidence).toMatch(/missing AGENTS.md/);
  });
});

describe("steps a promoted World would unlock", () => {
  /*
    No receipt in existence reaches these, so they are driven from hand-built receipt fragments.
    That is the honest form of the test: it checks the model's arithmetic, and it is not evidence
    that the product does any of this. Only a real run can be that.
  */
  it("passes the locator check only when the answer cites this file's own token", () => {
    const cited = journeyFromReceipt({ calls: [], uniqueToken: "TAVONEL-E2E-PDF-7f3a", tokenFoundInEvidence: true });
    expect(cited.find((r) => r.step === "source_locator")!.task).toBe("PASS");

    const elsewhere = journeyFromReceipt({ calls: [], uniqueToken: "TAVONEL-E2E-PDF-7f3a", tokenFoundInEvidence: false });
    const row = elsewhere.find((r) => r.step === "source_locator")!;
    expect(row.status).toBe("FAIL");
    expect(row.evidence).toMatch(/retrieval ran, but not over this file/);
  });

  it("records an abstention as a held answer, not a failed call", () => {
    const rows = journeyFromReceipt({
      calls: [{ step: "ASK", method: "POST", path: "/api/v1/collections/x/ask", status: 200, code: "ANSWER_ABSTAINED", latencyMs: 1 }],
      askResponse: { code: "ANSWER_ABSTAINED" },
      blockedBy: "ANSWER_ABSTAINED:insufficient evidence",
    });
    const row = rows.find((r) => r.step === "ask")!;
    expect(row.execution).toBe("PASS");
    expect(row.semantic).toBe("HELD");
    expect(row.status).toBe("PARTIAL");
  });

  it("only reports preservation from a resume receipt", () => {
    const first = journeyFromReceipt({ calls: [] });
    expect(first.find((r) => r.step === "previous_result_preserved")!.status).toBe("NOT_RUN");

    const resumed = journeyFromReceipt({ calls: [], mode: "resume", resumedFrom: "receipts/docx_first.json", priorVerdict: "REACHED_COLLECTION" });
    const row = resumed.find((r) => r.step === "previous_result_preserved")!;
    expect(row.status).toBe("PASS");
    expect(row.evidence).toMatch(/receipts\/docx_first\.json/);
  });

  it("keeps steps 14-16 NOT_RUN even when a World is active", () => {
    const rows = journeyFromReceipt({
      calls: [],
      collectionId: "collection-" + "a".repeat(32),
      activeWorld: { manifestDigest: "sha256:" + "b".repeat(64) },
      tokenFoundInEvidence: true,
      uniqueToken: "TAVONEL-E2E-PDF-7f3a-r3",
    });
    for (const step of ["revision_input", "change_approval", "post_change_use"]) {
      const row = rows.find((r) => r.step === step)!;
      expect(row.status, step).toBe("NOT_RUN");
      expect(row.evidence, step).toMatch(/no revision step exists|no change-approval endpoint|depends on steps/);
    }
    // The salt is new-document ingestion. Saying so is the difference between a revision step and
    // a re-upload that looks like one.
    expect(rows.find((r) => r.step === "revision_input")!.evidence).toMatch(/new source version/);
  });
});
