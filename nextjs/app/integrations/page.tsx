import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";
import { OAUTH_CONNECTOR_SCOPES } from "@/lib/connector-oauth";

export const metadata: Metadata = {
  title: "Integrations — TAVONEL",
  description: "Source systems TAVONEL can compile, with the product support level, the exact scopes requested and how each one handles deletion.",
  alternates: { canonical: "/integrations" },
  openGraph: { url: "/integrations" },
};

/*
  Masterplan 13.10's objection to this page was not the list. It was that "Beta" and "Enterprise"
  were presented as "current deployment state", which conflates two different things: whether a
  connector is a supported product, and whether one particular connection is working right now.

  The first belongs here. The second -- Configured, Credential expired, Unavailable -- is about
  a customer's own connection and belongs in their workspace, where it means something. A public
  page that reported it would either be reporting our deployment as though it were theirs, or
  reporting nothing and looking like a status page.

  So the support level is defined explicitly, and the per-connector facts are the ones a buyer's
  security review asks for: the exact scopes requested, whether anything is ever written back,
  what happens when a file is deleted at the source, and how a re-sync avoids re-reading
  everything. Those come from `lib/connector-oauth.ts` rather than being restated here.
*/

const SUPPORT_LEVELS = [
  ["Available", "A supported connector. Set it up yourself."],
  ["Beta", "Built and exercised against provider contracts, not yet verified end to end against a real account. Ask before depending on it."],
  ["Enterprise", "Configured with you, because it needs credentials or network access that do not belong in a browser."],
  ["Planned", "Not built. Nothing on this page is currently at this level."],
] as const;

const OAUTH = [
  {
    name: "Google Drive",
    provider: "google_drive",
    level: "Beta",
    description: "File discovery and import over a page token, with the file's own checksum as its revision.",
    deletion: "Drive filters trashed files out of a listing rather than reporting them, so a deletion arrives as absence on the next sync.",
    cursor: "nextPageToken, stored per connection.",
  },
  {
    name: "Dropbox",
    provider: "dropbox",
    level: "Beta",
    description: "Recursive listing with revision tracking, and explicit deletion entries.",
    deletion: "Reported as a deleted entry and surfaced, rather than dropped, so a World never keeps asserting a source that is gone.",
    cursor: "The provider's own cursor. A page that claims more and returns no cursor is refused.",
  },
  {
    name: "OneDrive / SharePoint",
    provider: "microsoft_graph",
    level: "Beta",
    description: "Microsoft Graph delta over drives and sites, with eTag revisions.",
    deletion: "Reported in the delta as a deleted facet and surfaced. A continuation link that points off graph.microsoft.com is refused.",
    cursor: "@odata.nextLink and @odata.deltaLink, validated against the provider's own origin.",
  },
] as const;

const INFRA = [
  ["Mounted file server", "Enterprise", "SMB, NFS or SFTP-backed paths stay inside the customer-controlled environment until selected files are imported."],
  ["Amazon S3", "Enterprise", "Bucket and prefix configuration with secret references kept outside the browser."],
  ["Cloudflare R2", "Enterprise", "S3-compatible source import with tenant-scoped connection records."],
  ["MinIO", "Enterprise", "Self-hosted S3-compatible storage through the same signed cursor contract."],
] as const;

export default function IntegrationsPage() {
  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell">
        <div className="body">
          <div className="stack"><p className="slate"><b>INTEGRATIONS</b><span />SOURCE SYSTEMS</p><h1 className="document-title">Compile where your knowledge already lives.</h1></div>
          <div className="stack">
            <p className="lede">
              Every connector below is read-only. Nothing writes back to a source system, and no
              connector can promote, compile or change billing.
            </p>
            <p>
              The level beside each one is its product support level, not the state of any
              deployment. Whether a particular connection is configured, expired or unreachable is
              about your workspace and is reported there.
            </p>
          </div>
        </div>

        <div className="body">
          <div className="stack"><p className="slate"><b>SUPPORT LEVEL</b><span />WHAT THE LABEL MEANS</p><h2>Four levels, defined.</h2></div>
          <div className="chain">{SUPPORT_LEVELS.map(([level, meaning]) => <article className="link" key={level}><span className="st">{level}</span><p>{meaning}</p></article>)}</div>
        </div>

        <div className="body">
          <div className="stack"><p className="slate"><b>OAUTH</b><span />MANAGED CONNECTIONS</p><h2>Cloud document systems.</h2></div>
          <div className="chain">{OAUTH.map((connector) => (
            <article className="link" key={connector.name}>
              <span className="st">{connector.level}</span>
              <h3>{connector.name}</h3>
              <p>{connector.description}</p>
              <dl className="integration-facts">
                <div><dt>Scopes requested</dt><dd><code>{(OAUTH_CONNECTOR_SCOPES[connector.provider] ?? []).join(" ")}</code></dd></div>
                <div><dt>Writes back</dt><dd>Never. Discovery and download only.</dd></div>
                <div><dt>Deletion</dt><dd>{connector.deletion}</dd></div>
                <div><dt>Incremental cursor</dt><dd>{connector.cursor}</dd></div>
              </dl>
            </article>
          ))}</div>
          <p className="fine">
            {/*
              13.10 asks each connector for a "last tested" date. A date here would have to mean
              a run against a real account, and there has not been one; a date derived from a
              contract test would be the strongest-looking claim on the page and the least true.
            */}
            No connector carries a last-tested date. That date has to mean a verified run against
            a real account with real credentials, and until one has happened there is nothing
            honest to put there.
          </p>
        </div>

        <div className="body"><div className="stack"><p className="slate"><b>LOCAL / INFRASTRUCTURE</b><span />CUSTOMER-CONTROLLED</p><h2>File and object storage.</h2></div><div className="chain">{INFRA.map(([name, level, description]) => <article className="link" key={name}><span className="st">{level}</span><h3>{name}</h3><p>{description}</p></article>)}</div></div>

        <div className="actions"><Link className="btn" href="/login">Connect a source</Link><Link className="btn ghost" href="/developers">Developer setup</Link></div>
      </div></section>
    </PublicPageShell>
  );
}
