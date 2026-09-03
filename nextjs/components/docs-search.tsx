"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
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
 */
export function DocsSearch({ entries }: { entries: Entry[] }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (trimmed.length < 2) return [];
    return entries.filter((entry) => entry.text.includes(trimmed)).slice(0, 8);
  }, [entries, trimmed]);

  return (
    <div className="docs-search">
      <label className="docs-search-field">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search the documentation"
          aria-label="Search the documentation"
          onChange={(event) => setQuery(event.target.value)}
        />
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
