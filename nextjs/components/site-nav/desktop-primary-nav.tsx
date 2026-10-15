"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { HEADER_NAV, KO_CHROME, customerNavCurrent } from "@/lib/site-navigation";

/**
 * The header's filled action, which never points at the page it is on (Release 2 critic: on
 * /explore it linked to itself). Route-aware, so it lives in this client file; the header passes
 * the words and the class.
 */
export function HeaderCta({ href, label, className }: { href: string; label: string; className: string }) {
  const pathname = usePathname();
  if (pathname === href || pathname === `/ko${href}`) return null;
  return <Link className={className} href={href as Route} prefetch={false}>{label}</Link>;
}

/** Three direct destinations; no menu that makes customers learn the repository structure. */
export default function DesktopPrimaryNav({ korean = false }: { korean?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={korean ? "섹션" : "Sections"} className="site-nav one-path-primary-nav">
      {HEADER_NAV.map((item) => (
        <Link key={item.href} className="site-nav-direct" href={item.href as Route}
          aria-current={customerNavCurrent(item.href, pathname)}>
          {/* BQ-013: /ko rendered these three in English above Korean body copy. */}
          {korean ? KO_CHROME.nav[item.href] ?? item.label : item.label}
        </Link>
      ))}
    </nav>
  );
}
