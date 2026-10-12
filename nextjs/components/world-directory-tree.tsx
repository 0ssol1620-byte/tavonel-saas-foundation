"use client";

import { useId, useMemo, useState } from "react";
import type { WorldDirectoryEntry, WorldObject } from "@/lib/world-read-model";
import { directoryPage } from "../lib/world-explorer-navigation";
import styles from "./world-directory-tree.module.css";

/*
  The semantic directory the compile actually planned.

  Every path, kind and source list here is read from the artifact's `directoryPlan`. The
  previous lens grouped `model.objects` by `object.type` and drew the result as folders, which
  looked like this and was a different thing: it could not show a path, could not show a root
  the compile deliberately left empty, and could not say which documents a folder came from.
  All three are in the plan, and all three are what makes this a directory rather than a
  filtered list.
*/

type Props = {
  entries: readonly WorldDirectoryEntry[];
  objects: readonly WorldObject[];
  selectedObjectId: string | null;
  onObjectSelect: (objectId: string) => void;
};

type TreeNode = {
  name: string;
  path: string;
  kind: string | null;
  sourceIds: string[];
  children: TreeNode[];
};

/** Build the tree the paths describe, inserting the folders they imply. */
export function buildDirectoryTree(entries: readonly WorldDirectoryEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const index = new Map<string, TreeNode>();

  const ensure = (path: string, name: string, parent: TreeNode | null): TreeNode => {
    const existing = index.get(path);
    if (existing) return existing;
    const node: TreeNode = { name, path, kind: null, sourceIds: [], children: [] };
    index.set(path, node);
    if (parent) parent.children.push(node); else roots.push(node);
    return node;
  };

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let parent: TreeNode | null = null;
    let cursor = "";
    parts.forEach((part, depth) => {
      cursor = cursor ? `${cursor}/${part}` : part;
      const node = ensure(cursor, part, parent);
      if (depth === parts.length - 1) {
        node.kind = entry.kind;
        // A folder that appears twice in the plan -- Topics/x.md written by two documents --
        // accumulates its sources rather than keeping only the last.
        for (const id of entry.sourceIds) if (!node.sourceIds.includes(id)) node.sourceIds.push(id);
      }
      parent = node;
    });
  }
  return roots;
}

function countLeaves(node: TreeNode): number {
  return node.children.length === 0 ? 1 : node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

/** Page original nodes, retaining ancestors only as labelled context. */
export function directoryTreePage(tree: readonly TreeNode[], query: string, requestedPage: number) {
  const nodes: TreeNode[] = [];
  const visit = (node: TreeNode) => { nodes.push(node); node.children.forEach(visit); };
  tree.forEach(visit);
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const page = directoryPage(nodes.map((node) => ({
    path: node.path, kind: node.kind ?? "folder", sourceIds: node.sourceIds,
  })), query, requestedPage);
  const pagePaths = new Set(page.entries.map((entry) => entry.path));
  const visiblePaths = new Set(pagePaths);
  for (const path of pagePaths) {
    let parent = path;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      visiblePaths.add(parent);
    }
  }
  return { ...page, nodes: page.entries.map((entry) => byPath.get(entry.path)!), pagePaths, visiblePaths };
}

/** Binding uses the original tree's leaf status and the compiled object's stable ID. */
export function directoryObjectBinding(node: TreeNode, objects: readonly WorldObject[]): WorldObject | null {
  return node.children.length === 0
    ? objects.find((object) => node.path.endsWith(`/${object.id}.md`) || node.path.endsWith(`/${object.id}.json`)) ?? null
    : null;
}

function Branch({ node, depth, objects, selectedObjectId, onObjectSelect, pagePaths, visiblePaths }: {
  node: TreeNode;
  depth: number;
  objects: readonly WorldObject[];
  selectedObjectId: string | null;
  onObjectSelect: (objectId: string) => void;
  pagePaths: ReadonlySet<string>;
  visiblePaths: ReadonlySet<string>;
}) {
  // Each page opens its ancestors so matches are immediately reachable. Collapsing is local.
  const [open, setOpen] = useState(true);
  const isLeaf = node.children.length === 0;
  const children = node.children.filter((child) => visiblePaths.has(child.path));
  const bound = directoryObjectBinding(node, objects);
  const context = !pagePaths.has(node.path);

  return (
    <li className={styles.row} data-depth={Math.min(depth, 4)} data-context={context} data-path={node.path}>
      <div className={styles.rowHead}>
        {isLeaf ? (
          <span className={styles.leafMark} aria-hidden="true">·</span>
        ) : children.length > 0 ? (
          <button type="button" className={styles.disclosure} aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.path}`}
            onClick={() => setOpen((previous) => !previous)}>
            {open ? "−" : "+"}
          </button>
        ) : <span className={styles.leafMark} aria-hidden="true">/</span>}
        {bound ? (
          <button type="button" className={styles.name} title={node.path}
            data-selected={bound.id === selectedObjectId} aria-pressed={bound.id === selectedObjectId}
            onClick={() => onObjectSelect(bound.id)}>{node.name}</button>
        ) : <span className={styles.name} title={node.path}>{node.name}</span>}
        {context ? <span className={styles.context}>folder context</span> : null}
        {node.kind ? <span className={styles.kind}>{node.kind}</span> : null}
        {isLeaf ? null : <span className={styles.count} title="Leaves in the full directory">{countLeaves(node)}</span>}
        {node.sourceIds.length > 0 ? (
          <span className={styles.sources} title={node.sourceIds.join(", ")}>
            {node.sourceIds.length} source{node.sourceIds.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {open && children.length > 0 ? (
        <ul className={styles.children}>
          {children.map((child) => (
            <Branch key={child.path} node={child} depth={depth + 1} objects={objects}
              selectedObjectId={selectedObjectId} onObjectSelect={onObjectSelect}
              pagePaths={pagePaths} visiblePaths={visiblePaths} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function WorldDirectoryTree({ entries, objects, selectedObjectId, onObjectSelect }: Props) {
  const tree = useMemo(() => buildDirectoryTree(entries), [entries]);
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(1);
  const filterId = useId();
  const page = useMemo(() => directoryTreePage(tree, query, requestedPage), [tree, query, requestedPage]);
  // Persist the clamp when a replacement plan shrinks, so a later plan cannot restore a stale page.
  if (page.page !== requestedPage) setPage(page.page);
  const selected = objects.find((object) => object.id === selectedObjectId) ?? null;
  const selectedOnPage = selected && page.nodes.some((node) => directoryObjectBinding(node, objects)?.id === selected.id);

  if (entries.length === 0) {
    return (
      <section className={styles.empty} role="status">
        <span>READ_NOT_YET</span>
        <h3>No compiled directory plan to read</h3>
        <p>The compiled artifact for this World does not carry a directory plan.</p>
      </section>
    );
  }

  const empties = tree.filter((root) => root.children.length === 0);
  return (
    <div className={styles.tree} data-sensitive="content">
      <p className={styles.summary}>
        {tree.length} root{tree.length === 1 ? "" : "s"} · {entries.length} planned path{entries.length === 1 ? "" : "s"}
        {empties.length > 0 ? ` · ${empties.length} root${empties.length === 1 ? "" : "s"} this compile left empty` : ""}
      </p>
      <div className={styles.controls}>
        <label htmlFor={filterId}>Filter directory paths or kinds</label>
        <input id={filterId} type="search" value={query} onChange={(event) => {
          setQuery(event.target.value); setPage(1);
        }} />
      </div>
      <p className={styles.summary} role="status" aria-live="polite">
        {page.total} matching path{page.total === 1 ? "" : "s"} · Showing {page.first}–{page.last}
        {" · Includes implied folders; folder context is outside this count."}
      </p>
      {selected && !selectedOnPage ? (
        <p className={styles.selection}>Selected object: {selected.label} ({selected.id}). Its directory path is outside this page or filter.</p>
      ) : selectedObjectId && !selected ? (
        <p className={styles.selection}>Selected object {selectedObjectId} is no longer in this World.</p>
      ) : null}
      {page.total === 0 ? <p className={styles.summary}>No directory paths match this filter.</p> : (
        <ul key={JSON.stringify([query, page.page])} className={styles.root} aria-label="Compiled semantic directory">
          {tree.filter((node) => page.visiblePaths.has(node.path)).map((node) => (
            <Branch key={node.path} node={node} depth={0} objects={objects}
              selectedObjectId={selectedObjectId} onObjectSelect={onObjectSelect}
              pagePaths={page.pagePaths} visiblePaths={page.visiblePaths} />
          ))}
        </ul>
      )}
      <nav className={styles.pagination} aria-label="Directory pages">
        <button type="button" disabled={page.page === 1} onClick={() => setPage(page.page - 1)}>Previous</button>
        <span>Page {page.page} of {page.pageCount}</span>
        <button type="button" disabled={page.page === page.pageCount} onClick={() => setPage(page.page + 1)}>Next</button>
      </nav>
    </div>
  );
}
