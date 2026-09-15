"use client";

import { useEffect, useState } from "react";

/*
  G2-040 / G2-041. Two findings, one cause.

  The two-column document template puts the H1 in a 480px left column and the whole document in
  the right rail, so on a long page -- /status was measured at 2,300px of it -- the left column is
  empty from the H1 down. On a phone the same document is one unbroken scroll: /security measured
  8,007 CSS px, roughly twenty-five screens, with no way to reach a section except by thumb.

  A table of contents fixes both, and the sections it needs already exist: every one of these
  pages writes `<h2>`s inside `.policy-copy`. So the index is read from the rendered document
  rather than declared a second time in five page files -- there is no list to keep in step, and a
  page that adds a section gets a jump link for it in the same commit.

  It is a client component for that one reason and does nothing else on the client: it reads the
  headings once after mount, gives each an id if the author did not, and renders links. A reader
  with scripting off loses a navigation aid and no content, which is the right side to fail on.
*/
type Entry = { id: string; text: string };

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";

export default function PolicyJumpIndex() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    /*
      `h2` where the document has them, `h3` where it does not. /status writes its three sections
      as `h3` under an `h1` and /subprocessors has a single `h2` over an `h3` list -- a heading
      level is that page's to fix, and until it is, an index keyed only to `h2` silently skips the
      longest page in the set. The two levels are never mixed: whichever one the document actually
      sections on is the one the index is built from.
    */
    const level2 = Array.from(document.querySelectorAll<HTMLElement>(".policy-copy h2"));
    const headings = level2.length >= 3
      ? level2
      : Array.from(document.querySelectorAll<HTMLElement>(".policy-copy h3"));
    const used = new Set<string>();
    const found = headings.flatMap((heading) => {
      const text = (heading.textContent ?? "").trim();
      if (!text) return [];
      if (!heading.id) {
        let id = slug(text);
        let suffix = 2;
        while (used.has(id) || document.getElementById(id)) id = `${slug(text)}-${suffix++}`;
        heading.id = id;
      }
      used.add(heading.id);
      return [{ id: heading.id, text }];
    });
    // Two headings are a heading pair, not a document that needs an index.
    setEntries(found.length >= 3 ? found : []);
  }, []);

  if (entries.length === 0) return null;

  return (
    <nav className="policy-jump" aria-label="On this page">
      <p className="policy-jump-title">On this page</p>
      <ol>
        {entries.map((entry) => (
          <li key={entry.id}><a href={`#${entry.id}`}>{entry.text}</a></li>
        ))}
      </ol>
    </nav>
  );
}
