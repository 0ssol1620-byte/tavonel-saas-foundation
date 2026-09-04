"use client";

import { useMemo, useState } from "react";
import type { PipelineRow } from "@/lib/pipeline";
import type { OcrProgress } from "@/lib/ocr-progress";
import ReadingView from "./reading-view";
import { displayName, type DocumentNames } from "@/lib/document-names";
import { trackFunnel } from "@/lib/funnel-events";

type Filter = "all" | "attention" | "processing" | "ready" | "failed";
function statusOf(row: PipelineRow): Exclude<Filter, "all"> { if (row.stages.some((stage) => stage.state === "failed")) return "failed"; if (row.needsPerson) return "attention"; if (row.transfer || row.stages.some((stage) => stage.state === "active")) return "processing"; return "ready"; }
function statusLabel(row: PipelineRow, reading: Record<string, OcrProgress>): string { const status = statusOf(row); if (status === "attention") return "Needs review"; if (status === "failed") return "Failed"; if (row.transfer) return "Uploading"; if (row.stages[2].state === "active") return reading[row.id]?.pagesRead ? `Reading page ${reading[row.id].pagesRead}` : "Reading"; if (row.stages[1].state === "active") return "Preparing"; if (row.stages[3].state === "active") return "Ready to compile"; if (row.stages[3].state === "done") return "Compiled"; return status === "processing" ? "Processing" : "Ready"; }

export default function PipelineBoard({ rows, reading = {}, names = {}, onDismiss }: { rows: PipelineRow[]; reading?: Record<string, OcrProgress>; names?: DocumentNames; onDismiss?: () => void }) {
  const [filter, setFilter] = useState<Filter>("attention");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  const [expandedId, setExpandedId] = useState<string | null>(() => rows.find((row) => row.stages[2].state === "active")?.id ?? null);
  const counts = useMemo(() => ({ all: rows.length, attention: rows.filter((row) => statusOf(row) === "attention").length, processing: rows.filter((row) => statusOf(row) === "processing").length, ready: rows.filter((row) => statusOf(row) === "ready").length, failed: rows.filter((row) => statusOf(row) === "failed").length }), [rows]);
  if (rows.length === 0) return null;
  const effectiveFilter: Filter = filter === "attention" && counts.attention === 0 ? "all" : filter;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = rows.filter((row) => (effectiveFilter === "all" || statusOf(row) === effectiveFilter) && (!normalizedQuery || displayName(row.id, names, row.filename).toLowerCase().includes(normalizedQuery)));
  const visible = filtered.slice(0, visibleCount);
  const selectFilter = (next: Filter) => { setFilter(next); setVisibleCount(12); setExpandedId(null); trackFunnel("source_filter_changed", { filter: next }); };

  return (
    <section className="card board board-compact" aria-label="Document processing">
      <div className="board-head board-head-compact"><div><p className="eyebrow">SOURCES</p><h2>{rows.length} sources</h2><p className="board-summary-copy">{counts.attention > 0 ? `${counts.attention} need review. Focus on exceptions first; ready sources stay collapsed.` : counts.processing > 0 ? `${counts.processing} still processing. Ready sources stay out of the way.` : "All observed sources are settled."}</p></div>{onDismiss ? <button type="button" className="board-dismiss" onClick={onDismiss}>Clear finished</button> : null}</div>
      <div className="board-metrics" aria-label="Source status summary">
        <button type="button" data-active={effectiveFilter === "attention"} onClick={() => selectFilter("attention")}><strong>{counts.attention}</strong><span>Need review</span></button>
        <button type="button" data-active={effectiveFilter === "processing"} onClick={() => selectFilter("processing")}><strong>{counts.processing}</strong><span>Processing</span></button>
        <button type="button" data-active={effectiveFilter === "ready"} onClick={() => selectFilter("ready")}><strong>{counts.ready}</strong><span>Ready</span></button>
        <button type="button" data-active={effectiveFilter === "failed"} onClick={() => selectFilter("failed")}><strong>{counts.failed}</strong><span>Failed</span></button>
      </div>
      <div className="board-toolbar"><div className="board-filters" role="group" aria-label="Filter sources"><button type="button" data-active={effectiveFilter === "all"} onClick={() => selectFilter("all")}>All {counts.all}</button><button type="button" data-active={effectiveFilter === "attention"} onClick={() => selectFilter("attention")}>Review {counts.attention}</button><button type="button" data-active={effectiveFilter === "processing"} onClick={() => selectFilter("processing")}>Processing {counts.processing}</button><button type="button" data-active={effectiveFilter === "ready"} onClick={() => selectFilter("ready")}>Ready {counts.ready}</button>{counts.failed > 0 ? <button type="button" data-active={effectiveFilter === "failed"} onClick={() => selectFilter("failed")}>Failed {counts.failed}</button> : null}</div><label className="board-search"><span className="sr-only">Search sources</span><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(12); }} placeholder="Search sources…" /></label></div>
      <div className="board-list-wrap"><ol className="board-list board-rows" aria-label={`${filtered.length} matching sources`}>
        {visible.map((row) => { const rowStatus = statusOf(row); const expanded = expandedId === row.id; const progress = reading[row.id]; return (
          <li key={row.id} data-status={rowStatus} data-document-id={row.id} data-held={row.needsPerson ? "1" : "0"}>
            <button type="button" className="board-row-summary" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : row.id)}><span className="board-row-name" data-sensitive="content">{displayName(row.id, names, row.filename)}</span><span className="board-row-status" data-status={rowStatus}>{statusLabel(row, reading)}</span><span className="board-row-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span></button>
            {row.transfer ? <div className="board-transfer compact" aria-label="Upload progress"><i style={{ width: `${row.transfer.total > 0 ? (row.transfer.loaded / row.transfer.total) * 100 : 0}%` }} /></div> : null}
            <div className="board-row-detail" hidden={!expanded}>
              {progress && row.stages[2].state === "active" ? <ReadingView progress={progress} /> : null}
              <div className="board-stages board-stages-detail">{row.stages.map((stageItem) => <div className="board-stage" key={stageItem.key} data-s={stageItem.state}><span className="board-stage-k"><i aria-hidden="true" />{stageItem.label}</span><span className="board-stage-d">{stageItem.detail || "Not started"}</span></div>)}</div>
            </div>
          </li>
        ); })}
      </ol></div>
      {filtered.length === 0 ? <div className="board-empty">No sources match this view.</div> : null}
      {filtered.length > visible.length ? <button type="button" className="board-more" onClick={() => setVisibleCount((count) => count + 12)}>Show {Math.min(12, filtered.length - visible.length)} more</button> : null}
      {counts.attention > 0 ? <p className="fine board-note">Open Review to inspect the source and choose the next action. Ready sources do not need attention.</p> : null}
    </section>
  );
}
