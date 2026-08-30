"use client";

import { Cloud, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Connection = {
  connectionId: string;
  provider: "file_server" | "s3" | "r2" | "minio";
  mode: "local_agent" | "cloud_pull";
  displayName: string;
  configuration: Record<string, unknown>;
  secretReference: string | null;
  status: "pending" | "active" | "paused" | "error" | "revoked";
  cursorSha256: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
};

async function sessionToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

function providerLabel(provider: Connection["provider"]) {
  return provider === "file_server" ? "Mounted file server" : provider === "r2" ? "Cloudflare R2" : provider === "minio" ? "MinIO" : "Amazon S3";
}

export default function ConnectionsPanel() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [provider, setProvider] = useState<Connection["provider"]>("file_server");
  const [displayName, setDisplayName] = useState("");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Reading tenant-scoped connections.");

  const load = async () => {
    const token = await sessionToken();
    if (!token) {
      setNotice("Session expired. Sign in again before reading connections.");
      return;
    }
    const response = await fetch("/api/connections", { headers: { authorization: `Bearer ${token}` } });
    const json = await response.json() as { code?: string; connections?: Connection[] };
    if (!response.ok || !Array.isArray(json.connections)) {
      setNotice(`Connections could not be read (${json.code ?? response.status}). No connection state is being inferred.`);
      return;
    }
    setConnections(json.connections);
    setNotice(json.connections.length > 0 ? `${json.connections.length} durable connection(s) loaded.` : "No source system is connected yet.");
  };

  useEffect(() => { void load(); }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const token = await sessionToken();
      if (!token) {
        setNotice("Session expired. Sign in again before creating a connection.");
        return;
      }
      const cloudProvider = provider !== "file_server";
      const body = {
        provider,
        mode: "local_agent",
        displayName,
        configuration: cloudProvider ? {
          bucket,
          ...(prefix ? { prefix } : {}),
          ...(region ? { region } : {}),
        } : { rootLabel: displayName },
        secretReference: null,
      };
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json() as { code?: string; connection?: Connection };
      if (!response.ok || !json.connection) {
        setNotice(`Connection was not created (${json.code ?? response.status}). No credential values were retained.`);
        return;
      }
      setConnections((current) => [json.connection!, ...(current ?? [])]);
      setDisplayName("");
      setBucket("");
      setPrefix("");
      setRegion("");
      setNotice(`${json.connection.displayName} is pending its first signed cursor batch.`);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (connection: Connection) => {
    if (!window.confirm(`Revoke ${connection.displayName}? Existing immutable documents and worlds are retained.`)) return;
    setBusy(true);
    try {
      const token = await sessionToken();
      if (!token) {
        setNotice("Session expired. Sign in again before revoking a connection.");
        return;
      }
      const response = await fetch(`/api/connections/${connection.connectionId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({})) as { code?: string };
        setNotice(`Connection was not revoked (${json.code ?? response.status}).`);
        return;
      }
      setConnections((current) => (current ?? []).filter((item) => item.connectionId !== connection.connectionId));
      setNotice(`${connection.displayName} was revoked. Existing immutable outputs were not deleted.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="connection-studio" aria-labelledby="connections-title">
      <header className="studio-heading">
        <div>
          <p className="eyebrow">SOURCE CONNECTIONS</p>
          <h2 id="connections-title">Bring storage to the compiler without giving it a password.</h2>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()}>Refresh state</button>
      </header>
      <p className="connection-notice" role="status">{notice}</p>
      <div className="connection-layout">
        <form className="connection-form" onSubmit={create}>
          <label htmlFor="connection-name">Connection name</label>
          <input id="connection-name" required maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Patent research share" />
          <label htmlFor="connection-provider">Source type</label>
          <select id="connection-provider" value={provider} onChange={(event) => {
            const next = event.target.value as Connection["provider"];
            setProvider(next);
          }}>
            <option value="file_server">Mounted SMB / NFS / SFTP share</option>
            <option value="s3">Amazon S3</option>
            <option value="r2">Cloudflare R2</option>
            <option value="minio">MinIO</option>
          </select>
          {provider !== "file_server" ? (
            <>
              <label htmlFor="connection-bucket">Bucket</label>
              <input id="connection-bucket" required maxLength={512} value={bucket} onChange={(event) => setBucket(event.target.value)} placeholder="research-archive" />
              <label htmlFor="connection-prefix">Prefix <small>optional</small></label>
              <input id="connection-prefix" maxLength={512} value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="approved/" />
              <label htmlFor="connection-region">Region <small>optional</small></label>
              <input id="connection-region" maxLength={64} value={region} onChange={(event) => setRegion(event.target.value)} placeholder="ap-northeast-2" />
              <small className="field-help">The local agent uses your existing AWS profile, workload role, or provider environment. Credential values never enter TAVONEL.</small>
            </>
          ) : (
            <p className="field-help">Mount the share with Windows, macOS, Linux, or an SFTP filesystem. The local agent reads that mount; TAVONEL never receives the mount password.</p>
          )}
          <button type="submit" disabled={busy || !displayName.trim() || (provider !== "file_server" && !bucket.trim())}>
            {busy ? "Writing durable record..." : "Create connection"}
          </button>
        </form>
        <div className="connection-list" aria-live="polite">
          {connections === null ? <p className="world-empty">Connection state has not been read yet.</p> : null}
          {connections?.length === 0 ? <p className="world-empty">Create a connection, then use a scoped sync key with the local agent or cloud pull worker.</p> : null}
          {connections?.map((connection) => (
            <article key={connection.connectionId}>
              <span className="connection-icon" aria-hidden="true">{connection.provider === "file_server" ? <Server size={18} /> : <Cloud size={18} />}</span>
              <div>
                <div className="connection-title"><strong>{connection.displayName}</strong><span data-status={connection.status}>{connection.status}</span></div>
                <p>{providerLabel(connection.provider)} · {connection.mode === "local_agent" ? "local agent" : "managed cloud pull"}</p>
                <small>{connection.lastSyncAt ? `Last durable sync ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.lastSyncAt))}` : "Awaiting first signed cursor batch"}</small>
                <small>{connection.cursorSha256 ?? "No cursor committed"}</small>
                {connection.lastErrorCode ? <small className="connection-error">{connection.lastErrorCode}</small> : null}
              </div>
              <button type="button" className="icon-action" disabled={busy} onClick={() => void revoke(connection)} aria-label={`Revoke ${connection.displayName}`}><Trash2 size={15} /></button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
