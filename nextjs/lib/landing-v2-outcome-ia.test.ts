import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { LANDING_V2_COPY, LANDING_V2_SCENE_ORDER } from "./landing-v2-copy";
import { PUBLIC_MARKETING_PATHS } from "./marketing-analytics";

const landingPageSource = readFileSync(
  new URL("../components/landing-v2/landing-page.tsx", import.meta.url),
  "utf8",
);
const landingAnalyticsSource = readFileSync(
  new URL("../components/landing-v2/landing-analytics.tsx", import.meta.url),
  "utf8",
);
const englishPageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const koreanPageSource = readFileSync(new URL("../app/ko/page.tsx", import.meta.url), "utf8");
const llms = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
const sitemapPaths = new Set(sitemap().map((entry) => new URL(entry.url).pathname.replace(/\/$/, "") || "/"));

const OUTCOME_ROUTES = [
  "/explore",
  "/evidence",
  "/sources",
  "/product/continuous-knowledge",
  "/trust",
  "/contact",
] as const;

describe("B33 outcome IA cross-surface integration", () => {
  it("keeps the nine customer-task scenes in the canonical order", () => {
    expect(LANDING_V2_SCENE_ORDER).toEqual([
      "hero",
      "proof",
      "sources",
      "evidence",
      "recompile",
      "why",
      "use",
      "trust",
      "start",
    ]);
    expect(landingPageSource).toContain('data-home-ia="outcome-v1.1"');
  });

  it.each(["en", "ko"] as const)("%s links only published and measured outcome routes", (locale) => {
    const copy = LANDING_V2_COPY[locale];
    const linked = new Set([
      ...copy.use.inbound.map((entry) => entry.href),
      ...copy.use.outbound.map((entry) => entry.href),
    ]);
    expect(linked).toEqual(new Set(OUTCOME_ROUTES));
    for (const route of linked) {
      expect(sitemapPaths, `${route} is absent from the sitemap`).toContain(route);
      expect(PUBLIC_MARKETING_PATHS, `${route} is absent from consented analytics`).toContain(route);
      expect(llms, `${route} is absent from llms.txt`).toContain(`https://tavonel.com${route}`);
    }
  });

  it("publishes the result-first home description consistently", () => {
    const sentence =
      "Inspect a finished public Compiled World, follow one result to its exact source region, compare what changed, and review accepted sources and deployment boundaries before discussing your own sources.";
    expect(englishPageSource).toContain(sentence);
    expect(llms).toContain(`[Home](https://tavonel.com/): ${sentence}`);
    expect(koreanPageSource).toContain(
      "완성된 공개 Compiled World를 살펴보고, 결과 하나를 정확한 원문 영역까지 따라가고, 변경 내용과 허용 원문 및 배포 경계를 확인한 뒤 직접 가진 원문을 논의하세요.",
    );
  });

  it("keeps both entry pages indexable and measured", () => {
    expect(sitemapPaths).toContain("/");
    expect(sitemapPaths).toContain("/ko");
    expect(PUBLIC_MARKETING_PATHS).toContain("/");
    expect(PUBLIC_MARKETING_PATHS).toContain("/ko");
    expect(llms).toContain("[Korean entry page](https://tavonel.com/ko)");
  });

  it("keeps proof interactions and classified destination clicks in the privacy-minimal listener", () => {
    expect(landingAnalyticsSource).toContain('"proof-tab": "proof_claim_switch"');
    expect(landingAnalyticsSource).toContain('"source-open": "source_open"');
    expect(landingAnalyticsSource).toContain('["integration_open", /^\\/(?:integrations|sources|docs)');
    expect(landingAnalyticsSource).toContain('["trust_open", /^\\/(?:trust|security|subprocessors)');
  });

  it("keeps the prepared study free of user evidence claims", () => {
    expect(LANDING_V2_COPY.en.hero.eyebrow).toBe("WHAT YOU LEAVE WITH");
    expect(LANDING_V2_COPY.en.proof.eyebrow).toBe("TRY A FINISHED RESULT");
    expect(LANDING_V2_COPY.en.evidence.eyebrow).toBe("VERIFY ONE ANSWER");
    expect(LANDING_V2_COPY.en.use.eyebrow).toBe("CHOOSE YOUR NEXT TASK");
    expect(LANDING_V2_COPY.en.trust.eyebrow).toBe("CHECK THE BOUNDARIES");
    expect(LANDING_V2_COPY.en.start.eyebrow).toBe("CHOOSE THE NEXT STEP");
  });
});
