import Link from "next/link";
import type { Route } from "next";
import { DOCS_GROUPS, DOCS_SECTIONS, docsSearchIndex } from "@/lib/docs-content";
import { DocsSearch } from "@/components/docs-search";
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

  G3-009: the search box existed on /docs and on none of the twenty-three inner pages, so a
  reader who had followed a link into the reference had to go back to the index to look anything
  up. It lives here now, which puts it on every page the index is on -- one mount, not twenty-four
  insertions -- and the index it searches is the same docsSearchIndex() /docs passes.

  It is rendered once, above the desktop column, rather than inside both copies of the list: two
  mounts would mean two inputs with the same label and two Cmd-K listeners racing for focus.
*/
export function DocsToc({ current }: { current: string }) {
  const list = (
    <ul className={styles.list}>
      {DOCS_GROUPS.map((group) => (
        <li key={group}>
          <p className={styles.group}>{group}</p>
          <ul>
            {DOCS_SECTIONS.filter((section) => section.group === group).map((section) => (
              <li key={section.slug}>
                {/*
                  BQ-030. A class, so the prose-link rule does not treat this as prose.

                  app/ux-polish.css underlines `:is(p, li, dd, td) > a:not([class])` inside
                  `.scene`, which is right for a link in a sentence and wrong for a list of
                  sections: this anchor is a classless <a> inside an <li>, so it matched, and
                  the module's own `text-decoration: none` lost on specificity. Twenty-two
                  navigation entries rendered as twenty-two body links. Naming the class is
                  the fix the rule already provides for; raising specificity here would just
                  be the same argument at a higher volume.
                */}
                <Link
                  className={styles.link}
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
    <div className={styles.rail}>
      <DocsSearch entries={docsSearchIndex()} />
      <nav className={styles.column} aria-label="Documentation">{list}</nav>
      <details className={styles.disclosure}>
        <summary>Docs index</summary>
        <nav aria-label="Documentation">{list}</nav>
      </details>
    </div>
  );
}

export default DocsToc;
