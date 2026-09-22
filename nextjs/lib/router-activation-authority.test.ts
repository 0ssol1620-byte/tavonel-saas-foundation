import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One authority for "is the candidate executing?", and it is the database.
 *
 * `adaptive_router_rollout_heads.state` plus the policy revision's `candidateBasisPoints` decide
 * the variant inside `resolve_adaptive_router_policy_v1`; the request path only carries that
 * decision (`adaptive-router-control-plane-store.ts` turns a `candidate` assignment into
 * `canaryPermille: 10_000` and a `control` assignment into `0`). A second switch in TypeScript
 * that could disagree with the head row would mean two answers to the same question, and the
 * quiet failure mode -- code says off, database says active -- is the one nobody notices.
 *
 * `evaluateAdaptiveRouterActivation` therefore stays an operator-side preflight: it checks that
 * a five-stage evidence contract is complete, sealed and chronologically possible BEFORE a human
 * calls `transition_adaptive_router_rollout_v1` for canary or active. It is not, and must not
 * become, a runtime gate. This test is what keeps that true.
 */
const ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_DIRECTORIES = ["app", "lib", "components"];

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
      continue;
    }
    if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) yield path;
  }
}

describe("adaptive router activation authority", () => {
  it("keeps the TypeScript activation gate out of the request path", () => {
    const importers = RUNTIME_DIRECTORIES
      .flatMap((directory) => [...sourceFiles(resolve(ROOT, directory))])
      .filter((path) => !path.endsWith("router-activation-gate.ts"))
      .filter((path) => /from ["'][^"']*router-activation-gate["']/.test(readFileSync(path, "utf8")));
    expect(importers).toEqual([]);
  });

  it("keeps the rollout state the only thing that turns candidate execution on", () => {
    const store = readFileSync(resolve(ROOT, "lib/adaptive-router-control-plane-store.ts"), "utf8");
    // The candidate share comes from the assignment the database issued, never from a local flag.
    expect(store).toContain('assignment.variant === "candidate" ? 10_000 : 0');
    expect(store).not.toMatch(/evaluateAdaptiveRouterActivation/);
  });
});
