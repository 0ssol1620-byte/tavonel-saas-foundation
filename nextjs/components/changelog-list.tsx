"use client";

import { useState } from "react";
import {
  CHANGELOG_SURFACES,
  changelogEntryId,
  changelogSections,
  type ChangelogEntry,
  type ChangelogSurface,
} from "@/lib/changelog";
import { COMPILER_RELEASE, COMPILER_RELEASE_DEFINITION } from "@/lib/compiler-release";

/**
 * The changelog, filtered by the surface a reader owns.
 *
 * Masterplan 13.3 asks for a filter, and the reason it matters is that most entries are not
 * anyone's in particular: somebody integrating against the API does not need to read three
 * website changes to find the one that breaks their client.
 *
 * Every entry is rendered on the server and hidden by the filter, not fetched — so the page has
 * its whole history without JavaScript, and the permalinks resolve whatever is selected.
 *
 * The page passes the entries in (`app/changelog/page.tsx`). Reading them here shipped the
 * whole changelog in this island's script, so every new entry raised /changelog's
 * §22 script bytes; as a prop the history travels in the server payload, which §22 does not count.
 */
export function ChangelogList({ entries }: { entries: readonly ChangelogEntry[] }) {
  const [surface, setSurface] = useState<ChangelogSurface | null>(null);
  /* The name's first mention on the page carries its definition (FINAL-SPEC-HARD-PROOF §1). */
  const firstRelease = entries.findIndex((entry) => entry.compilerRelease);

  return (
    <>
      <div className="changelog-filter" role="group" aria-label="Filter by surface">
        <button type="button" aria-pressed={surface === null} onClick={() => setSurface(null)}>All</button>
        {CHANGELOG_SURFACES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={surface === option}
            onClick={() => setSurface(surface === option ? null : option)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="stack">
        {entries.map((entry, index) => (
          <article
            className="policy-section changelog-entry"
            key={changelogEntryId(entry)}
            id={changelogEntryId(entry)}
            hidden={surface !== null && !entry.surfaces.includes(surface)}
          >
            {/* EN-0: the fragment this entry was first published under still lands here. */}
            {entry.previousId ? <span id={entry.previousId} aria-hidden="true" /> : null}
            {/*
              BQ-136. The date is the visible permalink label, and the surface chips are gone.
              The anchor is the date shown (EN-0); a corrected entry keeps its old fragment above.

              The link to an entry was a bare "#" pushed to the right-hand end of the row: a
              one-character target with an aria-label doing all the work, which a screen
              reader's link list showed as a column of hashes and a mouse could barely hit.
              The date is what a person cites an entry by, so the date is the link.

              The chips beside it printed the surfaces the entry touched in 9px tracked mono
              capitals, which is the same vocabulary the filter above the list already offers
              -- and the filter is how a reader got here. Same call as the tag lines on
              /resources: the control encodes it, so the card does not repeat it.
            */}
            <header>
              <a href={`#${changelogEntryId(entry)}`} aria-label={`${entry.date} — ${entry.title}`}>
                <time dateTime={entry.date}>
                  {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-GB", {
                    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
                  })}
                </time>
              </a>
              {/*
                BA-117, taking the audit's own alternative rather than its first choice.

                A website release does not necessarily carry a product version. Adding a version
                to every entry would invent one; deleting 2026.9.3.1 would remove the real
                version the MCP migration note tells readers to pin. The chip names only releases
                that carry a version.
              */}
              {entry.version ? <b>Release {entry.version}</b> : null}
              {entry.apiVersion ? <b>API {entry.apiVersion}</b> : null}
            </header>
            <h2>{entry.title}</h2>
            {entry.compilerRelease ? (
              <p className="fine" data-compiler-release={entry.compilerRelease}>
                {index === firstRelease ? "TAVONEL " : null}{COMPILER_RELEASE.name} ·{" "}
                <code title={COMPILER_RELEASE.digest}>{COMPILER_RELEASE.digest.slice(7, 15)}</code>
                {index === firstRelease ? <> &mdash; {COMPILER_RELEASE_DEFINITION.en}</> : null}
              </p>
            ) : null}

            {entry.breaking ? (
              <p className="changelog-breaking">
                <b>Breaking change</b>
                <span>{entry.breaking}</span>
                {entry.migration ? <span>{entry.migration}</span> : null}
              </p>
            ) : null}

            {changelogSections(entry).map(([label, items]) => (
              <div className="changelog-group" key={label}>
                <p>{label}</p>
                <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
