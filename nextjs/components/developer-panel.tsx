"use client";

import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DEVELOPER_SCOPES, type DeveloperScope } from "@/lib/developer-contracts";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type ApiKey = {
  keyId: string;
  name: string;
  prefix: string;
  scopes: DeveloperScope[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

async function sessionToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

export default function DeveloperPanel() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("Local compiler agent");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [scopes, setScopes] = useState<DeveloperScope[]>(["connections:read", "connections:sync", "documents:intake", "documents:read", "collections:read", "worlds:read", "ask:read"]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Reading API key inventory.");

  const load = async () => {
    const token = await sessionToken();
    if (!token) {
      setNotice("Session expired. Sign in again before reading developer access.");
      return;
    }
    const response = await fetch("/api/developer/keys", { headers: { authorization: `Bearer ${token}` } });
    const json = await response.json() as { code?: string; keys?: ApiKey[] };
    if (!response.ok || !Array.isArray(json.keys)) {
      setNotice(`API keys could not be read (${json.code ?? response.status}).`);
      return;
    }
    setKeys(json.keys);
    setNotice(json.keys.length > 0 ? `${json.keys.filter((key) => !key.revokedAt).length} active key(s).` : "No API key has been issued.");
  };

  useEffect(() => { void load(); }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setCreatedToken(null);
    setCopied(false);
    try {
      const token = await sessionToken();
      if (!token) {
        setNotice("Session expired. Sign in again before creating a key.");
        return;
      }
      const response = await fetch("/api/developer/keys", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name, scopes, expiresInDays: Number(expiresInDays) }),
      });
      const json = await response.json() as { code?: string; key?: ApiKey; token?: string };
      if (!response.ok || !json.key || !json.token) {
        setNotice(`API key was not created (${json.code ?? response.status}).`);
        return;
      }
      setKeys((current) => [json.key!, ...(current ?? [])]);
      setCreatedToken(json.token);
      setNotice(`${json.key.name} was created. Its token is visible once in this browser.`);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: ApiKey) => {
    if (!window.confirm(`Revoke ${key.name}? Clients using this key will stop immediately.`)) return;
    setBusy(true);
    try {
      const token = await sessionToken();
      if (!token) return;
      const response = await fetch(`/api/developer/keys/${key.keyId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const json = await response.json().catch(() => ({})) as { code?: string };
        setNotice(`API key was not revoked (${json.code ?? response.status}).`);
        return;
      }
      setKeys((current) => (current ?? []).map((item) => item.keyId === key.keyId ? { ...item, revokedAt: new Date().toISOString() } : item));
      if (createdToken?.includes(key.prefix)) setCreatedToken(null);
      setNotice(`${key.name} was revoked.`);
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
  };

  return (
    <section className="developer-studio" aria-labelledby="developer-title">
      <header className="studio-heading">
        <div>
          <p className="eyebrow">DEVELOPER ACCESS</p>
          <h2 id="developer-title">One scope at a time. One plaintext reveal.</h2>
        </div>
        <a href="/api/openapi" target="_blank" rel="noreferrer">OpenAPI 3.1</a>
      </header>
      <p className="connection-notice" role="status">{notice}</p>
      {createdToken ? (
        <div className="token-reveal" role="status">
          <div><strong>Store this token now.</strong><small>Only its SHA-256 digest remains on the server. Reloading this page removes the plaintext.</small></div>
          <code>{createdToken}</code>
          <button type="button" onClick={() => void copyToken()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy token"}</button>
        </div>
      ) : null}
      <div className="developer-layout">
        <form className="api-key-form" onSubmit={create}>
          <label htmlFor="key-name">Key name</label>
          <input id="key-name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          <label htmlFor="key-expiry">Expiry</label>
          <select id="key-expiry" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">365 days</option>
          </select>
          <fieldset>
            <legend>Scopes</legend>
            {DEVELOPER_SCOPES.map((scope) => (
              <label key={scope}>
                <input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} />
                <span>{scope}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={busy || !name.trim() || scopes.length === 0}>{busy ? "Hashing and recording..." : "Create scoped key"}</button>
        </form>
        <div className="developer-readout">
          <div className="developer-tools">
            <article><b>CLI</b><code>node tavonel-cli.mjs status</code><a href="/developer/tavonel-cli.mjs" download>Download zero-dependency CLI</a></article>
            <article><b>MCP</b><code>node tavonel-mcp.mjs</code><a href="/developer/tavonel-mcp.mjs" download>Download read-only MCP bridge</a></article>
            <article><b>SDK contract</b><code>Authorization: Bearer tvnl_live_...</code><a href="/developer/README.md" target="_blank" rel="noreferrer">Read setup and safety contract</a></article>
          </div>
          <div className="api-key-list" aria-live="polite">
            {keys === null ? <p className="world-empty">API key inventory has not been read yet.</p> : null}
            {keys?.length === 0 ? <p className="world-empty">Create a least-privilege key for the CLI, agent, or MCP bridge.</p> : null}
            {keys?.map((key) => (
              <article key={key.keyId} data-revoked={key.revokedAt ? "true" : "false"}>
                <KeyRound size={16} aria-hidden="true" />
                <div><strong>{key.name}</strong><small>tvnl_live_{key.prefix}_... · {key.scopes.join(" · ")}</small><small>{key.revokedAt ? "Revoked" : key.expiresAt ? `Expires ${new Intl.DateTimeFormat().format(new Date(key.expiresAt))}` : "No expiry"}{key.lastUsedAt ? ` · last used ${new Intl.DateTimeFormat().format(new Date(key.lastUsedAt))}` : " · never used"}</small></div>
                {!key.revokedAt ? <button type="button" className="icon-action" disabled={busy} onClick={() => void revoke(key)} aria-label={`Revoke ${key.name}`}><Trash2 size={15} /></button> : null}
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
