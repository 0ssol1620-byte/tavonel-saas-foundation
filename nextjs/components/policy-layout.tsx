import Link from "next/link";
import Logomark from "@/components/logomark";

export default function PolicyLayout({
  label,
  title,
  intro,
  children,
}: {
  label: string;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>
        <nav aria-label="Policy navigation"><Link href="/status">Service status</Link><Link href="/contact">Contact</Link></nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="scene doc policy-page">
          <div className="shell"><div className="body">
            <div className="stack"><p className="slate"><b>PUBLIC RECORD</b><span />{label}</p><h1 className="document-title">{title}</h1></div>
            <div className="stack"><p className="lede">{intro}</p><div className="policy-copy">{children}</div></div>
          </div></div>
        </section>
      </main>
      <footer className="site"><div className="shell"><span className="wordmark"><Logomark /><b>TAVONEL</b></span><nav className="site-links" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/refunds">Refunds</Link><Link href="/subprocessors">Subprocessors</Link><Link href="/security">Security</Link></nav><p className="fine">Questions about this record: <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a></p></div></footer>
    </div>
  );
}
