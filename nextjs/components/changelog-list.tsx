"use client";

import { useState } from "react";
import {
  CHANGELOG_SURFACES,
  changelogEntries,
  changelogSections,
  type ChangelogSurface,
} from "@/lib/changelog";

/**
 * The changelog, filtered by the surface a reader owns.
 *
 * Masterplan 13.3 asks for a filter, and the reason it matters is that most entries are not
 * anyone's in particular: somebody integrating against the API does not need to read three
 * website changes to find the one that breaks their client.
 *
 * Every entry is rendered on the server and hidden by the filter, not fetched — so the page has
 * its whole history without JavaScript, and the permalinks resolve whatever is selected.
 */
export function ChangelogList() {
  const [surface, setSurface] = useState<ChangelogSurface | null>(null);
  const entries = changelogEntries();

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
        {entries.map((entry) => (
          <article
            className="policy-section changelog-entry"
            key={entry.date}
            id={entry.date}
            hidden={surface !== null && !entry.surfaces.includes(surface)}
          >
            <header>
              <time dateTime={entry.date}>
                {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-GB", {
                  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
                })}
              </time>
              {/*
                BA-117, taking the audit's own alternative rather than its first choice.

                It asks for a version chip on every entry or none, because one of three reads as
                accidental versioning. Neither is available honestly: two of the three changes
                were not releases and carry no version, so putting a number on them would invent
                one, and deleting 2026.9.3.1 would remove a real fact the migration note beside
                it tells the reader to pin.

                So the chip says what it is. A labelled release number on the entry that was a
                release, and silence on the two that were not, is a rule a reader can read; an
                unlabelled number on one of three is not.
              */}
              {entry.version ? <b>Release {entry.version}</b> : null}
              {entry.surfaces.map((item) => <em key={item}>{item}</em>)}
              {/* The permalink 13.3 asks for: an anchor to this entry, not to the page. */}
              <a href={`#${entry.date}`} aria-label={`Link to ${entry.title}`}>#</a>
            </header>
            <h2>{entry.title}</h2>

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
