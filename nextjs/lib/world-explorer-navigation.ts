import type { CollectionShape } from "../components/world-explorer";

export type DirectoryEntry = CollectionShape["directoryPlan"][number];
type NavigationCollection = Pick<CollectionShape, "collectionId" | "manifestDigest" | "directoryPlan">;

export const DIRECTORY_PAGE_SIZE = 20;
const ROOT_ORDER = ["Sources", "Topics", "Entities", "Claims", "Evidence", "Assets", "MOCs", "Packages"];

export function collectionScope(collection: NavigationCollection): string {
  return JSON.stringify([collection.collectionId, collection.manifestDigest ?? null]);
}

/** A directory entry has a path and source references, not an ontology object ID. */
export function directoryEntryIdentity(entry: DirectoryEntry): string {
  return JSON.stringify([entry.path, [...entry.sourceIds].sort()]);
}

export function directoryGroups(collection: NavigationCollection) {
  const byRoot = new Map<string, DirectoryEntry[]>();
  for (const entry of collection.directoryPlan) {
    if (entry.kind === "root") continue;
    const root = entry.path.split("/")[0];
    const entries = byRoot.get(root) ?? [];
    entries.push(entry);
    byRoot.set(root, entries);
  }
  const roots = [...ROOT_ORDER.filter((root) => byRoot.has(root)),
    ...[...byRoot.keys()].filter((root) => !ROOT_ORDER.includes(root))];
  return roots.map((root) => ({ root, entries: byRoot.get(root)! }));
}

export function matchesDirectoryFilter(entry: DirectoryEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("en-US");
  return !needle || entry.path.toLocaleLowerCase("en-US").includes(needle)
    || entry.kind.toLocaleLowerCase("en-US").includes(needle);
}

export function directoryPage(entries: readonly DirectoryEntry[], query: string, requestedPage: number) {
  const matches = entries.filter((entry) => matchesDirectoryFilter(entry, query));
  const pageCount = Math.max(1, Math.ceil(matches.length / DIRECTORY_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * DIRECTORY_PAGE_SIZE;
  return { entries: matches.slice(start, start + DIRECTORY_PAGE_SIZE), total: matches.length,
    page, pageCount, first: matches.length ? start + 1 : 0, last: Math.min(start + DIRECTORY_PAGE_SIZE, matches.length) };
}

export type DirectoryNavigationState = {
  model: NavigationCollection;
  scope: string;
  openRoot: string | null;
  query: string;
  page: number;
  selectedIdentity: string | null;
};

export function initialDirectoryNavigation(collection: NavigationCollection): DirectoryNavigationState {
  const groups = directoryGroups(collection);
  return { model: collection, scope: collectionScope(collection),
    openRoot: groups.find(({ root }) => root === "Topics")?.root ?? groups[0]?.root ?? null,
    query: "", page: 1, selectedIdentity: null };
}

/** Resolve against the original model even when the display is filtered or on another page. */
export function selectedDirectoryEntry(collection: NavigationCollection, state: DirectoryNavigationState): DirectoryEntry | null {
  if (state.scope !== collectionScope(collection)
    || (!collection.manifestDigest && state.model !== collection)) return null;
  return collection.directoryPlan.find((entry) => entry.kind !== "root"
    && directoryEntryIdentity(entry) === state.selectedIdentity) ?? null;
}

export function reconcileDirectoryNavigation(collection: NavigationCollection, state: DirectoryNavigationState): DirectoryNavigationState {
  // Without a digest, only this exact model can support an existing selection.
  if (state.scope !== collectionScope(collection)
    || (!collection.manifestDigest && state.model !== collection)) return initialDirectoryNavigation(collection);
  const groups = directoryGroups(collection);
  const openRoot = state.openRoot === null || groups.some(({ root }) => root === state.openRoot)
    ? state.openRoot : groups[0]?.root ?? null;
  const entries = groups.find(({ root }) => root === openRoot)?.entries ?? [];
  const page = directoryPage(entries, state.query, state.page).page;
  const selectedIdentity = selectedDirectoryEntry(collection, state) ? state.selectedIdentity : null;
  if (state.model === collection && openRoot === state.openRoot && page === state.page
    && selectedIdentity === state.selectedIdentity) return state;
  return { ...state, model: collection, openRoot, page, selectedIdentity };
}

type NavigationAction = { type: "root"; root: string | null } | { type: "filter"; query: string }
  | { type: "page"; page: number } | { type: "select"; entry: DirectoryEntry } | { type: "clear" };

export function navigateDirectory(collection: NavigationCollection, previous: DirectoryNavigationState, action: NavigationAction): DirectoryNavigationState {
  const state = reconcileDirectoryNavigation(collection, previous);
  switch (action.type) {
    case "root": return reconcileDirectoryNavigation(collection, { ...state, openRoot: action.root, page: 1 });
    case "filter": return { ...state, query: action.query, page: 1 };
    case "page": return reconcileDirectoryNavigation(collection, { ...state, page: action.page });
    case "select": {
      const selectedIdentity = directoryEntryIdentity(action.entry);
      return collection.directoryPlan.some((entry) => entry.kind !== "root"
        && directoryEntryIdentity(entry) === selectedIdentity) ? { ...state, selectedIdentity } : state;
    }
    case "clear": return { ...state, selectedIdentity: null };
  }
}
