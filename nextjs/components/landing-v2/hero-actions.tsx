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
