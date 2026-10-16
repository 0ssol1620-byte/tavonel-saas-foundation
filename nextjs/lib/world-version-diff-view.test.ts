import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WorldVersionDiffPanel, { ArtifactDiffSections, VersionComparisonEffects } from "@/components/world-version-diff";
import type { ReviewImpactContract, WorldObject, WorldReadModel } from "./world-read-model";
import { countChanges, diffWorldVersions, type WorldVersionDiff } from "./world-version-diff";
import { DEFAULT_DIFF_FILTERS, DIFF_PAGE_SIZE, deriveWorldVersionDiffView, paginateWorldVersionDiffView, type DiffFilters } from "./world-version-diff-view";

type Effect = () => void | (() => void);
type HookSlot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type ElementProps = Record<string, unknown> & { children?: unknown; onClick: () => unknown;
  onChange: (event: { target: { value: string } }) => unknown };
type TestElement = { type: string | symbol | ((props: ElementProps) => unknown); props: ElementProps };
const pageRuntime = vi.hoisted(() => ({ active: null as PageHooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react,
    useState: <T,>(initial: T | (() => T)) => pageRuntime.active ? pageRuntime.active.state(initial) : react.useState(initial),
    useMemo: <T,>(factory: () => T, deps: readonly unknown[]) => pageRuntime.active ? pageRuntime.active.memo(factory, deps) : react.useMemo(factory, deps),
    useEffect: (effect: Effect, deps: readonly unknown[]) => pageRuntime.active ? pageRuntime.active.effect(effect, deps) : react.useEffect(effect, deps),
    useId: () => pageRuntime.active ? pageRuntime.active.id() : react.useId(),
  };
});
vi.mock("./supabase-browser", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-token" } } }) } }) }));

// Explicit synthetic records for display contracts only; no customer qualification or product fixture.
const syntheticDiff: WorldVersionDiff = {
  left: { manifestDigest: `sha256:${"a".repeat(64)}`, status: "candidate" },
  right: { manifestDigest: `sha256:${"b".repeat(64)}`, status: "candidate" },
  identical: false,
  objects: {
    added: [{ id: "shared-id", type: "Entity", label: "Added entity", changes: [] }],
    removed: [{ id: "object-old", type: "Claim", label: "Old claim", changes: [] }],
    changed: [{ id: "object-edit", type: "Entity", label: "Corrected entity", changes: [{ field: "label", before: "needle object", after: "Corrected entity" }] }],
  },
  relations: {
    added: [{ id: "shared-id", subject: "subject", predicate: "owns", object: "target", changes: [] }],
    removed: [{ id: "relation-old", subject: "subject", predicate: "owns", object: "old-target", changes: [] }],
    changed: [{ id: "relation-edit", subject: "subject", predicate: "owns", object: "target", changes: [{ field: "evidenceRefs", before: '["needle evidence-old"]', after: '["evidence-new"]' }] }],
  },
  evidence: {
    added: [{ id: "shared-id", sourceId: "source-new", page: 7, changes: [] }],
    removed: [{ id: "evidence-old", sourceId: "source-old", page: 1, changes: [] }],
    changed: [{ id: "evidence-edit", sourceId: "source-edited", page: 3, changes: [{ field: "excerpt", before: "needle quote", after: "Corrected quote" }] }],
  },
  files: { added: ["new/needle.json"], removed: ["old/model.json"], changed: ["graph/edges.csv"] },
  sourceRevisions: { added: ["revision-needle-new"], removed: ["revision-old"], unchanged: 9 },
};

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach((child: unknown) => freeze(child));
    Object.freeze(value);
  }
  return value;
}
freeze(syntheticDiff);

function renderedRows(markup: string) {
  const rows: string[] = [];
  for (const section of markup.matchAll(/<section data-diff-category="([^"]+)">([\s\S]*?)<\/section>/g)) {
    for (const row of section[2].matchAll(/<li\b[^>]*data-diff-row="true"[^>]*>/g)) {
      const id = row[0].match(/data-record-id="([^"]+)"/)?.[1];
      const kind = row[0].match(/data-kind="([^"]+)"/)?.[1];
      rows.push(`${section[1]}:${kind}:${id}`);
    }
  }
  return rows;
}

const allRows = [
  "objects:added:shared-id", "objects:removed:object-old", "objects:changed:object-edit",
  "relations:added:shared-id", "relations:removed:relation-old", "relations:changed:relation-edit",
  "evidence:added:shared-id", "evidence:removed:evidence-old", "evidence:changed:evidence-edit",
  "files:added:new/needle.json", "files:removed:old/model.json", "files:changed:graph/edges.csv",
  "sourceRevisions:added:revision-needle-new", "sourceRevisions:removed:revision-old",
];

describe("artifact diff filters count exactly the rendered selection", () => {
  const cases: Array<[string, Partial<DiffFilters>, string[]]> = [
    ["unfiltered", {}, allRows],
    ["objects", { category: "objects" }, allRows.slice(0, 3)],
    ["relations", { category: "relations" }, allRows.slice(3, 6)],
    ["evidence", { category: "evidence" }, allRows.slice(6, 9)],
    ["package files", { category: "files" }, allRows.slice(9, 12)],
    ["source revisions", { category: "sourceRevisions" }, allRows.slice(12)],
    ["added", { kind: "added" }, [allRows[0], allRows[3], allRows[6], allRows[9], allRows[12]]],
    ["removed", { kind: "removed" }, [allRows[1], allRows[4], allRows[7], allRows[10], allRows[13]]],
    ["changed", { kind: "changed" }, [allRows[2], allRows[5], allRows[8], allRows[11]]],
    ["text across recorded fields and paths", { text: "  NeEdLe  " }, [allRows[2], allRows[5], allRows[8], allRows[9], allRows[12]]],
    ["shared IDs remain separate categories", { text: "shared-id" }, [allRows[0], allRows[3], allRows[6]]],
    ["visible source/page label", { text: "source-new p.7" }, [allRows[6]]],
    ["category, kind and text intersect", { category: "relations", kind: "changed", text: "needle" }, [allRows[5]]],
    ["source revisions never become changed rows", { category: "sourceRevisions", kind: "changed" }, []],
    ["no matches", { text: "no-such-record" }, []],
    ["blank text behaves as unfiltered", { text: "  " }, allRows],
  ];
  it.each(cases)("%s", (_name, filters, expected) => {
    const view = deriveWorldVersionDiffView(syntheticDiff, { ...DEFAULT_DIFF_FILTERS, ...filters });
    for (const changedOnly of [true, false]) {
      const markup = renderToStaticMarkup(createElement(ArtifactDiffSections, { view, changedOnly, unchangedRevisions: 9 }));
      expect(renderedRows(markup)).toEqual(expected);
      expect(view.visible.total).toBe(expected.length);
      expect(view.original.total).toBe(14);
      expect(view.original.total).toBe(countChanges(syntheticDiff));
      expect(markup).toContain(`Showing ${expected.length} of 14 artifact changes`);
      for (const category of ["objects", "relations", "evidence", "files", "sourceRevisions"] as const) {
        const selected = expected.filter((row) => row.startsWith(`${category}:`)).length;
        expect(view.visible.categories[category]).toBe(selected);
        const section = markup.match(new RegExp(`<section data-diff-category="${category}">([\\s\\S]*?)<\\/section>`));
        if (!changedOnly || selected > 0) expect(section?.[1]).toContain(`${selected} of ${view.original.categories[category]}`);
        else expect(section).toBeNull();
      }
      for (const kind of ["added", "removed", "changed"] as const) {
        expect(view.visible.kinds[kind]).toBe(expected.filter((row) => row.split(":")[1] === kind).length);
      }
      if (expected.length === 0) expect(markup).toContain("No artifact changes match these filters.");
    }
  });

  it("keeps provenance, field arrays and record identity while returning new display arrays", () => {
    const snapshot = JSON.stringify(syntheticDiff);
    const view = deriveWorldVersionDiffView(syntheticDiff, { category: "relations", kind: "changed", text: "needle" });
    expect(view.groups.relations.changed[0]).toBe(syntheticDiff.relations.changed[0]);
    expect(view.groups.relations.changed[0].changes).toBe(syntheticDiff.relations.changed[0].changes);
    expect(view.groups.relations.changed).not.toBe(syntheticDiff.relations.changed);
    expect(JSON.stringify(syntheticDiff)).toBe(snapshot);
    expect(syntheticDiff.sourceRevisions.unchanged).toBe(9);
    expect(syntheticDiff.identical).toBe(false);
    expect(deriveWorldVersionDiffView(syntheticDiff).visible.total).toBe(14);
  });

  it("distinguishes identical artifacts from a nonempty comparison hidden by filters", () => {
    const empty: WorldVersionDiff = { ...syntheticDiff, identical: true,
      objects: { added: [], removed: [], changed: [] }, relations: { added: [], removed: [], changed: [] },
      evidence: { added: [], removed: [], changed: [] }, files: { added: [], removed: [], changed: [] },
      sourceRevisions: { added: [], removed: [], unchanged: 9 },
    };
    const markup = renderToStaticMarkup(createElement(ArtifactDiffSections, {
      view: deriveWorldVersionDiffView(empty), changedOnly: false, unchangedRevisions: 9,
    }));
    expect(markup).toContain("No artifact changes in this comparison.");
    expect(markup).not.toContain("match these filters");
    expect(renderedRows(markup)).toEqual([]);
  });
});

const unknownImpact: ReviewImpactContract = {
  state: "not_yet", affectedObjectIds: [],
  claims: { state: "not_yet", reason: "No compiled claim binding." },
  relations: { state: "not_yet", reason: "No compiled relation binding." },
  answerCaches: { state: "not_yet", reason: "Cache impact is not materialized." },
  activeWorldObjects: { state: "read", value: 0 },
  researchImpactPath: { status: "research", state: "not_yet", reason: "Unqualified research impact path." },
};

function syntheticModel(digit: string, evidenceRefs: string[]): WorldReadModel {
  const object: WorldObject = {
    id: "synthetic-object", stableKey: "synthetic-object", label: "Synthetic entity", type: "Entity", status: "candidate",
    aliases: { state: "not_yet", reason: "Unmaterialized." }, claims: ["claim-z"], relations: ["relation-z"],
    evidenceRefs, sourceVersions: ["revision-z"], firstSeen: { state: "not_yet", reason: "Unmaterialized." },
    lastChanged: { state: "not_yet", reason: "Unmaterialized." }, readState: "not_yet",
  };
  return {
    schemaVersion: "tavonel.world_read_model.v1",
    contract: { origin: "deterministic_sample", deterministicSample: true, realObjectsOnly: true, missingData: "not_yet" },
    world: { id: "synthetic-world", manifestDigest: `sha256:${digit.repeat(64)}`, status: "candidate", revision: { state: "not_yet", reason: "Unmaterialized." } },
    freshness: { observedAt: null, processedAt: null, reviewedAt: null, activatedAt: null, activeManifestDigest: null, candidateAwaitingActivation: false, candidateManifestDigest: null },
    objects: [object], relations: [], evidence: [], directory: [], history: [], files: [],
    ontology: { classes: [], properties: [], hierarchy: { state: "not_yet", reason: "Unmaterialized." }, exports: [] },
    signature: { state: "not_yet", reason: "Unmaterialized." },
    review: { state: "not_yet", reasons: [], evidenceRefs: [], impact: structuredClone(unknownImpact), receipt: { state: "not_yet", reason: "No human decision receipt." } },
  };
}

describe("filtering actual comparison output preserves read model contracts", () => {
  it("finds a same-sized evidence membership replacement without rewriting IDs or unknown state", () => {
    const before = freeze(syntheticModel("a", ["evidence-old", "evidence-kept"]));
    const after = freeze(syntheticModel("b", ["evidence-new", "evidence-kept"]));
    const beforeSnapshot = JSON.stringify(before);
    const afterSnapshot = JSON.stringify(after);
    const diff = freeze(diffWorldVersions(before, after));
    const view = deriveWorldVersionDiffView(diff, { category: "objects", kind: "changed", text: "evidence-old" });
    expect(view.visible.total).toBe(1);
    expect(view.groups.objects.changed[0].id).toBe("synthetic-object");
    expect(view.groups.objects.changed[0].changes).toEqual([{ field: "evidenceRefs", before: '["evidence-kept","evidence-old"]', after: '["evidence-kept","evidence-new"]' }]);
    expect(diff.left.manifestDigest).toBe(before.world.manifestDigest);
    expect(diff.right.manifestDigest).toBe(after.world.manifestDigest);
    expect(view.groups.objects.changed[0]).toBe(diff.objects.changed[0]);
    expect(JSON.stringify(before)).toBe(beforeSnapshot);
    expect(JSON.stringify(after)).toBe(afterSnapshot);
    expect(after.review.impact).toEqual(unknownImpact);
    expect(after.objects[0].evidenceRefs).toEqual(["evidence-new", "evidence-kept"]);
  });

  it("does not translate missing effects or the active object count into zero version impact", () => {
    const impact = freeze(structuredClone(unknownImpact));
    const snapshot = JSON.stringify(impact);
    const markup = renderToStaticMarkup(createElement(VersionComparisonEffects, { impact }));
    // The internal state token stays out of the copy (main's e2e/change-inbox.spec.ts forbids
    // "not_yet" anywhere on the page); the unknown is still said, with its reason.
    expect(markup).toContain("Merge, split, bridge and ACL effects: unknown (not materialized in this comparison).");
    expect(markup).toContain("Answer-cache effects: unknown.");
    expect(markup).not.toContain("not_yet");
    expect(markup).toContain(impact.answerCaches.state === "not_yet" ? impact.answerCaches.reason : "unreachable");
    expect(markup).not.toContain("0");
    expect(JSON.stringify(impact)).toBe(snapshot);
    const readCacheImpact: ReviewImpactContract = { ...impact, answerCaches: { state: "read", value: 17 } };
    const scopedMarkup = renderToStaticMarkup(createElement(VersionComparisonEffects, { impact: readCacheImpact }));
    expect(scopedMarkup).toContain("does not establish cache effects for this version comparison");
    expect(scopedMarkup).not.toContain("17");
  });
});


// Only this new group executes for the pagination successor's bounded verification.
describe("UX24 bounded diff paging", () => {
  it("visits every matching category/kind row once with stable identity across page boundaries", () => {
    const view = deriveWorldVersionDiffView(syntheticDiff);
    const rows: string[] = [];
    for (let number = 1; number <= 5; number++) {
      const page = paginateWorldVersionDiffView(view, number, 3);
      const markup = renderToStaticMarkup(createElement(ArtifactDiffSections, { view, page, changedOnly: true, unchangedRevisions: 9 }));
      rows.push(...renderedRows(markup));
      expect(page.displayed.total).toBe(number === 5 ? 2 : 3);
      expect(page.start).toBe((number - 1) * 3 + 1);
      expect(page.end).toBe(Math.min(number * 3, 14));
      expect(markup).toContain(`Rows ${page.start}–${page.end} of 14 matching changes`);
    }
    expect(rows).toEqual(allRows);
    expect(new Set(rows).size).toBe(14);
    expect(view.visible.total).toBe(14);
    expect(syntheticDiff.left.manifestDigest).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("caps a large display at fifty complete records while retaining every field/reference", () => {
    const changed = Array.from({ length: 1003 }, (_, index) => ({ ...syntheticDiff.objects.changed[0], id: `large-${index}`,
      changes: [{ field: "provenance", before: `before-${index}`, after: `after-${index}` }, ...syntheticDiff.objects.changed[0].changes] }));
    const diff = freeze({ ...syntheticDiff, objects: { added: [], removed: [], changed } });
    const view = deriveWorldVersionDiffView(diff, { ...DEFAULT_DIFF_FILTERS, category: "objects" });
    const visited = Array.from({ length: 21 }, (_, index) => index + 1).flatMap(number => {
      const page = paginateWorldVersionDiffView(view, number);
      expect(page.displayed.total).toBeLessThanOrEqual(DIFF_PAGE_SIZE);
      return page.groups.objects.changed;
    });
    expect(visited).toEqual(changed);
    visited.forEach((record, index) => {
      expect(record).toBe(changed[index]);
      expect(record.changes).toBe(changed[index].changes);
    });
    const last = paginateWorldVersionDiffView(view, 21);
    const markup = renderToStaticMarkup(createElement(ArtifactDiffSections, { view, page: last, changedOnly: true, unchangedRevisions: 9 }));
    expect(markup).toContain("3 displayed · 1003 matching · 1003 complete");
    expect(markup).toContain("Rows 1001–1003 of 1003 matching changes");
    expect(markup).toContain("before-1002"); expect(markup).toContain("after-1002");
  });

  it("pages after intersected filters and clamps reduced, empty and invalid requests", () => {
    const view = deriveWorldVersionDiffView(syntheticDiff, { category: "all", kind: "changed", text: "needle" });
    const page = paginateWorldVersionDiffView(view, 99, 2);
    expect(page.page).toBe(2); expect(page.pageCount).toBe(2);
    expect(page.displayed.total).toBe(1); expect(page.start).toBe(3); expect(page.end).toBe(3);
    expect(page.groups.evidence.changed[0]).toBe(syntheticDiff.evidence.changed[0]);
    expect(view.visible.total).toBe(3); expect(view.original.total).toBe(14);
    const empty = paginateWorldVersionDiffView(deriveWorldVersionDiffView(syntheticDiff, { ...DEFAULT_DIFF_FILTERS, text: "absent" }), 999);
    expect([empty.page, empty.pageCount, empty.start, empty.end, empty.displayed.total]).toEqual([1, 1, 0, 0, 0]);
    for (const invalid of [NaN, Infinity, -2, 0]) expect(paginateWorldVersionDiffView(view, invalid).page).toBe(1);
    expect(paginateWorldVersionDiffView(view, 1, Infinity).pageSize).toBe(50);
    expect(paginateWorldVersionDiffView(view, 1, 999).pageSize).toBe(50);
    expect(paginateWorldVersionDiffView(view, 1, 0).pageSize).toBe(1);
  });

  it("distinguishes an off-page category from zero matches and preserves unknown effects", () => {
    const view = deriveWorldVersionDiffView(syntheticDiff);
    const page = paginateWorldVersionDiffView(view, 2, 3);
    const markup = renderToStaticMarkup(createElement(ArtifactDiffSections, { view, page, changedOnly: false, unchangedRevisions: 9 }));
    expect(markup).toContain("0 displayed · 3 matching · 3 complete");
    expect(markup).toContain("No objects on this page.");
    expect(markup).not.toContain("No objects match these filters.");
    const effects = renderToStaticMarkup(createElement(VersionComparisonEffects, { impact: unknownImpact }));
    expect(effects).toContain("ACL effects: unknown (not materialized");
    expect(effects).toContain("Answer-cache effects: unknown.");
    expect(effects).not.toContain("not_yet");
  });
});


// Same deterministic actual-component hook technique as the admitted comparison-binding tests.
// This invokes real controls with local synthetic auth/fetch only; no browser/runtime qualification.
const pageSame = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
class PageHooks {
  slots: HookSlot[] = []; pending = new Map<number, Effect>(); cursor = 0; tree: unknown;
  constructor(public props: Parameters<typeof WorldVersionDiffPanel>[0]) {}
  state<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
    const index = this.cursor++;
    if (!this.slots[index]) this.slots[index] = { value: typeof initial === "function" ? (initial as () => T)() : initial };
    return [this.slots[index].value as T, next => { this.slots[index].value = typeof next === "function" ? (next as (previous: T) => T)(this.slots[index].value as T) : next; }];
  }
  memo<T>(factory: () => T, deps: readonly unknown[]): T {
    const index = this.cursor++;
    if (!pageSame(this.slots[index]?.deps, deps)) this.slots[index] = { deps, value: factory() };
    return this.slots[index].value as T;
  }
  effect(effect: Effect, deps: readonly unknown[]) {
    const index = this.cursor++; const old = this.slots[index];
    if (!pageSame(old?.deps, deps)) { this.slots[index] = { deps, cleanup: old?.cleanup }; this.pending.set(index, effect); }
  }
  id() { return `page-test-${this.cursor++}`; }
  render() {
    this.cursor = 0; pageRuntime.active = this;
    try { this.tree = WorldVersionDiffPanel(this.props); } finally { pageRuntime.active = null; }
    return this;
  }
  effects() {
    const pending = [...this.pending]; this.pending.clear();
    for (const [index] of pending) this.slots[index].cleanup?.();
    for (const [index, effect] of pending) this.slots[index].cleanup = effect() as (() => void) | undefined;
    return this;
  }
  dispose() { for (const slot of this.slots) slot?.cleanup?.(); }
}
function pageNodes(value: unknown): TestElement[] {
  if (Array.isArray(value)) return value.flatMap(pageNodes);
  if (!value || typeof value !== "object") return [];
  const element = value as TestElement;
  if (typeof element.type === "function") return pageNodes(element.type(element.props));
  return [element, ...pageNodes(element.props?.children)];
}
function pageText(value: unknown): string {
  if (Array.isArray(value)) return value.map(pageText).join("");
  if (value == null || typeof value === "boolean") return "";
  if (typeof value !== "object") return String(value);
  const element = value as TestElement;
  return typeof element.type === "function" ? pageText(element.type(element.props)) : pageText(element.props?.children);
}
function pageButton(hooks: PageHooks, label: string) {
  const found = pageNodes(hooks.tree).find(node => node.type === "button" && pageText(node) === label);
  expect(found).toBeDefined(); return found!;
}
const pageTicks = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
function pagingModel(letter: string, withRows = false) {
  const result = syntheticModel(letter, []);
  result.history = ["c", "a", "b"].map(value => ({ manifestDigest: `sha256:${value.repeat(64)}`, version: value, status: "candidate", activatedAt: { state: "not_yet", reason: "Synthetic." } })) as WorldReadModel["history"];
  result.objects = withRows ? Array.from({ length: 123 }, (_, index) => ({ ...result.objects[0], id: `entity-${index}`, stableKey: `entity-${index}`, label: `Entity ${index}`, sourceVersions: [] })) : [];
  return result;
}
async function withPagingPanel(callback: (hooks: PageHooks, calls: string[]) => Promise<void> | void) {
  const calls: string[] = [];
  const hooks = new PageHooks({ model: pagingModel("c", true), onRollback: digest => calls.push(digest) });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/v1/reviews?")
    ? { ok: true, json: async () => ({ decisions: [{ decisionId: "ledger-1", manifestDigest: `sha256:${"c".repeat(64)}`, action: "accept", reason: "Keep complete ledger", recordedAt: "synthetic", patch: null }] }) }
    : { ok: true, json: async () => ({ model: pagingModel(decodeURIComponent(url.split("manifest=")[1]).slice(7, 8)) }) }));
  try {
    hooks.render().effects().render().effects(); await pageTicks(); hooks.render();
    expect(pageText(hooks.tree)).toContain("Rows 1–50 of 123 matching changes");
    await callback(hooks, calls);
  } finally { hooks.dispose(); vi.unstubAllGlobals(); pageRuntime.active = null; }
}

describe("UX24 bounded diff paging actual handlers", () => {
  it("next and previous controls reach all rows with range, boundary and complete rollback target", async () => {
    await withPagingPanel((hooks, calls) => {
      expect(pageButton(hooks, "Previous changes").props.disabled).toBe(true);
      const ids = () => pageNodes(hooks.tree).filter(node => node.props?.["data-diff-row"] === "true").map(node => node.props["data-record-id"]);
      const visited = [...ids()];
      for (const range of ["51–100", "101–123"]) {
        pageButton(hooks, "Next changes").props.onClick(); hooks.render(); visited.push(...ids());
        expect(pageText(hooks.tree)).toContain(`Rows ${range} of 123 matching changes`);
      }
      expect(visited).toEqual(Array.from({ length: 123 }, (_, index) => `entity-${index}`));
      expect(pageButton(hooks, "Next changes").props.disabled).toBe(true);
      pageButton(hooks, "Previous changes").props.onClick(); hooks.render();
      expect(ids()[0]).toBe("entity-50"); expect(ids()).toHaveLength(50);
      expect(pageText(hooks.tree)).toContain("all 123 artifact changes");
      expect(pageText(hooks.tree)).toContain("Keep complete ledger");
      expect(pageText(hooks.tree)).toContain("ACL effects: unknown (not materialized");
      pageButton(hooks, "Roll back to this version").props.onClick();
      expect(calls).toEqual([`sha256:${"a".repeat(64)}`]);
    });
  });

  it.each(["category", "kind", "text"])("%s filter resets paging immediately and keeps complete comparison rollback", async kind => {
    await withPagingPanel((hooks, calls) => {
      pageButton(hooks, "Next changes").props.onClick(); hooks.render();
      const nodes = pageNodes(hooks.tree);
      if (kind === "text") nodes.find(node => node.type === "input" && node.props.type === "search")!.props.onChange({ target: { value: "Entity 122" } });
      else nodes.filter(node => node.type === "select")[kind === "category" ? 0 : 1].props.onChange({ target: { value: kind === "category" ? "objects" : "added" } });
      hooks.render(); // No effect flush: reset must already be visible.
      expect(pageText(hooks.tree)).toContain(kind === "text" ? "Rows 1–1 of 1 matching changes" : "Rows 1–50 of 123 matching changes");
      expect(pageText(hooks.tree)).toContain("of 123 artifact changes");
      if (kind === "text") expect(pageNodes(hooks.tree).filter(node => node.props?.["data-diff-row"] === "true").map(node => node.props["data-record-id"])).toEqual(["entity-122"]);
      pageButton(hooks, "Roll back to this version").props.onClick();
      expect(calls).toEqual([`sha256:${"a".repeat(64)}`]);
      pageButton(hooks, "Clear filters").props.onClick(); hooks.render();
      expect(pageText(hooks.tree)).toContain("Rows 1–50 of 123 matching changes");
    });
  });

  it("paged A to B to A resets each bound comparison to page one and rolls back only its digest", async () => {
    await withPagingPanel(async (hooks, calls) => {
      pageButton(hooks, "Roll back to this version").props.onClick();
      for (const letter of ["b", "a"]) {
        pageButton(hooks, "Next changes").props.onClick(); hooks.render();
        expect(pageText(hooks.tree)).toContain("Rows 51–100 of 123 matching changes");
        const row = pageNodes(hooks.tree).find(node => node.type === "li" && pageText(node).includes(letter.repeat(12)));
        pageNodes(row).find(node => node.type === "button" && pageText(node) === "Compare")!.props.onClick();
        hooks.render();
        expect(pageText(hooks.tree)).not.toContain("Rows ");
        expect(pageNodes(hooks.tree).filter(node => node.type === "button" && pageText(node) === "Roll back to this version")).toHaveLength(0);
        hooks.effects(); await pageTicks(); hooks.render();
        expect(pageText(hooks.tree)).toContain("Rows 1–50 of 123 matching changes");
        expect(pageButton(hooks, "Previous changes").props.disabled).toBe(true);
        pageButton(hooks, "Roll back to this version").props.onClick();
        expect(calls[calls.length - 1]).toBe(`sha256:${letter.repeat(64)}`);
      }
      expect(calls).toEqual(["a", "b", "a"].map(letter => `sha256:${letter.repeat(64)}`));
    });
  });

  it.each(["model", "current", "digest"])("%s replacement hides old page before effects then starts its bound comparison at one", async kind => {
    await withPagingPanel(async (hooks, calls) => {
      pageButton(hooks, "Next changes").props.onClick(); hooks.render();
      if (kind !== "digest") hooks.props = { ...hooks.props, model: pagingModel(kind === "current" ? "d" : "c", true) };
      else {
        const row = pageNodes(hooks.tree).find(node => node.type === "li" && pageText(node).includes("b".repeat(12)));
        pageNodes(row).find(node => node.type === "button" && pageText(node) === "Compare")!.props.onClick();
      }
      hooks.render();
      expect(pageText(hooks.tree)).not.toContain("Rows ");
      expect(pageNodes(hooks.tree).filter(node => node.props?.["data-diff-row"] === "true")).toHaveLength(0);
      expect(pageNodes(hooks.tree).filter(node => node.type === "button" && pageText(node) === "Roll back to this version")).toHaveLength(0);
      hooks.effects(); await pageTicks(); hooks.render();
      expect(pageText(hooks.tree)).toContain("Rows 1–50 of 123 matching changes");
      pageButton(hooks, "Roll back to this version").props.onClick();
      expect(calls).toEqual([`sha256:${(kind === "digest" ? "b" : "a").repeat(64)}`]);
    });
  });
});
