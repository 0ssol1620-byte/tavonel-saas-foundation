"use client";

import { Cloud, Link2, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { trackFunnelOnce } from "@/lib/funnel-events";
import ConnectionSyncStatus from "@/components/connection-sync-status";
import { formatTimestamp } from "@/lib/format";
import { formatElapsed } from "@/lib/review-queue";

/*
  Lag, said in both directions (audit I06).

  The panel printed the timestamp of the last durable sync, which answers "when" and not "how
  long ago" -- and "how long ago" is the question a reader actually has, because a date on its
  own reads as fresh until you work out today's. Both are printed. A connection that has never
  synced says so; it is never given a substituted time.
*/
export function describeSyncLag(lastSyncAt: string | null, now: number = Date.now()): string {
  if (!lastSyncAt) return "No durable sync has completed yet";
  const stamp = formatTimestamp(lastSyncAt);
  const at = Date.parse(lastSyncAt);
  if (stamp === null || Number.isNaN(at)) return "Last durable sync time could not be read";
  const elapsed = formatElapsed(now - at);
  return elapsed === null ? `Last durable sync ${stamp}` : `Last durable sync ${stamp} · ${elapsed} ago`;
}

/*
  A revoked scope is not a transient error, and it must not read like one.

  `reauthorization_required` means the provider withdrew the grant: no retry, no backoff and no
  amount of waiting fixes it, and the only thing that does is a person re-authorizing. The
  wording is exact about what that takes here, because re-authorizing the same account while
  the connection row still exists is refused by a unique constraint on
  (workspace, provider, provider account) -- the connection has to be disconnected first.
*/
export const REAUTHORIZATION_NOTICE =
  "Access to this source was withdrawn at the provider. Imports have stopped and will not resume on their own. "
  + "Disconnect this connection, then connect the same account again to issue a new credential.";

/**
 * What a connection status needs a person to do, or null when it needs nothing.
 *
 * Only the withdrawn-grant status gets a resolving action. `error` and `paused` are handled by
 * the per-job recovery advice the progress panel already prints, and duplicating them here
 * would put two different sentences about one problem on the same card.
 */
export function oauthConnectionAttention(status: OAuthConnection["status"]) {
  if (status !== "reauthorization_required") return null;
  return {
    label: "access withdrawn",
    notice: REAUTHORIZATION_NOTICE,
    action: "Disconnect so this account can be re-authorized",
    /* Starting an import cannot succeed without a credential, so it is not offered. */
    importDisabled: true,
  };
}

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

type OAuthProvider = "google_drive" | "dropbox" | "microsoft_graph";

type OAuthConnection = {
  oauthConnectionId: string;
  provider: OAuthProvider;
  displayName: string;
  providerAccountLabel: string | null;
  status: "active" | "reauthorization_required" | "paused" | "error" | "revoked";
  cursorSha256: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
};

type OAuthProviderState = { provider: OAuthProvider; configured: boolean };

function connectionRequest(input: string, init: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });
}

async function sessionToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

function providerLabel(provider: Connection["provider"]) {
  return provider === "file_server" ? "Mounted file server" : provider === "r2" ? "Cloudflare R2" : provider === "minio" ? "MinIO" : "Amazon S3";
}

function oauthProviderLabel(provider: OAuthProvider) {
  return provider === "google_drive" ? "Google Drive" : provider === "dropbox" ? "Dropbox" : "OneDrive / SharePoint";
}

export default function ConnectionsPanel() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [oauthConnections, setOAuthConnections] = useState<OAuthConnection[] | null>(null);
  const [oauthProviders, setOAuthProviders] = useState<OAuthProviderState[]>([]);
  const [oauthDisplayName, setOAuthDisplayName] = useState("Research Drive");
  const [provider, setProvider] = useState<Connection["provider"]>("file_server");
  const [displayName, setDisplayName] = useState("");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressRevision, setProgressRevision] = useState(0);
  const [notice, setNotice] = useState("Reading tenant-scoped connections.");
  const [readFailed, setReadFailed] = useState(false);

  const load = async (successNotice?: string) => {
    setReadFailed(false);
    try {
      const token = await sessionToken();
      if (!token) {
        setReadFailed(true);
        setNotice("Session expired. Sign in again before reading connections.");
        return;
      }
      const response = await connectionRequest("/api/connections", { headers: { authorization: `Bearer ${token}` } });
      const json = await response.json() as { code?: string; connections?: Connection[] };
      if (!response.ok || !Array.isArray(json.connections)) {
        setReadFailed(true);
        setNotice(`Connections could not be read (${json.code ?? response.status}). No connection state is being inferred.`);
        return;
      }
      setConnections(json.connections);
      const oauthResponse = await connectionRequest("/api/v1/oauth-connectors", { headers: { authorization: `Bearer ${token}` } });
      const oauthJson = await oauthResponse.json() as { code?: string; providers?: OAuthProviderState[]; connections?: OAuthConnection[] };
      if (!oauthResponse.ok || !Array.isArray(oauthJson.providers) || !Array.isArray(oauthJson.connections)) {
        setReadFailed(true);
        setNotice(`Storage connections loaded, but OAuth sources could not be read (${oauthJson.code ?? oauthResponse.status}).`);
        return;
      }
      setOAuthProviders(oauthJson.providers);
      setOAuthConnections(oauthJson.connections);
      setProgressRevision(value => value + 1);
      const total = json.connections.length + oauthJson.connections.length;
      setNotice(successNotice ?? (total > 0 ? `${total} durable connection(s) loaded.` : "No source system is connected yet."));
    } catch {
      setReadFailed(true);
      setNotice("Connection state could not be refreshed. Any displayed connections are the last known state. Use Refresh state to try again.");
    }
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
      const response = await connectionRequest("/api/connections", {
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
    } catch {
      setNotice("The create request could not be confirmed. Refresh state before trying again; the connection may already have been created.");
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
      const response = await connectionRequest(`/api/connections/${connection.connectionId}`, {
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
    } catch {
      setNotice("The revoke request could not be confirmed. Refresh state to check whether the connection was revoked.");
    } finally {
      setBusy(false);
    }
  };

  const connectOAuth = async (provider: OAuthProvider) => {
    const name = oauthDisplayName.trim();
    if (!name) {
      setNotice("Give the OAuth source a connection name before continuing.");
      return;
    }
    setBusy(true);
    try {
      const token = await sessionToken();
      if (!token) {
        setNotice("Session expired. Sign in again before connecting a source.");
        return;
      }
      const response = await connectionRequest("/api/v1/oauth-connectors/authorize", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ provider, displayName: name }),
      });
      const json = await response.json() as { code?: string; authorizationUrl?: string };
      if (!response.ok || typeof json.authorizationUrl !== "string") {
        setNotice(`OAuth connection could not start (${json.code ?? response.status}).`);
        return;
      }
      window.location.assign(json.authorizationUrl);
    } catch {
      setNotice("The authorization page could not be opened. Try connecting the source again.");
    } finally {
      setBusy(false);
    }
  };

  const revokeOAuth = async (connection: OAuthConnection) => {
    if (!window.confirm(`Revoke ${connection.displayName}? Existing immutable documents and worlds are retained.`)) return;
    setBusy(true);
    try {
      const token = await sessionToken();
      if (!token) {
        setNotice("Session expired. Sign in again before revoking a connection.");
        return;
      }
      const response = await connectionRequest(`/api/v1/oauth-connectors/connections/${connection.oauthConnectionId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({})) as { code?: string };
        setNotice(`OAuth connection was not revoked (${json.code ?? response.status}).`);
        return;
      }
      setOAuthConnections((current) => (current ?? []).filter((item) => item.oauthConnectionId !== connection.oauthConnectionId));
      setNotice(`${connection.displayName} was revoked. Existing immutable outputs were not deleted.`);
    } catch {
      setNotice("The revoke request could not be confirmed. Refresh state to check whether the connection was revoked.");
    } finally {
      setBusy(false);
    }
  };

  // Starts a bulk import and reports progress from the job instead of waiting for the whole
  // thing in one request. The old pair of buttons ("Scan metadata" / "Scan & import 1 file")
  // existed because the endpoint physically could not do more inside one invocation -- the
  // server refused maxImports > 3. Importing a real corpus is now a job, so the browser
  // starts it and watches it rather than holding a connection open.
  const startImport = async (connection: OAuthConnection) => {
    setBusy(true);
    try {
      const token = await sessionToken();
      if (!token) {
        setNotice("Session expired. Sign in again before importing a source.");
        return;
      }
      const response = await connectionRequest(`/api/v1/oauth-connectors/connections/${connection.oauthConnectionId}/sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await response.json().catch(() => ({})) as { code?: string; jobId?: string; started?: boolean };
      if (!response.ok || typeof json.jobId !== "string") {
        setNotice(json.code === "JOB_SYNC_CONFLICT"
          ? "Another target or an older import is already running for this connection. Review its progress before starting a new import."
          : json.code === "INTAKE_DISABLED" ? "Document imports are currently paused. Existing workspace results remain available."
          : `Import could not be started (${json.code ?? response.status}).`);
        return;
      }
      // A connector import is the other way a first source arrives, and it counts the same.
      trackFunnelOnce("workspace_first_source_added", { mode: "connector" });
      // started === false means an identical import was already in flight and this request
      // joined it. Saying so beats showing a second "started" message for one job.
      await load(json.started
        ? `${connection.displayName}: import queued. It continues in the background, so you can leave this page.`
        : `${connection.displayName}: an import is already running. Showing its progress.`);
    } catch {
      setProgressRevision(value => value + 1);
      setNotice("The import request could not be confirmed. Check import progress before trying again; the job may already be running.");
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
      <div className="connection-form">
        <label htmlFor="oauth-connection-name">Cloud connection name</label>
        <input id="oauth-connection-name" required maxLength={100} value={oauthDisplayName} onChange={(event) => setOAuthDisplayName(event.target.value)} placeholder="Research Drive" />
        <p className="field-help">TAVONEL requests read-only access and stores refresh credentials only in the encrypted secret broker. Disconnecting removes the broker credential.</p>
        {oauthProviders.map((item) => (
          <button key={item.provider} type="button" disabled={busy || !item.configured || !oauthDisplayName.trim()} onClick={() => void connectOAuth(item.provider)}>
            {item.configured ? `Connect ${oauthProviderLabel(item.provider)}` : `${oauthProviderLabel(item.provider)} not configured`}
          </button>
        ))}
        {oauthProviders.length === 0 ? <p className="field-help">{readFailed ? "Provider availability could not be confirmed. Refresh state to retry." : "Reading OAuth provider availability."}</p> : null}
      </div>
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
            <p className="field-help">Mount the share with Windows, macOS, Linux, or an SFTP filesystem. The local agent reads that mount; TAVONEL never receives the mount password. <a href="/developer/tavonel-source-agent.py" download>Download source agent</a>.</p>
          )}
          <button type="submit" disabled={busy || !displayName.trim() || (provider !== "file_server" && !bucket.trim())}>
            {busy ? "Writing durable record..." : "Create connection"}
          </button>
        </form>
        <div className="connection-list" aria-live="polite">
          {connections === null || oauthConnections === null ? <p className="world-empty">Connection state has not been read yet.</p> : null}
          {connections?.length === 0 && oauthConnections?.length === 0 ? <p className="world-empty">Create a connection, then use OAuth or a scoped sync key with the local source agent.</p> : null}
          {oauthConnections?.map((connection) => {
            const attention = oauthConnectionAttention(connection.status);
            return (
            <article key={connection.oauthConnectionId} data-status={connection.status}>
              <span className="connection-icon" aria-hidden="true"><Link2 size={18} /></span>
              <div>
                <div className="connection-title"><strong>{connection.displayName}</strong><span data-status={connection.status}>{attention?.label ?? connection.status}</span></div>
                <p>{oauthProviderLabel(connection.provider)} · encrypted OAuth</p>
                <small>{connection.providerAccountLabel ?? "Provider account connected"}</small>
                <small>{describeSyncLag(connection.lastSyncAt)}</small>
                {attention ? (
                  <>
                    <p className="fine held" role="alert">{attention.notice}</p>
                    <button type="button" disabled={busy} onClick={() => void revokeOAuth(connection)}>{attention.action}</button>
                  </>
                ) : null}
                {connection.lastErrorCode ? <small className="connection-error">{connection.lastErrorCode}</small> : null}
                <button type="button" disabled={busy || attention?.importDisabled} onClick={() => void startImport(connection)}>Import this source</button>
                <ConnectionSyncStatus connectionId={connection.oauthConnectionId} revision={progressRevision} getToken={sessionToken} />
              </div>
              <button type="button" className="icon-action" disabled={busy} onClick={() => void revokeOAuth(connection)} aria-label={`Revoke ${connection.displayName}`}><Trash2 size={15} /></button>
            </article>
            );
          })}
          {connections?.map((connection) => (
            <article key={connection.connectionId}>
              <span className="connection-icon" aria-hidden="true">{connection.provider === "file_server" ? <Server size={18} /> : <Cloud size={18} />}</span>
              <div>
                <div className="connection-title"><strong>{connection.displayName}</strong><span data-status={connection.status}>{connection.status}</span></div>
                <p>{providerLabel(connection.provider)} · {connection.mode === "local_agent" ? "local agent" : "managed cloud pull"}</p>
                <small><code>{connection.connectionId}</code></small>
                <small>{describeSyncLag(connection.lastSyncAt)}</small>
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
