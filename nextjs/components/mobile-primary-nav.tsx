"use client";

import Link from "next/link";
import type { Route } from "next";
import { PRIMARY_NAV } from "@/lib/site-navigation";

export default function MobilePrimaryNav() {
  return (
    <details className="mobile-primary-nav">
      <summary aria-label="Open site navigation">Menu</summary>
      <nav aria-label="Mobile sections">
        {PRIMARY_NAV.map((link) => (
          <Link key={link.href} href={link.href as Route}>{link.label}</Link>
        ))}
      </nav>
    </details>
  );
}
