import type { Metadata } from "next";
import Link from "next/link";

import Logomark from "@/components/logomark";
import ContactForm from "@/components/contact-form";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import DesktopPrimaryNav from "@/components/site-nav/desktop-primary-nav";
import { readLegalOperator } from "@/lib/legal-operator";
import { SUPPORT_ACKNOWLEDGEMENT } from "@/lib/support-targets";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/contact" },
  openGraph: { url: "/contact" },
  title: "Contact — TAVONEL",
  description: "Tell us what your documents need to become, without sending the documents themselves.",
};

export default function ContactPage() {
  const operator = readLegalOperator();
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <DesktopPrimaryNav />
        <MobilePrimaryNav />
        <span className="nav-actions">
          <Link className="nav-signin" href="/login">Sign in</Link>
        </span>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="scene doc contact-page">
          <div className="shell">
            <div className="body">
              <div className="stack">
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
                {/*
                  G2-034. The telephone number, on the page whose job is to be reachable.

                  It was published in the footer of every legal page and on none of the contact
                  routes, so the one visitor who wants to speak to somebody was the visitor who
                  could not find it. `readLegalOperator` is the source those footers read, so
                  this renders only where the operator record exists and can never become a
                  second, stale copy of the number.
                */}
                {operator ? (
                  <div className="contact-address">
                    <span>Telephone</span>
                    <a href={`tel:${operator.phone}`}>{operator.phone}</a>
                  </div>
                ) : null}
                {/* One constant, printed here and on /status. See lib/support-targets.ts. */}
                <p className="fine">{SUPPORT_ACKNOWLEDGEMENT}</p>
                {/*
                  G2-034. `hello@` carried no expectation at all, which left the address most
                  visitors use as the one with no answer to "when will I hear back". Same target
                  as support, said for this inbox; still no resolution time, because there is not
                  one to commit.
                */}
                <p className="fine">
                  General inquiries to hello@tavonel.com are read by a person and carry the same
                  one business day (KST) acknowledgement target.
                  {operator ? " The telephone is answered during Korean business hours; outside them, email reaches us sooner." : null}
                </p>
              </div>
              <div className="stack">
                {/*
                  BQ-113. The warning that governs the message box was printed here and again
                  inside the box as placeholder text, and the placeholder is the copy that
                  disappears the moment somebody starts typing. It is said once now, beside the
                  field it governs, where it stays legible while the field is being filled in.
                */}
                <p className="lede">
                  The optional questions above the message box are what let the first reply come
                  back with specifics rather than a request for more detail.
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
          <p className="fine">Every inquiry is read by a person, and the reply comes from an address on this domain.</p>
        </div>
      </footer>
    </div>
  );
}
