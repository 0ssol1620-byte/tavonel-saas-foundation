"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import CompileStagePlayer from "@/components/compile-stage-player";
import { COMPILE_STAGES } from "@/lib/compile-stages";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import { ACCESS_CTA, BRAND_LINE, EXPLORE_CTA, SELF_SERVE_CTA } from "@/lib/site-navigation";
import { LANDING_FRAMES } from "@/lib/landing-frames";
import { FIRST_CALL } from "@/lib/developer-snippets";
import { activationPolicy } from "@/lib/activation-policy";
import { trackFunnel } from "@/lib/funnel-events";

/*
  Landing replan, 2026-09-18 (`D:\TAVONEL_LANDING_REPLAN_2026-09-18_KO.md`; the five audits are in
  `site-review-0915/reports/landing-0918/audit-*.md`).

  Five sections. What went, and why, in one place:

  - The film played twice (hero and How-it-works). No reference landing plays one film twice, and
    it was the single largest source of the "assembled" feel. One player, in the hero, from a
    re-rendered master (`compile-cut-hq.mp4`: the same 450 frames, lower CRF) with a poster at the
    size it is painted. The four original cuts stay locked and untouched.
  - The six-step 01-06 grid, the 3-up Connect cards, the 3-up update steps and the 3-up output
    cards were four equal grids in a row. One survives (sources and outputs); the rest became prose
    or real product frames.
  - The interactive Apple SEC proof block moved off the landing (founder decision, 2026-09-18).
    What replaces it, in the same deploy, is the thing it was proving: three screenshots of the
    live /explore route, each linked to the view it shows. Not an illustration, and not a claim.
  - The design-partner block, the phone jump nav and the page's own copy of the header status line
    are gone from this page; the deployment gate sentence moved up under the hero action, next to
    the click it qualifies.

  Copy rules kept: BRAND_LINE.headline is the H1 verbatim (founder-owned); the deployment gate is
  `activationPolicy.customerData.reason` verbatim; no number appears on this page.
*/
const HERO_STAGE = [{
  id: "hero-v3",
  label: COMPILE_STAGES[0]!.label,
  line: BRAND_LINE.descriptor,
  src: "/film/compile-cut-hq.mp4",
  phoneSrc: "/film/compile-cut-hq-1440.mp4",
  poster: "/film/poster-1-hero-2x.webp",
}] as const;

const STEPS = [
  {
    id: "compile",
    title: "Compile",
    body: "Files and connected sources go in. Every passage keeps the page it was printed on and the box it sat in, so nothing in the result is detached from where it came from.",
    frame: LANDING_FRAMES.compile,
  },
  {
    id: "verify",
    title: "Verify",
    body: "Open the original page beside the passage that was read from it. What TAVONEL cannot verify is surfaced for review, not silently accepted.",
    frame: LANDING_FRAMES.verify,
  },
  {
    id: "recompile",
    title: "Recompile",
    body: "A source changes and only what that change reaches is rebuilt. The current version stays live until you activate the new one.",
    frame: LANDING_FRAMES.recompile,
  },
] as const;

const PROPERTIES = [
  ["Evidence, not excerpts", "Each compiled object names the page and the region it was read from, and the original stays beside it."],
  ["Identity that holds", "One entity keeps one identity across the documents that mention it, instead of becoming a new node in every file."],
  ["Order in time", "Versions are ordered. A superseded statement stays traceable rather than disappearing from the answer."],
  ["Dependencies, kept", "A changed clause rebuilds what depends on it and nothing else. That is what makes a recompile cheaper than a re-run."],
  ["Fail closed", "Knowledge that cannot be verified is not published as if it were. It is held for review, and the page says so."],
] as const;

export default function HomePageClient({ liveCommerce, formats }: { liveCommerce: boolean; formats: string }) {
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
  const explore = EXPLORE_CTA.href as Route;
  return (
    <div className="page landing-page one-path-home">
      <PublicSiteHeader cta={access} signedIn={signedIn} />
      <main id="main" tabIndex={-1}>
        <section className="one-path-hero" id="top" aria-labelledby="one-path-title" data-scene="1" tabIndex={-1}>
          <div className="one-path-wrap">
            <div className="one-path-intro">
              {/* COPY-05: who the page is for, in one sentence, before the headline. */}
              <p className="one-path-audience">For teams whose answers have to survive an audit: filings, contracts, standards and manuals.</p>
              <h1 id="one-path-title">{BRAND_LINE.headline}</h1>
              {/* The lede is the brand descriptor, which used to reach a visitor only in the footer. */}
              <p className="one-path-lede">{BRAND_LINE.descriptor}</p>
              <div className="one-path-actions actions">
                <Link className="btn" href={startHref} onClick={() => trackFunnel("hero_start_clicked")}>{signedIn ? "Add knowledge" : access.label}<ArrowUpRight size={17} aria-hidden="true" /></Link>
                <Link className="one-path-text-link" href={explore} prefetch={false} onClick={() => trackFunnel("cta_clicked", { cta: "hero_explore", scene: "1" })}>{EXPLORE_CTA.label}</Link>
              </div>
              {/*
                The gate sentence, beside the click it qualifies. It is `activationPolicy` verbatim:
                the header, /pricing, /security, /status, /login and /workspace render the same
                string, and a second wording here is where they would drift apart.
              */}
              <p className="one-path-state" data-customer-data={activationPolicy.customerData.enabled ? "open" : "arranged"}>{activationPolicy.customerData.reason}</p>
            </div>
            <div className="one-path-hero-film one-path-hero-film-v2" data-testid="one-path-hero-film">
              <CompileStagePlayer stages={HERO_STAGE} preferVideo playbackRate={1.5} compact priorityPoster />
            </div>
            {/*
              G1-003 / G1-004. The cut draws three things ahead of this deployment; the sentence that
              stops a reader inferring them from a picture stays under the film, and it is one
              sentence now rather than a disclosure nobody opens.
            */}
            <p className="one-path-film-note">
              A directed film, not a screen recording: the ruled table, the section-and-line labels and the <code>.csv</code> sources in it run ahead of this deployment. What a compile emits today is the paragraph as it was printed, the page it was read from and the box it sat in. The three frames below are that output, on the live route.
            </p>
          </div>
        </section>

        <section className="one-path-section one-path-steps-section" id="compile" data-scene="2" aria-labelledby="one-path-steps-title" tabIndex={-1}>
          <div className="one-path-wrap">
            <div className="one-path-section-heading">
              <h2 id="one-path-steps-title">Compile. Verify. Recompile.</h2>
              <p>Three steps, in the order they run. Nothing becomes active until a person approves it.</p>
            </div>
            {/*
              Real frames. Each image is a screenshot of the public /explore route at the view it
              links to (`lib/landing-frames.ts` records the URL, the capture date and what is on
              it). A reader can open the same screen with the link under it.
            */}
            <ol className="one-path-steps">
              {STEPS.map((step, index) => (
                <li key={step.id} className="one-path-step" data-side={index % 2 ? "right" : "left"}>
                  <figure className="one-path-frame">
                    <Link href={step.frame.href as Route} prefetch={false} aria-label={`Open the ${step.title} view`}>
                      <picture>
                        <source media="(max-width: 799px)" srcSet={step.frame.phone.src} width={step.frame.phone.width} height={step.frame.phone.height} />
                        <img src={step.frame.desktop.src} width={step.frame.desktop.width} height={step.frame.desktop.height} alt={step.frame.alt} loading="lazy" decoding="async" />
                      </picture>
                    </Link>
                    <figcaption>{step.frame.caption}</figcaption>
                  </figure>
                  <div className="one-path-step-copy">
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                    <Link className="one-path-text-link" href={step.frame.href as Route} prefetch={false}>{`Open the ${step.title} view`}</Link>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="one-path-section one-path-why" id="why" data-scene="3" aria-labelledby="one-path-why-title" tabIndex={-1}>
          <div className="one-path-wrap">
            <div className="one-path-section-heading">
              <h2 id="one-path-why-title">A parser returns text. A compiler keeps the dependencies.</h2>
              <p>Reading a document once is the easy part. What a fresh re-run cannot invent is everything that connects the results, and that is what a Compiled World carries.</p>
            </div>
            {/* No cards. A hanging list: the label, then the sentence. */}
            <dl className="one-path-properties">
              {PROPERTIES.map(([term, detail]) => (
                <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>
              ))}
            </dl>
            <div className="one-path-links">
              <Link href="/knowledge-compiler" prefetch={false}>What a Knowledge Compiler is</Link>
              <Link href={"/product/continuous-knowledge" as Route} prefetch={false}>How source updates work</Link>
            </div>
          </div>
        </section>

        <section className="one-path-section one-path-io" id="sources" data-scene="4" aria-labelledby="one-path-io-title" tabIndex={-1}>
          <div className="one-path-wrap">
            <div className="one-path-section-heading">
              <h2 id="one-path-io-title">Bring what you have. Use it where you work.</h2>
              <p>Nothing to configure. Choose what to bring; TAVONEL picks the route. Out through an assistant, your own application, or a portable package you can verify.</p>
            </div>
            {/* The one equal grid on the page: three ways in, three ways out, and the first call. */}
            <div className="one-path-io-grid">
              <div className="one-path-io-col">
                <h3>In</h3>
                <ul>
                  <li><strong>Files, folders &amp; ZIP</strong><span>Choose a batch from your computer. You see the selection and its price before anything runs.</span><Link href={startHref} prefetch={false}>{liveCommerce ? "Start with files" : "Ask about compiling your files"}</Link></li>
                  <li><strong>Connected sources</strong><span>See the available cloud connections and choose the files you allow TAVONEL to read.</span><Link href="/integrations" prefetch={false}>Choose a connection</Link></li>
                  <li><strong>Private infrastructure</strong><span>Object storage or mounted shares, set up with us in your environment.</span><Link href="/sources" prefetch={false}>Supported files</Link></li>
                </ul>
              </div>
              <div className="one-path-io-col">
                <h3>Out</h3>
                <ul>
                  <li><strong>AI assistant</strong><span>Connect over MCP. The same knowledge, with its citations, wherever you already ask questions.</span><Link href="/docs/use-with-ai" prefetch={false}>Use results with AI</Link></li>
                  <li><strong>Your application</strong><span>Build with the API.</span><Link href="/docs/quickstart" prefetch={false}>Quickstart</Link></li>
                  <li><strong>Portable files</strong><span>Take the package with you, and check what is inside it with the published verifier.</span><Link href="/docs/cli" prefetch={false}>CLI and package verification</Link></li>
                </ul>
              </div>
              <figure className="one-path-code">
                <figcaption>The first call, from the developer guide</figcaption>
                <pre role="region" tabIndex={0} aria-label="The first API call, as a curl command. Scroll sideways to read the whole line."><code>{FIRST_CALL}</code></pre>
              </figure>
            </div>
          </div>
        </section>

        <section className="one-path-section one-path-close" id="start" data-scene="5" aria-labelledby="one-path-close-title" tabIndex={-1}>
          <div className="one-path-wrap">
            <div className="one-path-section-heading">
              <h2 id="one-path-close-title">Start with the World that is already compiled.</h2>
              <p>Read it in full today, then tell us what you need compiled next.</p>
            </div>
            <div className="one-path-actions actions">
              <Link className="btn" href={startHref} onClick={() => trackFunnel("cta_clicked", { cta: "closing_start", scene: "5" })}>{signedIn ? "Use with AI" : access.label}<ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link className="one-path-text-link" href={explore} prefetch={false} onClick={() => trackFunnel("cta_clicked", { cta: "closing_explore", scene: "5" })}>{EXPLORE_CTA.label}</Link>
              <Link className="one-path-text-link" href="/pricing" prefetch={false}>See pricing</Link>
            </div>
            {/*
              COPY-44 / TRUST-07. The six questions a buyer asks before they write, answered in the
              words the pages that own them already use, each with the link to that page. Nothing
              here is new copy about the product: the training and provider answers are the
              /security rows, the formats line is the capability manifest, the gate is the shared
              activation record.
            */}
            <div className="one-path-faq">
              <h3 id="one-path-faq-title">Questions we get first</h3>
              <details className="one-path-details"><summary>Are my documents used to train models?</summary><p>No. Your documents are not used to train shared models. Models read your sources to compile your world, and for nothing else. <Link href="/security" prefetch={false}>Security</Link></p></details>
              <details className="one-path-details"><summary>Which model providers see my documents?</summary><p>No third-party model API receives your documents in this deployment: document reading runs on GPU workers TAVONEL operates, and every document is treated as hostile data. <Link href="/security" prefetch={false}>Security</Link></p></details>
              <details className="one-path-details"><summary>What happens when a passage cannot be verified?</summary><p>It is held for review and surfaced as such, not published as if it were verified. Fail closed is a property of the compiler, not a setting. <Link href="/trust" prefetch={false}>Trust Center</Link></p></details>
              <details className="one-path-details"><summary>What can I bring?</summary><p>{formats}, as files, folders or a ZIP, plus connected sources. Every accepted format is sanitized to PDF and read the same way, so each passage keeps its page and region. <Link href="/sources" prefetch={false}>Supported sources</Link></p></details>
              <details className="one-path-details"><summary>Can I compile my own files today?</summary><p>{activationPolicy.customerData.reason} <Link href={startHref}>{access.label}</Link></p></details>
              <details className="one-path-details"><summary>Can what I upload be deleted?</summary><p>Source material, derived artifacts and compiled packages can be deleted on request, and that request is carried out by a person rather than by a self-service control. <Link href="/security" prefetch={false}>Retention and deletion</Link></p></details>
            </div>
            <p className="one-path-fine">Documents are treated as hostile data: the models that read them get no tools, no broad credentials and no outbound network. <Link href="/security" prefetch={false}>Security</Link> · <Link href="/trust" prefetch={false}>Trust Center</Link></p>
          </div>
        </section>
      </main>
      <PublicSiteFooter onePath />
    </div>
  );
}
