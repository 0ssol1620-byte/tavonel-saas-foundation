import type { FieldChange, WorldVersionDiff } from "./world-version-diff";

export const DIFF_CATEGORIES = ["objects", "relations", "evidence", "files", "sourceRevisions"] as const;
export const DIFF_KINDS = ["added", "removed", "changed"] as const;
export type DiffCategory = typeof DIFF_CATEGORIES[number];
export type DiffKind = typeof DIFF_KINDS[number];
export type DiffFilters = { category: DiffCategory | "all"; kind: DiffKind | "all"; text: string };
export const DEFAULT_DIFF_FILTERS: DiffFilters = { category: "all", kind: "all", text: "" };
export const DIFF_CATEGORY_LABELS: Record<DiffCategory, string> = {
  objects: "Objects", relations: "Relations", evidence: "Evidence", files: "Package files", sourceRevisions: "Source revisions",
};

export const objectDiffLabel = (item: WorldVersionDiff["objects"]["added"][number]) => `${item.type} · ${item.label}`;
export const relationDiffLabel = (item: WorldVersionDiff["relations"]["added"][number]) => `${item.subject} ${item.predicate} ${item.object}`;
export const evidenceDiffLabel = (item: WorldVersionDiff["evidence"]["added"][number]) => `${item.sourceId} p.${item.page}`;

type ChangeGroups<T> = { added: T[]; removed: T[]; changed: T[] };
export type DiffViewGroups = Pick<WorldVersionDiff, "objects" | "relations" | "evidence" | "files"> & {
  // Source revisions have no changed kind in the comparison contract.
  sourceRevisions: ChangeGroups<string>;
};
export type DiffViewCounts = { total: number; categories: Record<DiffCategory, number>; kinds: Record<DiffKind, number> };
export type WorldVersionDiffView = {
  groups: DiffViewGroups;
  visible: DiffViewCounts;
  original: DiffViewCounts;
  filtering: boolean;
};

function recordText(item: { id: string; changes: FieldChange[] }, label: string) {
  return [item.id, label, ...item.changes.flatMap((change) => [change.field, change.before, change.after])].join("\n");
}

function countGroups(groups: DiffViewGroups): DiffViewCounts {
  const categories: Record<DiffCategory, number> = { objects: 0, relations: 0, evidence: 0, files: 0, sourceRevisions: 0 };
  const kinds: Record<DiffKind, number> = { added: 0, removed: 0, changed: 0 };
  for (const category of DIFF_CATEGORIES) {
    for (const kind of DIFF_KINDS) {
      const count = groups[category][kind].length;
      categories[category] += count;
      kinds[kind] += count;
    }
  }
  return { total: kinds.added + kinds.removed + kinds.changed, categories, kinds };
}

/** Display selection only: retain every selected record and its fields by reference. */
export function deriveWorldVersionDiffView(diff: WorldVersionDiff, filters: DiffFilters = DEFAULT_DIFF_FILTERS): WorldVersionDiffView {
  const query = filters.text.trim().toLowerCase();
  const matches = (category: DiffCategory, kind: DiffKind, text: string) =>
    (filters.category === "all" || filters.category === category)
    && (filters.kind === "all" || filters.kind === kind)
    && (query.length === 0 || text.toLowerCase().includes(query));

  const select = <T>(category: DiffCategory, group: ChangeGroups<T>, text: (item: T) => string): ChangeGroups<T> => ({
    added: group.added.filter((item) => matches(category, "added", text(item))),
    removed: group.removed.filter((item) => matches(category, "removed", text(item))),
    changed: group.changed.filter((item) => matches(category, "changed", text(item))),
  });
  const originalGroups: DiffViewGroups = {
    objects: diff.objects, relations: diff.relations, evidence: diff.evidence, files: diff.files,
    sourceRevisions: { added: diff.sourceRevisions.added, removed: diff.sourceRevisions.removed, changed: [] },
  };
  const groups: DiffViewGroups = {
    objects: select("objects", diff.objects, (item) => recordText(item, objectDiffLabel(item))),
    relations: select("relations", diff.relations, (item) => recordText(item, relationDiffLabel(item))),
    evidence: select("evidence", diff.evidence, (item) => recordText(item, evidenceDiffLabel(item))),
    files: select("files", diff.files, (path) => path),
    sourceRevisions: select("sourceRevisions", originalGroups.sourceRevisions, (revision) => revision),
  };
  return {
    groups, visible: countGroups(groups), original: countGroups(originalGroups),
    filtering: filters.category !== "all" || filters.kind !== "all" || query.length > 0,
  };
}


export const DIFF_PAGE_SIZE = 50;
export type WorldVersionDiffPage = {
  groups: DiffViewGroups;
  displayed: DiffViewCounts;
  page: number;
  pageSize: number;
  pageCount: number;
  start: number;
  end: number;
};

/** Page the already filtered display arrays; record identities and full fields stay intact. */
export function paginateWorldVersionDiffView(view: WorldVersionDiffView, requestedPage = 1, requestedSize = DIFF_PAGE_SIZE): WorldVersionDiffPage {
  const pageSize = Number.isFinite(requestedSize) ? Math.max(1, Math.min(DIFF_PAGE_SIZE, Math.floor(requestedSize))) : DIFF_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(view.visible.total / pageSize));
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.min(pageCount, Math.floor(requestedPage))) : 1;
  const offset = (page - 1) * pageSize;
  let cursor = 0;
  const select = <T>(group: ChangeGroups<T>): ChangeGroups<T> => {
    const slice = (items: T[]) => {
      const from = Math.max(0, offset - cursor);
      const to = Math.max(0, Math.min(items.length, offset + pageSize - cursor));
      cursor += items.length;
      return items.slice(from, to);
    };
    return { added: slice(group.added), removed: slice(group.removed), changed: slice(group.changed) };
  };
  const groups: DiffViewGroups = {
    objects: select(view.groups.objects), relations: select(view.groups.relations),
    evidence: select(view.groups.evidence), files: select(view.groups.files),
    sourceRevisions: select(view.groups.sourceRevisions),
  };
  const displayed = countGroups(groups);
  return { groups, displayed, page, pageSize, pageCount,
    start: displayed.total === 0 ? 0 : offset + 1, end: offset + displayed.total };
}
