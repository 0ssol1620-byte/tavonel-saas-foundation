import type { OAuthConnectorProvider } from "@/lib/connector-oauth";

/*
  What each source connector does, and how the customer-run agent is operated. Each row is read off
  the code that implements it: lib/connector-oauth.ts for the providers and their scopes, and
  public/developer/tavonel-source-agent.py with public/developer/channel.json for the agent. The page
  joins this list to OAUTH_CONNECTOR_PROVIDERS and stops the build when a provider has no row.

  These are operating answers a security reviewer reads, so they state what happens at each event,
  including the events that stop a sync.
*/

export const CONNECTORS: ReadonlyArray<{
  provider: OAuthConnectorProvider;
  name: string;
  description: string;
  deletion: string;
  cursor: string;
}> = [
  {
    provider: "google_drive",
    name: "Google Drive",
    description: "Discover and import Drive files read-only, tracking the file checksum as its revision.",
    deletion: "The versioned changes reader observes renames, content versions and removal or lost-access events. A removal or a lost-access event suspends the bound source and stops the sync for review before its checkpoint advances, so nothing compiles from a source we can no longer read.",
    cursor: "Versioned snapshot and changes tokens, bound to the selected drive and stored per connection.",
  },
  {
    provider: "dropbox",
    name: "Dropbox",
    description: "Import folders recursively with revision tracking and explicit deleted entries.",
    deletion: "A deleted entry or a lost-access event suspends the bound source and stops the sync for review before its checkpoint advances, so nothing compiles from a source we can no longer read.",
    cursor: "The provider cursor; a malformed continuation is refused.",
  },
  {
    provider: "microsoft_graph",
    name: "OneDrive / SharePoint",
    description: "Read Microsoft Graph drives and sites through delta sync with eTag revisions.",
    deletion: "A deleted facet or a lost-access event suspends the bound source and stops the sync for review before its checkpoint advances, so nothing compiles from a source we can no longer read. Off-origin continuation links are refused.",
    cursor: "@odata.nextLink / @odata.deltaLink, origin-validated.",
  },
];

export const CUSTOMER_RUN: ReadonlyArray<readonly [string, string]> = [
  ["Local folder", "Read a folder on a local NTFS or ReFS drive (Windows) or a local Linux file system through your own import agent."],
  ["S3-compatible object storage", "Import a selected bucket and prefix while credentials stay with your agent."],
];

export const AGENT_OPERATIONS: ReadonlyArray<readonly [string, string]> = [
  ["Install", "Python 3.12 or newer. Verify the download against the sha256 in the distribution record at /developer/channel.json, create the connection in Workspace to get its id, and put the API key in the TAVONEL_API_KEY environment variable, which is the only place the agent reads it from. S3-compatible mode additionally needs boto3, which you install; the agent stops and says so if it is missing."],
  ["Permissions", "Read on the directory tree, or ListObjectsV2 and GetObject on the bucket and prefix, and nothing more: the agent writes nothing to your source. Storage credentials are resolved on your host and are never sent to us. It skips symbolic links and refuses a path that resolves outside the root you gave it. Outbound HTTPS only, with no inbound port."],
  ["Runs", "By default one invocation performs one sync and exits; cron, a systemd timer or Task Scheduler is what makes it periodic, and that interval is your import latency. With --watch it stays resident and repeats the sync every --poll-seconds until it is stopped. Run it under a supervisor that restarts it and reports when it exits, and run one agent per connection."],
  ["Restart and network outage", "The local cursor file is written only after we have committed the batch, so a killed process, a reboot or a dropped connection leaves it untouched and the next run sends the same work again; per-file upload keys are derived from the connection, path and revision, so a repeat resolves to the same document rather than a duplicate. A transient network or HTTP error is retried within the run up to --retry-limit times; a failure past that exits non-zero and waits for your scheduler."],
  ["Update", "The distribution record at /developer/channel.json carries the current version, the minimum Python and the sha256 of the agent. Compare, download, verify the hash, replace the file and keep the cursor state. Checking that record is a task you schedule."],
  ["Responsibility", "The host, its uptime, the scheduler, the credentials and noticing a failed run are yours, because the agent runs inside your network on your machine. We are responsible for the API it calls, the upload capability, the cursor commit and everything after the upload."],
  ["Monitoring", "The agent runs on your host under your scheduler, so your scheduler is where a failed run surfaces: the process exits non-zero and reports there. It has no inbound port, no health endpoint and no callback to us. Timings are whatever a run on your own files produces."],
];
