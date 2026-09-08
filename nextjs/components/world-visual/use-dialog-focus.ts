"use client";

import { useEffect, type RefObject } from "react";

/*
  Focus, for the two panels on the Explore stage that are dialogs (§20).

  Both of them -- Ask and the technical drawer -- open over the stage and are closed with Escape
  by the stage's own key handler. What neither had is the other half of a dialog: focus moving
  into it when it opens, staying inside it while it is open, and returning to the control that
  opened it when it closes. Without that, Tab from an open drawer walks the world behind it and a
  keyboard reader is left in a panel they cannot leave except by guessing.

  Deliberately small: no library, no rendering into a portal, no `aria-modal` on a panel that
  does not cover the page. It moves focus, wraps Tab, and restores. `useEffect` cleanup does the
  restoring, so it runs on unmount however the panel was closed.
*/
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    // Only claim focus if the panel has not already placed it -- Ask focuses its first question.
    if (!panel.contains(document.activeElement)) focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}
