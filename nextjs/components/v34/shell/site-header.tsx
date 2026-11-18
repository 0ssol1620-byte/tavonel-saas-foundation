import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import { HeaderAccountActions } from "@/components/site-nav/desktop-primary-nav";
import { resolveEntries, resolveGroups, V34_MORE_GROUPS, V34_PRIMARY_NAV } from "@/lib/v34/nav";
import tokens from "../tokens.module.css";
import { createWorldAction } from "../ui/create-world";
import { current } from "./current";
import MobileDrawer from "./mobile-drawer";
import MoreMenu from "./more-menu";
import s from "./site-header.module.css";

/**
 * The sticky bar: brand, five primary items, the More panel, the account actions and the filled
 * "Create your World" action. Below 1001px the items and More give way to the drawer. Held routes
 * are filtered out of every list before they reach a client component.
 */
export default function SiteHeader({ currentPath = "" }: { currentPath?: string }) {
  const primary = resolveEntries(V34_PRIMARY_NAV);
  const groups = resolveGroups(V34_MORE_GROUPS);
  const start = createWorldAction();
  return (
    /* data-v34-header: the retained pages' stylesheets find their page root by the header it holds. */
    <header className={`${tokens.paper} ${s.header}`} data-v34-header="">
      <div className={s.inner}>
        <Link href="/" className={s.brand} aria-label="TAVONEL home" prefetch={false}>
          <Logomark size={26} />
          <span className={s.wordmark}>TAVONEL</span>
        </Link>
        <div className={s.center}>
          <nav aria-label="Primary">
            <ul className={s.list}>
              {primary.map((link) => (
                <li key={link.href}>
                  <Link className={s.link} href={link.href as Route} aria-current={current(link.href, currentPath)} prefetch={false}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <MoreMenu groups={groups} />
        </div>
        <div className={s.actions}>
          <HeaderAccountActions
            start={start}
            labels={{ signIn: "Sign in", workspace: "Open workspace" }}
            className={s.cta}
            signInClassName={s.signIn}
          />
        </div>
        <MobileDrawer primary={primary} groups={groups} start={start} />
      </div>
    </header>
  );
}
