"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Cloud, Files, Server } from "lucide-react";
import CompileStagePlayer from "@/components/compile-stage-player";
import { COMPILE_STAGES } from "@/lib/compile-stages";
import DesignPartners from "@/components/design-partners";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import { ACCESS_CTA, BRAND_LINE, SELF_SERVE_CTA } from "@/lib/site-navigation";
import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary";
import { convertedToPdfFormats, sourceFamilyChips, sourceSupportTier } from "@/lib/qualified-input";
import { activationPolicy } from "@/lib/activation-policy";
import { trackFunnel } from "@/lib/funnel-events";

/** One customer journey. Existing films illustrate it; the published sample supplies evidence.
 * Neither a directed film nor a CTA click is a real customer's processing receipt.
 */
const HERO_STAGE = [{
  id: "hero-v2",
  label: "READY FOR AI",
  line: "Files become organized, source-linked knowledge your AI can use.",
  src: "/film/compile-cut.mp4",
  poster: "/film/poster-1-hero.webp",
}] as const;

const WORK_STAGES = [COMPILE_STAGES[1]!, COMPILE_STAGES[2]!] as const;

/*
  BQ-066. Wayfinding, for the one reader who has none.

  The landing is 9,452px tall at 412px. On a desktop the scrollbar is the map; on a phone there
  is no map at all, and a reader four screens in cannot tell what is left or get back to the part
  they wanted. Five destinations, the page's own section ids, phone only -- a table of contents
  rather than a second header, and it scrolls away with the page.
*/
const JUMP = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#connect", label: "Connect" },
  { href: "#proof", label: "Proof" },
  { href: "#stays-current", label: "Stays current" },
  { href: "#ready-for-ai", label: "Ready for AI" },
] as const;

export default function HomePageClient({ liveCommerce, proof }: { liveCommerce: boolean; proof?: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client || cancelled) return;
      // Subscribe before reading the initial session; dispose even if the import completes late.
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setSignedIn(Boolean(session));
      });
      unsubscribe = () => listener.subscription.unsubscribe();
      const { data } = await client.auth.getSession();
      if (!cancelled) setSignedIn(Boolean(data.session));
    })().catch(() => { /* A public page remains usable when session lookup is unavailable. */ });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  const access = signedIn ? { href: "/workspace", label: "Open workspace" } : liveCommerce ? SELF_SERVE_CTA : ACCESS_CTA;
  const startHref = access.href as Route;
  return (
    <div className="page landing-page one-path-home">
      <PublicSiteHeader cta={access} signedIn={signedIn} />
      <main id="main" tabIndex={-1}>
        <section className="one-path-hero" id="s1" aria-labelledby="one-path-title" data-scene="1">
          <div className="one-path-wrap">
            {/*
              D3 / BQ-009. One column.

              The hero was a `.72fr / 1.5fr` grid: the H1 squeezed to five lines beside a film
              boxed at 838px, while the works film two screens below ran at 1,354px -- so the
              first asset a reader meets was visibly the smaller one, and the sentence that has to
              carry the product was broken across five lines to make room for it. The headline
              sits at a 680px measure now and the film runs the full content width underneath it,
              which is also the width the recording was composed for.

              The `<br/>` in the H1 went with the grid. It forced a break that was right at
              exactly one viewport width and wrong at every other; a measure and `text-wrap:
              balance` do the job at all of them.

              BQ-056: the "AI-READY KNOWLEDGE" eyebrow above the H1 is deleted rather than
              restyled. It said what the next line says, in smaller type.
            */}
            <div className="one-path-intro">
              <h1 id="one-path-title">{BRAND_LINE.headline}</h1>
              <p className="one-path-lede">Upload files or connect the systems you already use. TAVONEL handles the rest.</p>
              <div className="one-path-actions actions">
                <Link className="btn" href={startHref} onClick={() => trackFunnel("hero_start_clicked")}>{signedIn ? "Add knowledge" : access.label}<ArrowUpRight size={17} aria-hidden="true" /></Link>
                <a className="one-path-text-link" href="#how-it-works" onClick={() => trackFunnel("cta_clicked", { cta: "hero_see_how_it_works", scene: "1" })}>See how it works</a>
              </div>
            </div>
            <div className="one-path-hero-film one-path-hero-film-v2" data-testid="one-path-hero-film">
              {/*
                BQ-011 / BQ-056. A caption line, not four inert pills.

                These were four 999px-radius chips with the last one filled, directly under a
                film: the geometry of a segmented control, on four labels that were not controls
                and never had been. Two review lenses reported readers tapping them. This film
                plays one cut, so there is nothing for a control to select -- what the strip is
                for is naming the four stages, and it names them from `PIPELINE_STAGES` so the
                hero, the step grid and the workspace board cannot drift into four vocabularies
                for one pipeline again.
              */}
              <p className="one-path-hero-film-steps">
                {PIPELINE_STAGES.map((stage, position) => (
                  <span key={stage.key}>{position > 0 ? <i aria-hidden="true" /> : null}{stage.label}</span>
                ))}
              </p>
              <CompileStagePlayer stages={HERO_STAGE} preferVideo playbackRate={1.5} compact priorityPoster />
            </div>
            {/*
              G1-003 / G1-004. The four cuts are locked bytes (`lib/locked-film-assets.json`), and
              three things drawn inside them are ahead of this deployment.

              D3 keeps the qualification visible and stops it being a paragraph: the sentence a
              reader needs in order not to misread the film stays under the film, and the three
              specifics move into a disclosure beneath it. A caveat nobody finishes reading is not
              a caveat.
            */}
            <div className="one-path-film-note">
              <p>A directed film, not a screen recording: three things in it run ahead of this deployment.</p>
              <details>
                <summary>What the film shows that a compile does not</summary>
                <p>
                  It draws an extracted table as a ruled grid, labels a result with a section and
                  line number, and lists <code>.csv</code> files among the sources. What a compile
                  emits today is the paragraph as it was printed, the page it was read from and
                  the box it sat in. The public sample below is that output, unedited.
                </p>
              </details>
            </div>
            <nav className="one-path-jump" aria-label="Sections of this page">
              {JUMP.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
            </nav>
          </div>
        </section>

        <section className="one-path-section one-path-works" id="how-it-works" data-scene="2" aria-labelledby="one-path-works-title">
          <div className="one-path-wrap">
            {/*
              BQ-056. The numbered section kickers are gone.

              "01 / TAVONEL WORKS" through "05 / READY FOR AI" was a third ordinal system on a
              page that already had a 01-06 step grid inside this section and a numbered strip
              above it, and it numbered five things that are not steps. Numbering belongs to the
              step grid, which is the one place on this page where it means sequence.
            */}
            <div className="one-path-section-heading">
              <h2 id="one-path-works-title">You bring the source. TAVONEL does the hard part.</h2>
              <p>Normal documents move through automatically. Difficult pages take a more specialized path, and anything TAVONEL cannot verify is surfaced for review instead of silently accepted.</p>
            </div>
            {/*
              BQ-129. A real ordered list, with real headings inside it.

              This was a `<div>` carrying an `aria-label` -- an attribute that names nothing,
              because a generic div has no role to name -- holding six more divs whose titles were
              `<strong>`. A screen reader was given six run-on sentences with no structure and no
              count. An `<ol>` announces "list, 6 items", and `<h3>` puts the step titles in the
              document outline under the section's own h2.
            */}
            <ol className="one-path-workflow">
              <li><h3>Checking files</h3><p>Identify format, integrity and what can be read natively.</p></li>
              <li><h3>Reading content</h3><p>Use structured extraction first and specialized processing where needed.</p></li>
              {/*
                G1-008, on the landing page this time. "Recovering structure — Preserve tables,
                layout, figures and document hierarchy" is exactly the claim the capability
                manifest carries `no_table_or_formula_extraction` and `no_native_structure_reader_yet`
                against, and /product/document-understanding already says the opposite in full
                paragraphs. The step names what the read leaves behind, which is also the part a
                reviewer can check.
              */}
              <li><h3>Keeping the place</h3><p>Read every region in the order it was printed and keep the page and the box it sat in.</p></li>
              <li><h3>Connecting knowledge</h3><p>Organize related information without detaching it from its sources.</p></li>
              <li><h3>Checking sources</h3><p>Verify evidence and surface exceptions before activation.</p></li>
              <li><h3>Ready</h3><p>Make the reviewed result available to your AI.</p></li>
            </ol>
            <div className="one-path-works-film" data-testid="one-path-works-film"><CompileStagePlayer stages={WORK_STAGES} preferVideo /></div>
          </div>
        </section>

        <section className="one-path-section" id="connect" data-scene="3" aria-labelledby="one-path-input">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><h2 id="one-path-input">Bring what you already have.</h2><p>No parser settings. No model selection. Choose what to bring and let the processing policy handle the route.</p></div>
            {/* BQ-129: the arrow glyphs are gone from these links. An underlined destination is
                already a destination; a decorative arrow after every one of them is not. */}
            <div className="one-path-source-options">
              <article><Files aria-hidden="true" size={26} /><h3>Files, folders & ZIP</h3><p>Choose a batch from your computer. Review the selection and cost before processing.</p><Link href={startHref} prefetch={false}>Start with files</Link></article>
              <article><Cloud aria-hidden="true" size={26} /><h3>Connected sources</h3><p>See the available cloud connections and choose the files you allow TAVONEL to read.</p><Link href="/integrations" prefetch={false}>Choose a connection</Link></article>
              <article><Server aria-hidden="true" size={26} /><h3>Private infrastructure</h3><p>For object storage or mounted shares, plan an assisted, customer-run connection.</p><Link href="/integrations" prefetch={false}>Plan a private connection</Link></article>
            </div>
            {/*
              G1-007. The chips listed spreadsheets and decks beside PDFs as peers. Both sentences
              under them are read off the capability manifest -- the one tier every accepted format
              holds, and the formats that reach the reader as PDF -- so a chip can never outrun
              what the upload route validates against.
            */}
            <details className="one-path-details"><summary>Supported files and connection details</summary><p>{sourceFamilyChips.join(" · ")}</p>{sourceSupportTier ? <p className="one-path-tier-note">Every format above is read at the <code>{sourceSupportTier}</code> tier{convertedToPdfFormats.length > 0 ? <> — {convertedToPdfFormats.join(", ")} are converted to PDF and read as PDF</> : null}. The per-format list, with the limits each one carries, is on <Link href="/sources" prefetch={false}>supported formats</Link>.</p> : null}<p>ZIPs open on your device. Only supported files are selected for upload; skipped files remain visible in the selection report.</p><div className="one-path-links"><Link href="/sources" prefetch={false}>Supported formats</Link><Link href="/integrations" prefetch={false}>Availability and permissions</Link></div></details>
          </div>
        </section>

        <section className="one-path-section one-path-proof" id="proof" data-scene="4" aria-labelledby="one-path-proof-title">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><h2 id="one-path-proof-title">Every result keeps a path back to the source.</h2><p>Open the original page beside the extracted passage. Check what survived instead of trusting a marketing claim.</p></div>
            {/*
              BQ-076 / n39. The proof block is the proof block, not a card inside a card.

              The wrapper drew a second border at a second radius around a figure that already
              brings its own frame, ground and radius, and its eyebrow restated the figcaption
              inside it word for word ("Public compiled World · Apple SEC corpus"). A kicker that
              restates the thing under it is deleted rather than restyled. `figure` already
              labels itself through `aria-labelledby`, so the wrapper's aria-label went with it.
            */}
            {proof}
            <div className="one-path-links"><Link href={"/explore?act=source" as Route} prefetch={false}>Inspect the public source</Link><Link href="/sources" prefetch={false}>What is preserved</Link></div>
          </div>
        </section>

        <section className="one-path-section" id="stays-current" data-scene="5" aria-labelledby="one-path-updates">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><h2 id="one-path-updates">A source changes. Your knowledge keeps up.</h2><p>Prepare the affected update, keep the current version usable, and review what changed before the new version becomes active.</p></div>
            {/*
              BQ-129. One column, because the content is one column.

              This was `minmax(0,1fr) minmax(0,1fr)` with the heading in one half and three short
              steps in the other, which left the second half of the section empty from the third
              step down -- the widest piece of blank ground on the page, in the middle of it.
            */}
            <ol className="one-path-update-steps">
              <li><h3>Prepare the update</h3><p>Keep the current result available while a new candidate is prepared.</p></li>
              <li><h3>Check what needs attention</h3><p>Open the source and review the items that need a decision.</p></li>
              {/* D9: the verb is *activate*. "Approve it for use" was one more name for the one
                  act this product is built around. */}
              <li><h3>Activate the new version</h3><p>Your approval changes the active version. Previous versions remain traceable.</p></li>
            </ol>
            <Link className="one-path-text-link" href={"/product/continuous-knowledge" as Route} prefetch={false}>How source updates work</Link>
          </div>
        </section>

        <section className="one-path-section one-path-output" id="ready-for-ai" data-scene="6" aria-labelledby="one-path-output-title">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><h2 id="one-path-output-title">Ready for your AI.</h2><p>Use the same reviewed, source-traceable knowledge from an assistant, agent, application or portable workflow.</p></div>
            <div className="one-path-output-options"><Link href="/docs/use-with-ai" prefetch={false}><strong>AI assistant</strong><span>Set up a supported connection</span></Link><Link href="/docs/quickstart" prefetch={false}><strong>Your application</strong><span>Build with the API</span></Link><Link href="/docs/cli" prefetch={false}><strong>Portable files</strong><span>Use and verify the package</span></Link></div>
            <div className="one-path-actions actions"><Link className="btn" href={startHref} onClick={() => trackFunnel("cta_clicked", { cta: "closing_start", scene: "6" })}>{signedIn ? "Use with AI" : access.label}<ArrowUpRight size={17} aria-hidden="true" /></Link><Link className="one-path-text-link" href="/pricing" prefetch={false}>See pricing</Link></div>
            {/*
              BQ-134 / n55. "You choose the source access and approve what becomes active." is
              step three of the section above it ("Activate the new version — your approval changes
              the active version") and the first half of the policy line below it. A shield icon
              beside a sentence the page has already made twice is the eighth element of a closing
              scene the ledger asks to be three.
            */}
            {/*
              Cross-lane from `truth`: the closing scene states what is open today.

              The sentence is `activationPolicy.customerData.reason` verbatim rather than a
              shortened badge written here. The header, /pricing, /security, /status, /login and
              /workspace all render that one string, and a second wording of the same gate on the
              page that asks for the click is exactly where the two would drift apart. It is a
              module constant, so it costs the client bundle a string and nothing else.
            */}
            <p className="one-path-state" data-customer-data={activationPolicy.customerData.enabled ? "open" : "arranged"}>{activationPolicy.customerData.reason}</p>
            <details className="one-path-details"><summary>Setup and availability</summary><p>Live AI access requires an activated version and the appropriate account access. A package download or opening the setup guide does not verify an external AI connection.</p><div className="one-path-links"><Link href="/trust" prefetch={false}>Trust Center</Link></div></details>
            {/*
              BQ-065. Below the close, which is where a logo wall would go.

              It sat between the proof block and the closing action, so a second `<h2>` -- one
              that is not part of the customer story -- interrupted the page at the point a reader
              is deciding. It is the last thing on the page now: someone who wants to know who
              else is using this finds it where they look for it, and nobody else is stopped by it
              on the way to the action.
            */}
            <DesignPartners className="one-path-design-partners" />
          </div>
        </section>
      </main>
      <PublicSiteFooter onePath />
    </div>
  );
}
