"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { WALKTHROUGH_LABEL, WALKTHROUGH_STEPS } from "@/lib/v34/walkthrough";
import styles from "./walkthrough.module.css";

const COUNT = WALKTHROUGH_STEPS.length;
const pad = (i: number) => String(i + 1).padStart(2, "0");

/**
 * Four-step reference walkthrough as an accessible tabs pattern. The server renders every
 * panel; the tab strip and the hiding of inactive panels arrive only after hydration, so without
 * JS the four steps read as stacked panels. No autoplay and no timers.
 */
export function Walkthrough({ onStepChange }: { onStepChange?: (index: number) => void }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setReady(true), []);

  const go = (index: number, focus = false) => {
    const next = (index + COUNT) % COUNT;
    setActive(next);
    onStepChange?.(next);
    if (focus) tabs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? active + 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? active - 1
      : event.key === "Home" ? 0
      : event.key === "End" ? COUNT - 1
      : null;
    if (target === null) return;
    event.preventDefault();
    go(target, true);
  };

  return (
    <div className={styles.root} data-ready={ready ? "" : undefined} data-v34-walkthrough>
      <div className={styles.bar}>
        <span className={styles.barTitle}>World / Standards</span>
        <span className={styles.barTag}>{WALKTHROUGH_LABEL}</span>
      </div>
      <div role="tablist" aria-label="Knowledge lifecycle" className={styles.tablist}>
        {WALKTHROUGH_STEPS.map((step, i) => (
          <button
            key={step.label}
            ref={(el) => { tabs.current[i] = el; }}
            id={`${id}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            className={styles.tab}
            onClick={() => go(i)}
            onKeyDown={onKeyDown}
          >
            <small className={styles.tabNo}>{pad(i)}</small>
            {step.label}
          </button>
        ))}
      </div>
      {WALKTHROUGH_STEPS.map((step, i) => (
        <section
          key={step.label}
          id={`${id}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${i}`}
          hidden={ready && i !== active}
          className={i === 0 ? styles.panel : `${styles.panel} ${styles.panelFollowing}`}
        >
          <div className={styles.copy}>
            <p className={styles.eyebrow}>{pad(i)} / {step.label}</p>
            <h3 className={styles.heading}>{step.heading}</h3>
            <p className={styles.body}>{step.body}</p>
            <button type="button" className={styles.next} onClick={() => go(i + 1, true)}>
              {step.nextLabel} →
            </button>
          </div>
          <div className={styles.record}>
            <p className={styles.kind}>{step.record.kind}</p>
            <h4 className={styles.title}>{step.record.title}</h4>
            <p className={styles.meta}>{step.record.meta}</p>
            <a className={styles.link} href={step.record.url} target="_blank" rel="noopener noreferrer">
              {step.record.linkLabel} →
            </a>
          </div>
        </section>
      ))}
    </div>
  );
}
