"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { DocsCopyButton } from "@/components/docs-copy-button";
import { CodeTokens } from "@/components/docs/code-tokens";

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
/*
  `label` names the group, not the languages in it.

  On `/api` and in the docs a page carries many of these and the only useful name is the generic
  one, so that is the default and those routes are byte-identical. `/developers` carries exactly
  one, and it is the page's first authenticated read -- a group announced as "Request language"
  there tells a screen-reader user which control it is and not which request, which is the half
  that matters when the block is the only one on the page.
*/
export function DocsSnippet({ snippets, label = "Request language" }: {
  snippets: Array<{ language: string; label: string; body: string }>;
  label?: string;
}) {
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

  /*
    BQ-107. The roles were here and nothing implemented them.

    `role="tablist"` and `role="tab"` promise a screen-reader user that the arrow keys move
    between the tabs and that one Tab press leaves the strip. Neither was true: every tab sat in
    the tab order and no key did anything, so the markup described a control the page did not
    have. This is the roving tabindex that pattern requires -- only the selected tab is tabbable,
    Left and Right move and select, Home and End jump to the ends, and movement wraps.
  */
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next =
      step !== 0
        ? (index + step + snippets.length) % snippets.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? snippets.length - 1
            : null;
    if (next === null) return;
    event.preventDefault();
    choose(next);
    tabs.current[next]?.focus();
  };

  return (
    <figure className="docs-code">
      <figcaption>
        <span className="docs-langs" role="tablist" aria-label={label}>
          {snippets.map((snippet, index) => (
            <button
              key={snippet.language}
              ref={(node) => { tabs.current[index] = node; }}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls={`${uid}${snippet.language}`}
              tabIndex={index === active ? 0 : -1}
              onKeyDown={(event) => onTabKey(event, index)}
              onClick={() => choose(index)}
            >
              {snippet.label}
            </button>
          ))}
        </span>
        {/* BQ-137: the button names what it copies, so a reference page is not eight "Copy"s. */}
        <DocsCopyButton value={chosen.body} label={`Copy ${chosen.label}`} />
      </figcaption>
      {snippets.map((snippet, index) => (
        <pre
          key={snippet.language}
          id={`${uid}${snippet.language}`}
          role="tabpanel"
          aria-label={snippet.label}
          /*
            BQ-103: the panel scrolls sideways, so it is focusable and named. A scroll container
            with no focusable child cannot be reached from a keyboard at all, let alone scrolled.
          */
          tabIndex={index === active ? 0 : -1}
          hidden={index !== active}
        >
          <code><CodeTokens body={snippet.body} /></code>
        </pre>
      ))}
    </figure>
  );
}
