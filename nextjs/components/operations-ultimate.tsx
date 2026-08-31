"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentListItem } from "@/lib/immutable-keys";
import type { PipelineRow } from "@/lib/pipeline";
import { buildOperationsSnapshot, type OperationsGate } from "@/lib/operations-view-model";
import { displayName, type DocumentNames } from "@/lib/document-names";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./operations-ultimate.module.css";

type AuditEvent = { eventId: string; action: string; targetId: string; createdAt: string; actorUserId: string | null; actorKeyId: string | null };

export default function OperationsUltimate({ mode, rows, documents, names, gates, onRefresh }: {
  mode: "runs" | "activity";
  rows: PipelineRow[];
  documents: DocumentListItem[] | null;
  names: DocumentNames;
  gates: OperationsGate[];
  onRefresh?: () => void;
}) {
  const snapshot = buildOperationsSnapshot(rows, documents, gates);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [auditState, setAuditState] = useState("NOT READ YET");
  const [streamState, setStreamState] = useState("SSE CONNECTING");
  const selectedRow = rows.find((row) => row.id === selected) ?? rows[0] ?? null;
  const refreshFromStream = useRef(onRefresh);
  useEffect(() => { refreshFromStream.current = onRefresh; }, [onRefresh]);

  const loadAudit = async () => {
    setAuditState("READING");
    const client = getSupabaseBrowserClient();
    const session = client ? await client.auth.getSession() : null;
    const token = session?.data.session?.access_token;
    if (!token) { setEvents(null); setAuditState("SESSION REQUIRED"); return; }
    try {
      const response = await fetch("/api/v1/developer/audit?limit=100", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json() as { events?: AuditEvent[]; code?: string };
      if (!response.ok || !body.events) { setEvents(null); setAuditState(body.code ?? "AUDIT UNAVAILABLE"); return; }
      setEvents(body.events);
      setAuditState(body.events.length > 0 ? "PERSISTED EVENTS" : "NO PERSISTED EVENTS");
    } catch { setEvents(null); setAuditState("AUDIT UNAVAILABLE"); }
  };

  useEffect(() => { if (mode === "activity") void loadAudit(); }, [mode]);

  useEffect(() => {
    if (mode !== "runs") return;
    const controller = new AbortController();
    const connect = async () => {
      const client = getSupabaseBrowserClient();
      const session = client ? await client.auth.getSession() : null;
      const token = session?.data.session?.access_token;
      if (!token) { setStreamState("SSE SESSION REQUIRED"); return; }
      try {
        const response = await fetch("/api/v1/runs/events", { headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" }, cache: "no-store", signal: controller.signal });
        if (!response.ok || !response.body) { setStreamState(`SSE UNAVAILABLE · ${response.status}`); return; }
        setStreamState("SSE LIVE");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let receivedSnapshot = false;
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            if (!event.startsWith("event: snapshot")) continue;
            const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
            const payload = data ? JSON.parse(data) as { documents?: unknown[] } : null;
            receivedSnapshot = true;
            setStreamState(`SSE LIVE · ${payload?.documents?.length ?? 0} SOURCES`);
            refreshFromStream.current?.();
          }
        }
        if (!controller.signal.aborted && !receivedSnapshot) setStreamState("SSE RECONNECT ON REFRESH");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStreamState("SSE UNAVAILABLE");
      }
    };
    void connect();
    return () => controller.abort();
  }, [mode]);

  if (mode === "activity") return (
    <div className={styles.root} id="workspace-activity">
      <section className={styles.activity} aria-labelledby="activity-center-title">
        <div className={styles.head}><div><p>ACTIVITY CENTER · PERSISTED AUDIT</p><h2 id="activity-center-title">What the workspace recorded.</h2></div><button className={styles.refresh} type="button" onClick={() => void loadAudit()}>Refresh audit</button></div>
        <p className={styles.clear} role="status">{auditState}. Browser-only notices are not presented as durable events.</p>
        {events && events.length > 0 ? <ol className={styles.events}>{events.map((event) => <li key={event.eventId}><strong>{event.action}</strong><span>{event.targetId}</span><time className={styles.eventMeta} dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol> : <div className={styles.empty}>No durable audit rows are available to this session. TAVONEL does not synthesize an activity timeline.</div>}
      </section>
    </div>
  );

  return (
    <div className={styles.root} id="workspace-runs">
      <section className={styles.preflight} aria-labelledby="preflight-title">
        <div className={styles.head}><div><p>PREFLIGHT · OBSERVED INPUTS</p><h2 id="preflight-title">Know the boundary before compute starts.</h2></div><output className={styles.state} data-ok={snapshot.compileEligible}>{snapshot.compileEligible ? "ELIGIBLE" : "HELD"}</output></div>
        <dl className={styles.metrics}><div><dt>SOURCES</dt><dd>{snapshot.sourceCount}</dd></div><div><dt>OCR READY</dt><dd>{snapshot.readyCount}</dd></div><div><dt>RUNNING</dt><dd>{snapshot.runningCount}</dd></div><div><dt>REVIEW</dt><dd>{snapshot.heldCount}</dd></div><div><dt>COST</dt><dd title="No compute quote has been issued">—</dd></div></dl>
        {snapshot.blockers.length > 0 ? <ul className={styles.blockers}>{snapshot.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className={styles.clear}>All observable source checks are clear. Cost remains unquoted until the server issues a compute reservation.</p>}
      </section>
      <section className={styles.theater} aria-labelledby="run-theater-title">
        <div className={styles.head}><div><p>RUN THEATER · NO ESTIMATED PROGRESS</p><h2 id="run-theater-title">Every transition requires an object or receipt.</h2></div><div><span className={styles.state}>{snapshot.nextAction}</span><span className={styles.streamState} role="status">{streamState}</span></div></div>
        {rows.length > 0 ? <div className={styles.runGrid}><ol className={styles.runList}>{rows.map((row) => <li key={row.id}><button type="button" aria-current={selectedRow?.id === row.id} onClick={() => setSelected(row.id)}><strong>{displayName(row.id, names, row.filename)}</strong><small>{row.needsPerson ? "OPERATOR REVIEW" : row.stages.find((stage) => stage.state === "active")?.label ?? "OBSERVED"}</small></button></li>)}</ol>{selectedRow ? <article className={styles.runDetail}><p className={styles.kicker}>FOCUSED RUN</p><h3>{displayName(selectedRow.id, names, selectedRow.filename)}</h3><small className={styles.eventMeta}>{selectedRow.id}</small><div className={styles.stages}>{selectedRow.stages.map((stage) => <div className={styles.stage} data-state={stage.state} key={stage.key}><b>{stage.label} · {stage.state.toUpperCase()}</b><span>{stage.detail || "No observed detail yet."}</span></div>)}</div><p className={styles.receipt}>Progress is event-derived. Completion is shown only when the corresponding immutable artifact or collection binding exists.</p></article> : null}</div> : <div className={styles.empty}>No source run has been observed. Uploading a source creates the first run record; this screen does not draw a sample run.</div>}
      </section>
    </div>
  );
}
