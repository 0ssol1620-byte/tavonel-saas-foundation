"use client";

/**
 * Scene 07 -- selective recompilation, as the compiler's own log.
 *
 * The meters below the log are the argument: the rebuilt bar is a sliver and the kept bar is
 * almost the whole width, because 42 of 128,470 facts moved. Both widths are computed from
 * `lib/demo-world`, so the picture cannot disagree with the numbers beside it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CHANGE, KEPT, REBUILT, WORLD, n } from "@/lib/demo-world";

type Tone = "" | "warn" | "hold" | "ok" | "hi";

const LINES: [string, Tone, string][] = [
  ["11:04:18", "", `new version detected - ${CHANGE.document} - v${CHANGE.revisionFrom} to v${CHANGE.revisionTo}`],
  ["11:04:18", "", `comparing ${n(CHANGE.documentFacts)} facts against version ${CHANGE.revisionFrom}`],
  ["11:04:19", "warn", `${CHANGE.changed} facts changed`],
  ["11:04:19", "hold", `${CHANGE.held} fact has two possible readings - held, not guessed`],
  ["11:04:19", "", "tracing what depends on them"],
  ["11:04:20", "hi", `${CHANGE.affected} further facts affected - ${CHANGE.documentsRegenerated} documents now out of date`],
  ["11:04:20", "ok", `${n(KEPT)} facts proven unaffected - keeping them as-is`],
  ["11:04:20", "", `rebuilding ${REBUILT} facts`],
  ["11:04:21", "", `regenerating ${CHANGE.documentsRegenerated} documents from current facts`],
  ["11:04:21", "", `draft world v${WORLD.versionAfter} assembled`],
  ["11:04:21", "", `running ${WORLD.checksTotal} checks`],
  ["11:04:22", "ok", `${WORLD.checksPassed} of ${WORLD.checksTotal} passed`],
  ["11:04:22", "ok", `v${WORLD.versionAfter} is now live - answers come from here`],
];

const LINE_MS = 210;

export default function RebuildConsole({ active }: { active: boolean }) {
  const [shown, setShown] = useState(0);
  const timers = useRef<number[]>([]);
  const played = useRef(false);

  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const play = useCallback(() => {
    clear();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(LINES.length);
      return;
    }
    setShown(0);
    for (let i = 1; i <= LINES.length; i += 1) {
      timers.current.push(window.setTimeout(() => setShown(i), i * LINE_MS));
    }
  }, []);

  useEffect(() => {
    if (!active || played.current) return;
    played.current = true;
    play();
  }, [active, play]);

  useEffect(() => clear, []);

  const finished = shown >= LINES.length;
  const rebuiltShare = (REBUILT / WORLD.facts) * 100;

  return (
    <div className="panel rv">
      <div className="panel-head">
        <span>
          rebuilding world v{WORLD.versionBefore} &rarr; v{WORLD.versionAfter}
        </span>
        <button className="mini" onClick={play} type="button">
          Run again
        </button>
      </div>
      <p className="panel-hierarchy">REBUILT · PRESERVED · HELD</p>
      <div className="log" role="log" aria-live="polite">
        {LINES.slice(0, shown).map(([time, tone, text], index) => (
          <p key={index} className={tone}>
            <span className="t">{time}</span>
            {text}
          </p>
        ))}
      </div>
      <div className="meters" data-done={finished ? 1 : 0}>
        <div className="meter">
          <span className="mk">Rebuilt</span>
          <span className="mv">{n(REBUILT)}</span>
          {/* A 0.03% bar would be invisible, so the track carries a floor. The number beside it
              is exact; the bar is there to show the ratio is small, which it truthfully is. */}
          <span className="mb">
            <i style={{ width: `${Math.max(rebuiltShare, 0.8)}%` }} data-tone="changed" />
          </span>
        </div>
        <div className="meter">
          <span className="mk">Kept, untouched</span>
          <span className="mv">{n(KEPT)}</span>
          <span className="mb">
            <i style={{ width: `${(KEPT / WORLD.facts) * 100}%` }} data-tone="verified" />
          </span>
        </div>
        <div className="meter">
          <span className="mk">Held for review</span>
          <span className="mv">{n(CHANGE.held)}</span>
          <span className="mb">
            <i style={{ width: "0.8%" }} data-tone="held" />
          </span>
        </div>
      </div>
      <p className="panel-note">
        <b>Direction</b>
        Selective recompilation is a research direction on declared fixture data.
      </p>
    </div>
  );
}
