"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import styles from "./docs-search.module.css";

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
 * G3-010 read the deployed bundle and found `entries.filter(e => e.text.includes(q))` over
 * section titles and one-line descriptions, and reported it as "not search". Half of that was
 * right: the index has carried the full body of every section since BA-219, so a query for
 * RETRIEVAL_RUN_NOT_FOUND or Last-Event-ID does match the paragraph that mentions it. What was
 * missing is the half that makes it legible -- a result that says only "Errors — the codes a
 * client has to branch on" gives the reader no way to tell which of eight hits is theirs, so it
 * reads like a title filter whether or not it is one. Each result now carries the matched phrase
 * in its own sentence, with the term marked, and the label says what is being searched.
 *
 * Still deliberately not a service: the whole corpus is a few hundred kilobytes of prose built at
 * build time, so this needs no endpoint, no index to keep warm and no network round trip per
 * keystroke -- and it works on the first keystroke rather than after one.
 *
 * BA-219: it worked well and said nothing about itself. There was no shortcut hint, no shortcut,
 * and no count -- so a reader could not tell whether "bbox" matched thirty sections or two. All
 * three are here now; the shortcut is the one that needs a listener, and it is removed on unmount.
 */

/**
 * The sentence the match is in, with enough either side to recognise it.
 *
 * Cut at a word boundary rather than mid-token: a snippet that begins "ETRIEVAL_RUN_NOT" is
 * harder to read than one that begins a word late. The index is lower-cased for matching, so the
 * offsets are taken there and the slice is taken from the original text.
 */
function excerpt(text: string, term: string, span = 110) {
  const at = text.indexOf(term);
  if (at < 0) return null;
  const from = Math.max(0, at - Math.floor((span - term.length) / 2));
  const to = Math.min(text.length, from + span);
  const head = from > 0 ? text.slice(from).replace(/^\S*\s/, "") : text.slice(from);
  const body = head.slice(0, to - from).replace(/\s\S*$/, to < text.length ? "" : "$&");
  const start = body.toLowerCase().indexOf(term);
  if (start < 0) return { before: (from > 0 ? "…" : "") + body, match: "", after: to < text.length ? "…" : "" };
  return {
    before: (from > 0 ? "…" : "") + body.slice(0, start),
    match: body.slice(start, start + term.length),
    after: body.slice(start + term.length) + (to < text.length ? "…" : ""),
  };
}
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
          placeholder="Search every page"
          aria-label="Search every documentation page, including page bodies"
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
              {results.map((entry) => {
                const hit = excerpt(entry.text, trimmed);
                return (
                  <li key={entry.slug}>
                    <Link href={`/docs/${entry.slug}` as Route}>
                      <strong>{entry.title}</strong>
                      <span>
                        {hit && hit.match
                          ? <>{hit.before}<mark className={styles.mark}>{hit.match}</mark>{hit.after}</>
                          : entry.summary}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
