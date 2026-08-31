import type { DocumentListItem } from "./immutable-keys";
import type { PipelineRow } from "./pipeline";

export type OperationsGate = { label: string; qualified: boolean; detail: string };

export type OperationsSnapshot = {
  sourceCount: number;
  readyCount: number;
  runningCount: number;
  heldCount: number;
  failedCount: number;
  compileEligible: boolean;
  blockers: string[];
  nextAction: string;
};

export function buildOperationsSnapshot(
  rows: PipelineRow[],
  documents: DocumentListItem[] | null,
  gates: OperationsGate[],
): OperationsSnapshot {
  const readyCount = rows.filter((row) => row.stages[2]?.state === "done").length;
  const runningCount = rows.filter((row) => row.stages.some((stage) => stage.state === "active")).length;
  const heldCount = rows.filter((row) => row.needsPerson).length;
  const failedCount = rows.filter((row) => row.stages.some((stage) => stage.state === "failed")).length;
  const blockers: string[] = [];

  if ((documents?.length ?? 0) < 2) blockers.push("At least two immutable sources are required for a collection compile.");
  if (heldCount > 0) blockers.push(`${heldCount} source${heldCount === 1 ? " requires" : "s require"} operator review.`);
  if (failedCount > 0) blockers.push(`${failedCount} source transfer${failedCount === 1 ? "" : "s"} failed in this browser.`);
  for (const gate of gates.filter((item) => !item.qualified)) blockers.push(`${gate.label}: ${gate.detail}`);

  const compileEligible = readyCount >= 2 && heldCount === 0 && failedCount === 0;
  return {
    sourceCount: rows.length,
    readyCount,
    runningCount,
    heldCount,
    failedCount,
    compileEligible,
    blockers,
    nextAction: heldCount > 0
      ? "Resolve held sources"
      : runningCount > 0
        ? "Inspect observed stages"
        : compileEligible
          ? "Compile qualified sources"
          : "Add qualified sources",
  };
}
