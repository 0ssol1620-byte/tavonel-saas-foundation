"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight } from "lucide-react";
import { trackFunnel } from "@/lib/funnel-events";

export default function HeroActions({
  exploreLabel,
  exploreHref,
  startLabel,
  startHref,
  scene,
  ctaOrderVariant = "a",
}: {
  exploreLabel: string;
  exploreHref: string;
  /** The access action the server resolved from the commercial state -- not necessarily /pricing. */
  startLabel: string;
  startHref: string;
  scene: string;
  ctaOrderVariant?: "a" | "b" | "c";
}) {
  const explore = { label: exploreLabel, href: exploreHref, cta: "explore" } as const;
  const start = { label: startLabel, href: startHref, cta: "start" } as const;
  const [primary, secondary] = ctaOrderVariant === "b" ? [start, explore] : [explore, start];
  const onSelect = (action: typeof explore | typeof start) => () => {
    if (scene === "1") trackFunnel(action.cta === "explore" ? "hero_explore_clicked" : "hero_start_clicked");
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
        {secondary.label}<ArrowUpRight size={17} aria-hidden="true" />
      </Link>
    </div>
  );
}
