import { createHash } from "node:crypto";

export const GDP_PDF_RUN_SCHEMA = "tavonel.gdp_pdf.run.v1" as const;
export const GDP_PDF_RECEIPT_SCHEMA = "tavonel.gdp_pdf.receipt.v1" as const;
export const GDP_PDF_ADAPTIVE_EVIDENCE_SCHEMA = "tavonel.adaptive_router_evidence.v1" as const;
export const GDP_PDF_DATASET_REPOSITORY = "https://huggingface.co/datasets/surgeai/GDP.pdf" as const;
export const GDP_PDF_DATASET_REVISION = "400e411fc344b1b8dd2a51e70a7ecdf469c05b3c" as const;
export const GDP_PDF_HARNESS_REPOSITORY = "https://github.com/surge-ai/gdp-pdf" as const;
export const GDP_PDF_HARNESS_REVISION = "7a72a514a6ab19c90babb00adc817e4ae86b9c1b" as const;
export const GDP_PDF_SEALED_PROTOCOL_DIGEST = "sha256:0cab46bd7259a44522c8160f463187182f4c8eb6c1a5bb9b4e482fae5efd8da3" as const;
export const GDP_PDF_TASK_COUNT = 100 as const;
export const GDP_PDF_EPOCHS = 5 as const;

export const GDP_PDF_ARMS = [
  "native_pdf",
  "compiled_context_pdf",
  "fixed_control_retrieval_rerank",
  "adaptive_router",
] as const;

export type GdpPdfArm = (typeof GDP_PDF_ARMS)[number];
export type GdpPdfFailureStage = "subject" | "adapter" | "judge";

export type GdpPdfModelPin = Readonly<{
  provider: string;
  model: string;
  revision: string;
}>;

export type GdpPdfArmPin = Readonly<{
  adapterRevision: string;
  promptDigest: string;
  configDigest: string;
}>;

export type GdpPdfRunManifest = Readonly<{
  schemaVersion: typeof GDP_PDF_RUN_SCHEMA;
  runId: string;
  protocolDigest: string;
  datasetRepository: string;
  datasetRevision: string;
  datasetManifestDigest: string;
  corpusDigest: string;
  upstreamHarnessRepository: string;
  upstreamHarnessRevision: string;
  upstreamHarnessTreeDigest: string;
  taskSetDigest: string;
  expectedTaskCount: number;
  epochs: number;
  subjectModel: GdpPdfModelPin;
  judge: GdpPdfModelPin & Readonly<{ promptDigest: string }>;
  arms: Readonly<Record<GdpPdfArm, GdpPdfArmPin>>;
  hardwareDigest: string;
  priceSnapshotDigest: string;
  thresholdsDigest: string;
  startedAt: string;
  completedAt: string;
}>;

export type GdpPdfTask = Readonly<{
  taskId: string;
  taskResponseId: string;
  domain: string;
  pdfDigest: string;
  promptDigest: string;
  rubricDigest: string;
  criterionCount: number;
}>;

export type GdpPdfTaskOutput = Readonly<{
  taskId: string;
  arm: GdpPdfArm;
  epoch: number;
  status: "scored" | "subject_failure" | "adapter_failure" | "judge_failure";
  responseDigest: string | null;
  judgeReceiptDigest: string | null;
  passedCriteria: number;
  totalCriteria: number;
  allPass: boolean;
  failure: Readonly<{
    stage: GdpPdfFailureStage;
    code: string;
    detailDigest: string;
  }> | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  executionReceiptDigest: string;
  adaptiveRouteReceiptDigest: string | null;
}>;

export type GdpPdfRunInput = Readonly<{
  manifest: GdpPdfRunManifest;
  tasks: readonly GdpPdfTask[];
  outputs: readonly GdpPdfTaskOutput[];
}>;

export type GdpPdfArmSummary = Readonly<{
  tasks: number;
  attempts: number;
  allPass: Readonly<{ numerator: number; denominator: number; value: number }>;
  meanCriteria: Readonly<{ sumAttemptFractions: number; denominator: number; value: number }>;
  failures: Readonly<Record<GdpPdfFailureStage, number>>;
  latencyMs: Readonly<{ p50: number; p95: number }>;
  tokens: Readonly<{ input: number; output: number }>;
  costUsdMicros: number;
}>;

export type GdpPdfPairedCell = Readonly<{
  taskId: string;
  epoch: number;
  allPassDelta: -1 | 0 | 1;
  criterionFractionDelta: number;
  latencyMsDelta: number;
  inputTokensDelta: number;
  outputTokensDelta: number;
  costUsdMicrosDelta: number;
}>;

export type GdpPdfPairedComparison = Readonly<{
  challenger: GdpPdfArm;
  control: GdpPdfArm;
  cells: readonly GdpPdfPairedCell[];
  cellsDigest: string;
  summary: Readonly<{
    attempts: number;
    allPassWins: number;
    allPassTies: number;
    allPassLosses: number;
    meanAllPassDelta: number;
    meanCriterionFractionDelta: number;
    meanLatencyMsDelta: number;
    meanCostUsdMicrosDelta: number;
  }>;
}>;

export type GdpPdfRunReceiptBody = Readonly<{
  schemaVersion: typeof GDP_PDF_RECEIPT_SCHEMA;
  runId: string;
  protocolDigest: string;
  datasetRevision: string;
  datasetManifestDigest: string;
  corpusDigest: string;
  upstreamHarnessRevision: string;
  upstreamHarnessTreeDigest: string;
  taskSetDigest: string;
  evaluatorDigest: string;
  outputsDigest: string;
  thresholdsDigest: string;
  measuredAt: string;
  denominator: Readonly<{
    tasks: number;
    epochs: number;
    attemptsPerArm: number;
    totalAttempts: number;
  }>;
  arms: Readonly<Record<GdpPdfArm, GdpPdfArmSummary>>;
  pairedComparisons: Readonly<{
    adaptiveVsFixedControl: GdpPdfPairedComparison;
    compiledVsNative: GdpPdfPairedComparison;
  }>;
  infrastructureValid: boolean;
}>;

export type GdpPdfRunReceipt = GdpPdfRunReceiptBody & Readonly<{ receiptDigest: string }>;

export type GdpPdfBenchmarkEvidenceDraft = Readonly<{
  bodyWithoutEvidenceDigest: Readonly<{
    schemaVersion: typeof GDP_PDF_ADAPTIVE_EVIDENCE_SCHEMA;
    receiptId: string;
    corpusDigest: string;
    evaluatorDigest: string;
    benchmarkRunReceiptDigest: string;
    thresholdResults: Readonly<Record<string, Readonly<{ passed: true; value: number; threshold: number }>>>;
  }>;
  measuredAt: string;
  corpusDigest: string;
  evaluatorDigest: string;
}>;

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_EMPTY = /^\S(?:[\s\S]{0,510}\S)?$/;
const MOVING_MODEL_REVISION = /^(?:latest|current|default|auto)$/i;
const ARM_SET = new Set<string>(GDP_PDF_ARMS);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digest(value: unknown, domain: string): string {
  return `sha256:${sha256(`${domain}\u001f${canonicalize(value)}`)}`;
}

function isInstant(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactKeys(value: object, keys: readonly string[], at: string, problems: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    problems.push(`${at} has unexpected or missing fields`);
  }
}

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

function outputKey(output: GdpPdfTaskOutput): string {
  return `${output.taskId}\u0000${output.arm}\u0000${output.epoch}`;
}

function orderedTasks(tasks: readonly GdpPdfTask[]): GdpPdfTask[] {
  return [...tasks].sort((left, right) => left.taskId.localeCompare(right.taskId));
}

function orderedOutputs(outputs: readonly GdpPdfTaskOutput[]): GdpPdfTaskOutput[] {
  return [...outputs].sort((left, right) => {
    const task = left.taskId.localeCompare(right.taskId);
    if (task !== 0) return task;
    const arm = GDP_PDF_ARMS.indexOf(left.arm) - GDP_PDF_ARMS.indexOf(right.arm);
    return arm !== 0 ? arm : left.epoch - right.epoch;
  });
}

/**
 * Validates a complete four-arm GDP.pdf run. Every expected task/arm/epoch cell must exist exactly
 * once. Subject, adapter, and judge failures remain in the denominator; adapter or judge failures
 * additionally make the receipt ineligible for router promotion.
 */
export function validateGdpPdfRunInput(input: GdpPdfRunInput): string[] {
  const problems: string[] = [];
  const { manifest } = input;
  exactKeys(manifest, [
    "schemaVersion", "runId", "protocolDigest", "datasetRepository", "datasetRevision",
    "datasetManifestDigest", "corpusDigest", "upstreamHarnessRepository", "upstreamHarnessRevision",
    "upstreamHarnessTreeDigest", "taskSetDigest", "expectedTaskCount", "epochs", "subjectModel",
    "judge", "arms", "hardwareDigest", "priceSnapshotDigest", "thresholdsDigest", "startedAt", "completedAt",
  ], "manifest", problems);

  if (manifest.schemaVersion !== GDP_PDF_RUN_SCHEMA) problems.push("manifest.schemaVersion is unsupported");
  if (!UUID.test(manifest.runId)) problems.push("manifest.runId is not a UUID");
  for (const [field, value] of Object.entries({
    protocolDigest: manifest.protocolDigest,
    datasetManifestDigest: manifest.datasetManifestDigest,
    corpusDigest: manifest.corpusDigest,
    upstreamHarnessTreeDigest: manifest.upstreamHarnessTreeDigest,
    taskSetDigest: manifest.taskSetDigest,
    hardwareDigest: manifest.hardwareDigest,
    priceSnapshotDigest: manifest.priceSnapshotDigest,
    thresholdsDigest: manifest.thresholdsDigest,
    judgePromptDigest: manifest.judge.promptDigest,
  })) if (!DIGEST.test(value)) problems.push(`manifest.${field} is not a sha256 digest`);
  if (manifest.protocolDigest !== GDP_PDF_SEALED_PROTOCOL_DIGEST) problems.push("manifest.protocolDigest does not match the sealed protocol");
  if (manifest.datasetRepository !== GDP_PDF_DATASET_REPOSITORY || manifest.datasetRevision !== GDP_PDF_DATASET_REVISION) {
    problems.push("manifest dataset source does not match the sealed GDP.pdf revision");
  }
  if (manifest.upstreamHarnessRepository !== GDP_PDF_HARNESS_REPOSITORY || manifest.upstreamHarnessRevision !== GDP_PDF_HARNESS_REVISION) {
    problems.push("manifest harness source does not match the sealed GDP.pdf revision");
  }
  for (const [field, value] of Object.entries({
    datasetRepository: manifest.datasetRepository,
    datasetRevision: manifest.datasetRevision,
    upstreamHarnessRepository: manifest.upstreamHarnessRepository,
    upstreamHarnessRevision: manifest.upstreamHarnessRevision,
  })) if (!NON_EMPTY.test(value)) problems.push(`manifest.${field} is empty`);
  for (const [name, model] of [["subjectModel", manifest.subjectModel], ["judge", manifest.judge]] as const) {
    exactKeys(model, name === "judge" ? ["provider", "model", "revision", "promptDigest"] : ["provider", "model", "revision"], `manifest.${name}`, problems);
    if (![model.provider, model.model, model.revision].every((value) => NON_EMPTY.test(value))) {
      problems.push(`manifest.${name} is not an exact provider/model/revision pin`);
    }
    if (MOVING_MODEL_REVISION.test(model.revision)) problems.push(`manifest.${name}.revision is a moving alias`);
  }
  if (!Number.isSafeInteger(manifest.expectedTaskCount) || manifest.expectedTaskCount <= 0) {
    problems.push("manifest.expectedTaskCount is not positive");
  }
  if (!Number.isSafeInteger(manifest.epochs) || manifest.epochs <= 0) problems.push("manifest.epochs is not positive");
  if (manifest.expectedTaskCount !== GDP_PDF_TASK_COUNT || manifest.epochs !== GDP_PDF_EPOCHS) {
    problems.push(`manifest denominator must be ${GDP_PDF_TASK_COUNT} tasks x ${GDP_PDF_EPOCHS} epochs`);
  }
  if (!isInstant(manifest.startedAt) || !isInstant(manifest.completedAt) || Date.parse(manifest.completedAt) < Date.parse(manifest.startedAt)) {
    problems.push("manifest run interval is invalid");
  }
  exactKeys(manifest.arms, GDP_PDF_ARMS, "manifest.arms", problems);
  for (const arm of GDP_PDF_ARMS) {
    const pin = manifest.arms[arm];
    if (pin) exactKeys(pin, ["adapterRevision", "promptDigest", "configDigest"], `manifest.arms.${arm}`, problems);
    if (!pin || !NON_EMPTY.test(pin.adapterRevision)) problems.push(`manifest.arms.${arm}.adapterRevision is empty`);
    if (!pin || !DIGEST.test(pin.promptDigest) || !DIGEST.test(pin.configDigest)) {
      problems.push(`manifest.arms.${arm} does not pin prompt and config digests`);
    }
  }

  if (input.tasks.length !== manifest.expectedTaskCount) {
    problems.push(`task count ${input.tasks.length} does not equal sealed denominator ${manifest.expectedTaskCount}`);
  }
  const taskById = new Map<string, GdpPdfTask>();
  for (const task of input.tasks) {
    exactKeys(task, ["taskId", "taskResponseId", "domain", "pdfDigest", "promptDigest", "rubricDigest", "criterionCount"], `task ${task.taskId}`, problems);
    if (![task.taskId, task.taskResponseId, task.domain].every((value) => NON_EMPTY.test(value))) {
      problems.push(`task ${task.taskId || "<empty>"} has an empty identity field`);
    }
    if (![task.pdfDigest, task.promptDigest, task.rubricDigest].every((value) => DIGEST.test(value))) {
      problems.push(`task ${task.taskId} has an invalid artifact digest`);
    }
    if (!Number.isSafeInteger(task.criterionCount) || task.criterionCount <= 0) {
      problems.push(`task ${task.taskId} has no rubric criteria`);
    }
    if (taskById.has(task.taskId)) problems.push(`duplicate task ${task.taskId}`);
    taskById.set(task.taskId, task);
  }
  if (digest(orderedTasks(input.tasks), "tavonel.gdp_pdf.task_set.v1") !== manifest.taskSetDigest) {
    problems.push("manifest.taskSetDigest does not match the canonical task catalog");
  }

  const seen = new Set<string>();
  for (const output of input.outputs) {
    exactKeys(output, [
      "taskId", "arm", "epoch", "status", "responseDigest", "judgeReceiptDigest", "passedCriteria",
      "totalCriteria", "allPass", "failure", "latencyMs", "inputTokens", "outputTokens", "costUsdMicros",
      "executionReceiptDigest", "adaptiveRouteReceiptDigest",
    ], `output ${outputKey(output)}`, problems);
    const task = taskById.get(output.taskId);
    if (!task) problems.push(`output names unknown task ${output.taskId}`);
    if (!ARM_SET.has(output.arm)) problems.push(`output ${output.taskId} names unknown arm ${output.arm}`);
    if (!Number.isSafeInteger(output.epoch) || output.epoch < 1 || output.epoch > manifest.epochs) {
      problems.push(`output ${output.taskId}/${output.arm} has invalid epoch`);
    }
    const key = outputKey(output);
    if (seen.has(key)) problems.push(`duplicate output ${key}`);
    seen.add(key);
    for (const [field, value] of Object.entries({
      latencyMs: output.latencyMs,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      costUsdMicros: output.costUsdMicros,
      passedCriteria: output.passedCriteria,
      totalCriteria: output.totalCriteria,
    })) if (!isNonNegativeInteger(value)) problems.push(`output ${key}.${field} is invalid`);
    if (task && output.totalCriteria !== task.criterionCount) problems.push(`output ${key} changed the rubric denominator`);
    if (output.passedCriteria > output.totalCriteria) problems.push(`output ${key} passed more criteria than exist`);
    if (output.allPass !== (output.passedCriteria === output.totalCriteria)) problems.push(`output ${key}.allPass contradicts criterion counts`);
    if (!DIGEST.test(output.executionReceiptDigest)) problems.push(`output ${key} has invalid execution receipt digest`);
    if (output.adaptiveRouteReceiptDigest !== null && !DIGEST.test(output.adaptiveRouteReceiptDigest)) problems.push(`output ${key} has invalid adaptive route receipt digest`);
    if (output.status === "scored") {
      if (!DIGEST.test(output.responseDigest ?? "") || !DIGEST.test(output.judgeReceiptDigest ?? "") || output.failure !== null) {
        problems.push(`scored output ${key} is missing a response/judge digest or carries a failure`);
      }
    } else {
      const expectedStage = output.status.replace("_failure", "");
      if (output.failure) exactKeys(output.failure, ["stage", "code", "detailDigest"], `output ${key}.failure`, problems);
      if (output.passedCriteria !== 0 || output.allPass || output.failure?.stage !== expectedStage ||
          !NON_EMPTY.test(output.failure?.code ?? "") || !DIGEST.test(output.failure?.detailDigest ?? "")) {
        problems.push(`failed output ${key} is not a complete zero-scored failure record`);
      }
    }
    if (output.arm === "adaptive_router" && output.adaptiveRouteReceiptDigest === null) {
      problems.push(`adaptive output ${key} has no route receipt digest`);
    }
    if (output.arm !== "adaptive_router" && output.adaptiveRouteReceiptDigest !== null) {
      problems.push(`non-adaptive output ${key} carries adaptive route lineage`);
    }
  }

  for (const task of input.tasks) for (const arm of GDP_PDF_ARMS) for (let epoch = 1; epoch <= manifest.epochs; epoch += 1) {
    const key = `${task.taskId}\u0000${arm}\u0000${epoch}`;
    if (!seen.has(key)) problems.push(`missing output ${task.taskId}/${arm}/epoch-${epoch}`);
  }
  const expectedOutputs = manifest.expectedTaskCount * manifest.epochs * GDP_PDF_ARMS.length;
  if (input.outputs.length !== expectedOutputs) problems.push(`output count ${input.outputs.length} does not equal ${expectedOutputs}`);
  return problems;
}

function summarizeArm(tasks: readonly GdpPdfTask[], outputs: readonly GdpPdfTaskOutput[], arm: GdpPdfArm): GdpPdfArmSummary {
  const rows = outputs.filter((output) => output.arm === arm);
  // GDP.pdf's diagnostic is the macro mean of each attempt's criterion fraction. A pooled
  // passed/total micro-average would overweight tasks that happen to have longer rubrics.
  const criterionFractions = rows.map((row) => row.passedCriteria / row.totalCriteria);
  const sumAttemptFractions = criterionFractions.reduce((sum, value) => sum + value, 0);
  const allPass = rows.filter((row) => row.allPass).length;
  return {
    tasks: tasks.length,
    attempts: rows.length,
    allPass: { numerator: allPass, denominator: rows.length, value: allPass / rows.length },
    meanCriteria: {
      sumAttemptFractions,
      denominator: rows.length,
      value: sumAttemptFractions / rows.length,
    },
    failures: {
      subject: rows.filter((row) => row.failure?.stage === "subject").length,
      adapter: rows.filter((row) => row.failure?.stage === "adapter").length,
      judge: rows.filter((row) => row.failure?.stage === "judge").length,
    },
    latencyMs: { p50: percentile(rows.map((row) => row.latencyMs), 0.5), p95: percentile(rows.map((row) => row.latencyMs), 0.95) },
    tokens: {
      input: rows.reduce((sum, row) => sum + row.inputTokens, 0),
      output: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    },
    costUsdMicros: rows.reduce((sum, row) => sum + row.costUsdMicros, 0),
  };
}

function pairOutputs(
  outputs: readonly GdpPdfTaskOutput[],
  challenger: GdpPdfArm,
  control: GdpPdfArm,
): GdpPdfPairedComparison {
  const byKey = new Map(outputs.map((output) => [`${output.taskId}\u0000${output.arm}\u0000${output.epoch}`, output]));
  const cells = outputs
    .filter((output) => output.arm === challenger)
    .map((challengerRow): GdpPdfPairedCell => {
      const controlRow = byKey.get(`${challengerRow.taskId}\u0000${control}\u0000${challengerRow.epoch}`);
      if (!controlRow) throw new Error(`missing paired control for ${challengerRow.taskId}/${challengerRow.epoch}`);
      return {
        taskId: challengerRow.taskId,
        epoch: challengerRow.epoch,
        allPassDelta: (Number(challengerRow.allPass) - Number(controlRow.allPass)) as -1 | 0 | 1,
        criterionFractionDelta:
          challengerRow.passedCriteria / challengerRow.totalCriteria - controlRow.passedCriteria / controlRow.totalCriteria,
        latencyMsDelta: challengerRow.latencyMs - controlRow.latencyMs,
        inputTokensDelta: challengerRow.inputTokens - controlRow.inputTokens,
        outputTokensDelta: challengerRow.outputTokens - controlRow.outputTokens,
        costUsdMicrosDelta: challengerRow.costUsdMicros - controlRow.costUsdMicros,
      };
    })
    .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.epoch - right.epoch);
  const attempts = cells.length;
  const mean = (selector: (cell: GdpPdfPairedCell) => number) => cells.reduce((sum, cell) => sum + selector(cell), 0) / attempts;
  return {
    challenger,
    control,
    cells,
    cellsDigest: digest(cells, "tavonel.gdp_pdf.paired_cells.v1"),
    summary: {
      attempts,
      allPassWins: cells.filter((cell) => cell.allPassDelta > 0).length,
      allPassTies: cells.filter((cell) => cell.allPassDelta === 0).length,
      allPassLosses: cells.filter((cell) => cell.allPassDelta < 0).length,
      meanAllPassDelta: mean((cell) => cell.allPassDelta),
      meanCriterionFractionDelta: mean((cell) => cell.criterionFractionDelta),
      meanLatencyMsDelta: mean((cell) => cell.latencyMsDelta),
      meanCostUsdMicrosDelta: mean((cell) => cell.costUsdMicrosDelta),
    },
  };
}

export function buildGdpPdfPairedComparisons(input: GdpPdfRunInput): GdpPdfRunReceiptBody["pairedComparisons"] {
  const problems = validateGdpPdfRunInput(input);
  if (problems.length > 0) throw new Error(`GDP.pdf run refused: ${problems.join("; ")}`);
  return {
    adaptiveVsFixedControl: pairOutputs(input.outputs, "adaptive_router", "fixed_control_retrieval_rerank"),
    compiledVsNative: pairOutputs(input.outputs, "compiled_context_pdf", "native_pdf"),
  };
}

export function buildGdpPdfRunReceipt(input: GdpPdfRunInput): GdpPdfRunReceipt {
  const problems = validateGdpPdfRunInput(input);
  if (problems.length > 0) throw new Error(`GDP.pdf run refused: ${problems.join("; ")}`);
  const arms = Object.fromEntries(GDP_PDF_ARMS.map((arm) => [arm, summarizeArm(input.tasks, input.outputs, arm)])) as Record<GdpPdfArm, GdpPdfArmSummary>;
  const pairedComparisons = buildGdpPdfPairedComparisons(input);
  const evaluatorDigest = digest({
    harnessRepository: input.manifest.upstreamHarnessRepository,
    harnessRevision: input.manifest.upstreamHarnessRevision,
    harnessTreeDigest: input.manifest.upstreamHarnessTreeDigest,
    judge: input.manifest.judge,
    armPins: input.manifest.arms,
  }, "tavonel.gdp_pdf.evaluator.v1");
  const body: GdpPdfRunReceiptBody = {
    schemaVersion: GDP_PDF_RECEIPT_SCHEMA,
    runId: input.manifest.runId,
    protocolDigest: input.manifest.protocolDigest,
    datasetRevision: input.manifest.datasetRevision,
    datasetManifestDigest: input.manifest.datasetManifestDigest,
    corpusDigest: input.manifest.corpusDigest,
    upstreamHarnessRevision: input.manifest.upstreamHarnessRevision,
    upstreamHarnessTreeDigest: input.manifest.upstreamHarnessTreeDigest,
    taskSetDigest: input.manifest.taskSetDigest,
    evaluatorDigest,
    outputsDigest: digest(orderedOutputs(input.outputs), "tavonel.gdp_pdf.outputs.v1"),
    thresholdsDigest: input.manifest.thresholdsDigest,
    measuredAt: input.manifest.completedAt,
    denominator: {
      tasks: input.manifest.expectedTaskCount,
      epochs: input.manifest.epochs,
      attemptsPerArm: input.manifest.expectedTaskCount * input.manifest.epochs,
      totalAttempts: input.outputs.length,
    },
    arms,
    pairedComparisons,
    infrastructureValid: GDP_PDF_ARMS.every((arm) => arms[arm].failures.adapter === 0 && arms[arm].failures.judge === 0),
  };
  return { ...body, receiptDigest: digest(body, GDP_PDF_RECEIPT_SCHEMA) };
}

export function validateGdpPdfRunReceipt(input: GdpPdfRunInput, receipt: unknown): string[] {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return ["receipt is not an object"];
  let expected: GdpPdfRunReceipt;
  try {
    expected = buildGdpPdfRunReceipt(input);
  } catch (error) {
    return [error instanceof Error ? error.message : "GDP.pdf run input is invalid"];
  }
  const candidate = receipt as Record<string, unknown>;
  const problems: string[] = [];
  exactKeys(candidate, [...Object.keys(expected)], "receipt", problems);
  if (!DIGEST.test(String(candidate.receiptDigest ?? ""))) problems.push("receipt.receiptDigest is invalid");
  if (canonicalize(candidate) !== canonicalize(expected)) problems.push("receipt does not match the canonical run evidence");
  return problems;
}

/**
 * Produces a body ready for the control-plane promotion boundary. It deliberately does not invent
 * `evidenceDigest`: PostgreSQL must derive that field with adaptive_router_canonical_digest_v1
 * immediately before the service-role insert, using jsonb's canonical representation.
 */
export function buildGdpPdfBenchmarkEvidenceDraft(
  receipt: GdpPdfRunReceipt,
  thresholdResults: Readonly<Record<string, Readonly<{ passed: boolean; value: number; threshold: number }>>>,
): GdpPdfBenchmarkEvidenceDraft {
  if (!UUID.test(receipt.runId)) throw new Error("adaptive evidence receiptId must be a UUID");
  if (!receipt.infrastructureValid) throw new Error("GDP.pdf run has adapter or judge failures");
  const entries = Object.entries(thresholdResults);
  if (entries.length === 0 || entries.some(([name, result]) => !NON_EMPTY.test(name) || result.passed !== true ||
      !Number.isFinite(result.value) || !Number.isFinite(result.threshold))) {
    throw new Error("all sealed router thresholds must be present, finite, and passing");
  }
  return {
    bodyWithoutEvidenceDigest: {
      schemaVersion: GDP_PDF_ADAPTIVE_EVIDENCE_SCHEMA,
      receiptId: receipt.runId,
      corpusDigest: receipt.corpusDigest,
      evaluatorDigest: receipt.evaluatorDigest,
      benchmarkRunReceiptDigest: receipt.receiptDigest,
      thresholdResults: Object.fromEntries(entries) as Record<string, { passed: true; value: number; threshold: number }>,
    },
    measuredAt: receipt.measuredAt,
    corpusDigest: receipt.corpusDigest,
    evaluatorDigest: receipt.evaluatorDigest,
  };
}

export function gdpPdfTaskSetDigest(tasks: readonly GdpPdfTask[]): string {
  return digest(orderedTasks(tasks), "tavonel.gdp_pdf.task_set.v1");
}

export function gdpPdfProtocolDigest(protocol: unknown): string {
  return digest(protocol, "tavonel.gdp_pdf.protocol.v1");
}
