"use client";

import Link from "next/link";
import {
  Activity,
  Braces,
  CircleHelp,
  Command,
  FileStack,
  GitCompareArrows,
  Home,
  Network,
  Plug,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import Logomark from "@/components/logomark";
import styles from "@/app/workspace/workspace-ultimate.module.css";

export type WorkspaceSurface =
  | "home"
  | "sources"
  | "runs"
  | "review"
  | "world"
  | "ask"
  | "connections"
  | "developer"
  | "activity"
  | "settings";

type NavItem = {
  surface: WorkspaceSurface;
  label: string;
  icon: typeof Home;
  shortcut?: string;
  secondary?: boolean;
  mobileLabel?: string;
};

const NAV_ITEMS: NavItem[] = [
  { surface: "home", label: "Home", icon: Home, shortcut: "G H" },
  { surface: "sources", label: "Sources", icon: FileStack, shortcut: "G S" },
  { surface: "review", label: "Review", icon: GitCompareArrows, shortcut: "G R" },
  { surface: "world", label: "World", icon: Network, shortcut: "G W" },
  { surface: "ask", label: "Ask", icon: CircleHelp, shortcut: "G A" },
  { surface: "connections", label: "Connections", icon: Plug, secondary: true },
  { surface: "developer", label: "Developer", icon: Braces, secondary: true },
  { surface: "activity", label: "Activity", icon: Activity, secondary: true },
  { surface: "settings", label: "Settings", mobileLabel: "More", icon: Settings, secondary: true },
];

type TruthGate = { label: string; qualified: boolean; detail: string };

type Props = {
  surface: WorkspaceSurface;
  children: ReactNode;
  headerAction: ReactNode;
  activeRevision: number | null;
  candidateReady: boolean;
  reviewCount: number | null;
  activityCount: number;
  credits: number | null;
  truthGates: TruthGate[];
  stateTitle: string;
  stateDescription: string;
  nextAction: { label: string; surface?: WorkspaceSurface; run?: () => void };
  onNavigate: (surface: WorkspaceSurface) => void;
  onUpload: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

export default function WorkspaceUltimateShell({
  surface,
  children,
  headerAction,
  activeRevision,
  candidateReady,
  reviewCount,
  activityCount,
  credits,
  truthGates,
  stateTitle,
  stateDescription,
  nextAction,
  onNavigate,
  onUpload,
  onRefresh,
  onSignOut,
}: Props) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [privacyMode, setPrivacyMode] = useState(false);
  const pendingGo = useRef(false);
  const paletteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
  }, [paletteOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        pendingGo.current = false;
        return;
      }
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "g") {
        pendingGo.current = true;
        window.setTimeout(() => { pendingGo.current = false; }, 900);
        return;
      }
      const key = event.key.toLowerCase();
      if (pendingGo.current) {
        pendingGo.current = false;
        const targetSurface = ({ h: "home", s: "sources", w: "world", r: "review", a: "ask" } as const)[key];
        if (targetSurface) {
          event.preventDefault();
          onNavigate(targetSurface);
        }
        return;
      }
      if (key === "u") {
        event.preventDefault();
        onUpload();
      } else if (key === "c") {
        event.preventDefault();
        onNavigate("activity");
      } else if (key === "/") {
        event.preventDefault();
        onNavigate("ask");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNavigate, onUpload]);

  const runAction = (action: { surface?: WorkspaceSurface; run?: () => void }) => {
    setPaletteOpen(false);
    if (action.surface) onNavigate(action.surface);
    else action.run?.();
  };
  const paletteActions = [
    { label: "Upload sources", hint: "U", run: onUpload },
    { label: "Inspect compile activity", hint: "C", surface: "activity" as const },
    { label: "Open review queue", hint: "G R", surface: "review" as const },
    { label: "Inspect active World", hint: "G W", surface: "world" as const },
    { label: "Ask with grounded citations", hint: "G A", surface: "ask" as const },
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  const moveRailFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-rail-item]")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  };

  return (
    <main id="main" className={`workspace ${styles.shell}`} data-privacy={privacyMode} tabIndex={-1}>
      <aside className={styles.rail} aria-label="Workspace navigation" onKeyDown={moveRailFocus}>
        <Link href="/" className={styles.brand} aria-label="TAVONEL home"><Logomark size={23} /></Link>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const beginsSecondary = item.secondary && !NAV_ITEMS[index - 1]?.secondary;
            return (
              <div key={item.surface} className={beginsSecondary ? styles.secondaryStart : undefined}>
                <button
                  type="button"
                  data-rail-item
                  aria-current={surface === item.surface ? "page" : undefined}
                  className={surface === item.surface ? styles.current : undefined}
                  onClick={() => onNavigate(item.surface)}
                  title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span data-mobile-label={item.mobileLabel}>{item.label}</span>
                  {item.surface === "review" && reviewCount ? <b>{reviewCount}</b> : null}
                </button>
              </div>
            );
          })}
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
            <strong>Private pilot workspace</strong>
          </div>
          <button type="button" className={styles.topStatus} onClick={() => onNavigate("world")}>
            <small>WORLD</small>
            <b>{activeRevision ? `v${activeRevision} ACTIVE` : "NO ACTIVE WORLD"}</b>
          </button>
          <button type="button" className={styles.topStatus} onClick={() => onNavigate("review")}>
            <small>CANDIDATE</small>
            <b>{candidateReady ? `READY${reviewCount ? ` · ${reviewCount} REVIEW` : ""}` : "NONE"}</b>
          </button>
          <button type="button" className={styles.commandButton} onClick={() => setPaletteOpen(true)}>
            <Search size={15} aria-hidden="true" /><span>Search / Command</span><kbd>Ctrl K</kbd>
          </button>
          <div className={styles.headerAction}>{headerAction}</div>
        </header>

        <details className={styles.truthStrip}>
          <summary>
            <span>ADVANCED / SYSTEM DETAILS</span>
            <span data-qualified={truthGates.every((gate) => gate.qualified)}>
              <i aria-hidden="true" />{truthGates.every((gate) => gate.qualified) ? "ALL GATES QUALIFIED" : "SOME GATES HELD"}
            </span>
            <span>ACTIVITY {activityCount > 0 ? `${activityCount} RUNNING` : "QUIET"}</span>
            <span>INTERNAL UNITS {credits === null ? "NOT READ" : credits}</span>
            <button type="button" aria-pressed={privacyMode} onClick={(event) => { event.preventDefault(); setPrivacyMode((value) => !value); }}>
              {privacyMode ? "Show content" : "Hide content"}
            </button>
          </summary>
          <div>
            {truthGates.map((gate) => <p key={gate.label}><strong>{gate.label}</strong>{gate.detail}</p>)}
          </div>
        </details>

        <div className={`workspace-content ${styles.content}`}>
          <section className={styles.stateHero} aria-labelledby="workspace-state-title">
            <div>
              <p>{surface.toUpperCase()} · CURRENT STATE</p>
              <h1 id="workspace-state-title">{stateTitle}</h1>
              <span>{stateDescription}</span>
            </div>
            <button type="button" onClick={() => runAction(nextAction)}>{nextAction.label}</button>
          </section>
          {children}
        </div>
      </section>

      {paletteOpen ? (
        <div className={styles.paletteBackdrop} role="presentation" onMouseDown={() => setPaletteOpen(false)}>
          <section className={styles.palette} role="dialog" aria-modal="true" aria-label="Workspace command palette" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.paletteSearch}>
              <Command size={17} aria-hidden="true" />
              <input ref={paletteInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type an action" aria-label="Search commands" />
              <button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close command palette"><X size={16} /></button>
            </div>
            <p>ACTIONS</p>
            <div className={styles.paletteResults}>
              {paletteActions.map((action) => (
                <button key={action.label} type="button" onClick={() => runAction(action)}>
                  <span>{action.label}</span><kbd>{action.hint}</kbd>
                </button>
              ))}
              {paletteActions.length === 0 ? <span>No matching action. TAVONEL does not invent objects that are not in this workspace.</span> : null}
            </div>
            <footer><Upload size={13} /> Keyboard commands act on the current workspace only.</footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
