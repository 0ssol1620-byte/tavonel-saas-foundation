"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search } from "lucide-react";
import styles from "./docs-search.module.css";

type Chunk = { anchor: string | null; display: string };
type Entry = { slug: string; title: string; group: string; summary: string; chunks: Chunk[]; code: string };

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
  const at = text.toLowerCase().indexOf(term);
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
/**
 * The passage a query matched, and the anchor it lives under (BQ-105).
 *
 * `chunks` is split at each heading, so the first chunk carrying the term names the heading the
 * passage sits under -- which is the address a reader wants, rather than the top of a page that
 * runs to twenty screens. A term that matches only inside a snippet body has no passage to show:
 * `code` is matched and never excerpted, and the result falls back to the section summary with
 * no anchor, which is honest about what it found.
 */
function locate(entry: Entry, term: string) {
  for (const chunk of entry.chunks) {
    const hit = excerpt(chunk.display, term);
    if (hit?.match) return { hit, anchor: chunk.anchor };
  }
  return { hit: null, anchor: null };
}

export function DocsSearch({ entries }: { entries: Entry[] }) {
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const links = useRef<Array<HTMLAnchorElement | null>>([]);
  const trimmed = query.trim().toLowerCase();

  const matched = useMemo(() => {
    if (trimmed.length < 2) return [];
    return entries.filter(
      (entry) =>
        entry.code.includes(trimmed) ||
        entry.chunks.some((chunk) => chunk.display.toLowerCase().includes(trimmed)),
    );
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

  /*
    BQ-105. The results were reachable only by tabbing through every one of them from the field,
    and Escape did nothing -- so a reader who opened the panel by accident had eight extra tab
    stops between them and the rest of the page.

    Down from the field enters the list, Down and Up move inside it, Up from the first result
    returns to the field, and Escape clears the query and puts the caret back. It is the pattern
    the browser's own address bar uses, and it needs no roles beyond the ones already here: these
    are ordinary links in an ordinary list, so `aria-activedescendant` and a combobox contract
    would be describing a control this is not.
  */
  const move = (event: ReactKeyboardEvent, from: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      field.current?.focus();
      return;
    }
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    const next = from + step;
    if (next < 0) {
      event.preventDefault();
      field.current?.focus();
      return;
    }
    const target = links.current[next];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <div className="docs-search">
      <label className="docs-search-field">
        <Search size={14} aria-hidden="true" />
        {/*
          pages-15: the placeholder rendered as "Search every pag" in the 209px sidebar rail --
          the input is `flex: 1; min-width: 0` beside the search glyph, the live count and the
          ⌘K badge, so it takes whatever is left and clips its own text with no ellipsis. Two
          fewer words is the fix that cannot come back at any rail width; the full sentence is in
          the accessible name, which is what a screen reader reads out anyway.
        */}
        <input
          ref={field}
          type="search"
          value={query}
          placeholder="Search docs"
          aria-label="Search every documentation page, including page bodies"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => move(event, -1)}
        />
        {/*
          BQ-137. The live region is the count, not the result list.

          `role="status"` was on the results container, so every keystroke past two characters
          announced every matching section title and summary -- the whole panel, re-read, while
          the reader was still typing. The count is the sentence a person wants said out loud,
          it is already on screen, and it is one line. It is mounted from the start so the
          region exists before it has anything to say.
        */}
        <span className="docs-search-count" role="status">
          {trimmed.length >= 2 ? `${matched.length} ${matched.length === 1 ? "section" : "sections"}` : ""}
        </span>
        {trimmed.length >= 2 ? null : <kbd className="docs-search-hint" aria-hidden="true">⌘K</kbd>}
      </label>
      {trimmed.length >= 2 ? (
        <div className="docs-search-results">
          {results.length === 0 ? (
            <p className="fine">Nothing here matches “{query.trim()}”.</p>
          ) : (
            <ul>
              {results.map((entry, index) => {
                const { hit, anchor } = locate(entry, trimmed);
                const href = anchor ? `/docs/${entry.slug}#${anchor}` : `/docs/${entry.slug}`;
                return (
                  <li key={entry.slug}>
                    <Link
                      href={href as Route}
                      ref={(node) => { links.current[index] = node; }}
                      onKeyDown={(event) => move(event, index)}
                    >
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
