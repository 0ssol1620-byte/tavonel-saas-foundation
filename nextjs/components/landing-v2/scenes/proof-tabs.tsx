"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./proof.module.css";

/*
  Scene 02's tab group, and the only part of the scene that needs a browser.

  The panels arrive already rendered (`ReactNode` children built by the server component), so
  what ships to the browser is this file: three buttons, an index, and the keyboard contract.
  The excerpts, the citations and the raster sets stay on the server side of the boundary.

  ARIA: the APG tabs pattern with automatic activation. One button carries `tabIndex={0}` and the
  rest -1, so the group is one tab stop; the arrow keys move within it, Home/End jump to the
  ends, and selection follows focus -- which is right here because switching a panel costs
  nothing and shows no new tab stop. Every panel is in the DOM and `hidden` on the ones that are
  not selected, so the selected panel's link is the only reachable control in the group.

  Motion: there is none. §26 asks for no pane transition under reduced motion, and a scene whose
  swap is instant for everyone has nothing to turn off -- and nothing that can arrive late on a
  slow phone while a reader is already reading the new panel.
*/

export type ProofTabItem = { id: string; label: string; panel: ReactNode };

export default function ProofTabs({ label, tabs }: { label: string; tabs: ProofTabItem[] }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  /* Moving focus is moving the selection, so the two happen in one place. */
  const move = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setActive(next);
    buttons.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const key = event.key;
    // ArrowDown/ArrowUp are in here because the row wraps to two lines on a narrow desktop, and
    // a reader who sees a second row expects the vertical keys to reach it.
    if (key === "ArrowRight" || key === "ArrowDown") move(index + 1);
    else if (key === "ArrowLeft" || key === "ArrowUp") move(index - 1);
    else if (key === "Home") move(0);
    else if (key === "End") move(tabs.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.tablist}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${base}-tab-${index}`}
            className={styles.tab}
            aria-selected={index === active}
            aria-controls={`${base}-panel-${index}`}
            tabIndex={index === active ? 0 : -1}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            onClick={() => setActive(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            /* P3 wires `proof_claim_switch` to this hook; the scene itself tracks nothing. */
            data-analytics="proof-tab"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${index}`}
          aria-labelledby={`${base}-tab-${index}`}
          className={styles.panel}
          hidden={index !== active}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
