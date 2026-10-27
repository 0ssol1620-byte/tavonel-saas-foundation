"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
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
  Founder ask 2026-10-27 ("pdf 어디에 올리라는거야? ... 파일 드래그앤드랍도"), CLAUDE.md §Frontend "the hero is still the
  working drop zone": a PDF dropped anywhere on the first section, or chosen here, waits in this browser
  (lib/home-drop-handoff, loaded only when a file arrives, so the page's script bytes do not carry it) and
  /workspace stages it through its own intake after sign-in. Nothing is uploaded from Home.
*/
type DropState = "idle" | "over" | "failed";

async function handOver(files: File[], setState: (state: DropState) => void) {
  if (files.length === 0) return;
  try {
    const { stashHomeDrop } = await import("@/lib/home-drop-handoff");
    await stashHomeDrop(files);
  } catch {
    setState("failed");
    return;
  }
  trackFunnel("cta_clicked", { cta: "drop", scene: "1" });
  window.location.assign("/workspace");
}

const carriesFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes("Files"));

export function HeroDrop({ korean }: { korean: boolean }) {
  const [state, setState] = useState<DropState>("idle");
  const label = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    const zone = label.current?.closest("section");
    if (!zone) return;
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
      setState("over");
    };
    const leave = (event: DragEvent) => { if (!zone.contains(event.relatedTarget as Node | null)) setState("idle"); };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setState("idle");
      void handOver(Array.from(event.dataTransfer!.files), setState);
    };
    zone.addEventListener("dragover", over);
    zone.addEventListener("dragleave", leave);
    zone.addEventListener("drop", drop);
    return () => {
      zone.removeEventListener("dragover", over);
      zone.removeEventListener("dragleave", leave);
      zone.removeEventListener("drop", drop);
    };
  }, []);
  return (
    <>
      <label ref={label} className="lv2-drop" data-state={state} data-analytics="hero-drop">
        <input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => void handOver(Array.from(event.currentTarget.files ?? []), setState)} />
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
          <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3" />
        </svg>
        <span>{korean ? "PDF를 끌어다 놓거나 선택하세요" : "Drop or choose a PDF"}</span>
      </label>
      {state === "failed" ? <p className="lv2-drop-error" role="alert">{korean ? "이 브라우저에서는 파일을 보관할 수 없습니다." : "This browser could not keep the file."}</p> : null}
    </>
  );
}
