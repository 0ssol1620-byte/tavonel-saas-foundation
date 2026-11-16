import Link from "next/link";
import type { Route } from "next";
import s from "./read-next.module.css";

/** The links an article ends on, as a plain list. Each destination is a registry path or an existing retained page. */
export function ReadNext({ label, links }: { label: string; links: readonly { href: Route; label: string }[] }) {
  return (
    <nav className={s.nav} aria-label={label}>
      <p className={s.heading}>{label}</p>
      <ul className={s.list}>
        {links.map((link) => (
          <li key={link.href}>
            <Link className={s.link} href={link.href} prefetch={false}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
