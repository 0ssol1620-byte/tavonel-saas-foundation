"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PURPOSES, parsePurpose, type Purpose } from "@/lib/workspace-journey";
import styles from "./workspace-purpose-picker.module.css";

export const PURPOSE_KEY = "tavonel.workspace.purpose.v1";

/** Reads the stored purpose once on mount. Storage can be unavailable; the picker then works for the session. */
export function useStoredPurpose(): [Purpose | null, (purpose: Purpose) => void] {
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  useEffect(() => {
    try { setPurpose(parsePurpose(window.localStorage.getItem(PURPOSE_KEY))); } catch { /* storage unavailable */ }
  }, []);
  const choose = (next: Purpose) => {
    setPurpose(next);
    try { window.localStorage.setItem(PURPOSE_KEY, next); } catch { /* storage unavailable */ }
  };
  return [purpose, choose];
}

export default function WorkspacePurposePicker({ purpose, onPurpose }: { purpose: Purpose | null; onPurpose: (purpose: Purpose) => void }) {
  return (
    <fieldset className={styles.picker}>
      <legend>What do you want this workspace for?</legend>
      {PURPOSES.map((item) => (
        <label key={item.id}>
          <input type="radio" name="workspace-purpose" value={item.id} checked={purpose === item.id} onChange={() => onPurpose(item.id)} />
          <span>{item.label}</span>
        </label>
      ))}
      <Link href="/explore">Inspect a reference World first</Link>
    </fieldset>
  );
}
