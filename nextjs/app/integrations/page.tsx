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

/*
  The public surface names the access mode and next action. Provider qualification belongs to
  the connection record created after a real account is verified, where its scope is actionable.
  The private routes are explicitly customer-run because the source agent holds those credentials
  inside the customer's network.
*/
const OAUTH = [
  {
    name: "Google Drive",
    provider: "google_drive",
    access: "Read-only",
    description: "Discover and import Drive files read-only, tracking the file checksum as its revision.",
    /*
      The lifecycle reader now binds a pre-snapshot watermark and consumes Drive changes after
      the snapshot. Qualification remains closed until the same path passes a real-account run.
    */
    deletion: "The versioned changes reader observes renames, content versions and removal or lost-access events. A removal suspends the bound source and stops the sync for review; real-account lifecycle qualification is still required.",
    cursor: "Versioned snapshot and changes tokens, bound to the selected drive and stored per connection.",
  },
  {
    name: "Dropbox",
    provider: "dropbox",
    access: "Read-only",
    description: "Import folders recursively with revision tracking and explicit deleted entries.",
    deletion: "Deleted entries suspend the bound source and stop the sync for review before its checkpoint advances. Real-account deletion and access-change qualification is still required.",
    cursor: "The provider cursor; malformed continuation is refused.",
  },
  {
    name: "OneDrive / SharePoint",
    provider: "microsoft_graph",
    access: "Read-only",
    description: "Read Microsoft Graph drives and sites through delta sync with eTag revisions.",
    deletion: "Deleted facets suspend the bound source and stop the sync for review before its checkpoint advances. Off-origin continuation links are refused. Real-account lifecycle qualification is still required.",
    cursor: "@odata.nextLink / @odata.deltaLink, origin-validated.",
  },
] as const;

const INFRA = [
  ["Mounted file server", "Customer-run", "Read an SMB, NFS or SFTP-backed mounted directory through your own import agent."],
  ["S3-compatible object storage", "Customer-run", "Import a selected bucket and prefix while credentials stay with your agent."],
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
          <div className="stack">
            <div className="connector-public-grid">{OAUTH.map((connector) => (
              <article key={connector.name}>
                <span className="st">{connector.access}</span>
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
            <p className="fine integration-footnote">Verify the provider account in Workspace before the first sync. Connection health and lifecycle evidence stay with the connection.</p>
          </div>
        </div>

        <div className="body">
          <div className="stack"><p className="slate"><b>PRIVATE SOURCES</b><span />YOUR NETWORK</p><h2>File and object storage.</h2></div>
          <div className="stack">
            <p className="lede">Use a <a href="/developer/tavonel-source-agent.py" download>local source agent</a> for repositories that stay inside your network. We configure the first route with you.</p>
            <div className="chain">{INFRA.map(([name, level, description]) => <article className="link" key={name}><span className="st">{level}</span><h3>{name}</h3><p>{description}</p></article>)}</div>
          </div>
        </div>

        <div className="actions"><Link className="btn" href="/login">Connect a source</Link><Link className="btn ghost" href="/developers">Developer setup</Link></div>
      </div></section>
    </PublicPageShell>
  );
}
