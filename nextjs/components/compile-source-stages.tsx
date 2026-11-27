"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";
import type { CompileState } from "@/lib/compile-job-store";
import {
  freshSourceStages, readSourceStages, SOURCE_STAGE_LABEL, subscribeSourceStages, type SourceStage,
} from "@/lib/compile-source-stages";

/*
  Where each source is while the compile waits for them, in plain words.

  A view only. The stages come from the job's event stream (`sources` frames, read-only on the
  server) and are handed over by the stream reader, so this component starts no request of its
  own. It renders nothing until a frame has arrived and nothing once the sources are all read.
  "Handed to the reader" is a normal first step after a quiet period, not a fault, and is worded
  and styled as one: no alert role, no warning copy, and no promise about any single source.

  A frame older than SOURCES_STALE_MS is not shown (freshSourceStages), so when the stream stops
  delivering them the rows disappear rather than keep a stage that nothing confirms any more.
*/

const SHOWN_STATES: readonly CompileState[] = ["uploading", "sanitizing", "reading"];
const MAX_ROWS = 20;

export function CompileSourceStages({
  jobId, state, names, blockedIds = [],
}: {
  jobId: string;
  state: CompileState;
  names?: Record<string, string>;
  /** The panel's own, fresher list: a source the job has blocked is shown as needing a decision. */
  blockedIds?: readonly string[];
}) {
  const read = () => readSourceStages(jobId);
  const stored = useSyncExternalStore(subscribeSourceStages, read, read);
  // Re-check freshness while a frame is held, so an expired one is dropped without waiting for the next frame.
  const [, recheck] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    if (!stored) return undefined;
    const timer = setInterval(recheck, 5_000);
    return () => clearInterval(timer);
  }, [stored]);
  const snapshot = freshSourceStages(stored, Date.now());
  if (!SHOWN_STATES.includes(state) || !snapshot || snapshot.stages.length === 0) return null;
  const blocked = new Set(blockedIds);
  const rows = snapshot.stages.map(entry => ({
    documentId: entry.documentId,
    stage: (blocked.has(entry.documentId) && entry.stage !== "ready" ? "attention" : entry.stage) as SourceStage,
  }));
  const count = (stage: SourceStage) => rows.filter(row => row.stage === stage).length;
  const waking = count("waking") > 0;
  return (
    <div className="workspace-compile-sources">
      <p className="fine" role="status">
        {count("ready")} read · {count("waking") + count("reading")} reading · {count("queued")} waiting
        {count("attention") > 0 ? ` · ${count("attention")} need a decision` : ""}
      </p>
      {waking ? (
        <p className="fine">The reader may still be starting up. After a quiet period, the first read typically takes about 30 to 40 seconds.</p>
      ) : null}
      <ul className="fine" aria-label="Progress by source">
        {rows.slice(0, MAX_ROWS).map(row => (
          <li key={row.documentId} data-stage={row.stage}>
            <span data-sensitive="content">{names?.[row.documentId] ?? row.documentId}</span>
            {" · "}{SOURCE_STAGE_LABEL[row.stage]}
          </li>
        ))}
      </ul>
      {rows.length > MAX_ROWS ? <p className="fine">and {rows.length - MAX_ROWS} more</p> : null}
    </div>
  );
}
