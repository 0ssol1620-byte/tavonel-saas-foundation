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

import { useEffect, useId, useMemo, useState } from "react";
import {
  collectionScope, directoryEntryIdentity, directoryGroups, directoryPage,
  initialDirectoryNavigation, matchesDirectoryFilter, navigateDirectory,
  reconcileDirectoryNavigation, selectedDirectoryEntry,
} from "../lib/world-explorer-navigation";
import styles from "./world-explorer.module.css";

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

function DirectoryBrowser({ collection }: { collection: CollectionShape }) {
  const controlsId = useId();
  const grouped = useMemo(() => directoryGroups(collection), [collection]);
  const [navigation, setNavigation] = useState(() => initialDirectoryNavigation(collection));
  const current = reconcileDirectoryNavigation(collection, navigation);
  // Adjust before rendering the new model, so a removed path cannot retarget or return later.
  if (current !== navigation) setNavigation(current);
  const selected = selectedDirectoryEntry(collection, current);
  const openEntries = grouped.find(({ root }) => root === current.openRoot)?.entries ?? [];
  const visible = directoryPage(openEntries, current.query, current.page);
  const selectedVisible = selected && visible.entries.some((entry) =>
    directoryEntryIdentity(entry) === current.selectedIdentity);
  const totalMatches = grouped.reduce((total, group) => total
    + group.entries.filter((entry) => matchesDirectoryFilter(entry, current.query)).length, 0);
  const [revealed, setRevealed] = useState(0);
  const scope = collectionScope(collection);

  // Preserve the existing once-per-collection root reveal and its reduced-motion behavior.
  useEffect(() => {
    if (grouped.length === 0) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setRevealed(grouped.length);
      return;
    }
    setRevealed(1);
    const timers = Array.from({ length: grouped.length }, (_, index) =>
      window.setTimeout(() => setRevealed((count) => Math.max(count, index + 1)), index * 110));
    return () => timers.forEach(window.clearTimeout);
  }, [scope, grouped.length]);

  const navigate = (action: Parameters<typeof navigateDirectory>[2]) =>
    setNavigation((previous) => navigateDirectory(collection, previous, action));

  return (
    <div className={styles.browser}>
      <div className={styles.filter}>
        <label htmlFor={`${controlsId}-filter`}>Filter directory entries</label>
        <input id={`${controlsId}-filter`} type="search" value={current.query}
          placeholder="Path or kind" onChange={(event) => navigate({ type: "filter", query: event.target.value })}
          aria-describedby={`${controlsId}-filter-help`} />
        <p id={`${controlsId}-filter-help`} className="fine">Matches paths or kinds across all roots.</p>
      </div>
      {grouped.length === 0 ? <p role="status">No directory entries in this collection.</p> : null}
      {grouped.length > 0 && totalMatches === 0 ? <p role="status">No directory entries match this filter.</p> : null}
      <div className="tree">
        {grouped.map(({ root, entries }, index) => {
          const open = current.openRoot === root;
          const page = directoryPage(entries, current.query, open ? current.page : 1);
          const panelId = `${controlsId}-root-${index}`;
          return (
            <div className="tree-root" key={root} data-open={open ? 1 : 0} data-in={index < revealed ? 1 : 0}>
              <button type="button" onClick={() => navigate({ type: "root", root: open ? null : root })}
                aria-expanded={open} aria-controls={panelId}>
                <span className="tw" aria-hidden="true">{open ? "−" : "+"}</span>
                <span className="tn">{root}</span>
                <span className="tc">{current.query.trim() ? `${page.total} of ${entries.length}` : entries.length}</span>
              </button>
              <div id={panelId} hidden={!open}>
                {open ? <>
                  {page.total === 0 ? <p className={styles.empty}>No entries in {root} match this filter.</p> : (
                    <ul>
                      {page.entries.map((entry) => (
                        <li key={directoryEntryIdentity(entry)} className={styles.entryRow}>
                          <button type="button" className={styles.entry} aria-pressed={current.selectedIdentity === directoryEntryIdentity(entry)}
                            onClick={() => navigate({ type: "select", entry })}>
                            <span className={styles.path}>{entry.path.startsWith(`${root}/`) ? entry.path.slice(root.length + 1) : entry.path}</span>
                            <span className={styles.kind}>{entry.kind}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <nav className={styles.pagination} aria-label={`${root} directory pages`}>
                    <button type="button" disabled={page.page === 1}
                      onClick={() => navigate({ type: "page", page: page.page - 1 })}>Previous</button>
                    <span role="status">{page.first}–{page.last} of {page.total} · Page {page.page} of {page.pageCount}</span>
                    <button type="button" disabled={page.page === page.pageCount}
                      onClick={() => navigate({ type: "page", page: page.page + 1 })}>Next</button>
                  </nav>
                </> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.selection} role="status">
        {selected ? <>
          <p className="eyebrow">Selected directory entry</p>
          <p className={styles.selectedPath}>{selected.path}</p>
          <p className="fine">{selected.kind} · {selected.sourceIds.length} source reference{selected.sourceIds.length === 1 ? "" : "s"}</p>
          {!selectedVisible ? <p className="fine">This selection is outside the current page or filter.</p> : null}
          <button type="button" onClick={() => navigate({ type: "clear" })}>Clear selection</button>
        </> : <p className="fine">Select a directory entry to keep its path in view while browsing.</p>}
      </div>
    </div>
  );
}

export default function WorldExplorer({ collection, onUpload }: { collection: CollectionShape | null; onUpload?: () => void }) {
  if (!collection) {
    return (
      <section className="card">
        <p className="eyebrow">Knowledge architecture</p>
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
      <p className="eyebrow">Knowledge architecture</p>
      {/* An id and a digest are single unbreakable words. Marked so they wrap instead of
          pushing the whole page sideways on a phone. */}
      <h2 className="id">{collection.collectionId}</h2>

      {/* Six passes, reported by what they produced. See the note on PASSES above for why this
          is a result and not a progress display. */}
      <p className="eyebrow">Six passes</p>
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

      <DirectoryBrowser key={collectionScope(collection)} collection={collection} />

      {collection.manifestDigest ? (
        <p className="fine id">Manifest {collection.manifestDigest}</p>
      ) : null}
      <p className="fine">
        This is the compiled package structure. Activation is a separate, recorded human decision.
      </p>
    </section>
  );
}
