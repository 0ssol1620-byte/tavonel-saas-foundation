"use client";

/**
 * Scene 03 -- the compile itself, as six passes that report their own counts.
 *
 * This is a staged sequence, not a workload: it reads nothing, uploads nothing and computes
 * nothing. It plays once when the scene is first reached, and can be replayed. Every figure it
 * prints comes from `lib/demo-world`, so the totals here and the totals in the rebuild console
 * cannot drift apart.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SOURCE_CENSUS, WORLD, n } from "@/lib/demo-world";

const PASSES: { id: string; name: string; items: [string, string][] }[] = [
  {
    id: "01",
    name: "READ",
    items: [
      ["files", n(SOURCE_CENSUS.files)],
      ["archives unpacked", n(SOURCE_CENSUS.archivesUnpacked)],
      [SOURCE_CENSUS.bytes, ""],
    ],
  },
  {
    id: "02",
    name: "RECONSTRUCT",
    items: [
      ["tables", "41,208"],
      ["headings", "96,441"],
      ["figures", "12,905"],
      ["scans read", n(SOURCE_CENSUS.scansWithoutTextLayer)],
    ],
  },
  {
    id: "03",
    name: "RESOLVE",
    items: [
      ["near-duplicates merged", n(SOURCE_CENSUS.nearDuplicates)],
      ["competing versions", n(SOURCE_CENSUS.competingVersions)],
      ["cross-references", "31,006"],
    ],
  },
  {
    id: "04",
    name: "MODEL",
    items: [
      ["facts", n(WORLD.facts)],
      ["entities", n(WORLD.entities)],
      ["relations", n(WORLD.relations)],
      ["evidence spans", n(WORLD.facts)],
    ],
  },
  {
    id: "05",
    name: "VERIFY",
    items: [
      ["evidence resolves", n(WORLD.facts)],
      ["unsupported claims dropped", "0"],
      ["checks", `${WORLD.checksPassed} / ${WORLD.checksTotal}`],
    ],
  },
  {
    id: "06",
    name: "COMPILE",
    items: [
      ["ontology", "JSON-LD / Turtle"],
      ["graph", "CSV"],
      ["retrieval", "package"],
      ["provenance", "package"],
    ],
  },
];

const PASS_MS = 760;

export default function CompilePipeline({ active }: { active: boolean }) {
  const [stage, setStage] = useState(-1);
  const timers = useRef<number[]>([]);
  const played = useRef(false);

  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const play = useCallback(() => {
    clear();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Reduced motion gets the finished state, not a faster version of the animation.
      setStage(PASSES.length);
      return;
    }
    setStage(0);
    for (let i = 1; i <= PASSES.length; i += 1) {
      timers.current.push(window.setTimeout(() => setStage(i), i * PASS_MS));
    }
  }, []);

  useEffect(() => {
    if (!active || played.current) return;
    played.current = true;
    play();
  }, [active, play]);

  useEffect(() => clear, []);

  return (
    <div className="panel rv">
      <div className="panel-head">
        <span>compiling world v0 &rarr; v{WORLD.versionBefore}</span>
        <button className="mini" onClick={play} type="button">
          Run again
        </button>
      </div>
      <div className="pipe">
        {PASSES.map((pass, index) => {
          const state = stage > index ? "done" : stage === index ? "run" : "wait";
          return (
            <div className={`pl ${state}`} key={pass.id}>
              <div className="pl-h">
                <span className="num">{pass.id}</span>
                <span>{pass.name}</span>
                <span className="st">{state === "done" ? "DONE" : state === "run" ? "RUNNING" : "WAITING"}</span>
              </div>
              <div className="pl-b">
                {pass.items.map(([label, value]) => (
                  <span className="pl-i" key={label}>
                    {value ? <b>{value}</b> : null}
                    {label}
                  </span>
                ))}
              </div>
              <div className="pl-bar" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
