"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Cloud, Files, Server, ShieldCheck } from "lucide-react";
import CompileStagePlayer, { COMPILE_STAGES } from "@/components/compile-stage-player";
import { PublicSiteHeader } from "@/components/public-site-chrome";
import Logomark from "@/components/logomark";
import { FOOTER_GROUPS, ACCESS_CTA, SELF_SERVE_CTA } from "@/lib/site-navigation";
import { sourceFamilyChips } from "@/lib/qualified-input";
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
            <div className="one-path-intro">
              <p className="one-path-eyebrow">AI-READY KNOWLEDGE</p>
              <h1 id="one-path-title">Bring your knowledge.<br />TAVONEL makes it ready for AI.</h1>
              <p className="one-path-lede">Upload files or connect the systems you already use. TAVONEL handles the rest.</p>
              <div className="one-path-actions actions">
                <Link className="btn" href={startHref} onClick={() => trackFunnel("hero_start_clicked")}>{signedIn ? "Add knowledge" : access.label}<ArrowUpRight size={17} aria-hidden="true" /></Link>
                <a className="one-path-text-link" href="#how-it-works" onClick={() => trackFunnel("cta_clicked", { cta: "hero_see_how_it_works", scene: "1" })}>See how it works <span aria-hidden="true">↓</span></a>
              </div>
            </div>
            <div className="one-path-hero-film one-path-hero-film-v2" data-testid="one-path-hero-film">
              <div className="one-path-hero-film-steps" aria-hidden="true"><span>SOURCE</span><span>READ</span><span>ORGANIZE</span><span>READY FOR AI</span></div>
              <CompileStagePlayer stages={HERO_STAGE} preferVideo playbackRate={1.5} compact priorityPoster />
            </div>
            <p className="one-path-film-note">Hero V2 presentation — the approved source film is preserved and presented at a faster 12-second pace. The public sample below is the evidence surface.</p>
          </div>
        </section>

        <section className="one-path-section one-path-works" id="how-it-works" data-scene="2" aria-labelledby="one-path-works-title">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><p className="one-path-eyebrow">01 / TAVONEL WORKS</p><h2 id="one-path-works-title">You bring the source.<br />TAVONEL does the hard part.</h2><p>Normal documents move through automatically. Difficult pages take a more specialized path, and anything TAVONEL cannot verify is surfaced for review instead of silently accepted.</p></div>
            <div className="one-path-workflow" aria-label="How TAVONEL prepares knowledge">
              <div><span>01</span><strong>Checking files</strong><p>Identify format, integrity and what can be read natively.</p></div>
              <div><span>02</span><strong>Reading content</strong><p>Use structured extraction first and specialized processing where needed.</p></div>
              <div><span>03</span><strong>Recovering structure</strong><p>Preserve tables, layout, figures and document hierarchy.</p></div>
              <div><span>04</span><strong>Connecting knowledge</strong><p>Organize related information without detaching it from its sources.</p></div>
              <div><span>05</span><strong>Checking sources</strong><p>Verify evidence and surface exceptions before activation.</p></div>
              <div><span>06</span><strong>Ready</strong><p>Make the reviewed result available to your AI.</p></div>
            </div>
            <div className="one-path-works-film" data-testid="one-path-works-film"><CompileStagePlayer stages={WORK_STAGES} preferVideo /></div>
          </div>
        </section>

        <section className="one-path-section" id="connect" data-scene="3" aria-labelledby="one-path-input">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><p className="one-path-eyebrow">02 / CONNECT</p><h2 id="one-path-input">Bring what you already have.</h2><p>No parser settings. No model selection. Choose what to bring and let the processing policy handle the route.</p></div>
            <div className="one-path-source-options">
              <article><Files aria-hidden="true" size={26} /><h3>Files, folders & ZIP</h3><p>Choose a batch from your computer. Review the selection and cost before processing.</p><Link href={startHref}>Start with files <ArrowUpRight size={16} aria-hidden="true" /></Link></article>
              <article><Cloud aria-hidden="true" size={26} /><h3>Connected sources</h3><p>See the available cloud connections and choose the files you allow TAVONEL to read.</p><Link href="/integrations">Choose a connection <ArrowUpRight size={16} aria-hidden="true" /></Link></article>
              <article><Server aria-hidden="true" size={26} /><h3>Private infrastructure</h3><p>For object storage or mounted shares, plan an assisted, customer-run connection.</p><Link href="/integrations">Plan a private connection <ArrowUpRight size={16} aria-hidden="true" /></Link></article>
            </div>
            <details className="one-path-details"><summary>Supported files and connection details</summary><p>{sourceFamilyChips.join(" · ")}</p><p>ZIPs open on your device. Only supported files are selected for upload; skipped files remain visible in the selection report.</p><div className="one-path-links"><Link href="/sources">Supported formats</Link><Link href="/integrations">Availability and permissions</Link></div></details>
          </div>
        </section>

        <section className="one-path-section one-path-proof" id="proof" data-scene="4" aria-labelledby="one-path-proof-title">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><p className="one-path-eyebrow">03 / PROOF</p><h2 id="one-path-proof-title">Every result keeps a path back to the source.</h2><p>Open the original page beside the extracted passage. Check what survived instead of trusting a marketing claim.</p></div>
            {proof ? <div className="one-path-source-proof" aria-label="Published sample and its source"><p className="one-path-eyebrow">PUBLIC APPLE SEC SAMPLE · SOURCE INCLUDED</p>{proof}</div> : null}
            <div className="one-path-links"><Link href={"/explore?act=source" as Route}>Inspect the public source <ArrowUpRight size={16} aria-hidden="true" /></Link><Link href="/sources">What is preserved</Link></div>
          </div>
        </section>

        <section className="one-path-section" id="stays-current" data-scene="5" aria-labelledby="one-path-updates">
          <div className="one-path-wrap one-path-update-grid">
            <div className="one-path-section-heading"><p className="one-path-eyebrow">04 / STAYS CURRENT</p><h2 id="one-path-updates">A source changes.<br />Your knowledge keeps up.</h2><p>Prepare the affected update, keep the current version usable, and review what changed before the new version becomes active.</p></div>
            <div className="one-path-update-steps" aria-label="Review and activation workflow">
              <div><span>01</span><h3>Prepare the update</h3><p>Keep the current result available while a new candidate is prepared.</p></div>
              <div><span>02</span><h3>Check what needs attention</h3><p>Open the source and review the items that need a decision.</p></div>
              <div><span>03</span><h3>Approve it for use</h3><p>Your approval changes the active version. Previous versions remain traceable.</p></div>
              <Link className="one-path-text-link" href={"/product/continuous-knowledge" as Route}>How source updates work <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section className="one-path-section one-path-output" id="ready-for-ai" data-scene="6" aria-labelledby="one-path-output-title">
          <div className="one-path-wrap">
            <div className="one-path-section-heading"><p className="one-path-eyebrow">05 / READY FOR AI</p><h2 id="one-path-output-title">Ready for your AI.</h2><p>Use the same reviewed, source-traceable knowledge from an assistant, agent, application or portable workflow.</p></div>
            <div className="one-path-output-options"><Link href="/docs/use-with-ai"><strong>AI assistant</strong><span>Set up a supported connection ↗</span></Link><Link href="/docs/quickstart"><strong>Your application</strong><span>Build with the API ↗</span></Link><Link href="/docs/cli"><strong>Portable files</strong><span>Use and verify the package ↗</span></Link></div>
            <div className="one-path-actions actions"><Link className="btn" href={startHref} onClick={() => trackFunnel("cta_clicked", { cta: "closing_start", scene: "6" })}>{signedIn ? "Use with AI" : access.label}<ArrowUpRight size={17} aria-hidden="true" /></Link><Link className="one-path-text-link" href="/pricing">See pricing</Link></div>
            <p className="one-path-trust"><ShieldCheck size={16} aria-hidden="true" /> You choose the source access and approve what becomes active.</p>
            <details className="one-path-details"><summary>Setup and availability</summary><p>Live AI access requires an activated version and the appropriate account access. A package download or opening the setup guide does not verify an external AI connection.</p><div className="one-path-links"><Link href="/docs/use-with-ai">Integration guide</Link><Link href="/pricing">Plan limits</Link><Link href="/trust">Trust Center</Link></div></details>
          </div>
        </section>
      </main>
      <footer className="site one-path-footer"><div className="one-path-wrap"><span className="wordmark"><Logomark /><b>TAVONEL</b></span><div className="site-footer-groups">{FOOTER_GROUPS.map((group) => <nav key={group.title} aria-label={group.title}><p className="site-footer-title">{group.title}</p>{group.links.map((link) => <Link key={link.href} href={link.href as Route}>{link.label}</Link>)}</nav>)}</div><p className="fine">Your knowledge, with a path back to the source.</p></div></footer>
    </div>
  );
}
