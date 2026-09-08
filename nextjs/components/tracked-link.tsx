"use client";

import { trackFunnel, type FunnelEvent } from "@/lib/funnel-events";

/**
 * An ordinary link that reports the §32 funnel step it starts.
 *
 * The two developer entry points -- the MCP server and the HTTP contract -- are plain `<a>`
 * elements to a static file, which is the right thing for them to be: a download that works
 * without JavaScript and survives a right-click. Wrapping them in a client component only to
 * fire an event would be a lot of machinery for one call, so this is the smallest thing that
 * keeps the anchor an anchor and adds the event on the way through.
 *
 * The event name is the whole payload. No href, no filename, no identifier: `funnel-events.ts`
 * is a privacy-minimal module and a developer's chosen artifact is still a fact about them.
 */
export function TrackedLink({
  event,
  href,
  download,
  children,
}: {
  event: FunnelEvent;
  href: string;
  download?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a href={href} download={download} onClick={() => trackFunnel(event)}>
      {children}
    </a>
  );
}
