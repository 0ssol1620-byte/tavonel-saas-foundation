import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { calculatePilotUnitEconomics } from "../lib/pilot-unit-economics";

const defaultInput = resolve(process.cwd(), "../docs/finance/B38_PILOT_UNIT_ECONOMICS_INPUTS.json");
const inputPath = resolve(process.argv[2] ?? defaultInput);

try {
  const input = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  const result = calculatePilotUnitEconomics(input);
  process.stdout.write(`${JSON.stringify({ inputPath, ...result }, null, 2)}\n`);
  if (result.status === "blocked") process.exitCode = 2;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    inputPath,
    status: "blocked",
    decisionUse: "not_decision_ready",
    blockers: [error instanceof Error ? error.message : "Unable to read input"],
  }, null, 2)}\n`);
  process.exitCode = 2;
}
