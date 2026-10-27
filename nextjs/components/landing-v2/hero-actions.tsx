"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef } from "react";
import { trackFunnel } from "@/lib/funnel-events";

type HeroActionsProps = {
  exploreLabel: string;
  exploreHref: string;
  scene: string;
  ctaOrderVariant?: "a" | "b" | "c";
  /** Scene 1 only: the access action is drawn as the hero's document entry (see the note at the end of this file). */
  entry?: boolean;
} & (
  | { startLabel: string; startHref: string }
  | { pricingLabel: string; pricingHref?: string }
);

/** Accept the resolved Home access action while preserving existing pricing callers. */
export default function HeroActions(props: HeroActionsProps) {
  const { exploreLabel, exploreHref, scene, ctaOrderVariant = "a", entry = false } = props;
  const explore = { label: exploreLabel, href: exploreHref, cta: "explore" } as const;
  const access = "startLabel" in props
    ? { label: props.startLabel, href: props.startHref, cta: "start" as const }
    : { label: props.pricingLabel, href: props.pricingHref ?? "/pricing", cta: "pricing" as const };
  const [primary, secondary] = ctaOrderVariant === "b" ? [access, explore] : [explore, access];
  const entryRef = useRef<HTMLAnchorElement>(null);
  const drawsEntry = entry && secondary === access;
  // A file dropped anywhere on Home would open in the tab and leave the site. Home keeps no file: the drop only
  // takes the visitor to the document entry (PR #177 review round 2, nit 1).
  useEffect(() => {
    if (!drawsEntry) return;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const onDragOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      entryRef.current?.focus();
      entryRef.current?.scrollIntoView({ block: "center" });
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [drawsEntry]);
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
      {drawsEntry ? (
        <Link ref={entryRef} className="lv2-entry" href={secondary.href as Route} prefetch={false}
          onClick={onSelect(secondary)} data-analytics="hero-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
            <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3" />
          </svg>
          {secondary.label}
        </Link>
      ) : (
        <Link className="lv2-text-link" href={secondary.href as Route} prefetch={false}
          onClick={onSelect(secondary)} data-analytics="hero-secondary">
          {secondary.label}<span aria-hidden="true">&nbsp;→</span>
        </Link>
      )}
    </div>
  );
}

/*
  The hero's document entry (`entry`), PR #177 review round 1 (code B1, design B1). Founder ask 2026-10-27 ("pdf
  어디에 올리라는거야?"): Home's first screen names where your documents go, with one box -- and the box keeps the
  promise of the screen it opens. Customer file processing is not open to a visitor
  (activationPolicy.customerData.enabled=false), so the box is the hero's own access action ("Evaluate your
  documents" / "내 문서 평가" to /evaluation or /ko/evaluation while access resolves to /contact), not an upload label
  in front of a sign-in page whose first sentence is that processing is not open. It replaces the text link rather
  than adding a third action (DESIGN_MASTER_V3 §12.2) and draws no arrow: the box is the control. A public intake and
  its wording are the founder's call; until then the drop zone is the workspace's (app/workspace/page.tsx).
*/
