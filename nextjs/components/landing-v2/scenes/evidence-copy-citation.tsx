"use client";

import { useState } from "react";
import styles from "./evidence.module.css";

/**
 * Scene 04's secondary control: the citation, on the clipboard, or a truthful refusal.
 *
 * The only client component in this scene, and the only reason it is one. The citation string is
 * assembled on the server by `buildEvidenceRecord()` out of the record's own fields, so nothing
 * here composes a sentence -- this file presses a button and reports what happened.
 *
 * NO ANALYTICS. D12 says "Copy citation (clipboard; no analytics of the text)", and there is no
 * `trackFunnel` call here at all: an event carrying the copied text would put a passage of a
 * customer's filing into a third-party analytics payload the moment this pattern is reused off
 * the public sample.
 *
 * The state resets after a moment for one reason that is not cosmetic: an `aria-live` region
 * only announces a CHANGE in its content, so a reader who copies twice would hear nothing the
 * second time if "Copied" simply stayed on screen.
 */
export default function EvidenceCopyCitation({
  citation,
  label,
  copiedLabel,
  failedLabel,
}: {
  /** The plain-text citation, built from the record's fields on the server. */
  citation: string;
  label: string;
  copiedLabel: string;
  /** What a reader must do instead when the clipboard refuses. Never "Copied". */
  failedLabel: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <>
      <button
        type="button"
        className={styles.copy}
        data-state={state}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(citation);
            setState("copied");
          } catch {
            setState("failed");
          }
          setTimeout(() => setState("idle"), 2_400);
        }}
      >
        {label}
      </button>
      <span className={styles.announce} role="status" aria-live="polite">
        {state === "copied" ? copiedLabel : state === "failed" ? failedLabel : ""}
      </span>
    </>
  );
}
