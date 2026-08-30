"use client";

/**
 * D9 / A1 -- leaving through the same door you came in.
 *
 * "/" and "/film" draw the same world-graph from the same seed (see lib/world-graph.ts), and
 * both canvases carry `view-transition-name: world-canvas` in tavonel.css. Wrapping the
 * navigation in the browser's native View Transitions API lets it crossfade directly between
 * those two canvases instead of unmounting one and mounting the other -- the move reads as "the
 * same world, seen from a different angle" rather than "a new page loaded".
 *
 * This is a same-document browser API, not a data channel: the browser captures a bitmap of the
 * old canvas and a bitmap of the new one and blends between them. It does not carry the running
 * animation's actual state across -- an honest limit, not a bug, and the reason this stays a
 * plain visual transition and never becomes a claim in copy anywhere on the page.
 *
 * Feature-detected and skipped under reduced motion, in which case this renders as a completely
 * ordinary `next/link` and nothing about the navigation changes. Wrapped in try/catch because a
 * transition that throws must never be able to leave a click half-handled -- the fallback is
 * always a normal `router.push`.
 */

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { flushSync } from "react-dom";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

export default function CanvasTransitionLink<T extends string>({
  href,
  className,
  children,
}: {
  href: Route<T> | T;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const doc = document as ViewTransitionDocument;
    if (!doc.startViewTransition) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    event.preventDefault();
    try {
      doc.startViewTransition(() => {
        // `flushSync` forces the navigation's resulting state update to commit before this
        // callback returns, rather than leaving it for React's next scheduled render -- the
        // browser takes its "new" snapshot the instant this callback resolves, and both routes
        // are already prefetched by <Link>, so the swap is ready in time in practice. Without
        // it the browser was capturing its snapshot mid-navigation and, racing the world-field
        // canvas's own continuous rAF loop, sometimes never found a settled frame at all.
        flushSync(() => { router.push(href as Route); });
      });
    } catch {
      router.push(href as Route);
    }
  };

  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
