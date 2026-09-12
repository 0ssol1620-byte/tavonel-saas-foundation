"use client";

/**
 * Home. Three locked compile cuts carry the argument.
 * Copy is the headline, one lede, two band lines, then proof.
 */

import Link from "next/link";
import type { Route } from "next";
import { Fragment, cloneElement, isValidElement, useCallback, useEffect, useState } from "react";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import CompileStagePlayer, { type CompileStage } from "@/components/compile-stage-player";
import Logomark from "@/components/logomark";
import { PublicSiteHeader } from "@/components/public-site-chrome";
import WorldField, { type WorldMode } from "@/components/world-field";
import { trackFunnel, trackSceneDepth } from "@/lib/funnel-events";
import { sourceFamilyChips } from "@/lib/qualified-input";
import { FOOTER_GROUPS } from "@/lib/site-navigation";
import { useScrollProgress, useScrollScenes } from "@/lib/use-scroll-scenes";

const SCENES = [
  { id: 1, label: "KNOWLEDGE COMPILER" },
  { id: 2, label: "INPUT" },
  { id: 3, label: "COMPILE FILM" },
  { id: 4, label: "EVIDENCE" },
  { id: 5, label: "START" },
] as const;

/*
  The three jobs, each pointing at the solution page that already carries its limits.

  Written as input -> usable result -> where to check it, and deliberately without a number:
  nothing here is measured, and a "40% faster" on a landing page is the kind of figure §35 bars
  and this repository has no receipt for. The destinations are the existing
  `app/solutions/[slug]` slugs; `brand-copy.test.ts` checks each one resolves.
*/
const JOBS = [
  {
    eyebrow: "TECHNICAL SUPPORT",
    title: "Answer from the manual that is current",
    body: "In: the manuals, scans and service notes your team already keeps. Out: a reviewed World where every answer opens the document version and the place inside it that the answer was read from. What the read does and does not recover is on the solution page.",
    href: "/solutions/document-intelligence" as Route,
    action: "Reading difficult documents",
  },
  {
    eyebrow: "CONTRACT AND ANNEX REVIEW",
    title: "See what the annex changed before you sign",
    body: "In: a contract and the annexes that amend it. Out: one knowledge asset every AI project reads instead of re-cleaning the same files, with the source behind each claim. Where a compile is not worth it is stated on the solution page.",
    href: "/solutions/ai-ready-knowledge" as Route,
    action: "One grounded knowledge asset",
  },
  {
    eyebrow: "CHANGE IMPACT",
    title: "Know what a revised source moved",
    body: "In: a source that has been revised. Out: a candidate version beside the active one, promoted only by a person, with the previous revision still readable. What rollback does not undo is stated on the solution page.",
    href: "/solutions/knowledge-operations" as Route,
    action: "Running knowledge as an operation",
  },
] as const;

type BandName = "scatter" | "structure" | "world" | "change" | "rebuild" | "answer" | "access";

/*
  A band now only chooses how the background field renders.

  It also carried `state`, `version` and `facts` for the instrument bar, every one of them read
  from a demonstration fixture. Those fields are gone along with the bar readouts they fed.
*/
const BANDS: Record<BandName, { mode: WorldMode }> = {
  scatter: { mode: "scatter" },
  structure: { mode: "structure" },
  world: { mode: "current" },
  change: { mode: "change" },
  rebuild: { mode: "recompile" },
  answer: { mode: "answer" },
  access: { mode: "current" },
};

export default function HomePageClient({ liveCommerce }: { liveCommerce: boolean }) {
  const [signedIn, setSignedIn] = useState(false);
  const [filmStage, setFilmStage] = useState("SOURCES");
  const handleStageChange = useCallback((stage: CompileStage) => setFilmStage(stage.label), []);

  /*
    In pilot there is nothing to check out, so the primary action is to ask for access.

    Read on the server from the one commercial state and handed in as a prop: a client component
    cannot see COMMERCIAL_MODE, so deciding this here would silently call every deployment a
    pilot — including a live one.
  */
  const startHref = (signedIn ? "/workspace" : liveCommerce ? "/login" : "/contact") as Route;
  const startLabel = signedIn ? "Open workspace" : liveCommerce ? "Start with your files" : "Request access";

  const { scene, band } = useScrollScenes(SCENES.length);
  const progress = useScrollProgress();
  const active = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const world = BANDS[(band as BandName) in BANDS ? (band as BandName) : "scatter"];
  useEffect(() => { trackSceneDepth(scene); }, [scene]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client || cancelled) return;
      const { data } = await client.auth.getSession();
      if (!cancelled) setSignedIn(Boolean(data.session));
      client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setSignedIn(Boolean(session));
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const jump = (id: number) => {
    document.getElementById(`s${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cta = (name: string) => () => {
    trackFunnel("cta_clicked", { cta: name, scene: String(scene) });
  };

  return (
    <div className="page landing-page">
      {/*
        The first stage's poster, not its film.

        This was a high-priority `preload` of an 18-second video, written when cut 1 was the hero
        and never revisited after it moved three screens down into the compile scene. It was
        pulling a megabyte ahead of the fonts for text the visitor was actually reading, to fill
        a frame below the fold. The player admits the first film when the scene comes into view;
        what is worth having early is the still that holds the frame's shape until it does.
      */}
      <link rel="preload" as="image" href="/film/poster-1.webp" fetchPriority="low" />
      <OpeningWorldField band={band} mode={world.mode} />

      {/*
        The shared header, with the three things the landing page needs on top of it: the badge,
        the scroll-reactive ground, and its own access label. What it no longer keeps is a second
        copy of the section row -- the reason a menu change had to be made in four files.
      */}
      <PublicSiteHeader
        cta={{ label: startLabel, href: startHref }}
        mode={{ label: "KNOWLEDGE COMPILER", title: "Source-grounded document and knowledge compilation." }}
        signedIn={signedIn}
        stuck={progress > 0.005}
      />

      {/*
        BA-012. A progress indicator, not five controls a keyboard cannot reach.

        These were `<button>`s with the container `aria-hidden` and every one of them
        `tabIndex={-1}`: they looked like controls, worked for a mouse and did not exist for a
        keyboard or a screen reader, which is worse than no control at all (§14.3). The rail's
        job on this page is to say where the reader is, and that is what it now is -- the scene
        jumper that is a real control lives in the bar, where the 44px floor is met.
      */}
      <div className="rail" aria-hidden="true">
        {SCENES.map((s) => (
          <span key={s.id} className={s.id === scene ? "tick on" : "tick"}>
            <i />
            {String(s.id).padStart(2, "0")}
          </span>
        ))}
      </div>

      <main id="main" tabIndex={-1}>
        <section className="scene hero" id="s1" data-scene="1" data-band="scatter">
          <div className="shell">
            <p className="slate"><b>TAVONEL</b><span /> KNOWLEDGE COMPILER</p>
            {/*
              The headline names the gap the buyer arrives with, not the machinery.

              "Turn documents and connected systems into a source-grounded world your AI can
              use" described what the product does to files. What a buyer already has is an
              assistant that can search those files and still answers from stale or
              unattributable material, so the headline states that gap and the lede states the
              two properties that close it. Neither adjective is left to mean whatever the
              reader wants: current is defined as recompiled when the sources change, traceable
              as every fact pointing at the place it came from.

              Deliberate re-derivation of a locked string under RESOLVED A-2 (2026-09-06).
              `brand-copy.test.ts` locks the new wording in the same commit.
            */}
            <h1>
              <span className="line"><i>Your AI needs more than searchable files.</i></span>
              <span className="line dim"><i>It needs a current, traceable world.</i></span>
            </h1>
            <p className="lede">
              TAVONEL compiles your own sources into that world: current, because it is
              recompiled when those sources change, and traceable, because every compiled fact
              stays traceable to its exact source location.
            </p>
            {/*
              Understanding comes before the account.

              The primary action used to be "Request access" — a contact form asked of someone
              who has been on the page for four seconds and has not yet seen the product do
              anything. The compiled world at /explore is the argument; the form is what you
              fill in once the argument has landed. So Explore takes the primary weight and the
              access action keeps its place beside it, unchanged in destination and wording.
              Scene 05 still leads with the access action: by then the visitor has watched the
              whole sequence and starting is the next move.
            */}
            <div className="actions">
              <ExploreLink className="btn" onActivate={() => trackFunnel("hero_explore_clicked")} />
              <Link className="btn ghost" href={startHref} onClick={() => trackFunnel("hero_start_clicked")}>{startLabel}</Link>
              {/*
                The tertiary action §10.1 asks for, as a link rather than a third button.

                /product is the page that answers "how does this work". A third button here
                would compete with the two that matter and would mostly duplicate the rail and
                the instrument bar, which already move a reader through this page.
              */}
              <Link className="hero-tertiary" href={"/product" as Route}>See how it works</Link>
            </div>
            {/*
              §10.2's proof strip. Five properties, each one a page on this site.

              Deliberately not a metrics row: §35 bars invented company numbers and there are no
              measured ones that belong here. What it carries instead is the shape of the
              product -- what goes in, what holds it together, what comes out -- with every item
              linked to the surface that substantiates it. Each destination exists, and each is
              the page that would have to be edited if its claim stopped being true.
            */}
            <ul className="hero-proof" aria-label="What a compiled world carries">
              <li><Link href={"/sources" as Route}>Documents, scans, spreadsheets, decks</Link></li>
              <li><Link href="/evidence">Evidence-bound</Link></li>
              <li><Link href={"/product/continuous-knowledge" as Route}>Version-aware</Link></li>
              <li><Link href="/security">Reviewed before it goes live</Link></li>
              <li><Link href={"/developers" as Route}>MCP · API · signed export</Link></li>
            </ul>
            {/*
              Audit B01 / U02 / B02: three jobs, before the vocabulary.

              The locked hero names the gap and the lede defines the two adjectives, and then the
              page went straight into World, compile, candidate and ontology -- five scenes of
              machinery before a visitor could tell whether any of it was about their work. These
              three cards are the first thing under the hero for that reason: each names a job,
              what goes in, what comes back out usable, and the page that carries its limits and
              its worked sample. No card carries a figure, because none is measured; each links to
              an existing solution page rather than inventing a new one.
            */}
            <div className="tiles" aria-label="Three jobs this is built for">
              {JOBS.map((job) => (
                <article className="tile" key={job.href}>
                  <span className="n">{job.eyebrow}</span>
                  {/*
                    h2, not h3: these are the first sections under the hero, so an h3 here jumped the
                    outline h1 -> h3 on the landing page - the same defect the qa lane found on
                    /pricing, introduced on / when this block was added. `.tiles .tile h2` keeps the
                    card treatment, the way `.chain .link h2` already does for the same situation.
                  */}
                  <h2>{job.title}</h2>
                  <p>{job.body}</p>
                  <Link className="input-next" href={job.href}>{job.action} →</Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <Scene id={2} band="structure" eyebrow="INPUT" title="Bring the knowledge you already have.">
          <p className="lede rv">Start with files or connect the systems where your knowledge lives.</p>
          {/*
            Named formats, not a category, and named by the manifest rather than by this file.

            "Office documents" reads as every Office file ever made, and the intake whitelist is
            narrower: the OOXML and OpenDocument formats the manifest lists, but not legacy
            DOC/XLS/PPT. Naming the extensions is the difference between a promise and a
            rejection at upload -- which is why the format chips are derived from the Capability
            Manifest, the same list the server validates against and /sources publishes. A
            format this page offers is a format the upload route accepts, by construction rather
            than by remembering to edit two files.
          */}
          <ul className="input-formats rv" aria-label="Formats this deployment reads">
            {sourceFamilyChips.map((source) => <li key={source}>{source}</li>)}
          </ul>
          {/*
            The landing page explains the two source routes by access mode and next action.
            Detailed qualification labels and provider evidence stay on /integrations, where a
            reader can inspect the scope instead of reading a status badge without context.
          */}
          <ol className="intake-flow rv" aria-label="How sources enter a compiled world" data-visual>
            <li>
              <span className="intake-flow-index" aria-hidden="true">01</span>
              <div><strong>Choose</strong><span>Files · folders · ZIP</span></div>
            </li>
            <li>
              <span className="intake-flow-index" aria-hidden="true">02</span>
              <div><strong>Inspect</strong><span>Security and format checks</span></div>
            </li>
            <li>
              <span className="intake-flow-index" aria-hidden="true">03</span>
              <div><strong>Compile</strong><span>Supported content enters your World</span></div>
            </li>
          </ol>
          {/*
            BA-009. The same two facts, with the one the reader can act on first.

            "ZIPs open locally. Only supported files inside are uploaded." told a visitor what
            gets refused in the scene where they are deciding to hand over their own material.
            Both facts are still here and neither is softened -- the archive is expanded in the
            browser (`lib/archive-expand.ts`, on a worker or the main thread) and only the
            manifest's formats leave the machine -- but the sentence now names what happens
            rather than what does not. The step above already says supported content enters your
            World, so this is that claim in the ZIP's own words, not a new one.
          */}
          <p className="input-guidance rv">
            ZIPs open on your machine, and the supported files inside compile straight into your World. <Link className="input-next" href="/sources">See supported formats →</Link>
          </p>
          <div className="source-routes rv" aria-label="Ways to bring sources into TAVONEL">
            <article className="source-route">
              <div className="source-route-heading">
                <span className="source-route-index" aria-hidden="true">01</span>
                <div>
                  <p className="source-route-kind">Cloud systems</p>
                  <h3>Google Drive · Dropbox · OneDrive / SharePoint</h3>
                </div>
              </div>
              <p>Bring documents in with read-only access. Changes return through the same review flow.</p>
              <dl className="source-route-facts">
                <div><dt>Access</dt><dd>Read-only OAuth</dd></div>
                <div><dt>Before use</dt><dd>Verify the connection</dd></div>
              </dl>
              <Link className="input-next" href="/integrations">See cloud connections →</Link>
            </article>
            <article className="source-route">
              <div className="source-route-heading">
                <span className="source-route-index" aria-hidden="true">02</span>
                <div>
                  <p className="source-route-kind">Private infrastructure</p>
                  <h3>Object storage and mounted shares</h3>
                </div>
              </div>
              <p>Keep private repositories inside your network with a customer-run import agent.</p>
              <dl className="source-route-facts">
                <div><dt>Access</dt><dd>Customer-run agent</dd></div>
                <div><dt>Setup</dt><dd>Assisted</dd></div>
              </dl>
              <Link className="input-next" href="/integrations">Plan a private connection →</Link>
            </article>
          </div>
        </Scene>

        <Scene id={3} film band="change" eyebrow="COMPILE FILM" title="Watch knowledge take shape.">
          <CompileStagePlayer onStageChange={handleStageChange} />
          {/*
            Audit B06. Four evidence levels share this page -- a directed film, a research
            fixture, the public Apple sample and a customer's own run -- and the film is the one a
            visitor is most likely to read as a screen recording of the product. It is not one.
            Saying so in one line, next to the thing itself, is cheaper than any disclaimer and
            points at the surface where the real interface is: /explore renders a World compiled
            from committed public filings by the same compiler.
          */}
          {/*
            The caption carries no inline link, for the reason the evidence scene records below:
            `mobile-landing.spec.ts` measures every a/button/summary on `/` under a coarse pointer
            against a 44px floor, and a link inside a 14px `.fine` paragraph is about 18px. The
            pointer to the real interface goes in the actions row, where the floor is met.
          */}
          {/*
            BA-010. The same disclosure, in the order a confident page would write it.

            It read "These four cuts are a directed recreation of a compile, not a screen
            recording of the product. The working interface runs over a World compiled from
            committed public filings by the same compiler" -- four words of throat-clearing
            before the disclosure and the product in the passive. The disclosure is untouched
            and still first, because that is where it belongs; what changed is that the compiler
            is the subject of the sentence after it. "not a screen recording" stays verbatim:
            `brand-copy.test.ts` pins that phrase, and rewording a disclosure the guard holds is
            not something a copy pass gets to do.
          */}
          <p className="fine rv">
            A directed recreation of a compile, not a screen recording. The same compiler runs
            the working interface, over a World compiled from committed public filings.
          </p>
          <div className="actions rv">
            {/*
              No label override. An unqualified /explore link is "the door" and always reads
              "Explore a Compiled World" -- landing.spec.ts states that rule and this link broke
              it, which is the drift the one-component refactor existed to prevent. A link with
              its own wording has to be a named proof (/explore?act=...), and this one is not:
              it points at the working interface in general, which is the door. The caption
              above it already says what is on the other side.
            */}
            <ExploreLink className="btn ghost" />
          </div>
        </Scene>

        {/*
          The path ends at a location, not at a page.

          It used to read "Object → relation → evidence → document page → exact bounding box",
          which is what a PDF locator looks like and was written as though it were what evidence
          is. A cell in a spreadsheet, a shape on a slide and a MIME part in an email are exact
          locations too, and none of them has a page. RESOLVED A-1 names the abstraction; the
          per-source forms it covers are set out once, on /evidence, rather than repeated on
          every surface, and /sources stays the answer to what is read here today.
        */}
        <Scene id={4} band="answer" eyebrow="EVIDENCE" title="Follow grounded results back to the source.">
          <p className="lede rv">Every compiled fact stays traceable to its exact source location. Ask citations open that same location.</p>
          <div className="evidence-path rv" aria-label="Evidence path">
            {['Object', 'Relation', 'Evidence', 'Source version', 'Exact location'].map((step, index) => (
              <Fragment key={step}><span>{step}</span>{index < 4 ? <i aria-hidden="true">→</i> : null}</Fragment>
            ))}
          </div>
          {/*
            The pointer to /sources is a button, not a link in fine print.

            It was written as an inline link inside this sentence and `mobile-landing.spec.ts`
            caught it: on a touch phone the tap target was 33px tall against a 44px floor. A
            sentence can carry the nuance; the thing a thumb has to hit belongs in the actions
            row, where every other control on this page already meets the floor.
          */}
          <p className="fine rv">
            What a location is depends on the source — a page and a region in a PDF, a sheet and
            a cell in a spreadsheet, a slide and a shape in a deck. Which of those this
            deployment reads today is published, in full, as its capability manifest.
          </p>
          {/*
            Two proofs, opened where the proof is, and Scene E of §10.3 with them.

            The scene argues that a result returns to its source and that a world moves when its
            sources do. Both are demonstrable in the public Apple SEC sample, and both were a
            click into Explore's entry act away from being found. `?act=evidence` and
            `?act=change` are the query vocabulary `lib/explore-story.ts` resolves, so each link
            lands on the act that shows the thing this scene just claimed.
          */}
          {/*
            BA-004. Two named proofs, not three buttons.

            The row was "Explore a Compiled World" + "See what a new filing changed" + "What this
            deployment reads": three controls in one batch, which §3.4 bars, and the first of
            them repeated the door's label a third time in one render. Both surviving links are
            `?act=` proofs of the sentence directly above them, so each carries its own label --
            the rule `ExploreLink` already states. /sources lost its button and not its place on
            the page: the hero proof strip and the input scene's "See supported formats" both
            point at it, and a third pointer to the same page cannot be worth a third primary.
            It is not an inline link in the caption for the reason this file records twice
            already -- a link in a 14px `.fine` paragraph is an 18px tap target against a 44px
            floor that `mobile-landing.spec.ts` measures.
          */}
          <div className="actions rv">
            <ExploreLink className="btn" act="evidence" label="Follow a citation to its source" />
            <ExploreLink className="btn ghost" act="change" label="See what a new filing changed" />
          </div>
        </Scene>

        <Scene id={5} band="access" eyebrow="START" title="Compile your own knowledge.">
          {/*
            BA-004, the half of it that is not a button count.

            Scene 01 leads with Explore and scene 05 leads with the access action, and
            `landing.spec.ts` asserts that mirror deliberately -- but the page never said why the
            weights swap, so a reader met the same two buttons in the opposite order for no
            stated reason. The lede now says it: the World they were just shown is ours, and the
            next one is theirs. Nothing here claims the reader opened it; what it claims is what
            the page has been showing, which is a World compiled from committed public filings.
          */}
          <p className="lede rv">The compiled World on this page is ours, built from public filings. The next one is yours: files go in, structured and traceable knowledge comes out.</p>
          {/*
            Scene F of §10.3, in one sentence rather than a sixth scene.

            What the compiled world is *for* was the one step of the story this page never
            stated: a reader reached the closing action without being told what they would then
            hold. The three ways to use it are described in full on /developers, and this is the
            line that says they exist.
          */}
          {/*
            No inline link here, for the reason the evidence scene already records: an inline
            link in a `.fine` paragraph is a 14px tap target against a 44px floor, and
            `mobile-landing.spec.ts` measures it. The three ways to use a compiled world are set
            out on /developers, which is in the primary nav, in the footer and in the hero proof
            strip; this sentence's job is to say they exist.
          */}
          <p className="fine rv">
            Then your AI reads it: live over MCP or the API, as a signed portable package, or
            through Ask with a person in front of it.
          </p>
          <div className="actions rv">
            {/*
              Two actions, not three. "Connect a source" asked a visitor who has not yet seen the
              product to authorise OAuth against their company drive. It belongs in the empty
              state after sign-up, where connecting something is the obvious next move.
            */}
            <Link className="btn" href={startHref} onClick={cta("closing_start")}>{startLabel}</Link>
            <ExploreLink className="btn ghost" />
          </div>
        </Scene>
      </main>

      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <div className="site-footer-groups">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <p className="site-footer-title">{group.title}</p>
                {group.links.map((link) => <Link key={link.href} href={link.href as Route}>{link.label}</Link>)}
              </nav>
            ))}
          </div>
          <p className="fine">Knowledge compiled with a traceable path back to every source.</p>
        </div>
      </footer>

      <div className="bar" role="status" aria-live="off" data-scene={scene}>
        <span className="scroll" style={{ width: `${progress * 100}%` }} />
        {/*
          BA-007. The bar reports where the reader is, and nothing else.

          It also carried a control -- BRING YOUR SOURCES / WATCH IT COMPILE / FOLLOW THE
          EVIDENCE / START / REQUEST ACCESS -- in 9.5px mono caps, which was a fifth CTA system
          on a page that already has a sticky filled action in the header and one primary per
          scene: three primaries could be on screen at once, and "SCENE 02" put stage-direction
          vocabulary in front of a buyer. The scene jumper stays, because it is the only scene
          control that meets the touch floor; the readout is now a position (`02 / 05`) rather
          than a direction. `cta_clicked` moved with the deletion to the closing scene's primary,
          which is a CTA click by any definition -- the event is not dropped, it is fired from a
          control that means what it reports.

          It used to read WORLD v184 / FACTS 128,470 / NEEDS REVIEW 1, taken from a demo fixture.
          While the page still carried a large "this is a demonstration" disclaimer those numbers
          were legible as illustration. The disclaimer came off — correctly, it was defensive and
          in the way — and the numbers stayed, which left three precise, wholly invented figures
          reading as measured results from a customer deployment. There is no version of this bar
          with fictional metrics on it that is worth the disclaimer needed to keep them.
        */}
        <span className="bc"><span className="bk">STAGE</span><span className="bv">{filmStage}</span></span>
        <span className="bar-ticks" aria-label="Sections of this page">
          {SCENES.map((sc) => (
            <button
              key={sc.id}
              type="button"
              className={sc.id === scene ? "bt on" : "bt"}
              aria-label={`Go to ${sc.label}`}
              aria-current={sc.id === scene ? "true" : undefined}
              onClick={() => jump(sc.id)}
            />
          ))}
        </span>
        <span className="bc right"><span className="bv">{String(active.id).padStart(2, "0")} / {String(SCENES.length).padStart(2, "0")} &middot; {active.label}</span></span>
      </div>
    </div>
  );
}

/*
  One door into the compiled world, and it is the same door every time.

  The landing offers Explore three times — hero, evidence scene, closing scene — and each was a
  plain <Link>, so leaving cut hard: the world field the reader had been watching vanished and a
  new page appeared. `CanvasTransitionLink` routes the same navigation through the browser's View
  Transitions API, which blends the outgoing document into the incoming one rather than swapping
  them.

  Be precise about what that buys today. The landing's field carries
  `view-transition-name: world-canvas`, and as of this branch so does the Explore stage root in
  `components/explore/explore-stage.tsx` — so the pair is complete and the browser morphs the
  field into the stage instead of crossfading the whole document. Nothing here changed to make
  that happen; the pairing is by name. The sentence this replaces said `/explore` carried no
  such name, which was true until the stage landed, and a stale comment about a visual contract
  is how the contract quietly gets dropped. Even paired, the browser blends two bitmaps and
  carries no state across, which is why this continuity stays a visual cue and never becomes a
  claim in copy.

  Under reduced motion, or in a browser without the API, this is an ordinary link and the
  navigation is identical. It is one component so the three call sites cannot drift apart in
  label or destination.
*/
/*
  `act` sends the reader to the part of Explore the surrounding scene has just argued for.

  The three call sites still share one component and one door; what varies is where inside the
  world it opens, using the query vocabulary `lib/explore-story.ts` already resolves (`world`,
  `evidence`, `change`). The evidence scene sending a reader to Explore's entry act left the
  trace it had just described two clicks away and unfound.

  `label` is only ever passed where the link is a second, different proof rather than the door
  again — the change link beside the evidence one. The door's own wording does not vary.
*/
function ExploreLink({
  className,
  act,
  label,
  onActivate,
}: {
  className: string;
  act?: "world" | "evidence" | "change";
  label?: string;
  onActivate?: () => void;
}) {
  return (
    <CanvasTransitionLink
      className={className}
      href={(act ? `/explore?act=${act}` : "/explore") as Route}
      onActivate={onActivate}
    >
      {label ?? "Explore a Compiled World"}
    </CanvasTransitionLink>
  );
}

function OpeningWorldField({ band, mode }: { band: string; mode: WorldMode }) {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setOpened(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  return <WorldField mode={band === "scatter" && opened ? "ingest" : mode} />;
}

function revealWords(node: React.ReactNode, startAt = 0): React.ReactNode {
  const at = { current: startAt };
  const walk = (child: React.ReactNode): React.ReactNode => {
    if (typeof child === "string" || typeof child === "number") {
      const text = String(child);
      return text.split(/(\s+)/).map((part, i) => {
        if (part === "" || /^\s+$/.test(part)) return part;
        const index = at.current++;
        return (
          <span key={`w${index}-${i}`} className="rv word" style={{ "--i": index } as React.CSSProperties}>
            {part}
          </span>
        );
      });
    }
    if (Array.isArray(child)) {
      return child.map((c, i) => <Fragment key={i}>{walk(c)}</Fragment>);
    }
    if (isValidElement(child)) {
      if (child.type === "br") return child;
      const props = child.props as { children?: React.ReactNode };
      return cloneElement(child, undefined, walk(props.children));
    }
    return child;
  };
  return walk(node);
}

function Scene({
  id,
  band,
  eyebrow,
  title,
  film,
  children,
}: {
  id: number;
  band: BandName;
  eyebrow: string;
  title: React.ReactNode;
  /*
    A film scene stacks instead of splitting.

    The two-column body puts a 380px title beside the content, which is right for prose and
    wrong for a four-up: it left the cut about half the page wide, and at that size the columns
    it is made of stop being readable — the exact failure the wide fixed frame was chosen to
    avoid. So a film scene puts the heading above and gives the frame the full measure.
  */
  film?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="scene" id={`s${id}`} data-scene={id} data-band={band}>
      <div className="shell">
        <div className={film ? "body film-body" : "body"}>
          <div className="stack">
            <p className="slate rv"><b>SCENE {String(id).padStart(2, "0")}</b><span />{eyebrow}</p>
            <h2>{revealWords(title)}</h2>
          </div>
          <div className="stack film-scene">{children}</div>
        </div>
      </div>
    </section>
  );
}
