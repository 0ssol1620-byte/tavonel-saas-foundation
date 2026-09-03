"use client";

import { useState } from "react";
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
 */
export function DocsSnippet({ snippets }: { snippets: Array<{ language: string; label: string; body: string }> }) {
  const [active, setActive] = useState(0);
  const chosen = snippets[active] ?? snippets[0];

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
              onClick={() => setActive(index)}
            >
              {snippet.label}
            </button>
          ))}
        </span>
        <DocsCopyButton value={chosen.body} />
      </figcaption>
      <pre><code>{chosen.body}</code></pre>
    </figure>
  );
}
