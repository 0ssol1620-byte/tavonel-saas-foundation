"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { HeaderAccountActions } from "@/components/site-nav/desktop-primary-nav";
import type { NavGroupLinks, NavLink } from "@/lib/v34/nav";
import tokens from "../tokens.module.css";
import { current } from "./current";
import { listenShellEscape } from "./more-menu";
import s from "./mobile-drawer.module.css";

/**
 * The phone and tablet menu, a native modal `<dialog>`. The platform traps focus inside it, makes
 * the page behind it inert, closes it on Escape and hands focus back to the button that opened it.
 * What this adds: scroll lock (the stylesheet, from the `open` attribute), keeping that Escape from
 * the page's own key listeners, closing when a link is followed or the route changes, and closing
 * if the viewport grows past the point where the bar shows its own items. Groups arrive already
 * filtered for held routes.
 */
export default function MobileDrawer({ primary, groups, start }: {
  primary: readonly NavLink[];
  groups: readonly NavGroupLinks[];
  start: NavLink;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const pathname = usePathname();

  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  // The open dialog closes itself on Escape; the press goes no further than the shell.
  useEffect(() => listenShellEscape(() => dialog.current?.open === true), []);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1001px)");
    const onChange = () => {
      if (wide.matches) dialog.current?.close();
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  const openDrawer = (trigger: HTMLButtonElement) => {
    const element = dialog.current;
    if (!element || element.open) return;
    // Safari does not focus a button on click, and a closing dialog returns focus to the element
    // that was focused when it opened. Focus the trigger first so Escape and the close button hand it back.
    trigger.focus();
    element.showModal();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={s.trigger}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => openDrawer(event.currentTarget)}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {/*
        Following any link in the drawer closes it, including a link to the page already open, which
        changes no route. One handler on the dialog, so a link anywhere in it (the brand, the nav, the
        account actions, one added later) is covered without a handler of its own.
      */}
      <dialog
        ref={dialog}
        id={id}
        className={`${tokens.paper} ${s.dialog}`}
        aria-label="Site navigation"
        data-v34-overlay=""
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) dialog.current?.close();
        }}
      >
        <div className={s.bar}>
          <Link href="/" className={s.brand} aria-label="TAVONEL home" prefetch={false}>TAVONEL</Link>
          <button type="button" className={s.close} aria-label="Close navigation" onClick={() => dialog.current?.close()}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav aria-label="Site" className={s.nav}>
          <ul className={s.primary}>
            {primary.map((link) => (
              <li key={link.href}>
                <Link className={s.primaryLink} href={link.href as Route} aria-current={current(link.href, pathname)} prefetch={false}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {/*
            One group open at a time: the groups share a `name`, so opening one closes the others
            (the platform's exclusive accordion; no script).
          */}
          {groups.map((group) => (
            <details key={group.title} name={`${id}-groups`} className={s.group}>
              <summary className={s.summary}>{group.title}</summary>
              <ul className={s.list}>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link className={s.link} href={link.href as Route} aria-current={current(link.href, pathname)} prefetch={false}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </nav>
        <div className={s.foot}>
          <HeaderAccountActions
            start={start}
            labels={{ signIn: "Sign in", workspace: "Open workspace" }}
            className={s.cta}
            signInClassName={s.signIn}
          />
        </div>
      </dialog>
    </>
  );
}
