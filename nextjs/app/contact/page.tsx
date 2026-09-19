import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";

import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../../shared/capabilityManifest";
import ContactForm from "@/components/contact-form";
import { PublicSitePage } from "@/components/public-site-chrome";
import { activationPolicy } from "@/lib/activation-policy";
import { primaryCallToAction } from "@/lib/commercial-state";
import { readLegalOperator } from "@/lib/legal-operator";
import { TRAINING_DATA_CLAIM } from "@/lib/security-claims";
import { SUPPORT_ACKNOWLEDGEMENT } from "@/lib/support-targets";
import faq from "./contact-faq.module.css";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/contact" },
  openGraph: { url: "/contact" },
  title: "Contact — TAVONEL",
  description: "Tell us what your documents need to become, without sending the documents themselves.",
};

/*
  BQ-012 / n32. The shared chrome, not a third copy of it.

  This page hand-rolled a header with no action in it and a footer with neither the navigation
  groups nor the legal row -- so the one route the whole site's "Request access" button points at
  was the route where a visitor could not get back to pricing, the Korean entry, the security
  inbox or the consent withdrawal. Nothing in `PublicSitePage` had to change to take it: the
  header resolves its own commercial action, and the `<main id="main">` the skip link targets is
  the one this page used to declare itself.

  The footer sentence this page did own -- what happens to an inquiry after it is sent -- is not
  chrome, so it moves up beside the addresses it is about rather than going with the shell.
*/
export default function ContactPage() {
  const operator = readLegalOperator();
  /*
    D6, 2026-09-19. The six questions a buyer asks before they write, moved off the landing.

    They were the close of `components/home-page-client.tsx`, which Landing V2 deletes. They are
    not landing copy: every one of them is asked by somebody who has decided to get in touch and
    wants one thing settled first, which is this page. The copy and the links are unchanged --
    the training and provider answers are the /security rows, the formats line is the capability
    manifest, the gate is the shared activation record -- so nothing here is a new claim about
    the product, and each answer still ends at the page that owns it.
  */
  const formats = describeAcceptedFormats(CAPABILITY_MANIFEST);
  const access = primaryCallToAction();
  return (
    <PublicSitePage>
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
                  <a className="link" href="mailto:hello@tavonel.com">hello@tavonel.com</a>
                </div>
                <div className="contact-address">
                  <span>Product support</span>
                  <a className="link" href="mailto:support@tavonel.com">support@tavonel.com</a>
                </div>
                <div className="contact-address">
                  <span>Vulnerability reports</span>
                  <a className="link" href="mailto:security@tavonel.com">security@tavonel.com</a>
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
                    <a className="link" href={`tel:${operator.phone}`}>{operator.phone}</a>
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
                {/*
                  This read "Personal mailbox addresses are never published", which 13.4 asks to
                  delete: it is a sentence about our internal address policy on a page whose reader
                  wants to know what happens to their inquiry. What replaces it is that. It sat in
                  this page's own footer until n32 gave the page the site's footer instead.
                */}
                <p className="fine">Every inquiry is read by a person, and the reply comes from an address on this domain.</p>
              </div>
              <div className="stack">
                <div className={faq.faq}>
                  <h2 className={faq.title}>Questions we get first</h2>
                  <details className={faq.item}>
                    <summary>Are my documents used to train models?</summary>
                    {/* ROUND3-P2: the answer reads /security's own row rather than a fourth hand-typed copy of
                        it. The sentence is unchanged; only the product noun's casing is (PRODUCT_NOUNS). */}
                    <p className={faq.answer}>No. {TRAINING_DATA_CLAIM.body} <Link href="/security" prefetch={false}>Security</Link></p>
                  </details>
                  <details className={faq.item}>
                    <summary>Which model providers see my documents?</summary>
                    <p className={faq.answer}>No third-party model API receives your documents in this deployment: document reading runs on GPU workers TAVONEL operates, and every document is treated as hostile data. <Link href="/security" prefetch={false}>Security</Link></p>
                  </details>
                  <details className={faq.item}>
                    <summary>What happens when a passage cannot be verified?</summary>
                    <p className={faq.answer}>It is held for review and surfaced as such, not published as if it were verified. Fail closed is a property of the compiler, not a setting. <Link href="/trust" prefetch={false}>Trust Center</Link></p>
                  </details>
                  <details className={faq.item}>
                    <summary>What can I bring?</summary>
                    <p className={faq.answer}>{formats}, as files, folders or a ZIP, plus connected sources. Every accepted format is sanitized to PDF and read the same way, so each passage keeps its page and region. <Link href="/sources" prefetch={false}>Supported sources</Link></p>
                  </details>
                  <details className={faq.item}>
                    {/*
                      C6, 2026-09-19: the original link is back.

                      D6 moved these six Q&As "unchanged, with the same links", and this one had
                      been rewritten to drop the link in the posture where it points at /contact
                      -- the page it now lives on. The argument was that a link to the page you
                      are already reading is not an answer; it is a fair argument and it is also a
                      copy change to a founder-approved Q&A, made by a lane, which D6 forbids.
                      `d52fa26:nextjs/components/home-page-client.tsx:245` renders
                      `<Link href={startHref}>{access.label}</Link>` unconditionally, and
                      `startHref` is `access.href`, so that is what renders here. Dropping the
                      self-link is a founder decision about the copy, not this lane's.
                    */}
                    <summary>Can I compile my own files today?</summary>
                    <p className={faq.answer}>{activationPolicy.customerData.reason} <Link href={access.href as Route} prefetch={false}>{access.label}</Link></p>
                  </details>
                  <details className={faq.item}>
                    <summary>Can what I upload be deleted?</summary>
                    <p className={faq.answer}>Source material, derived artifacts and compiled packages can be deleted on request, and that request is carried out by a person rather than by a self-service control. <Link href="/security" prefetch={false}>Retention and deletion</Link></p>
                  </details>
                </div>
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
    </PublicSitePage>
  );
}
