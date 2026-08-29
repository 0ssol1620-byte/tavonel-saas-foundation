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

import { useEffect, useMemo, useRef, useState } from "react";

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

/**
 * What each compile pass produced, counted from the plan it actually returned.
 *
 * The landing page spends a scene on six passes and the workspace never mentioned them again.
 * This closes that, and it closes it with the one honest material available: the compiler is a
 * pure function that finishes in single-digit milliseconds -- measured, not assumed -- so there
 * is no pass-by-pass progress to stream. Animating six steps over a 10ms function would be the
 * fixture staging from the marketing page smuggled into the product.
 *
 * So the passes are reported by their output instead of their duration. Every number below is a
 * count of entries the compiler put in the directory plan.
 */
const PASSES: Array<{ id: string; name: string; kinds: string[] }> = [
  { id: "01", name: "Read", kinds: ["document"] },
  { id: "02", name: "Bind evidence", kinds: ["evidence"] },
  { id: "03", name: "Derive topics", kinds: ["topic"] },
  { id: "04", name: "Resolve entities", kinds: ["entity"] },
  { id: "05", name: "Extract claims", kinds: ["claim"] },
  { id: "06", name: "Package", kinds: ["map-of-content", "package"] },
];

function CompilePasses({ collection }: { collection: CollectionShape }) {
  const byKind = new Map<string, number>();
  for (const entry of collection.directoryPlan) {
    if (entry.kind === "root") continue;
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  }
  return (
    <div className="passes">
      {PASSES.map((pass) => {
        const produced = pass.kinds.reduce((total, kind) => total + (byKind.get(kind) ?? 0), 0);
        return (
          <div className="pass" key={pass.id} data-empty={produced === 0 ? 1 : 0}>
            <span className="pass-i">{pass.id}</span>
            <span className="pass-n">{pass.name}</span>
            {/* A pass that produced nothing says so rather than being hidden. An absent row
                would read as a pass that did not run. */}
            <span className="pass-v">{produced === 0 ? "none" : produced.toLocaleString("en-US")}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function WorldExplorer({ collection, onUpload }: { collection: CollectionShape | null; onUpload?: () => void }) {
  const [openRoot, setOpenRoot] = useState<string | null>("Topics");
  /**
   * How many roots are on screen.
   *
   * The compiler builds these in a fixed order and the plan records it, so revealing them one at
   * a time is showing the order the structure was actually created in -- not a decorative delay
   * bolted onto a finished result. It runs once per collection, it never gates anything (every
   * root is present in the DOM within a second), and a visitor who does not want it gets the
   * whole tree immediately: the reveal is skipped entirely under reduced motion.
   */
  const [revealed, setRevealed] = useState(0);
  const revealedFor = useRef<string | null>(null);

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

  useEffect(() => {
    const id = collection?.collectionId ?? null;
    if (!id || grouped.length === 0) return;
    if (revealedFor.current === id) return;
    revealedFor.current = id;

    const reduce = typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setRevealed(grouped.length);
      return;
    }
    setRevealed(1);
    const timers = grouped.map((_, index) =>
      window.setTimeout(() => setRevealed((current) => Math.max(current, index + 1)), index * 110));
    return () => timers.forEach(window.clearTimeout);
  }, [collection?.collectionId, grouped]);

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
      {/* An id and a digest are single unbreakable words. Marked so they wrap instead of
          pushing the whole page sideways on a phone. */}
      <h2 className="id">{collection.collectionId}</h2>

      {/* Six passes, reported by what they produced. See the note on PASSES above for why this
          is a result and not a progress display. */}
      <p className="eyebrow">SIX PASSES</p>
      <CompilePasses collection={collection} />

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
        {grouped.map(({ root, entries }, index) => {
          const open = openRoot === root;
          return (
            <div
              className="tree-root"
              key={root}
              data-open={open ? 1 : 0}
              data-in={index < revealed ? 1 : 0}
            >
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
        <p className="fine id">Manifest {collection.manifestDigest}</p>
      ) : null}
      <p className="fine">
        A candidate structure. Nothing here is promoted into a live world without an explicit
        human decision.
      </p>
    </section>
  );
}
