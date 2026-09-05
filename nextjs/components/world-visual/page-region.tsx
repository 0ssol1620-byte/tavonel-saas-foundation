"use client";

/*
  Where a region sits on its page, drawn from the region's own coordinates.

  The box is positioned from `bbox1000` -- thousandths of the page, as the compiler emitted them
  -- so it moves when the selection moves and it is wrong whenever the compiler is wrong. A
  decorative rectangle at a fixed offset would look identical on this fixture and would be the
  one thing on the page that cannot be checked, which is why the numbers are not shown here and
  the drawing is: §48 puts human meaning first and the coordinates in the technical drawer.
*/

import styles from "./world-visual.module.css";

export default function PageRegion({
  bbox1000,
  page,
  pageCount,
  tone = "verified",
}: {
  bbox1000: [number, number, number, number];
  page: number;
  pageCount: number;
  tone?: "verified" | "changed";
}) {
  const [left, top, right, bottom] = bbox1000;
  return (
    <div className={styles.pageMap} data-tone={tone}>
      <div
        className={styles.pageBox}
        style={{
          left: `${left / 10}%`,
          top: `${top / 10}%`,
          width: `${(right - left) / 10}%`,
          height: `${(bottom - top) / 10}%`,
        }}
      />
      <small>REGION ON PAGE {page} OF {pageCount}</small>
    </div>
  );
}
