"use client";

import { useEffect, useState } from "react";
import styles from "./page-toc.module.css";
import type { TocEntry } from "./page-toc";

/**
 * The jump list, marking the section being read (BQ-104).
 *
 * It is its own file because `page-toc.tsx` also exports `slugify` and `tocEntries`, which two
 * server components call at render time. A `"use client"` directive on that module would replace
 * those exports with client references in the server bundle and the pages would fail at
 * page-data collection rather than at build -- the same trap `components/pricing-page-client.tsx`
 * documents for its FAQ array. So the helpers stay server-side and only the list crosses.
 *
 * An IntersectionObserver over the headings, and nothing else: no scroll handler and no
 * measurement per frame. The `rootMargin` pins the "being read" line just under the fixed header
 * and well above the fold, so an entry is marked when its heading reaches the top of the reading
 * area rather than when it first appears at the bottom of the window -- which would mark the
 * section after the one on screen.
 *
 * With scripting off nothing is marked and every anchor still works, which is exactly what this
 * list did before.
 */
export function PageTocList({ entries }: { entries: readonly TocEntry[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const onScreen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) onScreen.set(record.target.id, record.isIntersecting);
        // The first entry in document order that is inside the band, so scrolling up and down
        // over the same boundary lands on the same answer.
        setCurrent(entries.find((entry) => onScreen.get(entry.id))?.id ?? null);
      },
      { rootMargin: "-96px 0px -70% 0px" },
    );
    for (const entry of entries) {
      const node = document.getElementById(entry.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [entries]);

  return (
    <nav className={styles.toc} aria-label="On this page">
      {/*
        BQ-104: sentence case at the type floor. It was "ON THIS PAGE" in 9.5px tracked mono --
        under the floor, in the face reserved for machine identifiers, and shouting a label that
        is not one.
      */}
      <p className={styles.title}>On this page</p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a href={`#${entry.id}`} aria-current={entry.id === current ? "true" : undefined}>
              {entry.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default PageTocList;
