"use client";

/**
 * Home. Three locked compile cuts carry the argument.
 * Copy is the headline, one lede, two band lines, then proof.
 */

import Link from "next/link";
import type { Route } from "next";
import { Fragment, cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from "react";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import CompileStagePlayer, { type CompileStage } from "@/components/compile-stage-player";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import WorldField, { type WorldMode } from "@/components/world-field";
import { trackFunnel, trackSceneDepth } from "@/lib/funnel-events";
import { FOOTER_GROUPS, PRIMARY_NAV } from "@/lib/site-navigation";
import { useScrollProgress, useScrollScenes } from "@/lib/use-scroll-scenes";

const SCENES = [
  { id: 1, label: "KNOWLEDGE COMPILER" },
  { id: 2, label: "INPUT" },
  { id: 3, label: "COMPILE FILM" },
  { id: 4, label: "EVIDENCE" },
  { id: 5, label: "START" },
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
  const barNextRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const button = barNextRef.current;
    if (!button) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const RANGE = 70;
    const PULL = 0.32;
    let raf = 0;
    const reset = () => { button.style.removeProperty("--mx"); button.style.removeProperty("--my"); };
    const onMove = (event: PointerEvent) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const box = button.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < RANGE) {
          const pull = (1 - dist / RANGE) * PULL;
          button.style.setProperty("--mx", `${dx * pull}px`);
          button.style.setProperty("--my", `${dy * pull}px`);
        } else {
          reset();
        }
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
      reset();
    };
  }, []);
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

  const cta = (name: string, run: () => void) => () => {
    trackFunnel("cta_clicked", { cta: name, scene: String(scene) });
    run();
  };

  const nextStep = ((): { label: string; run: () => void } => {
    if (scene <= 1) return { label: "BRING YOUR SOURCES", run: () => jump(2) };
    if (scene === 2) return { label: "WATCH IT COMPILE", run: () => jump(3) };
    if (scene === 3) return { label: "FOLLOW THE EVIDENCE", run: () => jump(4) };
    if (scene < 5) return { label: "START", run: () => jump(5) };
    // The bar's final action is the page's primary action. It used to say SIGN IN in pilot,
    // sending a first-time visitor to a login for an account they cannot create.
    return { label: startLabel.toUpperCase(), run: () => window.location.assign(startHref) };
  })();

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

      <header className="nav" data-stuck={progress > 0.005 ? 1 : 0}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <span className="mode" title="Source-grounded document and knowledge compilation.">
          <i aria-hidden="true" />
          KNOWLEDGE COMPILER
        </span>
        <nav aria-label="Sections">
          {PRIMARY_NAV.map((link) => <Link key={link.href} href={link.href as Route}>{link.label}</Link>)}
        </nav>
        <MobilePrimaryNav />
        <span className="nav-actions">
          <Link className="btn small" href={startHref}>{startLabel}</Link>
          {signedIn ? null : <Link className="nav-signin" href="/login">Sign in</Link>}
        </span>
      </header>

      <div className="rail" aria-hidden="true">
        {SCENES.map((s) => (
          <button key={s.id} type="button" className={s.id === scene ? "tick on" : "tick"} onClick={() => jump(s.id)} tabIndex={-1}>
            <i />
            {String(s.id).padStart(2, "0")}
          </button>
        ))}
      </div>

      <main id="main" tabIndex={-1}>
        <section className="scene hero" id="s1" data-scene="1" data-band="scatter">
          <div className="shell">
            <p className="slate"><b>TAVONEL</b><span /> KNOWLEDGE COMPILER</p>
            <h1>
              <span className="line"><i>Turn documents and connected systems</i></span>
              <span className="line dim"><i>into a source-grounded world your AI can use.</i></span>
            </h1>
            <p className="lede">
              TAVONEL reads difficult sources, reconstructs structure, resolves identities and
              relationships, and compiles a versioned knowledge layer with evidence back to the page.
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
              <ExploreLink className="btn" />
              <Link className="btn ghost" href={startHref}>{startLabel}</Link>
            </div>
          </div>
        </section>

        <Scene id={2} band="structure" eyebrow="INPUT" title="Bring the knowledge you already have.">
          <p className="lede rv">Upload files, folders or ZIP archives, or connect the system where your knowledge already lives.</p>
          {/*
            Named formats, not a category.

            "Office documents" reads as every Office file ever made, and the intake whitelist is
            narrower: DOCX, XLSX, PPTX and the OpenDocument equivalents, but not legacy
            DOC/XLS/PPT. Naming the extensions is the difference between a promise and a
            rejection at upload. ZIP is listed as a container, because that is what it is.
          */}
          <ul className="input-formats rv" aria-label="Supported knowledge sources">
            {[
              "PDF", "DOCX / XLSX / PPTX", "ODT / ODS / ODP", "JPG / PNG / TIFF scans",
              "Folders", "ZIP archives", "Google Drive", "Dropbox",
              "OneDrive / SharePoint", "S3 / R2 / MinIO", "SMB / NFS / SFTP",
            ].map((source) => <li key={source}>{source}</li>)}
          </ul>
        </Scene>

        <Scene id={3} film band="change" eyebrow="COMPILE FILM" title="Watch knowledge take shape.">
          <CompileStagePlayer onStageChange={handleStageChange} />
        </Scene>

        <Scene id={4} band="answer" eyebrow="EVIDENCE" title="Follow grounded results back to the source.">
          <p className="lede rv">Object → relation → evidence → document page → exact bounding box. Ask citations open the same source evidence.</p>
          <div className="evidence-path rv" aria-label="Evidence path">
            {['Object', 'Relation', 'Evidence', 'Document page', 'Exact bbox'].map((step, index) => (
              <Fragment key={step}><span>{step}</span>{index < 4 ? <i aria-hidden="true">→</i> : null}</Fragment>
            ))}
          </div>
          <div className="actions rv"><ExploreLink className="btn" /></div>
        </Scene>

        <Scene id={5} band="access" eyebrow="START" title="Compile your own knowledge.">
          <p className="lede rv">Files go in. Structured, traceable knowledge comes out.</p>
          <div className="actions rv">
            {/*
              Two actions, not three. "Connect a source" asked a visitor who has not yet seen the
              product to authorise OAuth against their company drive. It belongs in the empty
              state after sign-up, where connecting something is the obvious next move.
            */}
            <Link className="btn" href={startHref}>{startLabel}</Link>
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
          The bar reports where the reader is, and nothing else.

          It used to read WORLD v184 / FACTS 128,470 / NEEDS REVIEW 1, taken from a demo fixture.
          While the page still carried a large "this is a demonstration" disclaimer those numbers
          were legible as illustration. The disclaimer came off — correctly, it was defensive and
          in the way — and the numbers stayed, which left three precise, wholly invented figures
          reading as measured results from a customer deployment. There is no version of this bar
          with fictional metrics on it that is worth the disclaimer needed to keep them.
        */}
        <span className="bc"><span className="bk">STAGE</span><span className="bv">{filmStage}</span></span>
        <span className="bar-ticks" aria-label="Scenes">
          {SCENES.map((sc) => (
            <button
              key={sc.id}
              type="button"
              className={sc.id === scene ? "bt on" : "bt"}
              aria-label={`Scene ${sc.id}: ${sc.label}`}
              aria-current={sc.id === scene ? "true" : undefined}
              onClick={() => jump(sc.id)}
            />
          ))}
        </span>
        <span className="bc right"><span className="bv">SCENE {String(active.id).padStart(2, "0")} &middot; {active.label}</span></span>
        <button ref={barNextRef} className="bar-next" type="button" onClick={cta("instrument_bar", nextStep.run)}>{nextStep.label}</button>
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
function ExploreLink({ className }: { className: string }) {
  return (
    <CanvasTransitionLink className={className} href={"/explore" as Route}>
      Explore a Compiled World
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
