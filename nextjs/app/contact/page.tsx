import type { Metadata } from "next";
import Link from "next/link";

import Logomark from "@/components/logomark";
import ContactForm from "@/components/contact-form";

export const metadata: Metadata = {
  title: "Talk to TAVONEL",
  description: "Tell us what your documents need to become, without sending the documents themselves.",
};

export default function ContactPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/">Back to the compiler</Link>
          <Link href="/security">Security</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="scene doc contact-page">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>DIRECT LINE</b><span />INQUIRY</p>
                <h1 className="document-title">Tell us what your knowledge needs to become.</h1>
                <div className="contact-address">
                  <span>General inquiries</span>
                  <a href="mailto:hello@tavonel.com">hello@tavonel.com</a>
                </div>
              </div>
              <div className="stack">
                <p className="lede">
                  Share the source types, document volume, target outputs and security boundary.
                  <b> Do not attach or paste customer documents here.</b>
                </p>
                <ContactForm />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <p className="fine">Personal mailbox addresses are never published. Inquiries enter through the TAVONEL domain.</p>
        </div>
      </footer>
    </div>
  );
}
