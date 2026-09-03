import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the product surface against diagnostic routes and inline credential-like values.
//
// This exists because one did ship: /api/internal/retrieval-gpu-smoke-check was added to
// prove the Wave 2 RunPod TEI endpoints worked from the deployed environment, gated by a
// hex token written directly into the source. It did its job, but it was a live route on a
// production deployment that spent GPU budget on request, and its token reached the public
// git history the moment it was committed -- which is why that token is treated as burned
// and the route is gone.
//
// The lesson generalises: a temporary route with a "DELETE THIS" comment is only deleted if
// something fails when it is not. This test is that something.

const appDirectory = resolve(import.meta.dirname, "../app");

function walkRouteFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walkRouteFiles(path));
    } else if (entry === "route.ts" || entry === "route.tsx") {
      found.push(path);
    }
  }
  return found;
}

const routeFiles = walkRouteFiles(appDirectory);

/*
  Read every route handler once, at module load, rather than inside each test.

  Both checks below scan the whole route surface -- around ninety files. Doing that with
  readFileSync inside an `it` puts the entire scan inside vitest's 5s per-test budget, and on
  a machine where every open is intercepted by an on-access scanner that budget is not
  generous. The credential check began failing intermittently with "Test timed out in 5000ms",
  which in a security test reads exactly like a credential was found. Module-level work is not
  subject to the per-test timeout, so the scan happens once and each test does only its regex.

  Nothing about what is asserted changes: the same files are read, the same patterns run.
*/
const routeSources: ReadonlyArray<readonly [string, string]> = routeFiles.map((path) => [
  relative(appDirectory, path).split(sep).join("/"),
  readFileSync(path, "utf8"),
] as const);

describe("production route surface", () => {
  it("has no retrieval GPU smoke-check route", () => {
    // The specific route that shipped. Named explicitly so a revert cannot quietly restore it.
    expect(existsSync(join(appDirectory, "api/internal/retrieval-gpu-smoke-check"))).toBe(false);
  });

  it("has no route whose own name marks it as temporary or diagnostic", () => {
    const suspicious = routeFiles
      .map((path) => relative(appDirectory, path).replace(/\\/g, "/"))
      .filter((path) => /(smoke|debug|scratch|temp|tmp|playground|sandbox-test)/i.test(path));
    expect(suspicious).toEqual([]);
  });

  it("carries no inline credential-like literal in any route handler", () => {
    // A long unbroken hex/base64-ish literal assigned to a token/secret/key-shaped name is
    // the shape the removed route used. Env reads (process.env.X) are unaffected.
    const offenders: string[] = [];
    for (const [name, source] of routeSources) {
      const matches = source.match(
        /(?:const|let|var)\s+\w*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)\w*\s*=\s*["'`][A-Za-z0-9+/=_-]{24,}["'`]/gi,
      );
      if (matches) offenders.push(`${name}: ${matches.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it("never marks a route as deliberately temporary in a comment without removing it", () => {
    // "DELETE THIS ROUTE once ..." is exactly what the removed file said, and it stayed.
    const offenders = routeSources
      .filter(([, source]) => /DELETE THIS ROUTE|TEMPORARY .*(route|endpoint)|REMOVE BEFORE (PROD|LAUNCH)/i.test(source))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });
});
