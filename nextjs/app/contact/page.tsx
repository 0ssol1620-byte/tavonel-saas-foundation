import type { Metadata } from "next";
import Link from "next/link";

import Logomark from "@/components/logomark";
import ContactForm from "@/components/contact-form";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/contact" },
  openGraph: { url: "/contact" },
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
                {/*
                  13.4 asks for a direct route to support and security. A single general
                  address means a vulnerability report waits behind a pricing question, which
                  is the one queue it must never be in.
                */}
                <div className="contact-address">
                  <span>General inquiries</span>
                  <a href="mailto:hello@tavonel.com">hello@tavonel.com</a>
                </div>
                <div className="contact-address">
                  <span>Product support</span>
                  <a href="mailto:support@tavonel.com">support@tavonel.com</a>
                </div>
                <div className="contact-address">
                  <span>Vulnerability reports</span>
                  <a href="mailto:security@tavonel.com">security@tavonel.com</a>
                </div>
              </div>
              <div className="stack">
                <p className="lede">
                  The questions below are optional, and answering them is what makes the first
                  reply useful rather than a request for more detail.
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
          {/*
            This read "Personal mailbox addresses are never published", which 13.4 asks to
            delete: it is a sentence about our internal address policy on a page whose reader
            wants to know what happens to their inquiry. What replaces it is that.
          */}
          <p className="fine">Every inquiry is read by a person. There is no automated reply, and the answer comes from an address on this domain.</p>
        </div>
      </footer>
    </div>
  );
}
