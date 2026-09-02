import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";

export function PublicPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>
        <nav aria-label="Sections">
          <Link href="/product">Product</Link>
          <Link href={"/solutions/ai-ready-knowledge" as Route}>Solutions</Link>
          <Link href={"/integrations" as Route}>Integrations</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/security">Security</Link>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <Link className="btn small" href="/login">Try TAVONEL</Link>
      </header>
      <main id="main">{children}</main>
      <footer className="site"><div className="shell"><span className="wordmark"><Logomark /><b>TAVONEL</b></span><p className="fine">Knowledge compiled with a traceable path back to every source.</p></div></footer>
    </div>
  );
}

