import type { ReactNode } from "react";
import s from "./scroll-table.module.css";

/**
 * The one surface in V34 that scrolls sideways. It is a keyboard-focusable named region, so a
 * reader without a pointer can scroll it with the arrow keys, and it paints a shadow on whichever
 * edge has more to see. Everything else on a page must fit the width it is given.
 * Data in, table out: authors do not write table markup, so cell styling has one owner.
 */
export function ScrollTable({ label, caption, columns, rows, rowHeaders = true }: {
  /** The region's accessible name. */
  label: string;
  caption?: string;
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  /** The first cell of each row is its row header. */
  rowHeaders?: boolean;
}) {
  return (
    <div className={s.region} role="region" tabIndex={0} aria-label={label}>
      <table className={s.table}>
        {caption ? <caption className={s.caption}>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => <th key={column} scope="col" className={s.columnHead}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                rowHeaders && cellIndex === 0
                  ? <th key={cellIndex} scope="row" className={s.rowHead}>{cell}</th>
                  : <td key={cellIndex} className={s.cell}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
