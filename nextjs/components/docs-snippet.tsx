"use client";

import { useEffect, useId, useState } from "react";
import { DocsCopyButton } from "@/components/docs-copy-button";

/**
 * One request, in the language the reader integrates from.
 *
 * Masterplan 13.2 asks /api for curl, Python and TypeScript. Three stacked code blocks would
 * have been simpler to build and much worse to read: an endpoint reference where every entry is
 * three times as tall is one a reader scrolls past. Tabs keep the page the length it was.
 *
 * All three arrive rendered from the server -- they are generated from the OpenAPI document at
 * build time, not fetched -- so switching is a state change over content that is already here,
 * and a reader with no JavaScript still has the first one.
 *
 * G3-032: "rendered from the server" was true of the generation and not of the markup. Only the
 * chosen panel was in the HTML, so a crawler, an agent reading the raw page, or a reader with
 * JavaScript off saw one language of three on a page whose whole point is that it has three.
 * Every panel is in the document now and the inactive ones are hidden with the `hidden`
 * attribute, which removes them from the accessibility tree and from the rendered text while
 * leaving them in the source. The cost is two extra <pre> elements per block; the alternative
 * was a page that told two thirds of its readers less than it had.
 *
 * BA-189: the choice is remembered, per reader, across every snippet on the page and the next.
 * A quickstart with two tab groups and a reference page with one per endpoint would otherwise ask
 * a TypeScript reader to pick TypeScript once per block. It is a per-browser convenience and
 * nothing depends on it, so every access is guarded: a private window, blocked site data or a
 * thumbnail capture throws on the accessor itself, and the component must still render.
 */
const LANGUAGE_KEY = "tavonel-docs-language";
export function DocsSnippet({ snippets }: { snippets: Array<{ language: string; label: string; body: string }> }) {
  /*
    The server renders index 0, and the stored choice is applied after mount rather than during
    the first render: reading storage while rendering would make the server's HTML and the
    client's first pass disagree.
  */
  const [active, setActive] = useState(0);
  // A page carries several snippet groups; ids must be unique per group or the tab/panel pairing is ambiguous.
  const uid = useId();
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANGUAGE_KEY);
      const index = snippets.findIndex((snippet) => snippet.label === saved);
      if (index > 0) setActive(index);
    } catch {
      /* No stored preference is available. The server's choice stands. */
    }
  }, [snippets]);

  const choose = (index: number) => {
    setActive(index);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, snippets[index]!.label);
    } catch {
      /* The tab still switches; it is only the memory of it that is unavailable. */
    }
  };

  const chosen = snippets[active] ?? snippets[0]!;

  return (
    <figure className="docs-code">
      <figcaption>
        <span className="docs-langs" role="tablist" aria-label="Request language">
          {snippets.map((snippet, index) => (
            <button
              key={snippet.language}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls={`${uid}${snippet.language}`}
              onClick={() => choose(index)}
            >
              {snippet.label}
            </button>
          ))}
        </span>
        <DocsCopyButton value={chosen.body} />
      </figcaption>
      {snippets.map((snippet, index) => (
        <pre
          key={snippet.language}
          id={`${uid}${snippet.language}`}
          role="tabpanel"
          aria-label={snippet.label}
          hidden={index !== active}
        >
          <code>{snippet.body}</code>
        </pre>
      ))}
    </figure>
  );
}
