"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { AGENT_CLIENT_LABEL_UNVERIFIED, AGENT_PROPOSAL_CONSENT } from "@/lib/agent-consent";
import { failureSentence } from "@/lib/workspace-failure-copy";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { GrantActivityRow } from "@/lib/change-proposals";
import styles from "./agent-access-panel.module.css";
import { formatDay } from "@/lib/format";

/*
  Agent access (WO-AN-6): the people-facing end of an agent grant. A person names the client, reads
  what it can and cannot do (the sentences live in lib/agent-consent, which has no imports, so this
  client file never reaches a Node built-in), creates the grant and is shown its one credential
  once. Disconnect ends it. The panel identifies a grant by its label and dates; no key prefix exists
  here. The credential lives in component state only: never in storage, a URL or a log, and gone on close.
*/

type Grant = { grantId: string; clientLabel: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null };
export type Load = { state: "loading" } | { state: "unavailable" } | { state: "ready"; grants: Grant[]; truncated: boolean; creatable: boolean };

// The one-time credential: set by a created grant, cleared by closing. Nothing else touches it.
export type Reveal = string | null;
export function revealAfter(_current: Reveal, event: { type: "created"; token: string } | { type: "close" }): Reveal {
  return event.type === "created" ? event.token : null;
}

const CREATE_REFUSED: Record<number, string> = {
  404: "Agent access is not available for this workspace.",
  402: "Agent access is not part of a free evaluation.",
};
const LABEL_MAX = 48; // the server bound (CLIENT_LABEL_MAX in lib/agent-grants.ts); the server still decides

async function api(path: string, init: RequestInit = {}) {
  const client = getSupabaseBrowserClient();
  const token = client ? (await client.auth.getSession()).data.session?.access_token ?? null : null;
  return fetch(path, { ...init, cache: "no-store", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}) } });
}

const STATE_WORD: Record<string, string> = {
  proposed: "Proposed", confirmed: "Confirmed", executed: "Done", rejected: "Rejected",
  expired: "Expired", stale: "Out of date", failed: "Failed", undone: "Undone", withdrawn: "Withdrawn",
};
const TYPE_WORD: Record<string, string> = { library_label: "Label", compile_plan: "Compile", ontology_label_patch: "Label correction" };
const ISO = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

/** One activity line, from the row alone: type, state, created, decided (UTC, so it reads the same everywhere). */
export function activityLine(row: GrantActivityRow): string {
  return `${TYPE_WORD[row.actionType] ?? "Change"} · ${STATE_WORD[row.state] ?? row.state} · proposed ${ISO(row.createdAt)} UTC`
    + (row.decidedAt ? ` · decided ${ISO(row.decidedAt)} UTC` : "") + (row.receiptAvailable ? " · signed receipt stored" : "");
}

const isActivityRow = (r: unknown): r is GrantActivityRow => Boolean(r) && typeof (r as GrantActivityRow).proposalId === "string"
  && typeof (r as GrantActivityRow).state === "string" && typeof (r as GrantActivityRow).actionType === "string"
  && Number.isFinite(Date.parse((r as GrantActivityRow).createdAt))
  && ((r as GrantActivityRow).decidedAt === null || Number.isFinite(Date.parse((r as GrantActivityRow).decidedAt as string)));

/** The listed rows as NDJSON: every row now shown (all pages read so far), in order, one object per line. */
export function activityNdjson(rows: readonly GrantActivityRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function downloadRows(rows: readonly GrantActivityRow[], filename: string) {
  const url = URL.createObjectURL(new Blob([activityNdjson(rows)], { type: "application/x-ndjson" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * What one grant's agent proposed: a page at a time, and the same rows as an NDJSON download. A malformed answer shows nothing.
 * This is the only reader of the activity route; it reads once it is mounted, which AgentAccessView does only for the grant a
 * person opened.
 */
export function GrantActivity({ grantId }: { grantId: string }) {
  const [rows, setRows] = useState<GrantActivityRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [busy, setBusy] = useState(false);
  const base = `/api/agent-grants/${encodeURIComponent(grantId)}/activity`;

  const read = useCallback(async (cursor: string | null) => {
    setBusy(true);
    try {
      const response = await api(cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base);
      const body = await response.json().catch(() => null) as { activity?: unknown[]; nextCursor?: unknown } | null;
      if (!response.ok || !body || !Array.isArray(body.activity) || !body.activity.every(isActivityRow)) { setState("unavailable"); return; }
      setRows((current) => [...(cursor ? current ?? [] : []), ...(body.activity as GrantActivityRow[])]);
      setNext(typeof body.nextCursor === "string" ? body.nextCursor : null);
      setState("ready");
    } catch {
      setState("unavailable");
    } finally {
      setBusy(false);
    }
  }, [base]);
  useEffect(() => { void read(null); }, [read]);

  if (state === "loading") return <p className={styles.muted} aria-busy="true">Reading activity…</p>;
  if (state === "unavailable") {
    return <p className={styles.muted} role="status">Activity could not be read. <button type="button" className={styles.link} onClick={() => { setState("loading"); void read(null); }}>Try again</button></p>;
  }
  return (
    <div className={styles.activity}>
      {rows && rows.length > 0 ? (
        <ul className={styles.list} aria-label="Activity">
          {rows.map((row) => <li key={row.proposalId} className={styles.activityRow}>{activityLine(row)}</li>)}
        </ul>
      ) : <p className={styles.muted}>This connection has not proposed anything.</p>}
      <div className={styles.actions}>
        {next ? <button type="button" className={styles.action} disabled={busy} onClick={() => void read(next)}>Show more</button> : null}
        {rows && rows.length > 0 ? (
          <button type="button" className={styles.action} disabled={busy}
            onClick={() => downloadRows(rows, `agent-activity-${grantId}.ndjson`)}>
            Export these rows
          </button>
        ) : null}
      </div>
    </div>
  );
}

const isGrant = (g: unknown): g is Grant => Boolean(g) && typeof (g as Grant).grantId === "string" && typeof (g as Grant).clientLabel === "string"
  && typeof (g as Grant).createdAt === "string";
/* D-18: one pinned UTC format, never the browser's locale. */
const day = (iso: string) => formatDay(iso) ?? iso;

/**
 * What GET /api/agent-grants answered. WO-REL-5: `creatable` is the server's own answer to "would a create be
 * accepted for this workspace"; anything but `true` means the offer is not shown, and the list still is.
 */
export function readGrantList(ok: boolean, body: { grants?: unknown; truncated?: unknown; creatable?: unknown } | null): Load {
  if (!ok || !body || !Array.isArray(body.grants) || !body.grants.every(isGrant)) return { state: "unavailable" };
  return { state: "ready", grants: body.grants, truncated: body.truncated === true, creatable: body.creatable === true };
}

/** The consent a person reads before Create: the five sentences and the note, with the label as the one slot. */
export function ConsentText({ label }: { label: string }) {
  const { sees, suggests, cannotChange, cannotReach, disconnect, securityNote } = AGENT_PROPOSAL_CONSENT;
  return (
    <div className={styles.consent}>
      <p>{sees(label)} <span className={styles.muted}>{AGENT_CLIENT_LABEL_UNVERIFIED}</span></p>
      <p>{suggests}</p>
      <p>{cannotChange}</p>
      <p>{cannotReach}</p>
      <p>{disconnect}</p>
      <p className={styles.muted}>{securityNote}</p>
    </div>
  );
}

/** What a create answered: a credential, a 2xx that carried none (unconfirmed, the list is read again), or a refusal. */
export function createOutcome(ok: boolean, status: number, body: { code?: string; token?: string } | null): { kind: "created"; token: string } | { kind: "unconfirmed" } | { kind: "refused"; notice: string } {
  if (ok && typeof body?.token === "string") return { kind: "created", token: body.token };
  if (ok) return { kind: "unconfirmed" };
  return { kind: "refused", notice: CREATE_REFUSED[status] ?? `The connection was not created. ${failureSentence(body?.code, status)}` };
}

const UNCONFIRMED = "The connection could not be confirmed. The list was read again and shows what was recorded.";

/** Copies to the clipboard; a browser without one, or a refusal, is "failed" and never throws. */
export async function copyCredential(text: string): Promise<"done" | "failed"> {
  try {
    if (!navigator.clipboard?.writeText) return "failed";
    await navigator.clipboard.writeText(text);
    return "done";
  } catch {
    return "failed";
  }
}

/** The credential, shown once. Renders nothing when there is none. Only the notice that one was created is announced; the token is outside every live region. */
export function TokenReveal({ token, onClose }: { token: Reveal; onClose: () => void }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  if (token === null) return null;
  return (
    <div className={styles.reveal}>
      <p role="status">A credential was created.</p>
      <strong>Copy this credential now. It will not be shown again.</strong>
      <code className={styles.token}>{token}</code>
      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={() => { void copyCredential(token).then(setCopied); }}>
          {copied === "done" ? "Copied" : "Copy credential"}
        </button>
        <button type="button" className={styles.action} onClick={onClose}>Close</button>
      </div>
      {copied === "failed" ? <p className={styles.muted}>It could not be copied. Select the text above.</p> : null}
    </div>
  );
}

export default function AgentAccessPanel() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [openActivity, setOpenActivity] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, dispatch] = useReducer(revealAfter, null as Reveal);

  const refresh = async () => {
    try {
      const response = await api("/api/agent-grants");
      const body = await response.json().catch(() => null) as { grants?: unknown; truncated?: unknown; creatable?: unknown } | null;
      setLoad(readGrantList(response.ok, body));
    } catch {
      setLoad({ state: "unavailable" });
    }
  };
  useEffect(() => { void refresh(); }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    dispatch({ type: "close" });
    try {
      const response = await api("/api/agent-grants", { method: "POST", body: JSON.stringify({ clientLabel: label }) });
      const body = await response.json().catch(() => null) as { code?: string; token?: string } | null;
      const outcome = createOutcome(response.ok, response.status, body);
      if (outcome.kind === "refused") { setNotice(outcome.notice); return; }
      if (outcome.kind === "unconfirmed") { setNotice(UNCONFIRMED); await refresh(); return; }
      dispatch({ type: "created", token: outcome.token });
      setLabel("");
      await refresh();
    } catch {
      setNotice(UNCONFIRMED);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (grant: Grant) => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await api(`/api/agent-grants/${encodeURIComponent(grant.grantId)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string } | null;
        setNotice(`“${grant.clientLabel}” was not disconnected. ${failureSentence(body?.code, response.status)}`);
      }
      await refresh();
    } catch {
      setNotice(`“${grant.clientLabel}” could not be confirmed as disconnected. The list was read again and shows what was recorded.`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AgentAccessView load={load} label={label} busy={busy} notice={notice} token={token}
      onLabel={setLabel} onCreate={create} onClose={() => dispatch({ type: "close" })}
      onDisconnect={(grant) => void disconnect(grant)} onRetry={() => void refresh()}
      openActivity={openActivity} onActivity={(grantId) => setOpenActivity((current) => (current === grantId ? null : grantId))} />
  );
}

type ViewProps = {
  load: Load; label: string; busy: boolean; notice: string | null; token: Reveal;
  onLabel: (value: string) => void; onCreate: (event: React.FormEvent) => void; onClose: () => void;
  onDisconnect: (grant: Grant) => void; onRetry: () => void;
  /** WO-AN-10: the grant whose Activity is open (one at a time), and the toggle. */
  openActivity: string | null; onActivity: (grantId: string) => void;
};

/**
 * WO-REL-5. The offer -- "Connect an agent", the consent text and the Create form -- is rendered only when the server
 * answered `creatable: true`: a workspace that POST would refuse is never shown a capability it cannot use. The list of
 * existing connections and Disconnect are rendered whatever `creatable` says: revoking is never gated. A workspace
 * with nothing to offer and nothing to disconnect renders nothing; so does a read still in flight.
 * WO-AN-10: Activity is offered on every listed grant, revoked ones included, and like Disconnect it is never gated by
 * `creatable` (its route is not behind the flag). Its read happens only once a person opens it; with no list rendered,
 * no Activity is mounted and nothing is read.
 */
export function AgentAccessView({ load, label, busy, notice, token, onLabel, onCreate, onClose, onDisconnect, onRetry, openActivity, onActivity }: ViewProps) {
  const grants = load.state === "ready" ? load.grants : [];
  const creatable = load.state === "ready" && load.creatable;
  if (load.state === "loading") return null;
  if (load.state === "ready" && !creatable && grants.length === 0 && token === null && notice === null) return null;
  return (
    <section className={styles.panel} aria-labelledby="agent-access-title">
      <h3 id="agent-access-title">Agent access</h3>
      {creatable ? <p className={styles.muted}>Connect an agent that suggests changes.</p> : null}
      {notice ? <p className={styles.problem} role="status">{notice}</p> : null}
      <TokenReveal token={token} onClose={onClose} />
      {creatable ? (
        <form className={styles.form} onSubmit={onCreate}>
          <label htmlFor="agent-client-label">Client name</label>
          <input id="agent-client-label" required maxLength={LABEL_MAX} value={label} onChange={(event) => onLabel(event.target.value)} autoComplete="off" />
          <ConsentText label={label.trim() || "This client"} />
          <button type="submit" className={styles.action} disabled={busy || !label.trim()}>Create connection</button>
        </form>
      ) : null}
      {load.state === "unavailable" ? (
        <p className={styles.muted} role="status">Connections could not be read. <button type="button" className={styles.link} onClick={onRetry}>Try again</button></p>
      ) : null}
      {load.state === "ready" && grants.length === 0 ? <p className={styles.muted}>No agent is connected.</p> : null}
      {grants.length > 0 ? (
        <ul className={styles.list} aria-label="Connected agents">
          {grants.map((grant) => (
            <li key={grant.grantId} className={styles.row} data-revoked={grant.revokedAt ? "true" : "false"}>
              <div>
                <strong>“{grant.clientLabel}”</strong> <span className={styles.muted}>{AGENT_CLIENT_LABEL_UNVERIFIED}</span>
                <p className={styles.muted}>
                  {grant.revokedAt ? `Disconnected ${day(grant.revokedAt)}` : `Connected ${day(grant.createdAt)}`}
                  {!grant.revokedAt && grant.expiresAt ? ` · expires ${day(grant.expiresAt)}` : ""}
                  {!grant.revokedAt ? (grant.lastUsedAt ? ` · last used ${day(grant.lastUsedAt)}` : " · not used yet") : ""}
                </p>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.action} aria-expanded={openActivity === grant.grantId} aria-label={`Activity of “${grant.clientLabel}”`}
                  onClick={() => onActivity(grant.grantId)}>Activity</button>
                {!grant.revokedAt ? (
                  <button type="button" className={styles.action} disabled={busy} aria-label={`Disconnect “${grant.clientLabel}”`} onClick={() => onDisconnect(grant)}>Disconnect</button>
                ) : null}
              </div>
              {openActivity === grant.grantId ? <GrantActivity grantId={grant.grantId} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {load.state === "ready" && load.truncated ? <p className={styles.muted}>Only the newest connections are listed.</p> : null}
    </section>
  );
}
