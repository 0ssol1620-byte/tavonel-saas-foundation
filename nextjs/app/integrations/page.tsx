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
  Four labels, and the one that was doing the most work now says what it means.

  "Enterprise" read as a higher tier of the same thing -- the connector you get if you pay more
  -- when what sits under it is not a connector at all: there is no S3, MinIO, SMB, NFS or SFTP
  adapter in `lib/connector-*`, and nothing in the product connects to one. What exists is
  `public/developer/tavonel-source-agent.py`, a local agent the customer runs inside their own
  network against a mounted path or an S3-compatible bucket, talking to two real endpoints
  (`/api/v1/uploads/capability` and `/api/v1/connections/{id}/sync`). That is an assisted import
  route, and RESOLVED A-4 (2026-09-06) says it may be described only as one.
*/
const SUPPORT_LEVELS = [
  ["Available", "Set it up yourself."],
  ["Beta", "Built and contract-tested. Verify the connection in your workspace before depending on it. Not qualified."],
  ["Enterprise-assisted", "Not a self-serve connector. An import route we configure with you, run by an agent inside your own network."],
  ["Planned", "Not built yet."],
] as const;

const OAUTH = [
  {
    name: "Google Drive",
    provider: "google_drive",
    level: "Beta",
    description: "Discover and import Drive files read-only, tracking the file checksum as its revision.",
    /*
      What the adapter does, not what a deletion contract should do. RESOLVED B-7.

      The listing query is `trashed = false`, and the Drive adapter emits no deleted entry --
      unlike Dropbox and Graph, which both do. So a trashed file simply stops appearing, and
      that is indistinguishable from a file that was moved, renamed, hard-deleted, or that the
      account can no longer see. The row used to claim it was "surfaced as source removal on
      sync", which is the contract, not the code. B-7 calls this gap unacceptable for a
      production connector and makes closing it a precondition of qualification, so it is
      written here rather than smoothed over.
    */
    deletion: "A trashed file stops appearing in the listing. It is not distinguished from a file that was deleted outright, moved, renamed, or whose permissions changed — a known gap, and one reason no connector here is qualified.",
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
  ["Mounted file server", "Enterprise-assisted", "SMB, NFS or SFTP-backed paths are read by the agent as an ordinary mounted directory. TAVONEL never reaches into your network; the files stay customer-controlled until the agent imports the ones you selected."],
  ["S3-compatible object storage", "Enterprise-assisted", "Amazon S3, Cloudflare R2 and MinIO through one bucket-and-prefix configuration, with credentials held by the agent and never in the browser."],
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

        <div className="body">
          <div className="stack"><p className="slate"><b>LOCAL / INFRASTRUCTURE</b><span />ASSISTED IMPORT, NOT A CONNECTOR</p><h2>File and object storage.</h2></div>
          <p className="lede">These are not connectors you switch on. They are imported by <a href="/developer/tavonel-source-agent.py" download>a local source agent</a> you run inside your own network, configured with you. Nothing below is a self-serve connection, and nothing below is qualified.</p>
          <div className="chain">{INFRA.map(([name, level, description]) => <article className="link" key={name}><span className="st">{level}</span><h3>{name}</h3><p>{description}</p></article>)}</div>
        </div>

        <div className="actions"><Link className="btn" href="/login">Connect a source</Link><Link className="btn ghost" href="/developers">Developer setup</Link></div>
      </div></section>
    </PublicPageShell>
  );
}
