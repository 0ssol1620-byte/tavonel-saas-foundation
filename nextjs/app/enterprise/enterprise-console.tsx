"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Download, Fingerprint, Gauge, Globe2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type IdentityConfig = { protocol: "saml" | "scim"; storedStatus: string; effectiveStatus: string; provider: string; hasSecretReference: boolean; lastVerifiedAt: string | null; lastErrorCode: string | null };
type Policy = { retentionDays: number; deletedObjectGraceDays: number; auditRetentionDays: number; exportFormat: "jsonl" | "csv"; exportSigningRequired: boolean; legalHoldEnabled: boolean; allowedRegions: Array<"us" | "eu" | "apac">; dedicatedDeploymentRequired: boolean; rtoMinutes: number; rpoMinutes: number };
type Overview = { organization: { id: string; name: string; role: string }; workspace: { key: string; name: string; role: string | null }; identity: IdentityConfig[]; policy: Policy | null };
type Dashboard = { totals: { activeUsers: number; documentsProcessed: number; gpuSeconds: number; gpuCostUsd: number; revenueUsd: number; grossMarginUsd: number; failureRate: number; gpuCostPerDocumentUsd: number } };

const DEFAULT_POLICY: Policy = { retentionDays: 365, deletedObjectGraceDays: 30, auditRetentionDays: 2555, exportFormat: "jsonl", exportSigningRequired: true, legalHoldEnabled: false, allowedRegions: ["apac"], dedicatedDeploymentRequired: false, rtoMinutes: 240, rpoMinutes: 1440 };

async function getAccessToken() {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

async function enterpriseFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("AUTH_REQUIRED");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.code === "string" ? body.code : "ENTERPRISE_REQUEST_FAILED");
  return body;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="enterprise-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export default function EnterpriseConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const [overviewBody, dashboardBody] = await Promise.all([
        enterpriseFetch("/api/enterprise/overview"), enterpriseFetch("/api/enterprise/dashboard?days=30"),
      ]);
      const nextOverview = overviewBody as unknown as Overview;
      setOverview(nextOverview);
      setPolicy(nextOverview.policy ?? DEFAULT_POLICY);
      setDashboard(dashboardBody as unknown as Dashboard);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ENTERPRISE_LOAD_FAILED"); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, []);

  async function savePolicy() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await enterpriseFetch("/api/enterprise/policies", { method: "PUT", body: JSON.stringify(policy) });
      setNotice("Governance policy recorded. Runtime enforcement remains subject to the deployment gates below.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ENTERPRISE_POLICY_WRITE_FAILED"); setBusy(false); }
  }

  async function downloadAudit() {
    setBusy(true); setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("AUTH_REQUIRED");
      const response = await fetch(`/api/enterprise/audit/export?format=${policy.exportFormat}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { code?: string }).code ?? "AUDIT_EXPORT_FAILED");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `tavonel-audit.${policy.exportFormat}`;
      anchor.click(); URL.revokeObjectURL(blobUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AUDIT_EXPORT_FAILED"); }
    finally { setBusy(false); }
  }

  return (
    <main id="main" className="enterprise-page" tabIndex={-1}>
      <header className="enterprise-header">
        <a href="/workspace"><ArrowLeft size={15} /> Workspace</a>
        <span>TAVONEL / ENTERPRISE CONTROL PLANE</span>
        <button onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button>
      </header>

      <section className="enterprise-hero" aria-labelledby="enterprise-title">
        <p>GOVERNED OPERATIONS</p>
        <h1 id="enterprise-title">Control is a chain of recorded decisions.</h1>
        <div>
          <span>{overview?.organization.name ?? "Organization not bound"}</span>
          <span>{overview ? `ORG ROLE · ${overview.organization.role}` : "ACCESS · UNRESOLVED"}</span>
          <span>{overview ? `WORKSPACE · ${overview.workspace.name}` : "WORKSPACE · UNRESOLVED"}</span>
        </div>
      </section>

      {error ? <p className="enterprise-alert" role="alert">{error}. Access remains closed; no fallback role or sample metric was substituted.</p> : null}
      {notice ? <p className="enterprise-notice" role="status">{notice}</p> : null}

      <section className="enterprise-section" aria-labelledby="economics-title">
        <div className="enterprise-section-title"><Gauge /><div><p>30-DAY OPERATING LEDGER</p><h2 id="economics-title">Usage, GPU cost and revenue</h2></div></div>
        <div className="enterprise-metrics">
          <Metric label="Active users" value={dashboard ? String(dashboard.totals.activeUsers) : "—"} detail="maximum daily active count" />
          <Metric label="Documents" value={dashboard ? dashboard.totals.documentsProcessed.toLocaleString() : "—"} detail="completed processing volume" />
          <Metric label="GPU cost" value={dashboard ? `$${dashboard.totals.gpuCostUsd.toFixed(2)}` : "—"} detail={dashboard ? `$${dashboard.totals.gpuCostPerDocumentUsd.toFixed(4)} / document` : "ledger unavailable"} />
          <Metric label="Revenue" value={dashboard ? `$${dashboard.totals.revenueUsd.toFixed(2)}` : "—"} detail={dashboard ? `gross margin $${dashboard.totals.grossMarginUsd.toFixed(2)}` : "ledger unavailable"} />
          <Metric label="Failure rate" value={dashboard ? `${(dashboard.totals.failureRate * 100).toFixed(2)}%` : "—"} detail="failed jobs / processed documents" />
        </div>
      </section>

      <div className="enterprise-columns">
        <section className="enterprise-section" aria-labelledby="identity-title">
          <div className="enterprise-section-title"><Fingerprint /><div><p>IDENTITY BOUNDARY</p><h2 id="identity-title">SAML & SCIM</h2></div></div>
          <ul className="enterprise-status-list">
            {(["saml", "scim"] as const).map((protocol) => {
              const item = overview?.identity.find((entry) => entry.protocol === protocol);
              return <li key={protocol}><strong>{protocol.toUpperCase()}</strong><span data-status={item?.effectiveStatus ?? "closed"}>{item?.effectiveStatus ?? "NOT CONFIGURED"}</span><small>{item?.lastVerifiedAt ? `verified ${new Date(item.lastVerifiedAt).toLocaleString()}` : "Provider verification required before activation"}</small></li>;
            })}
          </ul>
          <p className="enterprise-fine"><LockKeyhole size={14} /> Secrets stay in an approved external manager. Metadata alone never activates an identity provider.</p>
        </section>

        <section className="enterprise-section" aria-labelledby="audit-title">
          <div className="enterprise-section-title"><ShieldCheck /><div><p>IMMUTABLE ADMIN HISTORY</p><h2 id="audit-title">Audit export</h2></div></div>
          <p>Exports up to 5,000 organization-scoped events for a bounded period. Database triggers reject mutation of recorded history.</p>
          <button className="enterprise-primary" disabled={busy || !overview} onClick={() => void downloadAudit()}><Download size={15} /> Download 30-day {policy.exportFormat.toUpperCase()}</button>
        </section>
      </div>

      <section className="enterprise-section" aria-labelledby="governance-title">
        <div className="enterprise-section-title"><Globe2 /><div><p>RETENTION · RESIDENCY · RECOVERY</p><h2 id="governance-title">Governance policy</h2></div></div>
        <div className="enterprise-policy-grid">
          <label>Content retention, days<input type="number" min="1" max="3650" value={policy.retentionDays} onChange={(event) => setPolicy({ ...policy, retentionDays: Number(event.target.value) })} /></label>
          <label>Deleted-object grace, days<input type="number" min="0" max="90" value={policy.deletedObjectGraceDays} onChange={(event) => setPolicy({ ...policy, deletedObjectGraceDays: Number(event.target.value) })} /></label>
          <label>Audit retention, days<input type="number" min="365" max="3650" value={policy.auditRetentionDays} onChange={(event) => setPolicy({ ...policy, auditRetentionDays: Number(event.target.value) })} /></label>
          <label>Recovery time objective, min<input type="number" min="15" max="10080" value={policy.rtoMinutes} onChange={(event) => setPolicy({ ...policy, rtoMinutes: Number(event.target.value) })} /></label>
          <label>Recovery point objective, min<input type="number" min="5" max="10080" value={policy.rpoMinutes} onChange={(event) => setPolicy({ ...policy, rpoMinutes: Number(event.target.value) })} /></label>
          <label>Audit export<select value={policy.exportFormat} onChange={(event) => setPolicy({ ...policy, exportFormat: event.target.value as "jsonl" | "csv" })}><option value="jsonl">JSONL</option><option value="csv">CSV</option></select></label>
        </div>
        <fieldset><legend>Allowed data regions</legend>{(["us", "eu", "apac"] as const).map((region) => <label key={region}><input type="checkbox" checked={policy.allowedRegions.includes(region)} onChange={(event) => setPolicy({ ...policy, allowedRegions: event.target.checked ? [...policy.allowedRegions, region] : policy.allowedRegions.filter((item) => item !== region) })} /> {region.toUpperCase()}</label>)}</fieldset>
        <div className="enterprise-checks"><label><input type="checkbox" checked={policy.exportSigningRequired} onChange={(event) => setPolicy({ ...policy, exportSigningRequired: event.target.checked })} /> Signed exports required</label><label><input type="checkbox" checked={policy.legalHoldEnabled} onChange={(event) => setPolicy({ ...policy, legalHoldEnabled: event.target.checked })} /> Legal hold enabled</label><label><input type="checkbox" checked={policy.dedicatedDeploymentRequired} onChange={(event) => setPolicy({ ...policy, dedicatedDeploymentRequired: event.target.checked })} /> Dedicated deployment required</label></div>
        <button className="enterprise-primary" disabled={busy || !overview || policy.allowedRegions.length === 0} onClick={() => void savePolicy()}>Record governance policy</button>
      </section>

      <footer className="enterprise-footer"><span>POLICY IS NOT RUNTIME PROOF</span><p>Region routing, deletion, recovery and identity activation remain closed until their named infrastructure gates are verified.</p></footer>
    </main>
  );
}
