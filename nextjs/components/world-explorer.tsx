"use client";

/**
 * The knowledge architecture, for a real compiled collection.
 *
 * This closes the largest gap between the marketing page and the product: the landing page spends
 * a whole scene showing a structured world an AI can reason about, and until now signing in
 * produced a workspace where that structure did not appear anywhere. Everything here is read from
 * the collection artifact the compiler actually returned -- the directory plan it built, the
 * ontology nodes and edges it derived, the counts it validated. Nothing is illustrative.
 *
 * That constraint is the reason for the empty state below. With no compiled collection there is
 * no architecture to show, and inventing one to fill the space would make the workspace claim
 * something the tenant does not have.
 */

import { useMemo, useState } from "react";

export interface CollectionShape {
  collectionId: string;
  artifactKey?: string;
  manifestDigest?: string;
  directoryPlan: Array<{ path: string; kind: string; sourceIds: string[] }>;
  ontology?: { nodes?: unknown[]; edges?: unknown[] };
  validation: {
    counts: {
      documents: number;
      topics: number;
      entities: number;
      claims: number;
      relations: number;
      packageFiles: number;
    };
  };
}

/** Directory roots, in the order the compiler creates them. */
const ROOT_ORDER = ["Sources", "Topics", "Entities", "Claims", "Evidence", "Assets", "MOCs", "Packages"];

export default function WorldExplorer({ collection, onUpload }: { collection: CollectionShape | null; onUpload?: () => void }) {
  const [openRoot, setOpenRoot] = useState<string | null>("Topics");

  const grouped = useMemo(() => {
    if (!collection) return [];
    const byRoot = new Map<string, { path: string; kind: string; sourceIds: string[] }[]>();
    for (const entry of collection.directoryPlan) {
      if (entry.kind === "root") continue;
      const root = entry.path.split("/")[0];
      const list = byRoot.get(root) ?? [];
      list.push(entry);
      byRoot.set(root, list);
    }
    return ROOT_ORDER.filter((root) => byRoot.has(root)).map((root) => ({
      root,
      entries: byRoot.get(root) ?? [],
    }));
  }, [collection]);

  if (!collection) {
    return (
      <section className="card">
        <p className="eyebrow">KNOWLEDGE ARCHITECTURE</p>
        <h2>Nothing compiled yet</h2>
        <p>
          When a document finishes the safety chain and a collection is compiled, its structure
          appears here: the directory the compiler built, the entities and claims it resolved, and
          the evidence each one points back at.
        </p>
        <p className="fine">
          This panel shows only what the compiler actually returned. With no compiled collection
          there is no architecture to show, and an illustrative one would be claiming a structure
          this workspace does not have.
        </p>
        {onUpload ? (
          <div className="billing-actions">
            <button type="button" onClick={onUpload}>Upload your first document</button>
          </div>
        ) : null}
      </section>
    );
  }

  const { counts } = collection.validation;
  const nodes = collection.ontology?.nodes?.length ?? 0;
  const edges = collection.ontology?.edges?.length ?? 0;

  return (
    <section className="card">
      <p className="eyebrow">KNOWLEDGE ARCHITECTURE</p>
      <h2>{collection.collectionId}</h2>

      <div className="arch-counts">
        {[
          ["Documents", counts.documents],
          ["Topics", counts.topics],
          ["Entities", counts.entities],
          ["Claims", counts.claims],
          ["Relations", counts.relations],
          ["Nodes", nodes],
          ["Edges", edges],
          ["Package files", counts.packageFiles],
        ].map(([label, value]) => (
          <div className="ac" key={String(label)}>
            <span className="ac-v">{Number(value).toLocaleString("en-US")}</span>
            <span className="ac-k">{label}</span>
          </div>
        ))}
      </div>

      <div className="tree">
        {grouped.map(({ root, entries }) => {
          const open = openRoot === root;
          return (
            <div className="tree-root" key={root} data-open={open ? 1 : 0}>
              <button type="button" onClick={() => setOpenRoot(open ? null : root)} aria-expanded={open}>
                <span className="tw">{open ? "−" : "+"}</span>
                <span className="tn">{root}</span>
                <span className="tc">{entries.length}</span>
              </button>
              {open ? (
                <ul>
                  {entries.slice(0, 40).map((entry) => (
                    <li key={entry.path}>
                      <span className="tp">{entry.path.slice(root.length + 1)}</span>
                      <span className="tk">{entry.kind}</span>
                    </li>
                  ))}
                  {entries.length > 40 ? (
                    // Never truncate silently: a list that stops without saying so reads as a
                    // complete list that happens to be short.
                    <li className="more">{(entries.length - 40).toLocaleString("en-US")} more not listed</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {collection.manifestDigest ? (
        <p className="fine">Manifest {collection.manifestDigest}</p>
      ) : null}
      <p className="fine">
        A candidate structure. Nothing here is promoted into a live world without an explicit
        human decision.
      </p>
    </section>
  );
}
