"use client";

/**
 * Identity resolution, as a staged example — not a compiler run.
 *
 * Three filenames collapse to one agreement; three spellings of a company collapse to one
 * entity. The compile scene already names RESOLVE as a pass; this is that pass, shown.
 * Declared fictional demonstration data. Reduced motion draws the finished state rather than
 * a faster animation.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const FILES = ["Agreement_FINAL.pdf", "Agreement_FINAL_v2.pdf", "Agreement_signed.pdf"] as const;

const NAMES = ["Acme Inc.", "ACME", "Acme Corporation"] as const;

const COMPLETE = 4;
const STEP_MS = 480;

export default function IdentityResolve({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);
  const played = useRef(false);

  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const play = useCallback(() => {
    clear();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(COMPLETE);
      return;
    }
    setStep(0);
    for (let i = 1; i <= COMPLETE; i += 1) {
      timers.current.push(window.setTimeout(() => setStep(i), i * STEP_MS));
    }
  }, []);

  useEffect(() => {
    if (!active || played.current) return;
    played.current = true;
    play();
  }, [active, play]);

  useEffect(() => clear, []);

  const filesIn = step >= 1;
  const filesOn = step >= 2;
  const namesIn = step >= 3;
  const namesOn = step >= 4;

  return (
    <div className="panel rv">
      <div className="panel-head">
        <span>resolving identities</span>
        <span className="right">EXAMPLE · FIXTURE</span>
        <button className="mini" onClick={play} type="button">
          Run again
        </button>
      </div>
      <div className="resolve">
        <div className="resolve-row" data-on={filesOn ? 1 : 0}>
          <div>
            <span className="resolve-k">Three filenames</span>
            <div className="resolve-aliases">
              {FILES.map((file) => (
                <span key={file} data-in={filesIn ? 1 : 0} data-tone={filesOn ? "verified" : "unused"}>
                  <i aria-hidden="true" />
                  {file}
                </span>
              ))}
            </div>
          </div>
          <span className="resolve-join" aria-hidden="true" />
          <div>
            <span className="resolve-k">One document</span>
            <div className="resolve-canon" data-in={filesOn ? 1 : 0}>
              <b>Agreement #187</b>
              <i>v1 · v2 · signed</i>
            </div>
          </div>
        </div>
        <div className="resolve-row" data-on={namesOn ? 1 : 0}>
          <div>
            <span className="resolve-k">Three names</span>
            <div className="resolve-aliases">
              {NAMES.map((name) => (
                <span key={name} data-in={namesIn ? 1 : 0} data-tone={namesOn ? "verified" : "unused"}>
                  <i aria-hidden="true" />
                  {name}
                </span>
              ))}
            </div>
          </div>
          <span className="resolve-join" aria-hidden="true" />
          <div>
            <span className="resolve-k">One entity</span>
            <div className="resolve-canon" data-in={namesOn ? 1 : 0}>
              <b>Acme Corporation</b>
              <i>resolved identity</i>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
