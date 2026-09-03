"use client";

import { useMemo, useState } from "react";
import type { WorldDirectoryEntry, WorldObject } from "@/lib/world-read-model";
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
function buildTree(entries: readonly WorldDirectoryEntry[]): TreeNode[] {
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

function Branch({ node, depth, objects, selectedObjectId, onObjectSelect }: {
  node: TreeNode;
  depth: number;
  objects: readonly WorldObject[];
  selectedObjectId: string | null;
  onObjectSelect: (objectId: string) => void;
}) {
  // Roots open, everything below closed: a compile of a hundred documents otherwise opens as
  // several hundred rows and the shape is the first thing lost.
  const [open, setOpen] = useState(depth === 0);
  const isLeaf = node.children.length === 0;
  /*
    A leaf is bound to a compiled object when the plan's file name is that object's id.

    Where it is not -- a root the compile emitted with nothing under it, or a package file --
    the row is still shown. An empty `Assets` folder is a fact about this World, and hiding it
    would misrepresent the compile as having produced something it did not.
  */
  const bound = isLeaf
    ? objects.find((object) => node.path.endsWith(`/${object.id}.md`) || node.path.endsWith(`/${object.id}.json`)) ?? null
    : null;

  return (
    <li className={styles.row} data-depth={Math.min(depth, 4)}>
      <div className={styles.rowHead}>
        {isLeaf ? (
          <span className={styles.leafMark} aria-hidden="true">·</span>
        ) : (
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={open}
            onClick={() => setOpen((previous) => !previous)}
          >
            {open ? "−" : "+"}
          </button>
        )}
        {bound ? (
          <button
            type="button"
            className={styles.name}
            data-selected={bound.id === selectedObjectId}
            onClick={() => onObjectSelect(bound.id)}
          >
            {node.name}
          </button>
        ) : (
          <span className={styles.name}>{node.name}</span>
        )}
        {node.kind ? <span className={styles.kind}>{node.kind}</span> : null}
        {isLeaf ? null : <span className={styles.count}>{countLeaves(node)}</span>}
        {node.sourceIds.length > 0 ? (
          <span className={styles.sources} title={node.sourceIds.join(", ")}>
            {node.sourceIds.length} source{node.sourceIds.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {open && !isLeaf ? (
        <ul className={styles.children}>
          {node.children.map((child) => (
            <Branch
              key={child.path}
              node={child}
              depth={depth + 1}
              objects={objects}
              selectedObjectId={selectedObjectId}
              onObjectSelect={onObjectSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function WorldDirectoryTree({ entries, objects, selectedObjectId, onObjectSelect }: Props) {
  const tree = useMemo(() => buildTree(entries), [entries]);

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
        {tree.length} root{tree.length === 1 ? "" : "s"} · {entries.length} planned path
        {entries.length === 1 ? "" : "s"}
        {empties.length > 0 ? ` · ${empties.length} root${empties.length === 1 ? "" : "s"} this compile left empty` : ""}
      </p>
      <ul className={styles.root} aria-label="Compiled semantic directory">
        {tree.map((node) => (
          <Branch
            key={node.path}
            node={node}
            depth={0}
            objects={objects}
            selectedObjectId={selectedObjectId}
            onObjectSelect={onObjectSelect}
          />
        ))}
      </ul>
    </div>
  );
}
