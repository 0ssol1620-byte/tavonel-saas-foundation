import styles from "./page-toc.module.css";

export type TocEntry = { id: string; label: string };

/**
 * A fragment identifier derived from the text it names, so a link published against it survives
 * an edit somewhere else on the page.
 *
 * Positional ids (`#block-4`) would be shorter and would silently point at a different block the
 * first time one is inserted above them, which is the failure mode a documentation anchor cannot
 * have.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The labels of one page, in order, as unique ids.
 *
 * Uniqueness is per page and by appearance order: the second "Steps 6 and 7 — Python" on a page
 * becomes `-2`. A duplicate id is worse than an ugly one -- the browser jumps to the first match
 * and the jump link for the later block is quietly wrong -- so the suffix is not optional, and a
 * label that slugifies to nothing at all (punctuation only) still gets a usable id rather than
 * an empty fragment.
 */
export function tocEntries(labels: readonly string[]): TocEntry[] {
  const used = new Map<string, number>();
  return labels.map((label) => {
    const base = slugify(label) || "section";
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return { id: seen === 1 ? base : `${base}-${seen}`, label };
  });
}

/**
 * "On this page" -- the jump list for a page long enough to need one.
 *
 * Plain anchors, no script, no scroll observer: a highlighted "current" entry needs JavaScript
 * and an IntersectionObserver to be accurate, and it is not what the list is for. Rendering
 * nothing below three entries is deliberate -- a two-item table of contents costs a screenful
 * and saves nobody a scroll.
 */
export function PageToc({ entries }: { entries: readonly TocEntry[] }) {
  if (entries.length < 3) return null;
  return (
    <nav className={styles.toc} aria-label="On this page">
      <p className={styles.title}>ON THIS PAGE</p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}><a href={`#${entry.id}`}>{entry.label}</a></li>
        ))}
      </ul>
    </nav>
  );
}

export default PageToc;
