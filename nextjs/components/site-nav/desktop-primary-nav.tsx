"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { HEADER_NAV, KO_CHROME, customerNavOwns } from "@/lib/site-navigation";

/** Three direct destinations; no menu that makes customers learn the repository structure. */
export default function DesktopPrimaryNav({ korean = false }: { korean?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={korean ? "섹션" : "Sections"} className="site-nav one-path-primary-nav">
      {HEADER_NAV.map((item) => (
        <Link key={item.href} className="site-nav-direct" href={item.href as Route}
          aria-current={customerNavOwns(item.href, pathname) ? "page" : undefined}>
          {/* BQ-013: /ko rendered these three in English above Korean body copy. */}
          {korean ? KO_CHROME.nav[item.href] ?? item.label : item.label}
        </Link>
      ))}
    </nav>
  );
}
