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

/*
  I04. The rows above say "Customer-run" and stopped there, which is the honest label and not
  yet an answer: the reader who accepts it immediately needs install, permissions, restart,
  outage and update behaviour, and none of it was written anywhere on the site or in
  docs/runbooks.

  Each answer below is read off `public/developer/tavonel-source-agent.py` and
  `public/developer/channel.json` rather than described from intent. Two of them are the ones
  a reader will be surprised by, so they are stated plainly instead of softened: one run is
  one sync and exits, so the customer's scheduler is the whole schedule; and there is no retry
  inside the agent, so the customer's scheduler is also the whole retry. The long form, with
  the error-message table, is docs/runbooks/source-agent-operations.md in the repository.
*/
const AGENT_OPERATIONS: Array<[string, string]> = [
  ["Install", "Python 3.12 or newer. Verify the download against the sha256 in the distribution record at /developer/channel.json, create the connection in Workspace to get its id, and put the API key in the TAVONEL_API_KEY environment variable \u2014 the agent reads it from nowhere else. S3-compatible mode additionally needs boto3, which you install; the agent stops and says so if it is missing."],
  ["Permissions", "Read on the directory tree, or ListObjectsV2 and GetObject on the bucket and prefix. Nothing more: the agent never writes to your source. Storage credentials are resolved on your host and are never sent to us. It skips symbolic links and refuses a path that resolves outside the root you gave it. Outbound HTTPS only, no inbound port."],
  ["One run", "One invocation performs one sync and exits. It is not a service and has no internal timer: cron, a systemd timer or Task Scheduler is what makes it periodic, and that interval is your import latency. Do not run two against one connection at once."],
  ["Restart and network outage", "The local cursor file is written only after we have committed the batch, so a killed process, a reboot or a dropped connection leaves it untouched and the next run sends the same work again; per-file upload keys are derived from the connection, path and revision, so a repeat resolves to the same document rather than a duplicate. There is no retry inside the agent: a failure exits non-zero and waits for your scheduler."],
  ["Update", "The distribution record at /developer/channel.json carries the current version, the minimum Python and the sha256 of the agent. Compare, download, verify the hash, replace the file, keep the cursor state. There is no self-update and no notification, so checking that record is a task you schedule."],
  ["Responsibility", "The host, its uptime, the scheduler, the credentials and noticing a failed run are yours, because the agent runs inside your network on your machine. We do not monitor it: an agent that stopped looks to us like a source with no changes. We are responsible for the API it calls, the upload capability, the cursor commit and everything after the upload."],
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
            <details className="integration-technical">
              <summary>Operating the agent</summary>
              <dl className="integration-facts">{AGENT_OPERATIONS.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
            </details>
            <p className="fine">No customer-run install of this agent has been qualified end to end on real infrastructure yet, so the timings from a run on your own corpus are the only ones that exist. There is no health endpoint or heartbeat for it either: its liveness is whatever your scheduler reports.</p>
          </div>
        </div>

        <div className="actions"><Link className="btn" href="/login">Connect a source</Link><Link className="btn ghost" href="/developers">Developer setup</Link></div>
      </div></section>
    </PublicPageShell>
  );
}
