"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

type Entry = { slug: string; title: string; group: string; summary: string; text: string };

/**
 * Search across the documentation, in the page.
 *
 * Every section is already on the client as an index built at build time -- the whole corpus is
 * a few kilobytes of prose -- so this needs no endpoint, no index service and no network round
 * trip per keystroke. It also means it works on the first keystroke rather than after one.
 *
 * Matching is substring, over the full text of each section rather than its title. Someone
 * looking for "Last-Event-ID" is looking for the paragraph that mentions it, and a title-only
 * search would tell them the documentation does not cover it.
 *
 * BA-219: it worked well and said nothing about itself. There was no shortcut hint, no shortcut,
 * and no count -- so a reader could not tell whether "bbox" matched thirty sections or two. All
 * three are here now; the shortcut is the one that needs a listener, and it is removed on unmount.
 */
export function DocsSearch({ entries }: { entries: Entry[] }) {
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const trimmed = query.trim().toLowerCase();

  const matched = useMemo(() => {
    if (trimmed.length < 2) return [];
    return entries.filter((entry) => entry.text.includes(trimmed));
  }, [entries, trimmed]);
  // The count is over every match; the list is the first eight, so the two cannot disagree.
  const results = matched.slice(0, 8);

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);

  return (
    <div className="docs-search">
      <label className="docs-search-field">
        <Search size={14} aria-hidden="true" />
        <input
          ref={field}
          type="search"
          value={query}
          placeholder="Search the documentation"
          aria-label="Search the documentation"
          onChange={(event) => setQuery(event.target.value)}
        />
        {trimmed.length >= 2
          ? <span className="docs-search-count">{matched.length} {matched.length === 1 ? "section" : "sections"}</span>
          : <kbd className="docs-search-hint" aria-hidden="true">⌘K</kbd>}
      </label>
      {trimmed.length >= 2 ? (
        <div className="docs-search-results" role="status">
          {results.length === 0 ? (
            <p className="fine">Nothing here matches “{query.trim()}”.</p>
          ) : (
            <ul>
              {results.map((entry) => (
                <li key={entry.slug}>
                  <Link href={`/docs/${entry.slug}` as Route}>
                    <strong>{entry.title}</strong>
                    <span>{entry.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
