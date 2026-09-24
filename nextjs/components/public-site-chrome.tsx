import Link from "next/link";
import type { Route } from "next";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import DesktopPrimaryNav from "@/components/site-nav/desktop-primary-nav";
import HeaderScrollState from "@/components/site-nav/header-scroll-state";
import { MarketingConsentLink } from "@/components/marketing-consent";
import { BRAND_LINE, FOOTER_GROUPS, FOOTER_LEGAL_ROW, KO_CHROME } from "@/lib/site-navigation";
import chrome from "./public-site-chrome.module.css";

/**
 * The header, once, for every public surface including the three that used to hand-roll one.
 *
 * The landing page needed a scroll-reactive header and its KNOWLEDGE COMPILER badge,
 * `/pricing` needed its own access label, and the policy pages had a two-link nav of their own --
 * so three files each kept a copy of the row, and a change to the navigation had to be made four
 * times or the site's structure changed as a visitor moved through it. Those three differences are
 * the three props below; everything else is this component.
 *
 * `signedIn` suppresses Sign in rather than the action beside it. A reader who is already
 * authenticated does not need the link, and offering both put the same destination in the row
 * twice on the landing page.
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
  korean = false,
}: {
  signedIn?: boolean;
  /** G1-043: /ko is the site's one Korean URL, and it rendered an English header around it. */
  korean?: boolean;
}) {
  const pricingLabel = korean ? KO_CHROME.nav["/pricing"] : "Pricing";
  return (
    <header className={`nav chrome-v2-header ${chrome.header}`}>
      <HeaderScrollState />
      <Link href="/" className={`wordmark ${chrome.wordmark}`} aria-label="TAVONEL home">
        <Logomark />
        <b>TAVONEL</b>
      </Link>
      <DesktopPrimaryNav korean={korean} />
      <MobilePrimaryNav korean={korean} signedIn={signedIn} />
      <span className="nav-actions">
        <Link className="btn small" href="/pricing" hrefLang={korean ? "en" : undefined}>{pricingLabel}</Link>
        {/*
          Below the desktop switch this link is in the phone sheet instead, where it gets a 44px
          row of its own. At 360px the row was wordmark + toggle + a 109px filled button + Sign in
          and it did not fit: `app/tavonel.css` hid the link outright on one posture and drew the
          toggle as a bare icon to buy back the width. A secondary destination belongs in the
          sheet on a phone; the action beside it is the one thing that may not go behind a
          disclosure.
        */}
        {signedIn ? null : <Link className="nav-signin chrome-v2-signin" href="/login">{korean ? KO_CHROME.signIn : "Sign in"}</Link>}
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
export function PublicSiteFooter({ korean = false, onePath = false, languageHref }: { korean?: boolean; onePath?: boolean; languageHref?: string } = {}) {
  /* chrome-06: the switch points at the language the reader is not reading. */
  const language = korean ? FOOTER_LEGAL_ROW.languageBack : FOOTER_LEGAL_ROW.language;
  return (
    <footer className={`${onePath ? "site one-path-footer" : "site"} chrome-v2-footer ${chrome.footer}`}>
      <div className={`${onePath ? "one-path-wrap" : "shell"} chrome-v2-wrap`}>
        {/* BQ-131: the wordmark at the bottom of a page is where a reader goes home from. It was
            a bare <span> -- the one instance of the lockup on the site that was not a link. */}
        <Link href="/" className={`wordmark ${chrome.wordmark}`} aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>
        <div className={`site-footer-groups ${chrome.footerGroups}`}>
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <p className="site-footer-title">{korean ? KO_CHROME.footerGroups[group.title] ?? group.title : group.title}</p>
              {/* T1-014: the footer is always below the fold; prefetching every group wasted ~185KB on a cold home load. */}
              {group.links.map((link) => (
                <Link key={link.href} href={(korean && link.href === "/contact" ? "/ko/contact" : link.href) as Route} hrefLang={korean && link.href !== "/contact" ? "en" : undefined} prefetch={false}>{korean ? KO_CHROME.footerLinks[link.href] ?? link.label : link.label}</Link>
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
        <p className="fine site-footer-tagline">{korean ? KO_CHROME.tagline : BRAND_LINE.descriptor}</p>
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
          reached from. `KO_CHROME.customerDataGate` remains its one Korean translation for those
          surfaces. Restoring it to shared chrome needs a placement that satisfies both gates
          above, which is a design decision rather than a re-add.
        */}
        {/*
          BA-250: the row a procurement reader looks for. Copyright, the Korean entry and the
          security inbox -- the last two are pages and an address this site already publishes, so
          nothing here is a new commitment. The legal entity and the governing jurisdiction are
          deliberately absent; see `FOOTER_LEGAL_ROW`.
        */}
        {/*
          landing-14: every separator travels with the link after it.

          The row wrapped between a " · " and its link, so the line ended on a dangling middle dot
          and "Analytics preferences" was orphaned onto a row of its own at 412. Each pair is one
          nowrap span, so the row breaks between pairs or not at all.
        */}
        <p className="fine site-footer-legal">
          <span className="site-footer-legal-pair">{FOOTER_LEGAL_ROW.copyright}</span>{" "}
          <span className="site-footer-legal-pair">
            {"· "}
            {/* T1-014 again (ROUND3-P2): the one footer link that was missing the flag, so /ko
                fired an RSC prefetch for `/` that the browser then aborted. */}
            <Link href={(languageHref ?? language.href) as Route} hrefLang={korean ? "en" : "ko"} lang={korean ? "en" : "ko"} prefetch={false}>{language.label}</Link>
          </span>{" "}
          <span className="site-footer-legal-pair">
            {"· "}
            <a href={`mailto:${FOOTER_LEGAL_ROW.security}`}>{FOOTER_LEGAL_ROW.security}</a>
          </span>{" "}
          {/* G1-033 / G2-006: the consent-withdrawal path lives here after a choice, not in a floating pill.
              It owns its own separator (BQ-051, because it returns null off a measured path), so the
              nowrap span goes around the component rather than inside the row. */}
          <span className="site-footer-legal-pair"><MarketingConsentLink /></span>
        </p>
      </div>
    </footer>
  );
}

export function PublicSitePage({ children, korean = false, languageHref }: { children: React.ReactNode; korean?: boolean; languageHref?: string }) {
  /*
    The commercial posture, read once per page rather than fetched once per visitor.

    This module is also reached from two client components (`home-page-client`,
    `pricing-page-client`), each of which passes its own already-resolved `cta` and never renders
    `PublicSitePage`. That is why the call is here and not inside `PublicSiteHeader`: a client
    render of this function would inline the unprefixed flags as `undefined` and quietly return
    the closed posture.
  */
  return (
    <div className="page public-page" lang={korean ? "ko" : undefined}>
      <PublicSiteHeader korean={korean} />
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicSiteFooter korean={korean} languageHref={languageHref} />
    </div>
  );
}
