import { describe, expect, it } from "vitest";
import {
  GDP_PDF_ARMS,
  GDP_PDF_SEALED_PROTOCOL_DIGEST,
  GDP_PDF_RUN_SCHEMA,
  buildGdpPdfBenchmarkEvidenceDraft,
  buildGdpPdfRunReceipt,
  gdpPdfTaskSetDigest,
  validateGdpPdfRunInput,
  validateGdpPdfRunReceipt,
  type GdpPdfRunInput,
  type GdpPdfTask,
  type GdpPdfTaskOutput,
} from "./gdp-pdf-eval";

const D = (character: string) => `sha256:${character.repeat(64)}`;

const tasks: GdpPdfTask[] = Array.from({ length: 100 }, (_, index) => ({
  taskId: `task-${String(index + 1).padStart(3, "0")}`,
  taskResponseId: `response-${String(index + 1).padStart(3, "0")}`,
  domain: index % 2 === 0 ? "Healthcare" : "Finance",
  pdfDigest: D("1"),
  promptDigest: D("2"),
  rubricDigest: D("3"),
  criterionCount: index % 2 === 0 ? 3 : 2,
}));

function scoredOutput(task: GdpPdfTask, arm: (typeof GDP_PDF_ARMS)[number], epoch: number): GdpPdfTaskOutput {
  return {
    taskId: task.taskId,
    arm,
    epoch,
    status: "scored",
    responseDigest: D("7"),
    judgeReceiptDigest: D("8"),
    passedCriteria: task.criterionCount,
    totalCriteria: task.criterionCount,
    allPass: true,
    failure: null,
    latencyMs: 100 + epoch,
    inputTokens: 200,
    outputTokens: 50,
    costUsdMicros: 300,
    executionReceiptDigest: D("a"),
    adaptiveRouteReceiptDigest: arm === "adaptive_router" ? D("9") : null,
  };
}

function fixture(): GdpPdfRunInput {
  const outputs = tasks.flatMap((task) => GDP_PDF_ARMS.flatMap((arm) => [1, 2, 3, 4, 5].map((epoch) => scoredOutput(task, arm, epoch))));
  return {
    manifest: {
      schemaVersion: GDP_PDF_RUN_SCHEMA,
      runId: "018f4f1a-7c2d-7fd0-8e9a-112233445566",
      protocolDigest: GDP_PDF_SEALED_PROTOCOL_DIGEST,
      datasetRepository: "https://huggingface.co/datasets/surgeai/GDP.pdf",
      datasetRevision: "400e411fc344b1b8dd2a51e70a7ecdf469c05b3c",
      datasetManifestDigest: D("b"),
      corpusDigest: D("c"),
      upstreamHarnessRepository: "https://github.com/surge-ai/gdp-pdf",
      upstreamHarnessRevision: "7a72a514a6ab19c90babb00adc817e4ae86b9c1b",
      upstreamHarnessTreeDigest: D("d"),
      taskSetDigest: gdpPdfTaskSetDigest(tasks),
      expectedTaskCount: tasks.length,
      epochs: 5,
      subjectModel: { provider: "provider", model: "subject-model", revision: "2026-09-01" },
      judge: { provider: "google", model: "gemini-3.5-flash", revision: "2026-09-01", promptDigest: D("e") },
      arms: Object.fromEntries(GDP_PDF_ARMS.map((arm, index) => [arm, {
        adapterRevision: `adapter-${index + 1}`,
        promptDigest: D(String(index + 1)),
        configDigest: D(String(index + 5)),
      }])) as GdpPdfRunInput["manifest"]["arms"],
      hardwareDigest: D("f"),
      priceSnapshotDigest: D("0"),
      thresholdsDigest: D("1"),
      startedAt: "2026-09-20T00:00:00.000Z",
      completedAt: "2026-09-20T00:10:00.000Z",
    },
    tasks,
    outputs,
  };
}

describe("GDP.pdf evidence adapter", () => {
  it("seals a complete four-arm run with explicit denominators, cost, tokens and pairwise deltas", () => {
    const input = fixture();
    expect(validateGdpPdfRunInput(input)).toEqual([]);

    const receipt = buildGdpPdfRunReceipt(input);
    expect(receipt.denominator).toEqual({ tasks: 100, epochs: 5, attemptsPerArm: 500, totalAttempts: 2_000 });
    expect(receipt.arms.adaptive_router.allPass).toEqual({ numerator: 500, denominator: 500, value: 1 });
    expect(receipt.arms.native_pdf.tokens).toEqual({ input: 100_000, output: 25_000 });
    expect(receipt.arms.native_pdf.costUsdMicros).toBe(150_000);
    expect(receipt.pairedComparisons.adaptiveVsFixedControl.summary.meanAllPassDelta).toBe(0);
    expect(receipt.pairedComparisons.adaptiveVsFixedControl.cells).toHaveLength(500);
    expect(receipt.infrastructureValid).toBe(true);
    expect(validateGdpPdfRunReceipt(input, receipt)).toEqual([]);
  });

  it("refuses missing cells, changed task catalogs, extra raw fields and forged receipts", () => {
    const input = fixture();
    expect(validateGdpPdfRunInput({ ...input, outputs: input.outputs.slice(1) }).join("\n")).toContain("missing output");
    expect(validateGdpPdfRunInput({
      ...input,
      tasks: [{ ...input.tasks[0], domain: "changed" }, ...input.tasks.slice(1)],
    })).toContain("manifest.taskSetDigest does not match the canonical task catalog");

    const withRawResponse = {
      ...input.outputs[0],
      rawResponse: "unsealed model text",
    } as unknown as GdpPdfTaskOutput;
    expect(validateGdpPdfRunInput({ ...input, outputs: [withRawResponse, ...input.outputs.slice(1)] }).join("\n"))
      .toContain("unexpected or missing fields");

    const receipt = buildGdpPdfRunReceipt(input);
    expect(validateGdpPdfRunReceipt(input, { ...receipt, infrastructureValid: false }).join("\n"))
      .toContain("does not match the canonical run evidence");
  });

  it("keeps execution failures in the denominator and blocks promotion on adapter or judge failure", () => {
    const input = fixture();
    const failed: GdpPdfTaskOutput = {
      ...input.outputs[0],
      status: "adapter_failure",
      responseDigest: null,
      judgeReceiptDigest: null,
      passedCriteria: 0,
      allPass: false,
      failure: { stage: "adapter", code: "TIMEOUT", detailDigest: D("a") },
    };
    const failedInput = { ...input, outputs: [failed, ...input.outputs.slice(1)] };
    const receipt = buildGdpPdfRunReceipt(failedInput);
    expect(receipt.arms.native_pdf.allPass).toEqual({ numerator: 499, denominator: 500, value: 0.998 });
    expect(receipt.arms.native_pdf.meanCriteria).toEqual({ sumAttemptFractions: 499, denominator: 500, value: 0.998 });
    expect(receipt.arms.native_pdf.failures.adapter).toBe(1);
    expect(receipt.infrastructureValid).toBe(false);
    expect(() => buildGdpPdfBenchmarkEvidenceDraft(receipt, {
      quality: { passed: true, value: 0.75, threshold: 0.7 },
    })).toThrow("adapter or judge failures");
  });

  it("builds only a database-digest draft after every sealed threshold passes", () => {
    const receipt = buildGdpPdfRunReceipt(fixture());
    const draft = buildGdpPdfBenchmarkEvidenceDraft(receipt, {
      quality_noninferiority: { passed: true, value: 0, threshold: -0.01 },
      cost_guardrail: { passed: true, value: 1, threshold: 1 },
    });
    expect(draft.bodyWithoutEvidenceDigest.benchmarkRunReceiptDigest).toBe(receipt.receiptDigest);
    expect(draft.bodyWithoutEvidenceDigest).not.toHaveProperty("evidenceDigest");
    expect(() => buildGdpPdfBenchmarkEvidenceDraft(receipt, {
      quality_noninferiority: { passed: false, value: -0.02, threshold: -0.01 },
    })).toThrow("all sealed router thresholds");
  });
});
