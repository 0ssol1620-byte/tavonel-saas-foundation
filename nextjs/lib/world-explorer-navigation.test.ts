import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorldExplorer, { type CollectionShape } from "../components/world-explorer";
import {
  directoryGroups, directoryPage, initialDirectoryNavigation, navigateDirectory,
  reconcileDirectoryNavigation, selectedDirectoryEntry,
} from "./world-explorer-navigation";

// Explicitly synthetic data using the customer CollectionShape directory contract.
// This is a bounded navigation contract, not corpus, throughput, provider or load evidence.
const longPath = `Topics/${"synthetic-long-name-".repeat(24)}.md`;
function syntheticCollection(): CollectionShape {
  return {
    collectionId: "synthetic-navigation-65", manifestDigest: "sha256:synthetic-manifest-a",
    directoryPlan: [
      { path: "Topics", kind: "root", sourceIds: [] },
      ...Array.from({ length: 65 }, (_, index) => ({
        path: index === 64 ? longPath : `Topics/synthetic-topic-${String(index + 1).padStart(2, "0")}.md`,
        kind: "topic", sourceIds: [`synthetic-source-${index + 1}`],
      })),
      { path: "Sources/synthetic-source.md", kind: "document", sourceIds: ["synthetic-source-1"] },
    ],
    validation: { counts: { documents: 1, topics: 65, entities: 0, claims: 0, relations: 0, packageFiles: 0 } },
  };
}

describe("WorldExplorer bounded customer navigation", () => {
  it("reaches every one of 65 topic entries, including the former unreachable suffix, in compiler order", () => {
    const collection = syntheticCollection();
    const original = structuredClone(collection);
    const topics = directoryGroups(collection).find(({ root }) => root === "Topics")!.entries;
    let state = initialDirectoryNavigation(collection);
    const visited: string[] = [];
    for (let index = 1; index <= 4; index++) {
      const page = directoryPage(topics, state.query, state.page);
      visited.push(...page.entries.map((entry) => entry.path));
      state = navigateDirectory(collection, state, { type: "page", page: page.page + 1 });
    }
    expect(visited).toEqual(topics.map((entry) => entry.path));
    expect(new Set(visited).size).toBe(65);
    expect(visited.slice(40)).toHaveLength(25);
    expect(visited.at(-1)).toBe(longPath);
    expect(state.page).toBe(4);
    expect(collection).toEqual(original);
  });

  it("keeps the exact selected model entry across pages, an excluding filter, and another root", () => {
    const collection = syntheticCollection();
    const entry = collection.directoryPlan[61];
    let state = navigateDirectory(collection, initialDirectoryNavigation(collection), { type: "page", page: 4 });
    state = navigateDirectory(collection, state, { type: "select", entry });
    state = navigateDirectory(collection, state, { type: "page", page: 1 });
    expect(selectedDirectoryEntry(collection, state)).toBe(entry);
    state = navigateDirectory(collection, state, { type: "filter", query: "synthetic-topic-01" });
    expect(directoryPage(directoryGroups(collection)[1].entries, state.query, state.page).entries).not.toContain(entry);
    expect(selectedDirectoryEntry(collection, state)).toBe(entry);
    state = navigateDirectory(collection, state, { type: "root", root: "Sources" });
    expect(selectedDirectoryEntry(collection, state)).toBe(entry);
    state = navigateDirectory(collection, state, { type: "root", root: null });
    expect(selectedDirectoryEntry(collection, state)).toBe(entry);
    state = navigateDirectory(collection, state, { type: "clear" });
    expect(selectedDirectoryEntry(collection, state)).toBeNull();
  });

  it("filters all paths and kinds, resets to page one and clamps page boundaries without losing selection", () => {
    const collection = syntheticCollection();
    const topics = directoryGroups(collection).find(({ root }) => root === "Topics")!.entries;
    let state = navigateDirectory(collection, initialDirectoryNavigation(collection), { type: "select", entry: topics[0] });
    state = navigateDirectory(collection, state, { type: "page", page: 99 });
    expect(state.page).toBe(4);
    state = navigateDirectory(collection, state, { type: "filter", query: "  TOPIC-65  " });
    expect(state.page).toBe(1);
    // The 65th entry has an intentionally long path, rather than the generated short name.
    expect(directoryPage(topics, state.query, 99)).toMatchObject({ total: 0, page: 1, first: 0, last: 0 });
    state = navigateDirectory(collection, state, { type: "filter", query: "  TOPIC-01  " });
    expect(directoryPage(topics, state.query, 99)).toMatchObject({ total: 1, page: 1, first: 1, last: 1 });
    expect(selectedDirectoryEntry(collection, state)).toBe(topics[0]);
    expect(directoryPage(topics, " topic ", -10).total).toBe(65);
    expect(directoryPage(directoryGroups(collection)[0].entries, "DOCUMENT", 1).total).toBe(1);
    expect(directoryPage(topics, " ", Number.NaN)).toMatchObject({ total: 65, page: 1 });
  });

  it("clears selection for a different collection or manifest, even with an identical path", () => {
    const collection = syntheticCollection();
    const state = navigateDirectory(collection, initialDirectoryNavigation(collection), { type: "select", entry: collection.directoryPlan[1] });
    for (const replacement of [
      { ...collection, collectionId: "synthetic-other-collection" },
      { ...collection, manifestDigest: "sha256:synthetic-manifest-b" },
    ]) {
      expect(selectedDirectoryEntry(replacement, state)).toBeNull();
      expect(reconcileDirectoryNavigation(replacement, state).selectedIdentity).toBeNull();
    }
  });

  it("does not retarget a removed path or changed source binding, and clears rather than resurrecting it", () => {
    const collection = syntheticCollection();
    const chosen = collection.directoryPlan[61];
    const state = navigateDirectory(collection, initialDirectoryNavigation(collection), { type: "select", entry: chosen });
    const removed = { ...collection, directoryPlan: collection.directoryPlan.filter((entry) => entry !== chosen) };
    const cleared = reconcileDirectoryNavigation(removed, state);
    expect(selectedDirectoryEntry(removed, cleared)).toBeNull();
    expect(selectedDirectoryEntry(collection, reconcileDirectoryNavigation(collection, cleared))).toBeNull();
    const rebound = { ...collection, directoryPlan: collection.directoryPlan.map((entry) =>
      entry === chosen ? { ...entry, sourceIds: ["synthetic-different-source"] } : entry) };
    expect(selectedDirectoryEntry(rebound, state)).toBeNull();
    // Identical source references reordered are the same binding, not a different object.
    const multiSource = { ...chosen, sourceIds: ["synthetic-b", "synthetic-a"] };
    const withMulti = { ...collection, directoryPlan: [multiSource] };
    const multiState = navigateDirectory(withMulti, initialDirectoryNavigation(withMulti), { type: "select", entry: multiSource });
    const reordered = { ...withMulti, directoryPlan: [{ ...multiSource, sourceIds: [...multiSource.sourceIds].reverse() }] };
    expect(selectedDirectoryEntry(reordered, multiState)).toBe(reordered.directoryPlan[0]);
  });

  it("treats a replacement without manifest identity as a new model and clamps a shortened root", () => {
    const collection = syntheticCollection();
    const undigested = { ...collection, manifestDigest: undefined };
    const state = navigateDirectory(undigested, initialDirectoryNavigation(undigested), { type: "select", entry: undigested.directoryPlan[1] });
    expect(selectedDirectoryEntry({ ...undigested }, state)).toBeNull();
    expect(selectedDirectoryEntry(undigested, state)).toBe(undigested.directoryPlan[1]);
    const latePage = navigateDirectory(collection, initialDirectoryNavigation(collection), { type: "page", page: 4 });
    const shortened = { ...collection, directoryPlan: collection.directoryPlan.slice(0, 6) };
    expect(reconcileDirectoryNavigation(shortened, latePage).page).toBe(1);
  });

  it("keeps empty and unexpected-root models navigable without inventing entries or identity", () => {
    const collection = { ...syntheticCollection(), directoryPlan: [] };
    expect(initialDirectoryNavigation(collection).openRoot).toBeNull();
    expect(directoryPage([], "", 7)).toMatchObject({ entries: [], total: 0, page: 1, pageCount: 1 });
    const entry = { path: "Additional/synthetic-entry.md", kind: "package", sourceIds: [] };
    const other = { ...collection, directoryPlan: [entry] };
    expect(directoryGroups(other)).toEqual([{ root: "Additional", entries: [entry] }]);
    expect(initialDirectoryNavigation(other).openRoot).toBe("Additional");
    expect(navigateDirectory(other, initialDirectoryNavigation(other), { type: "select", entry: { ...entry, path: "Additional/absent.md" } }).selectedIdentity).toBeNull();
  });

  it("renders the customer controls and original result semantics for a real-shaped synthetic model", () => {
    const markup = renderToStaticMarkup(createElement(WorldExplorer, { collection: syntheticCollection() }));
    expect(markup).toContain("Filter directory entries");
    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-label="Topics directory pages"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Previous<\/button>/);
    expect(markup).toContain("1–20 of 65");
    expect(markup).toContain("Six passes");
    expect(markup).toContain("Activation is a separate, recorded human decision.");
    expect(markup).not.toContain("more not listed");
    const emptyMarkup = renderToStaticMarkup(createElement(WorldExplorer, { collection: { ...syntheticCollection(), directoryPlan: [] } }));
    expect(emptyMarkup).toContain("No directory entries in this collection.");
    expect(renderToStaticMarkup(createElement(WorldExplorer, { collection: null }))).toContain("Nothing compiled yet");
  });
});
