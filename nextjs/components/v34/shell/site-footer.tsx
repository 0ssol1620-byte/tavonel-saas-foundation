import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import { MarketingConsentLink } from "@/components/marketing-consent";
import { BRAND_LINE, FOOTER_LEGAL_ROW } from "@/lib/site-navigation";
import { resolveGroups, V34_FOOTER_GROUPS, V34_FOOTER_LEGAL_LINKS } from "@/lib/v34/nav";
import tokens from "../tokens.module.css";
import s from "./site-footer.module.css";

/**
 * The footer, on the forest surface: the brand and its one-line descriptor, five link groups and
 * the legal row. Held routes are filtered out of the groups. The consent link is the shared one
 * and renders only on measured public paths. On a phone the groups are `<details>` disclosures
 * (WO-CI-22, lead decision 7).
 */
export default function SiteFooter() {
  const groups = resolveGroups(V34_FOOTER_GROUPS);
  return (
    <footer className={`${tokens.forest} ${s.footer}`}>
      <div className={s.shell}>
        <div className={s.lead}>
          <Link href="/" className={s.brand} aria-label="TAVONEL home" prefetch={false}>
            <Logomark size={26} />
            <span className={s.wordmark}>TAVONEL</span>
          </Link>
          <p className={s.tagline}>{BRAND_LINE.descriptor}</p>
        </div>
        <div className={s.groups}>
          {groups.map((group) => (
            <nav key={group.title} aria-label={group.title} className={s.group}>
              <p className={s.title}>{group.title}</p>
              {/*
                On a phone each group is a native disclosure, opened on its own (no `name`), so the footer
                fits its height budget; wider, the stylesheet hides the summary and shows the links. No
                script either way, and the links are in the server HTML whether the group is open or not.
              */}
              <details className={s.disclosure}>
                <summary className={s.summary}>{group.title}</summary>
                <ul className={s.list}>
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link className={s.link} href={link.href as Route} prefetch={false}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </details>
            </nav>
          ))}
        </div>
        <div className={s.legal}>
          <span>{FOOTER_LEGAL_ROW.copyright}</span>
          <a className={s.link} href={`mailto:${FOOTER_LEGAL_ROW.security}`}>{FOOTER_LEGAL_ROW.security}</a>
          {V34_FOOTER_LEGAL_LINKS.map((link) => (
            <Link key={link.href} className={s.link} href={link.href as Route} prefetch={false}>{link.label}</Link>
          ))}
          <MarketingConsentLink />
        </div>
      </div>
    </footer>
  );
}
