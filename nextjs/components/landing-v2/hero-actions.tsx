"use client";

import Link from "next/link";
import type { Route } from "next";
import { trackFunnel } from "@/lib/funnel-events";

type HeroActionsProps = {
  exploreLabel: string;
  exploreHref: string;
  scene: string;
  ctaOrderVariant?: "a" | "b" | "c";
} & (
  | { startLabel: string; startHref: string }
  | { pricingLabel: string; pricingHref?: string }
);

/** Accept the resolved Home access action while preserving existing pricing callers. */
export default function HeroActions(props: HeroActionsProps) {
  const { exploreLabel, exploreHref, scene, ctaOrderVariant = "a" } = props;
  const explore = { label: exploreLabel, href: exploreHref, cta: "explore" } as const;
  const access = "startLabel" in props
    ? { label: props.startLabel, href: props.startHref, cta: "start" as const }
    : { label: props.pricingLabel, href: props.pricingHref ?? "/pricing", cta: "pricing" as const };
  const [primary, secondary] = ctaOrderVariant === "b" ? [access, explore] : [explore, access];
  const onSelect = (action: typeof explore | typeof access) => () => {
    if (scene === "1" && action.cta === "explore") trackFunnel("hero_explore_clicked");
    if (scene === "1" && action.cta === "start") trackFunnel("hero_start_clicked");
    trackFunnel("cta_clicked", { cta: action.cta, scene });
  };
  return (
    <div className="lv2-actions" data-scene-actions={scene}>
      <Link className="btn lv2-cta" href={primary.href as Route} prefetch={false}
        onClick={onSelect(primary)} data-analytics="hero-primary">
        {primary.label}
      </Link>
      <Link className="lv2-text-link" href={secondary.href as Route} prefetch={false}
        onClick={onSelect(secondary)} data-analytics="hero-secondary">
        {secondary.label}<span aria-hidden="true">&nbsp;→</span>
      </Link>
    </div>
  );
}

/*
  Founder ask 2026-10-27 ("pdf 어디에 올리라는거야?"): Home's first screen names where a PDF goes. The workspace
  intake is behind sign-in, so this is a way in, not a drop zone: a Home drop would have to keep the visitor's
  file before sign-in, and how that is told to the visitor is consent wording (founder-only). /login sends a
  signed-in visitor straight on to /workspace, whose intake is the first block of its Home tab.
*/
export function HeroUpload({ korean }: { korean: boolean }) {
  return (
    <Link className="lv2-upload" href={"/login?next=/workspace" as Route} prefetch={false} data-analytics="hero-upload"
      onClick={() => trackFunnel("cta_clicked", { cta: "upload", scene: "1" })}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
        <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3" />
      </svg>
      <span>{korean ? "PDF 올리기" : "Upload a PDF"}</span>
    </Link>
  );
}
