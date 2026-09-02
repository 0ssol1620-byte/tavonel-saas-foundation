import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";
export const metadata: Metadata = {
  title: "Integrations — TAVONEL",
  description: "Source systems TAVONEL can compile, with current deployment availability shown per connector.",
  alternates: { canonical: "/integrations" },
  openGraph: { url: "/integrations" },
};

const OAUTH = [
  ["Google Drive", "Beta", "Read-only file discovery and import with a durable cursor."],
  ["Dropbox", "Beta", "Recursive file discovery, revision tracking and deletion events."],
  ["OneDrive / SharePoint", "Beta", "Microsoft Graph delta cursors for drives and sites."],
] as const;

const INFRA = [
  ["Mounted file server", "Enterprise", "SMB, NFS or SFTP-backed paths remain inside the customer-controlled environment until selected files are imported."],
  ["Amazon S3", "Enterprise", "Bucket and prefix configuration with secret references kept outside the browser."],
  ["Cloudflare R2", "Enterprise", "S3-compatible source import with tenant-scoped connection records."],
  ["MinIO", "Enterprise", "Self-hosted S3-compatible storage through the same signed cursor contract."],
] as const;

export default function IntegrationsPage() {
  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell">
        <div className="body"><div className="stack"><p className="slate"><b>INTEGRATIONS</b><span />SOURCE SYSTEMS</p><h1 className="document-title">Compile where your knowledge already lives.</h1></div><div className="stack"><p className="lede">Each connector carries its current deployment state and supported source boundary.</p></div></div>
        <div className="body"><div className="stack"><p className="slate"><b>OAUTH</b><span />MANAGED CONNECTIONS</p><h2>Cloud document systems.</h2></div><div className="chain">{OAUTH.map(([name, state, description]) => <article className="link" key={name}><span className="st">{state}</span><h3>{name}</h3><p>{description}</p></article>)}</div></div>
        <div className="body"><div className="stack"><p className="slate"><b>LOCAL / INFRASTRUCTURE</b><span />CUSTOMER-CONTROLLED</p><h2>File and object storage.</h2></div><div className="chain">{INFRA.map(([name, state, description]) => <article className="link" key={name}><span className="st">{state}</span><h3>{name}</h3><p>{description}</p></article>)}</div></div>
        <div className="actions"><Link className="btn" href="/login">Connect a source</Link><Link className="btn ghost" href="/developers">Developer setup</Link></div>
      </div></section>
    </PublicPageShell>
  );
}
