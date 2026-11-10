import Link from "next/link";
import type { Route } from "next";
import { primaryCallToAction } from "@/lib/commercial-state";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { SELF_SERVE_CTA, START_FREE_LABEL, TRIAL_ALLOWANCE } from "@/lib/site-navigation";

/*
  Conversion pass, 2026-11-09 (funnel audit fix 4). A reader who has just checked a citation or a
  benchmark row is the warmest on the site, and /evidence and /benchmarks ended on the next trust
  page only. This is the step from proof to their own files.

  Server component: the access action is resolved here (`primaryCallToAction()`), so a deployment
  that cannot sell offers the access request instead, and the free allowance is not printed there.
  Every number is read from `TRIAL_ALLOWANCE` (pinned to the trial policy migration) and the
  billing catalog.
*/
export function ownFilesCopy(start: { href: string; label: string }) {
  const live = start.href === SELF_SERVE_CTA.href;
  const developer = BILLING_OFFERS.observer_access;
  return {
    heading: "Run this on your own files",
    note: live
      ? `Free for ${TRIAL_ALLOWANCE.days} days with up to ${TRIAL_ALLOWANCE.files} files and ${TRIAL_ALLOWANCE.pages} standard pages, no card. ${developer.label} is $${developer.priceUsd}/month for ${developer.includedPages.toLocaleString("en-US")} standard pages.`
      : "Tell us about your sources and we will scope an evaluation with you.",
    primary: { href: start.href, label: live ? START_FREE_LABEL : start.label },
    // The access request already goes to /contact, so a second link there would be the same action twice.
    secondary: start.href === "/contact" ? null : { href: "/contact", label: "Talk to us" },
  };
}

export function OwnFilesCta() {
  const copy = ownFilesCopy(primaryCallToAction());
  return (
    <div className="stack trust-next own-files-cta" data-own-files-cta="">
      <h2>{copy.heading}</h2>
      <p className="fine">{copy.note}</p>
      <div className="actions">
        <Link className="btn" href={copy.primary.href as Route}>{copy.primary.label}</Link>
        {copy.secondary ? <Link className="btn ghost" href={copy.secondary.href as Route}>{copy.secondary.label}</Link> : null}
      </div>
    </div>
  );
}
