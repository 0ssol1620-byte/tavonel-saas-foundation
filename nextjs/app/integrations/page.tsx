import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";
import { OAUTH_CONNECTOR_SCOPES } from "@/lib/connector-oauth";

export const metadata: Metadata = {
  title: "Integrations — TAVONEL",
  description: "Connect read-only source systems to TAVONEL and compile their knowledge into a traceable World.",
  alternates: { canonical: "/integrations" },
  openGraph: { url: "/integrations" },
};

const SUPPORT_LEVELS = [
  ["Available", "Set it up yourself."],
  ["Beta", "Built and contract-tested. Verify the connection in your workspace before depending on it."],
  ["Enterprise", "Configured with you when credentials or network access belong outside the browser."],
  ["Planned", "Not built yet."],
] as const;

const OAUTH = [
  {
    name: "Google Drive",
    provider: "google_drive",
    level: "Beta",
    description: "Discover and import Drive files read-only, tracking the file checksum as its revision.",
    deletion: "Trashed files disappear from the next listing and are surfaced as source removal on sync.",
    cursor: "nextPageToken, stored per connection.",
  },
  {
    name: "Dropbox",
    provider: "dropbox",
    level: "Beta",
    description: "Import folders recursively with revision tracking and explicit deleted entries.",
    deletion: "Deleted entries are surfaced so a World does not keep asserting a source that is gone.",
    cursor: "The provider cursor; malformed continuation is refused.",
  },
  {
    name: "OneDrive / SharePoint",
    provider: "microsoft_graph",
    level: "Beta",
    description: "Read Microsoft Graph drives and sites through delta sync with eTag revisions.",
    deletion: "Deleted facets in the delta are surfaced. Off-origin continuation links are refused.",
    cursor: "@odata.nextLink / @odata.deltaLink, origin-validated.",
  },
] as const;

const INFRA = [
  ["Mounted file server", "Enterprise", "SMB, NFS or SFTP-backed paths stay customer-controlled until selected files are imported."],
  ["Amazon S3", "Enterprise", "Bucket and prefix configuration with secret references kept outside the browser."],
  ["Cloudflare R2", "Enterprise", "S3-compatible source import with tenant-scoped connection records."],
  ["MinIO", "Enterprise", "Self-hosted S3-compatible storage through the same bounded connection contract."],
] as const;

export default function IntegrationsPage() {
  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell">
        <div className="body">
          <div className="stack"><p className="slate"><b>INTEGRATIONS</b><span />SOURCE SYSTEMS</p><h1 className="document-title">Compile where your knowledge already lives.</h1></div>
          <div className="stack">
            <p className="lede">Connect a source once. TAVONEL discovers and imports read-only, then tracks revisions so the compiled World can stay traceable to the system it came from.</p>
            <p className="fine">Connection health—configured, expired or unreachable—is reported inside your workspace, where it is actionable.</p>
          </div>
        </div>

        <div className="body">
          <div className="stack"><p className="slate"><b>OAUTH</b><span />MANAGED CONNECTIONS</p><h2>Cloud document systems.</h2></div>
          <div className="connector-public-grid">{OAUTH.map((connector) => (
            <article key={connector.name}>
              <span className="st">{connector.level}</span>
              <h3>{connector.name}</h3>
              <p className="integration-summary">{connector.description}</p>
              <details className="integration-technical">
                <summary>Security & sync details</summary>
                <dl className="integration-facts">
                  <div><dt>Scopes requested</dt><dd><code>{(OAUTH_CONNECTOR_SCOPES[connector.provider] ?? []).join(" ")}</code></dd></div>
                  <div><dt>Writes back</dt><dd>Never. Discovery and download only.</dd></div>
                  <div><dt>Deletion</dt><dd>{connector.deletion}</dd></div>
                  <div><dt>Incremental cursor</dt><dd>{connector.cursor}</dd></div>
                </dl>
              </details>
            </article>
          ))}</div>
          <p className="fine integration-footnote">Beta describes product support, not your connection state. A provider-specific last-tested date appears only after a verified real-account run exists.</p>
        </div>

        <div className="body">
          <div className="stack"><p className="slate"><b>SUPPORT LEVEL</b><span />WHAT THE LABEL MEANS</p><h2>Four levels, one clear contract.</h2></div>
          <div className="chain">{SUPPORT_LEVELS.map(([level, meaning]) => <article className="link" key={level}><span className="st">{level}</span><p>{meaning}</p></article>)}</div>
        </div>

        <div className="body"><div className="stack"><p className="slate"><b>LOCAL / INFRASTRUCTURE</b><span />CUSTOMER-CONTROLLED</p><h2>File and object storage.</h2></div><div className="chain">{INFRA.map(([name, level, description]) => <article className="link" key={name}><span className="st">{level}</span><h3>{name}</h3><p>{description}</p></article>)}</div></div>

        <div className="actions"><Link className="btn" href="/login">Connect a source</Link><Link className="btn ghost" href="/developers">Developer setup</Link></div>
      </div></section>
    </PublicPageShell>
  );
}
