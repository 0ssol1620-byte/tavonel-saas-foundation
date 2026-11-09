import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { koTermDrift } from "./ko-terms";
import { SCHEMA_REVIEW_COPY, schemaReviewCopy, schemaReviewError } from "./schema-review-copy";

vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowserClient: () => null }));

import WorkspaceUltimateShell from "@/components/workspace-ultimate-shell";
import SchemaReview, { OntologyInductionAvailability } from "@/components/workspace/schema-review";

/* Every string of a copy table, functions called with a sample argument (and each deriver, for proposedBy). */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const call = value as (argument: never, deriver: never) => unknown;
    return [String(call(3 as never, "baseline" as never)), String(call(3 as never, "model" as never))];
  }
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
const keys = (value: unknown): string[] => value && typeof value === "object" && typeof value !== "function"
  ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner).map((child) => `${key}.${child}`)]).sort()
  : [];

describe("Schema screen copy (EN/KO)", () => {
  it("has the same keys in both languages and follows the browser's first language", () => {
    expect(keys(SCHEMA_REVIEW_COPY.ko)).toEqual(keys(SCHEMA_REVIEW_COPY.en));
    expect(schemaReviewCopy(["ko-KR", "en"])).toBe(SCHEMA_REVIEW_COPY.ko);
    expect(schemaReviewCopy(["en-US", "ko"])).toBe(SCHEMA_REVIEW_COPY.en);
    expect(schemaReviewCopy([])).toBe(SCHEMA_REVIEW_COPY.en);
  });

  it("Korean uses the term table's spellings", () => {
    for (const line of strings(SCHEMA_REVIEW_COPY.ko)) expect(koTermDrift(line), line).toEqual([]);
  });

  it("never claims automatic construction, unattended certification or downstream use", () => {
    for (const line of [...strings(SCHEMA_REVIEW_COPY.en), ...strings(SCHEMA_REVIEW_COPY.ko)]) {
      expect(line).not.toMatch(/automatic|auto-|AI-generated|hallucination|자동|now used to extract|extraction uses/i);
    }
    expect(SCHEMA_REVIEW_COPY.en.storedOnly).toMatch(/not used to extract anything yet/);
    expect(SCHEMA_REVIEW_COPY.ko.storedOnly).toMatch(/아직 어떤 추출에도 사용되지 않습니다/);
  });

  it("says no language model was used only for a baseline run", () => {
    for (const copy of [SCHEMA_REVIEW_COPY.en, SCHEMA_REVIEW_COPY.ko]) {
      expect(copy.proposedBy("t", "baseline")).toMatch(/does not use a language model|언어 모델을 사용하지 않습니다/);
      expect(copy.proposedBy("t", "model")).not.toMatch(/does not use|사용하지 않습니다|deterministic|결정적/);
    }
  });

  it("maps a refusal code to its sentence and anything else to the nothing-recorded sentence", () => {
    expect(schemaReviewError(SCHEMA_REVIEW_COPY.en, "ONTOLOGY_ROLE_REQUIRED")).toMatch(/owner or admin/);
    expect(schemaReviewError(SCHEMA_REVIEW_COPY.en, "SOMETHING_NEW")).toBe(SCHEMA_REVIEW_COPY.en.errors.default);
    expect(schemaReviewError(SCHEMA_REVIEW_COPY.ko, undefined)).toBe(SCHEMA_REVIEW_COPY.ko.errors.default);
  });
});

describe("flag off = no UI entry", () => {
  // The shell's props, children included (null), named once so createElement gets them whole.
  const shellProps: Parameters<typeof WorkspaceUltimateShell>[0] = {
    surface: "home", headerAction: null, activeRevision: null, candidateReady: false, reviewCount: null, activityCount: 0,
    stateTitle: "t", stateDescription: "d", nextAction: { label: "n" }, onNavigate: () => {}, onUpload: () => {},
    onRefresh: () => {}, onSignOut: () => {}, children: null,
  };
  const shell = (enabled: boolean) => renderToStaticMarkup(createElement(OntologyInductionAvailability, { enabled },
    createElement(WorkspaceUltimateShell, shellProps)));

  it("the shell lists Schema only where the build has the flag", () => {
    expect(shell(false)).not.toMatch(/>Schema</);
    expect(shell(true)).toMatch(/>Schema</);
  });

  it("the workspace page reaches /workspace/schema and the Schema body only through the flag", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/workspace/page.tsx"), "utf8");
    expect(page).toContain('(schemaEnabled || segment !== "schema")');
    expect(page).toContain('{surface === "schema" && schemaEnabled ? (');
    const layout = readFileSync(resolve(import.meta.dirname, "../app/workspace/layout.tsx"), "utf8");
    expect(layout).toContain("<OntologyInductionAvailability enabled={ontologyInductionEnabled()}>");
  });

  it("without a compiled World the screen says so and offers no action", () => {
    const html = renderToStaticMarkup(createElement(SchemaReview, { collection: null }));
    expect(html).toContain(SCHEMA_REVIEW_COPY.en.noWorld);
    expect(html).not.toContain("<button");
  });
});
