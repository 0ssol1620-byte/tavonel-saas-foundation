import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";
import { activationPolicy } from "./activation-policy";
import { BILLING_OFFERS } from "./billing-catalog";
import { qualifiedBenchmarkRecords } from "./benchmark-registry";
import registry from "./benchmark-registry.records.json";

/*
  The production posture, pinned to main at 4c80bb30 (UX program 2026-10-17, lane P2-01;
  PHASE1-CRITIC-2026-10-17.md §5.1 and §5.4).

  The UX program changes a great deal of what the site looks like and nothing about what it
  lets a visitor do. "Nothing" is only checkable if the switches are written down in one place,
  so this file holds main's value for each of them: which capabilities the deployment has
  enabled, the three launch flags `vercel.json` ships, which plan sells itself, what the
  capability manifest claims per format, that the Vercel collector loads only behind its flag,
  and that no benchmark row is published. Today that is state S1: account creation open,
  purchase and customer-file processing closed.

  Every expectation is a literal on purpose. A failure here means a posture switch moved. That
  is a founder decision (CLAUDE.md, "What is not an agent's call"), and the pull request that
  carries it updates the literal in the same commit and names the decision -- P2-37 is the one
  planned case, and it should report `customerData.enabled` and nothing else. Updating a value
  here to get a design lane green is the failure this file exists to catch.
*/

describe("production posture @ 4c80bb30", () => {
  it("keeps every activation switch at main's value", () => {
    const enabled = Object.fromEntries(
      Object.entries(activationPolicy).map(([capability, { enabled }]) => [capability, enabled]),
    );
    expect(enabled).toEqual({
      customerIntake: true,
      cdr: true,
      ocrGpu: true,
      candidatePromotion: false,
      customerData: false,
    });
  });

  it("ships exactly main's three launch flags in vercel.json", () => {
    const vercel = JSON.parse(readFileSync(resolve(import.meta.dirname, "../vercel.json"), "utf8")) as {
      env?: Record<string, string>;
    };
    expect(vercel.env).toEqual({
      COMMERCIAL_MODE: "live",
      TAVONEL_BILLING_LAUNCH_APPROVED: "true",
      ACCESS_MODE: "self_service",
    });
  });

  it("keeps each plan's sale channel", () => {
    const channels = Object.fromEntries(
      Object.entries(BILLING_OFFERS).map(([code, offer]) => [code, offer.saleChannel]),
    );
    expect(channels).toEqual({ observer_access: "self_serve", studio_access: "contact" });
  });

  it("keeps every shipped manifest row's status and known limitations", () => {
    // `LIVE_LIMITS` in shared/capabilityManifest.ts, spelled out. The last two are the processing
    // ceiling (shared/intakeCeiling.ts), so moving the ceiling is a posture change too.
    const live = [
      "no_native_structure_reader_yet",
      "no_table_or_formula_extraction",
      "no_visual_native_reconciliation",
      "at_most_5_mib_per_source",
      "at_most_80_pages_per_source",
    ];
    const converted = { status: "BEST_EFFORT", knownLimitations: ["converted_to_pdf_before_reading", ...live] };
    const spreadsheet = {
      status: "BEST_EFFORT",
      knownLimitations: ["converted_to_pdf_before_reading", ...live, "page_count_not_defined_for_spreadsheets"],
    };

    const rows = Object.fromEntries(
      CAPABILITY_MANIFEST.entries.map(({ mime, status, knownLimitations }) => [mime, { status, knownLimitations }]),
    );
    expect(rows).toEqual({
      "application/pdf": { status: "BEST_EFFORT", knownLimitations: ["read_through_cdr_sanitized_pdf_and_ocr", ...live] },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": converted,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": spreadsheet,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": converted,
      "application/vnd.oasis.opendocument.text": converted,
      "application/vnd.oasis.opendocument.spreadsheet": spreadsheet,
      "application/vnd.oasis.opendocument.presentation": converted,
      "image/jpeg": converted,
      "image/png": converted,
      "image/tiff": converted,
      "image/gif": converted,
      "application/zip": {
        status: "UNSUPPORTED",
        knownLimitations: [
          "expanded_in_the_browser_before_upload",
          "members_validated_individually_against_this_manifest",
          "encrypted_or_nested_archives_refused_at_expansion",
          "at_most_128_files_and_500_mb_expanded",
          "the_archive_itself_is_never_compiled",
          "not_included_in_free_evaluation",
        ],
      },
    });
  });

  it("publishes no benchmark records", () => {
    expect(registry.records).toEqual([]);
    expect(qualifiedBenchmarkRecords()).toEqual([]);
  });

  it("renders the Vercel collector only behind NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === \"1\"", () => {
    const sources = runtimeSources();
    const renders = sources.flatMap(({ text }) => [...text.matchAll(/<Analytics\b/g)]);
    // Non-vacuous: the collector exists today (app/layout.tsx). P2-07 may move it, not remove it.
    expect(renders.length).toBeGreaterThan(0);
    expect(sources.flatMap(({ file, text }) => analyticsViolations(file, text))).toEqual([]);
  });
});

/*
  The collector rule is checked on its condition, not on its file, so moving `<Analytics />` into
  `components/marketing-consent.tsx` (P2-07) keeps passing as long as the flag still guards it.

  Accepted: a JSX expression whose guard contains the literal flag comparison and ends in `?` or
  `&&`, e.g. `{process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" && consent ? <Analytics /> : null}`.
  Refused: no flag, a guard with `||` or `??` (either can open it without the flag), and any import
  of the SDK other than `{ Analytics }` from `/next`, `{ track }` from the root, or a type-only
  import -- an alias, a namespace, `inject` or a dynamic import would render the collector out of
  reach of the `<Analytics` scan.
  ponytail: lexical scan, not a parser. A guard hoisted into a const or an early return is refused
  rather than understood; extend the accepted forms here if a lane needs one.
*/
const FLAG = /process\.env\.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED\s*===\s*"1"/;
const SDK_SPECIFIER = /["']@vercel\/analytics(\/[\w-]+)?["']/g;
const SDK_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']@vercel\/analytics(\/[\w-]+)?["']/g;
const ALLOWED_VALUE_IMPORTS: Record<string, readonly string[]> = { "": ["track"], "/next": ["Analytics"] };

function analyticsViolations(file: string, text: string): string[] {
  const problems: string[] = [];

  const imports = [...text.matchAll(SDK_IMPORT)];
  if ([...text.matchAll(SDK_SPECIFIER)].length !== imports.length) {
    problems.push(`${file}: reaches @vercel/analytics other than through a named import`);
  }
  for (const [, typeOnly, names, subpath = ""] of imports) {
    if (typeOnly) continue;
    for (const name of names.split(",").map((part) => part.trim()).filter(Boolean)) {
      if (name.startsWith("type ")) continue;
      if (!(ALLOWED_VALUE_IMPORTS[subpath] ?? []).includes(name)) {
        problems.push(`${file}: imports \`${name}\` from @vercel/analytics${subpath}`);
      }
    }
  }

  for (const render of text.matchAll(/<Analytics\b/g)) {
    const guard = enclosingGuard(text, render.index);
    const line = text.slice(0, render.index).split("\n").length;
    const ok = guard !== null
      && FLAG.test(guard)
      && !/\|\||\?\?/.test(guard)
      && /(\?|&&)[\s(]*$/.test(guard);
    if (!ok) problems.push(`${file}:${line}: <Analytics> is not guarded by the analytics flag`);
  }
  return problems;
}

/** The text between the unmatched `{` that opens the JSX expression and the render, or null. */
function enclosingGuard(text: string, at: number): string | null {
  let depth = 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    if (text[index] === "}") depth += 1;
    else if (text[index] === "{") {
      if (depth === 0) return text.slice(index + 1, at);
      depth -= 1;
    }
  }
  return null;
}

/** Everything that can end up in the deployed bundle, minus tests (which quote the forms above). */
function runtimeSources(): Array<{ file: string; text: string }> {
  const nextjs = resolve(import.meta.dirname, "..");
  const roots = ["app", "components", "lib", "core-runtime", "../shared"].map((dir) => join(nextjs, dir));
  const files = [join(nextjs, "middleware.ts")];
  for (const root of roots) {
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (/\.(m?[jt]sx?)$/.test(entry) && !/\.(test|spec)\./.test(entry)) files.push(join(root, entry));
    }
  }
  return files.map((path) => ({ file: relative(nextjs, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));
}

describe("production posture: the collector scan refuses what it should", () => {
  const guarded = 'import { Analytics } from "@vercel/analytics/next";\n';

  it("accepts main's form and the P2-07 consent form", () => {
    expect(analyticsViolations("a.tsx", `${guarded}{process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" ? <Analytics /> : null}`)).toEqual([]);
    expect(analyticsViolations("b.tsx", `${guarded}{process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" && ready && consent === true && location\n  ? <Analytics beforeSend={vercelBeforeSend} /> : null}`)).toEqual([]);
    expect(analyticsViolations("c.ts", 'import { track } from "@vercel/analytics";\nimport type { BeforeSendEvent } from "@vercel/analytics";')).toEqual([]);
  });

  it("refuses an unguarded render", () => {
    expect(analyticsViolations("x.tsx", `${guarded}<body><Analytics /></body>`)).toEqual(["x.tsx:2: <Analytics> is not guarded by the analytics flag"]);
    expect(analyticsViolations("x.tsx", `${guarded}{consent ? <Analytics /> : null}`)).toHaveLength(1);
  });

  it("refuses a guard the flag does not bind", () => {
    for (const guard of [
      'process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" || consent ?',
      'process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" ?? true ?',
      'process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED !== "1" ?',
      'process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" ? null :',
    ]) expect(analyticsViolations("x.tsx", `${guarded}{${guard} <Analytics />}`), guard).toHaveLength(1);
  });

  it("refuses an SDK import that would bypass the render scan", () => {
    for (const source of [
      'import { Analytics as Collector } from "@vercel/analytics/next";',
      'import { inject } from "@vercel/analytics";',
      'import * as va from "@vercel/analytics";',
      'import { Analytics } from "@vercel/analytics/react";',
      'const va = await import("@vercel/analytics");',
    ]) expect(analyticsViolations("x.tsx", source), source).not.toEqual([]);
  });
});
