"use client";

import { useId, useRef, useState } from "react";

/**
 * A filter over a table that is already in the document (BQ-102).
 *
 * The error catalogue is 229 rows across seven tables. Finding one code meant scrolling seven
 * tables or falling back to the browser's own find, which on a stacked phone rendering matches
 * text a reader cannot see the row for.
 *
 * It filters the DOM rather than the data. The obvious implementation is a client component that
 * takes `rows` and renders the table itself; that would serialize all 229 rows into the RSC
 * payload a second time, on top of the HTML they are already in, to add a text input. So the
 * table stays server-rendered and this walks its rows and sets `hidden` -- no rows cross the
 * wire, and with scripting off the input is simply absent and every row is visible.
 *
 * `hidden` rather than `display: none` because it removes the row from the accessibility tree as
 * well as the layout, which is the point: a screen-reader user filtering to two codes should
 * hear two rows, not 229.
 */
export function DocsTableFilter({ label }: { label: string }) {
  const inputId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  const apply = (term: string) => {
    const table = container.current?.nextElementSibling;
    if (!(table instanceof HTMLElement)) return;
    const rows = table.querySelectorAll("tbody tr");
    const needle = term.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      const match = needle === "" || (row.textContent ?? "").toLowerCase().includes(needle);
      row.hidden = !match;
      if (match) visible += 1;
    }
    setShown(needle === "" ? null : visible);
  };

  return (
    <div className="docs-table-filter" ref={container}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        placeholder="Code, status or words from the row"
        onChange={(event) => apply(event.target.value)}
      />
      {/*
        The count is polite rather than assertive, and it is `null` until the reader has typed
        something: a live region that announces "229 rows" on page load is noise.
      */}
      <p className="fine" role="status">
        {shown === null ? "" : shown === 1 ? "1 row" : `${shown} rows`}
      </p>
    </div>
  );
}

export default DocsTableFilter;
