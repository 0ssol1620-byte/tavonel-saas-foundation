"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { NavGroupLinks } from "@/lib/v34/nav";
import tokens from "../tokens.module.css";
import { current } from "./current";
import s from "./more-menu.module.css";

/**
 * An Escape a shell surface consumes is the shell's alone (WO-CI-14). `consume` runs for every
 * Escape and returns true when it closed something; that press is then stopped, so no key listener
 * of the page acts on it too (the /explore workbench closed its evidence view on the same press).
 *
 * The listener sits on `window` in the capture phase, the first place a key event reaches, and is
 * added once when the shell mounts, not when a surface opens: the header mounts before `main`, so
 * it precedes every listener a page body adds, on window or document, capture or bubble. Stopping
 * propagation does not cancel the press, so a modal <dialog> still closes itself on it.
 * ponytail: a window capture listener added before the header mounted (a script outside React) would
 * still run first; the drawer pass arms its probe after mount and before opening, which is the order a page has.
 */
export function listenShellEscape(consume: () => boolean): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && consume()) event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

/**
 * The "More" disclosure: a button and the panel it controls. It is not a modal, so there is no
 * focus trap and the page behind it stays reachable. Escape closes it and returns focus to the
 * button, and goes no further than the shell; a click or focus outside closes it; navigating
 * closes it. The groups arrive already filtered for held routes, so a held route's link is not
 * in this bundle.
 */
export default function MoreMenu({ groups }: { groups: readonly NavGroupLinks[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  // Open is read from the panel itself, so the listener never needs re-adding after the page's.
  useEffect(
    () =>
      listenShellEscape(() => {
        if (!panel.current || panel.current.hidden) return false;
        setOpen(false);
        button.current?.focus();
        return true;
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (panel.current?.contains(target) || button.current?.contains(target));
    const onOutside = (event: Event) => {
      if (!inside(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={s.button}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        More
        <svg className={s.chevron} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div ref={panel} id={panelId} className={`${tokens.paper} ${s.panel}`} hidden={!open}>
        <nav aria-label="All pages" className={s.columns}>
          {groups.map((group) => (
            <div key={group.title} className={s.group}>
              <p className={s.title}>{group.title}</p>
              <ul className={s.list}>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link className={s.link} href={link.href as Route} aria-current={current(link.href, pathname)} prefetch={false}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}
