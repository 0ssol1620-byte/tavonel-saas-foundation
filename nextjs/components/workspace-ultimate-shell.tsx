"use client";

import Link from "next/link";
import {
  Activity, Braces, CircleHelp, Command, FileStack, GitCompareArrows, Home, Inbox, Network, Plug, Search, Settings, Upload, X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Logomark from "@/components/logomark";
import { useDialogFocus } from "@/components/world-visual/use-dialog-focus";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "@/app/workspace/workspace-ultimate.module.css";

export type WorkspaceSurface = "home" | "sources" | "runs" | "review" | "changes" | "world" | "ask" | "connections" | "developer" | "activity" | "settings";

/*
  `rail` marks the surfaces the condensed mobile rail shows. It used to be decided by counting
  positions in CSS (`.nav > div:nth-child(1), (2), (4), (5), :last-child`), so inserting a row
  anywhere near the top silently pushed the surface that had been fifth off mobile altogether.
  Naming the five here means a new row changes the rail only when someone says it should.
*/
type NavItem = { surface: WorkspaceSurface; label: string; icon: typeof Home; shortcut?: string; secondary?: boolean; mobileLabel?: string; rail?: boolean };
const NAV_ITEMS: NavItem[] = [
  { surface: "home", label: "Home", icon: Home, shortcut: "G H", rail: true },
  { surface: "sources", label: "Knowledge", icon: FileStack, shortcut: "G S", rail: true },
  { surface: "ask", label: "Use with AI", icon: CircleHelp, shortcut: "G A", rail: true },
];
const MORE_ITEMS: NavItem[] = [
  { surface: "review", label: "Review", icon: GitCompareArrows, shortcut: "G R" },
  { surface: "changes", label: "Changes", icon: Inbox },
  { surface: "world", label: "Knowledge graph", icon: Network, shortcut: "G W" },
  { surface: "connections", label: "Connections", icon: Plug, secondary: true },
  { surface: "developer", label: "Developer tools", icon: Braces, secondary: true },
  { surface: "activity", label: "Activity", icon: Activity, secondary: true },
  { surface: "settings", label: "Settings", icon: Settings, secondary: true },
];

type TruthGate = { label: string; qualified: boolean; detail: string };
type AccessSummary = {
  source: "owner" | "paid" | "trial";
  accessPlan: "observer_access" | "studio_access";
  billingExempt: boolean;
  expiresAt: string | null;
  limits: { files: number; pages: number; worlds: number } | null;
};

type Props = {
  surface: WorkspaceSurface;
  children: ReactNode;
  headerAction: ReactNode;
  activeRevision: number | null;
  candidateReady: boolean;
  reviewCount: number | null;
  activityCount: number;
  truthGates: TruthGate[];
  stateTitle: string;
  stateDescription: string;
  nextAction: { label: string; surface?: WorkspaceSurface; run?: () => void };
  onNavigate: (surface: WorkspaceSurface) => void;
  onUpload: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

/*
  useDialogFocus as a child, because its effect IS the lifecycle: it records
  document.activeElement as the opener on mount and returns focus there on cleanup. Called up in
  the shell it would run once at page load with an empty ref and never fire again; mounted inside
  the panel it runs on open and cleans up on close, however the palette was closed.

  It renders nothing, so the panel keeps its focus order and the search input is still the first
  focusable element in it -- which is why the separate focus-the-input effect could go rather than
  be reordered: claiming the first focusable IS focusing that input, and one mechanism that does
  both cannot get the two out of order the way ask-overlay.tsx did.
*/
function PaletteFocus({ panel }: { panel: RefObject<HTMLElement | null> }) {
  useDialogFocus(panel);
  return null;
}

export default function WorkspaceUltimateShell({
  surface, children, headerAction, activeRevision, candidateReady, reviewCount, activityCount, truthGates,
  stateTitle, stateDescription, nextAction, onNavigate, onUpload, onRefresh, onSignOut,
}: Props) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [privacyMode, setPrivacyMode] = useState(false);
  const [access, setAccess] = useState<AccessSummary | null>(null);
  const pendingGo = useRef(false);
  const paletteRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => { if (moreRef.current) moreRef.current.open = false; }, [surface]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && moreRef.current && !moreRef.current.contains(event.target)) moreRef.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const moreItems = MORE_ITEMS.filter((item) => access?.source !== "trial" || !["connections", "developer"].includes(item.surface));

  useEffect(() => {
    let current = true;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch("/api/access/bootstrap", {
        method: "POST",
        credentials: "same-origin",
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => null) as { access?: AccessSummary } | null;
      if (current && response.ok && body?.access) setAccess(body.access);
    })().catch(() => undefined);
    return () => { current = false; };
  }, []);

  const navItems = useMemo(
    () => NAV_ITEMS.filter((item) => access?.source !== "trial" || !["connections", "developer"].includes(item.surface)),
    [access?.source],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPaletteOpen((open) => !open); return;
      }
      if (event.key === "Escape") {
        setPaletteOpen(false); pendingGo.current = false;
        if (moreRef.current?.open) { moreRef.current.open = false; moreRef.current.querySelector("summary")?.focus(); }
        return;
      }
      if (!editing && event.key === "?") { event.preventDefault(); setPaletteOpen(true); return; }
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "g") {
        pendingGo.current = true; window.setTimeout(() => { pendingGo.current = false; }, 900); return;
      }
      const key = event.key.toLowerCase();
      if (pendingGo.current) {
        pendingGo.current = false;
        const targetSurface = ({ h: "home", s: "sources", w: "world", r: "review", a: "ask" } as const)[key];
        if (targetSurface) { event.preventDefault(); onNavigate(targetSurface); }
        return;
      }
      if (key === "u") { event.preventDefault(); onUpload(); }
      else if (key === "c") { event.preventDefault(); onNavigate("activity"); }
      else if (key === "/") { event.preventDefault(); onNavigate("ask"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNavigate, onUpload]);

  const runAction = (action: { surface?: WorkspaceSurface; run?: () => void }) => {
    setPaletteOpen(false);
    if (action.surface) onNavigate(action.surface); else action.run?.();
  };

  const paletteActions = [
    { group: "CREATE", label: "Upload sources", hint: "U", run: onUpload },
    { group: "NAVIGATE", label: "Home", hint: "G H", surface: "home" as const },
    { group: "NAVIGATE", label: "Sources", hint: "G S", surface: "sources" as const },
    { group: "NAVIGATE", label: "Review queue", hint: "G R", surface: "review" as const },
    { group: "NAVIGATE", label: "Active World", hint: "G W", surface: "world" as const },
    { group: "NAVIGATE", label: "Ask with citations", hint: "G A", surface: "ask" as const },
    { group: "OPERATE", label: "Compile activity", hint: "C", surface: "activity" as const },
    ...(access?.source === "trial" ? [] : [
      { group: "BUILD", label: "Connections", hint: "", surface: "connections" as const },
      { group: "BUILD", label: "Developer tools", hint: "", surface: "developer" as const },
    ]),
    { group: "HELP", label: "Getting started", hint: "", run: () => window.location.assign("/docs/quickstart") },
    { group: "HELP", label: "Use results with AI", hint: "", run: () => window.location.assign("/docs/use-with-ai") },
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  const moveRailFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-item]")].filter((item) => item.getClientRects().length > 0);
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  };

  const trialDays = access?.source === "trial" && access.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(access.expiresAt) - Date.now()) / 86_400_000))
    : null;

  return (
    <main id="main" className={`workspace one-path-workspace ${styles.shell}`} data-privacy={privacyMode} data-access={access?.source ?? "unknown"} tabIndex={-1}>
      <aside className={styles.rail} aria-label="Workspace navigation" onKeyDown={moveRailFocus}>
        <Link href="/" className={styles.brand} aria-label="TAVONEL home"><Logomark size={23} /></Link>
        <nav className={styles.nav}>
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const beginsSecondary = item.secondary && !navItems[index - 1]?.secondary;
            return (
              <div key={item.surface} data-mobile-rail={item.rail ? "" : undefined} className={beginsSecondary ? styles.secondaryStart : undefined}>
                <button type="button" data-rail-item aria-current={surface === item.surface ? "page" : undefined}
                  className={surface === item.surface ? styles.current : undefined} onClick={() => onNavigate(item.surface)}
                  title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}>
                  <Icon size={17} aria-hidden="true" />
                  <span data-mobile-label={item.mobileLabel}>{item.label}</span>
                  {item.surface === "review" && reviewCount ? <b>{reviewCount}</b> : null}
                </button>
              </div>
            );
          })}
          <div data-mobile-rail="">
            <details className="one-path-more" ref={moreRef}>
              <summary data-rail-item aria-label="More workspace tools"><Settings size={17} aria-hidden="true" /><span>More</span></summary>
              <div className="one-path-more-panel" aria-label="More workspace tools">
                <p>TOOLS & SETTINGS</p>
                {moreItems.map((item) => {
                  const Icon = item.icon;
                  return <button key={item.surface} type="button" data-rail-item
                    aria-current={surface === item.surface ? "page" : undefined}
                    onClick={() => { if (moreRef.current) moreRef.current.open = false; onNavigate(item.surface); }}>
                    <Icon size={16} aria-hidden="true" /><span>{item.label}</span>
                    {item.surface === "review" && reviewCount ? <b>{reviewCount}</b> : null}
                  </button>;
                })}
              </div>
            </details>
          </div>
        </nav>
        <div className={styles.railFooter}>
          <button type="button" onClick={onRefresh}>Refresh</button>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      <section className={`workspace-body ${styles.body}`}>
        <header className={styles.topbar}>
          <div className={styles.workspaceIdentity}>
            <span>TAVONEL</span>
            <strong>Knowledge workspace</strong>
          </div>
          {activeRevision !== null ? <button type="button" className={styles.topStatus} onClick={() => onNavigate("world")}><small>PUBLISHED</small><b>v{activeRevision}</b></button> : null}
          {candidateReady ? <button type="button" className={styles.topStatus} onClick={() => onNavigate("review")}><small>NEEDS YOUR REVIEW</small><b>{reviewCount ? `${reviewCount} ITEMS` : "NEW VERSION"}</b></button> : null}
          <button type="button" className={styles.commandButton} onClick={() => setPaletteOpen(true)}><Search size={15} aria-hidden="true" /><span>Search / Command</span><kbd>Ctrl K</kbd></button>
          <div className={styles.headerAction}>{headerAction}</div>
        </header>

        {access?.source === "trial" ? (
          <div className={styles.accessStrip} role="status">
            <div><strong>Free evaluation</strong><span>{trialDays} day{trialDays === 1 ? "" : "s"} remaining</span></div>
            <p>{access.limits ? `${access.limits.files} files · ${access.limits.pages} pages · ${access.limits.worlds} World` : "Bounded evaluation access"}</p>
            <Link href="/pricing">Upgrade to Developer</Link>
          </div>
        ) : access?.source === "owner" ? (
          <div className={styles.ownerStrip}><span>OWNER ACCESS</span><p>Full workspace access · billing exempt</p></div>
        ) : null}

        {truthGates.length > 0 ? <details className={styles.truthStrip}>
          <summary><span>ADVANCED / SYSTEM DETAILS</span><span data-qualified={truthGates.every((gate) => gate.qualified)}><i aria-hidden="true" />{truthGates.every((gate) => gate.qualified) ? "ALL GATES QUALIFIED" : "SOME GATES HELD"}</span><span>ACTIVITY {activityCount > 0 ? `${activityCount} RUNNING` : "QUIET"}</span><button type="button" aria-pressed={privacyMode} onClick={(event) => { event.preventDefault(); setPrivacyMode((value) => !value); }}>{privacyMode ? "Show content" : "Hide content"}</button></summary>
          <div>{truthGates.map((gate) => <p key={gate.label}><strong>{gate.label}</strong>{gate.detail}</p>)}</div>
        </details> : null}

        <div className={`workspace-content ${styles.content}`}>
          <section className={styles.stateHero} aria-labelledby="workspace-state-title">
            <div><p>YOUR KNOWLEDGE</p><h1 id="workspace-state-title">{stateTitle}</h1><span>{stateDescription}</span></div>
            {/* While the workspace state is still resolving there is no honest next action, so
                the control says so and stays inert rather than offering a guess. */}
            <button type="button" disabled={!nextAction.surface && !nextAction.run} onClick={() => runAction(nextAction)}>{nextAction.label}</button>
          </section>
          {children}
        </div>
      </section>

      {paletteOpen ? (
        <div className={styles.paletteBackdrop} role="presentation" onMouseDown={() => setPaletteOpen(false)}>
          <section ref={paletteRef} className={styles.palette} role="dialog" aria-modal="true" aria-label="Workspace command palette" onMouseDown={(event) => event.stopPropagation()}>
            <PaletteFocus panel={paletteRef} />
            <div className={styles.paletteSearch}><Command size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jump to a surface or run an action" aria-label="Search commands" /><button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close command palette"><X size={16} /></button></div>
            <p>COMMANDS · ? TO OPEN</p>
            <div className={styles.paletteResults}>
              {paletteActions.map((action) => <button key={action.label} type="button" onClick={() => runAction(action)}><span><small>{action.group}</small>{action.label}</span><kbd>{action.hint}</kbd></button>)}
              {paletteActions.length === 0 ? <span>No matching action.</span> : null}
            </div>
            <footer><Upload size={13} /> Commands act on the current workspace only.</footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
