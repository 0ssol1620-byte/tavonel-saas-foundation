"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { CUSTOMER_NAV, customerNavOwns } from "@/lib/site-navigation";

/** Three direct destinations; no menu that makes customers learn the repository structure. */
export default function DesktopPrimaryNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="site-nav one-path-primary-nav">
      {CUSTOMER_NAV.map((item) => (
        <Link key={item.href} className="site-nav-direct" href={item.href as Route}
          aria-current={customerNavOwns(item.href, pathname) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
