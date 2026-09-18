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
            {/*
              BQ-136. The date is the permalink, and the surface chips are gone.

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
              <a href={`#${entry.date}`}>
                <time dateTime={entry.date}>
                  {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-GB", {
                    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
                  })}
                </time>
              </a>
              {/*
                BA-117, taking the audit's own alternative rather than its first choice.

                It asks for a version chip on every entry or none, because one of three reads
                as accidental versioning. Neither is available honestly: two of the three
                changes were not releases and carry no version, so putting a number on them
                would invent one, and deleting 2026.9.3.1 would remove a real fact the
                migration note beside it tells the reader to pin. So the chip says what it is.
              */}
              {entry.version ? <b>Release {entry.version}</b> : null}
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
