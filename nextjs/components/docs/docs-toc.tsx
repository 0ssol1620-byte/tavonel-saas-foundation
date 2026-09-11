import Link from "next/link";
import type { Route } from "next";
import { DOCS_GROUPS, DOCS_SECTIONS } from "@/lib/docs-content";
import styles from "./docs-toc.module.css";

/*
  The documentation index, on every section page.

  What a section page had was a pager and one "All sections" link back to /docs, so reading two
  sections meant three navigations and a reader could not see where in the documentation they
  were. This is the same list /docs renders, from the same data, beside the article.

  No client JavaScript, twice over. The desktop column is a plain `<nav>`; below 1080px the same
  list is a native `<details>`, closed by default, which opens on click, Enter and Space without
  a line of script. Both renderings are in the HTML and CSS shows one of them -- `display: none`
  takes the other out of the accessibility tree, so a screen reader is offered one
  "Documentation" landmark, not two, and neither rendering carries an `id` that could collide
  with its twin.

  ponytail: two copies of one list rather than a client component that reflows at a breakpoint.
  The list is 22 links; if it grows past what a phone reader will scroll, the fix is a narrower
  disclosure per group, still with no script.
*/
export function DocsToc({ current }: { current: string }) {
  const list = (
    <ul className={styles.list}>
      {DOCS_GROUPS.map((group) => (
        <li key={group}>
          <p className={styles.group}>{group.toUpperCase()}</p>
          <ul>
            {DOCS_SECTIONS.filter((section) => section.group === group).map((section) => (
              <li key={section.slug}>
                <Link
                  href={`/docs/${section.slug}` as Route}
                  aria-current={section.slug === current ? "page" : undefined}
                >
                  {section.title}
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <nav className={styles.column} aria-label="Documentation">{list}</nav>
      <details className={styles.disclosure}>
        <summary>Docs index</summary>
        <nav aria-label="Documentation">{list}</nav>
      </details>
    </>
  );
}

export default DocsToc;
