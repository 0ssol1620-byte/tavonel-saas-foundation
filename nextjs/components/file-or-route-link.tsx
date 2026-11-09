import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

/*
  A published file (a policy .md, security.txt) is not a route. next/link prefetches its RSC
  payload, which 404s and puts an error in every visitor's console on /security, /trust and
  /enterprise. A file gets a plain anchor; every route keeps next/link.

  The test is an escaped dot then an extension at the end of the path, so "/security" is a route
  and "/.well-known/security.txt" is a file. `lib/file-or-route-link.test.ts` holds both.
*/
export const isFileHref = (href: string) => /\.[a-z0-9]+$/i.test(href.split(/[?#]/)[0] ?? "");

export default function FileOrRouteLink({ href, className, children }: {
  href: string;
  className?: string;
  children?: ReactNode;
}) {
  return isFileHref(href)
    ? <a className={className} href={href}>{children}</a>
    : <Link className={className} href={href as Route}>{children}</Link>;
}
