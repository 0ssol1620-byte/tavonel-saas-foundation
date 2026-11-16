import Link from "next/link";
import type { Route } from "next";
import type { CSSProperties } from "react";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import V34Page from "@/components/v34/shell/v34-page";
import { HeaderAccountActions, NavCurrentLink, NavDisclosure } from "@/components/site-nav/desktop-primary-nav";
import HeaderScrollState from "@/components/site-nav/header-scroll-state";
import { MarketingConsentLink } from "@/components/marketing-consent";
import { primaryCallToAction } from "@/lib/commercial-state";
import {
  BRAND_LINE,
  FOOTER_GROUPS,
  FOOTER_LEGAL_ROW,
  HEADER_NAV,
  navAlsoOwns,
  navGroupFor,
  type NavPanelItem,
} from "@/lib/site-navigation";
import chrome from "./public-site-chrome.module.css";

/*
  NAV PANELS, 2026-11-09: the bar's items open the 2026-09-11 panels again, on hover and from a
  toggle beside each label.

  Server-rendered, both widths. Every bar item is still the link it was -- a click on "Product"
  goes to /product -- and the items that own a group (`navGroupFor`) are followed by a disclosure
  button and the panel it controls, in that order, so Tab walks label, toggle, the open panel's
  links, then the next label. `NavDisclosure` is the only script: it moves `aria-expanded`, and
  `public-site-chrome.module.css` draws the panel from that attribute. The markup is the same at
  both widths ("one structure"); the bar lays a panel out as columns under its item, the phone
  sheet as an accordion row. The class names differ only because the e2e specs and the shared
  chrome sheets have always told the two chromes apart by them.

  Panel links do not prefetch: they are in the DOM on every page, and T1-014 measured what a footer
  full of prefetching links cost a cold Home load.
*/
export function NavSections({ sheet = false }: { sheet?: boolean }) {
  const panelLink = (item: NavPanelItem) => (
    <Link key={item.href} className={chrome.navLink} href={item.href as Route} prefetch={false}>
      <span className={chrome.navLinkLabel}>{item.label}</span>
      {item.description ? <span className={chrome.navDescription}>{item.description}</span> : null}
    </Link>
  );
  return (
    <>
      {HEADER_NAV.map((item) => {
        const label = item.label;
        const group = navGroupFor(item.href);
        const panelId = `${sheet ? "sheet" : "bar"}-nav-panel-${group?.section}`;
        return [
          <NavCurrentLink key={item.href} href={item.href} also={navAlsoOwns(item.href)} native={sheet} section={group?.section}
            className={sheet ? "mobile-nav-direct" : "site-nav-direct"}>
            {label}
          </NavCurrentLink>,
          group ? (
            <button key={`${item.href}-toggle`} type="button" className={chrome.navToggle} aria-expanded="false"
              aria-controls={panelId} data-section={group.section} data-hub={item.href}
              aria-label={`${label} menu`} />
          ) : null,
          group ? (
            <div key={`${item.href}-panel`} className={chrome.navPanel} id={panelId} data-section={group.section}>
              <div className={chrome.navCard} style={{ "--nav-columns": group.columns.length } as CSSProperties}>
                {group.columns.map((column) => (
                  <div className={chrome.navColumn} key={column.title}>
                    <p className={chrome.navColumnTitle}>{column.title}</p>
                    {column.items.map(panelLink)}
                  </div>
                ))}
                {group.featured ? <p className={chrome.navFeatured}>{panelLink(group.featured)}</p> : null}
              </div>
            </div>
          ) : null,
        ];
      })}
      <NavDisclosure hover={!sheet} />
    </>
  );
}

/** The desktop row: the bar items, their toggles and their panels. Below 1250px the sheet takes over. */
export function DesktopPrimaryNav() {
  return (
    <nav aria-label="Sections" className={`site-nav one-path-primary-nav ${chrome.navBar}`}>
      <NavSections />
    </nav>
  );
}

/**
 * The header, once, for every public surface including the three that used to hand-roll one.
 *
 * The landing page needed a scroll-reactive header and its KNOWLEDGE COMPILER badge,
 * `/pricing` needed its own access label, and the policy pages had a two-link nav of their own --
 * so three files each kept a copy of the row, and a change to the navigation had to be made four
 * times or the site's structure changed as a visitor moved through it. Those three differences are
 * the three props below; everything else is this component.
 *
 * `signedIn` swaps Sign in for a link to the workspace and leaves the action beside it alone. A
 * reader who is already authenticated needs their account, not a sign-in (FUNNEL-SIGNED-IN #10).
 *
 * BA-232: `cta` is required. It was optional, and the fallback was a client component that
 * painted a placeholder label and then replaced it once `/api/status` answered -- on every page
 * that took the fallback, which was every page but three. The caller resolves the action instead,
 * which every caller can: two of them are client components that already receive the commercial
 * state as a prop, and the rest reach this file through `PublicSitePage` below.
 *
 * Landing V2, 2026-09-19 (blueprint §8, §35; contract D2). Three changes, and the first is a
 * removal.
 *
 * The deployment state line leaves the header. `Public sample: open to read · Your own files: by
 * arrangement` is true, and it was the first thing a reader met on every page of the site -- an
 * operations notice in the position a visitor reads as the product's opening sentence, which is
 * §2.1's diagnosis of the old hero applied to the bar above it. Nothing here decides the fact is
 * unimportant; it decides where a fact about the deployment sits relative to what the product is.
 * The fact itself -- `activationPolicy.customerData.reason` -- is still published verbatim on
 * /pricing, /security, /integrations, in the /docs first-run notes and in the landing's closing
 * scene. `deploymentStateLine()` was deleted in the 2026-09-19 fix round, once this removal left
 * it with no caller anywhere in the tree; `lib/commercial-state.ts` carries the inventory of the
 * surfaces that still state the gate and of the ones that no longer do.
 *
 * The `mode` and `stuck` props went with it. `mode` was a caller's override for that line and no
 * caller passed one; `stuck` hard-coded the bar's opaque state and every caller took the default,
 * so the bar was opaque at the top of the page where §8 wants it transparent. `HeaderScrollState`
 * sets `data-scrolled` instead -- server-rendered absent, which is the unscrolled state, so the
 * first paint is right before any JavaScript runs.
 *
 * BA-249 is reversed here, deliberately. The access action is the filled `btn` again, because §8
 * asks for exactly one filled control in the bar and §29 makes Request access the site's one
 * commercial conversion. What BA-249 was avoiding -- two filled buttons for the same action in
 * one viewport on /product and /developers -- is a hero problem, and this row is transparent over
 * the page until 40px of scroll, so at the moment a reader meets a hero's own primary button the
 * header's is on no ground at all.
 */
export function PublicSiteHeader({
  signedIn,
  ghostCta = false,
  start,
}: {
  signedIn?: boolean;
  /**
   * The start action for the phone sheet, resolved on the server (`primaryCallToAction()`). A
   * client caller passes the one it already resolved, or nothing.
   */
  start?: { href: string; label: string };
  /**
   * FINAL-SPEC 2026-10-26 §2.8: on Home the header action is a ghost pill (the hero and the close carry
   * the one filled action per screen), so it is marked as the ghost it is rather than as a filled `.btn`.
   */
  ghostCta?: boolean;
}) {
  /*
    Founder 2026-11-10: signed out, the header's action is the start -- "Start free" (SELF_SERVE_CTA) wherever live
    commerce is on, the access action where it is not, so the header never offers a start the deployment refuses
    (lib/cta-truth.test.ts). A page that resolved its own start passes it; a client caller that cannot read the flags
    (BA-232) and passes nothing gets the closed posture, which is the truthful default.
  */
  const resolved = primaryCallToAction();
  const action = start ?? resolved;
  return (
    <header className={`nav chrome-v2-header ${chrome.header}`}>
      <HeaderScrollState />
      <Link href="/" className={`wordmark ${chrome.wordmark}`} aria-label="TAVONEL home">
        <Logomark />
        <b>TAVONEL</b>
      </Link>
      <DesktopPrimaryNav />
      <MobilePrimaryNav signedIn={signedIn} start={action}
        labels={{ menu: "Menu", pricing: "Pricing", signIn: "Sign in" }}>
        <NavSections sheet />
      </MobilePrimaryNav>
      <span className="nav-actions">
        <Link className={`small ${chrome.pricingLink}`} href="/pricing">Pricing</Link>
        {/*
          Below the desktop switch this link is in the phone sheet instead, where it gets a 44px
          row of its own. At 360px the row was wordmark + toggle + a 109px filled button + Sign in
          and it did not fit: `app/tavonel.css` hid the link outright on one posture and drew the
          toggle as a bare icon to buy back the width. A secondary destination belongs in the
          sheet on a phone; the action beside it is the one thing that may not go behind a
          disclosure.
        */}
        {/* FUNNEL-SIGNED-IN #10 and founder 2026-11-10: signed in, the action is Open workspace and Sign in goes;
            signed out, Sign in stays a plain link and the action is the start. Desktop only: below the switch both are
            the phone sheet's foot. The public sample is the hero's secondary link, no longer the header's action. */}
        <HeaderAccountActions signedIn={signedIn} start={action}
          labels={{ signIn: "Sign in", workspace: "Open workspace" }}
          className={`btn${ghostCta ? " btn-ghost" : ""} ${chrome.cta}`} signInClassName="nav-signin chrome-v2-signin" />
      </span>
    </header>
  );
}

/**
 * G1-036 / BA-250 follow-through: the footer, once, for the two pages that hand-rolled their own.
 *
 * `home-page-client` and `pricing-page-client` each kept a copy of the groups and the tagline and
 * neither carried the legal row -- so the copyright, the Korean entry, the security inbox and the
 * consent-withdrawal link existed on every page except the two a visitor meets first. `onePath`
 * keeps the landing page's wider measure (`.one-path-wrap`); nothing else differs.
 *
 * Landing V2, 2026-09-19 (contract D9). `.chrome-v2-wrap` rides alongside whichever of the two
 * the caller asked for rather than replacing it: `app/tavonel.css` styles `footer.site .shell`
 * and `footer.site .one-path-wrap` as the flex column this content needs, and swapping the class
 * would have taken that with it. `chrome-v2.css` is unlayered, so the measure it sets wins over
 * both while the layout they give stays. The header takes the same measure through its own
 * padding (it is a full-bleed flex row and cannot hold a wrapper element without breaking the
 * `.nav > nav` child selectors two sheets rely on), which is what puts the wordmark on the same
 * left edge as the content below it.
 */
/*
  FINAL-SPEC 2026-10-26 §2.8: Home's compact footer -- seven of the footer's own links, in this
  order, labelled exactly as `FOOTER_GROUPS` labels them, so the compact row introduces no string. A
  route missing from it fails the render rather than printing a link the full footer does not have.
*/
const COMPACT_FOOTER_HREFS = ["/knowledge-compiler", "/enterprise", "/trust", "/security", "/status", "/subprocessors", "/contact"] as const;

export function compactFooterLinks(groups: typeof FOOTER_GROUPS = FOOTER_GROUPS) {
  const all = groups.flatMap((group) => group.links);
  return COMPACT_FOOTER_HREFS.map((href) => {
    const link = all.find((candidate) => candidate.href === href);
    if (!link) throw new Error(`compact footer: ${href} has no FOOTER_GROUPS entry`);
    return { href, label: link.label };
  });
}

export function PublicSiteFooter({ onePath = false, compact = false }: { onePath?: boolean; compact?: boolean } = {}) {
  /* BQ-131: the wordmark at the bottom of a page is where a reader goes home from. It was
     a bare <span> -- the one instance of the lockup on the site that was not a link. */
  const wordmark = <Link href="/" className={`wordmark ${chrome.wordmark}`} aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>;
  return (
    <footer className={`${onePath ? "site one-path-footer" : "site"} chrome-v2-footer ${chrome.footer}${compact ? ` ${chrome.compact}` : ""}`}>
      <div className={`${onePath ? "one-path-wrap" : "shell"} chrome-v2-wrap`}>
        {compact ? (
          /* Home only: one row, no group titles and no tagline; the legal row below is unchanged. */
          <div className={chrome.compactRow}>
            {wordmark}
            <nav className={`site-footer-groups ${chrome.footerGroups} ${chrome.compactLinks}`}>
              {compactFooterLinks().map((link) => (
                <Link key={link.href} href={link.href as Route} prefetch={false}>{link.label}</Link>
              ))}
            </nav>
          </div>
        ) : <>
        {wordmark}
        <div className={`site-footer-groups ${chrome.footerGroups}`}>
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <p className="site-footer-title">{group.title}</p>
              {/* T1-014: the footer is always below the fold; prefetching every group wasted ~185KB on a cold home load. */}
              {group.links.map((link) => (
                <Link key={link.href} href={link.href as Route} prefetch={false}>{link.label}</Link>
              ))}
            </nav>
          ))}
        </div>
        {/*
          D8: the tagline is `BRAND_LINE.descriptor`, not a sixth copy of it.

          landing-09: it sat at the Product column's own left edge on the Product column's own
          29px rhythm, so it read as a sixth item of that list rather than as the footer's
          positioning line, and at 412 it ran straight into the copyright row. Its own class, its
          own row, its own tone.
        */}
        <p className="fine site-footer-tagline">{BRAND_LINE.descriptor}</p>
        </>}
        {/*
          THE DEPLOYMENT GATE IS NOT IN THE CHROME. 2026-09-19, hero/chrome fix round.

          A previous round put `activationPolicy.customerData.reason` here, in the footer, to give
          back the eight routes that lost it when D2 cleared the header line. The reasoning was
          sound and the placement was not: the footer renders on every public route, and two gates
          this repository already enforces say so.

            e2e/explore.spec.ts (BA-028) forbids the phrase "this deployment" anywhere on
            /explore -- that page's argument is that a reader can open the sample and check it,
            and a sentence about what is closed contradicts the page it is printed on; and

            e2e/public-layout-balance.spec.ts caps the footer at 90% of a phone viewport. With the
            gate paragraph the /integrations footer measured 812px against a 760px ceiling at
            390x844 -- a bottom of page that is taller than the screen.

          The fact itself is unchanged and still published verbatim, on the surfaces where a
          reader is actually deciding: /pricing, /security, /integrations, the /docs first-run
          notes, and the landing's own closing scene, which is what /contact's access action is
          reached from. Restoring it to shared chrome needs a placement that satisfies both gates
          above, which is a design decision rather than a re-add.
        */}
        {/*
          BA-250: the row a procurement reader looks for. Copyright and the security inbox -- an
          address this site already publishes, so nothing here is a new commitment. The legal entity and the governing jurisdiction are
          deliberately absent; see `FOOTER_LEGAL_ROW`.
        */}
        {/*
          landing-14, then Release 2: separators sit only between items.

          Each dot is its own aria-hidden span between two pairs, never inside one, so where the
          row becomes a two-column grid on a phone the dots are dropped and no line starts with
          one (the 390 capture ended on "· Analytics preferences").
        */}
        <p className={`fine site-footer-legal ${chrome.legal}`}>
          <span className="site-footer-legal-pair">{FOOTER_LEGAL_ROW.copyright}</span>
          {/* Founder decision 2026-11-09 (global-only presentation): no language switch. A Korean
              reader uses the browser's own translation, and /ko/* redirects to English. */}
          <span className="site-footer-legal-sep" aria-hidden="true">·</span>
          <span className="site-footer-legal-pair">
            <a href={`mailto:${FOOTER_LEGAL_ROW.security}`}>{FOOTER_LEGAL_ROW.security}</a>
          </span>
          {/* G1-033 / G2-006: the consent-withdrawal path lives here after a choice, not in a floating pill.
              It renders its own separator and pair (BQ-051: it returns null off a measured path). */}
          <MarketingConsentLink />
        </p>
      </div>
    </footer>
  );
}

/**
 * UX-L7 (UX-PLAN-2026-10-17 §5.1, §5.4): the page templates, declared on the page root.
 *
 * T0 Home, T1 Story (Product/Solutions), T2 Conversion (Pricing/Evaluation/Contact), T3 Reference
 * (Docs/Developers), T4 Explore, T5 Trust/Editorial. T6, the workspace app shell, is not a public
 * page and is not declared here. A route says which template it is as `data-template` on its page root
 * (the element that holds <main>, or <main> itself on /explore), so a template-wide rule has one
 * selector and `e2e/templates.spec.ts` can read the inventory off the browser and compare it with §5.4.
 */
export type PageTemplate = "T0" | "T1" | "T2" | "T3" | "T4" | "T5";

/*
  `template` is required: a new public page has to say which template it is, and a page outside
  §5.4's inventory (the 404, the noindex /arena) says so with `null` rather than by forgetting.
*/
export function PublicSitePage({ children, template }: { children: React.ReactNode; template: PageTemplate | null }) {
  /*
    The commercial posture, read once per page rather than fetched once per visitor.

    This module is also reached from two client components (`home-page-client`,
    `pricing-page-client`), each of which passes its own already-resolved `cta` and never renders
    `PublicSitePage`. That is why the call is here and not inside `PublicSiteHeader`: a client
    render of this function would inline the unprefixed flags as `undefined` and quietly return
    the closed posture.
  */
  return (
    <V34Page className="page public-page" template={template ?? undefined}>{children}</V34Page>
  );
}
