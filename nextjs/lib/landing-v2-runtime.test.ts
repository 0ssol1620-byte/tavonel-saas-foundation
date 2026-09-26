import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  buildEvidenceRecord, buildProofTabs, buildRecompileView,
  LANDING_V2_STATE_WORD, LANDING_V2_STATE_WORD_KO,
} from "./landing-v2-proof";
import { buildSourcesScene, SOURCES_COPY } from "./landing-v2-sources";
import { sampleEvidencePage } from "./evidence-regions";
import { HERO_STATS } from "./hero-stats";

const file = path.resolve(process.cwd(), "lib/landing-v2-snapshot.json");

describe("frozen landing proof, without request-time corpus compilation", () => {
  it("exactly reproduces every field from the real compiler-backed builders", () => {
    const expected = {
      schema: "tavonel.landing-public-proof.v1",
      tabs: buildProofTabs(), record: buildEvidenceRecord(), recompile: buildRecompileView(),
      heroView: sampleEvidencePage(), heroStats: HERO_STATS,
      sources: buildSourcesScene(), sourcesCopy: SOURCES_COPY,
      stateWords: { en: LANDING_V2_STATE_WORD, ko: LANDING_V2_STATE_WORD_KO },
    };
    if (process.env.TAVONEL_UPDATE_LANDING_SNAPSHOT === "1") {
      if (process.env.CI) throw new Error("Snapshot updates are forbidden in CI");
      writeFileSync(file, JSON.stringify(expected, null, 2) + "\n");
    }
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(expected);
  });

  it("keeps runtime policy live instead of putting it in the public proof snapshot", () => {
    const snapshot = JSON.parse(readFileSync(file, "utf8"));
    for (const key of ["customerData", "liveCheckout", "selfService", "activationPolicy", "session", "billing"]) {
      expect(snapshot).not.toHaveProperty(key);
    }
    const home = readFileSync(path.resolve(process.cwd(), "app/page.tsx"), "utf8");
    expect(home).toContain('dynamic = "force-dynamic"');
  });
  it("has no compiler-bearing value imports on the landing render path", () => {
    const runtime = readFileSync(path.resolve(process.cwd(), "lib/landing-v2-runtime.ts"), "utf8");
    const imports = [...runtime.matchAll(/^import (?!type )[^\n]+from "([^"]+)"/gm)].map(match => match[1]);
    expect(imports).toEqual(["./landing-v2-snapshot.json"]);
    function walk(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const location = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(location);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(location, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
          expect(source, location).not.toMatch(/from ["']@\/lib\/(?:landing-v2-(?:proof|sources)|evidence-regions|hero-stats)["']/);
        }
      }
    }
    walk(path.resolve(process.cwd(), "components/landing-v2"));
  });
  it("runtime getters return exactly the compiler-backed data and state vocabulary", async () => {
    const runtime = await import("./landing-v2-runtime");
    expect(runtime.buildProofTabs()).toEqual(buildProofTabs());
    expect(runtime.buildEvidenceRecord()).toEqual(buildEvidenceRecord());
    expect(runtime.buildRecompileView()).toEqual(buildRecompileView());
    expect(runtime.buildHeroView()).toEqual(sampleEvidencePage());
    expect(runtime.buildHeroStats()).toEqual(HERO_STATS);
    expect(runtime.sourcesScene()).toEqual(buildSourcesScene());
    expect(runtime.SOURCES_COPY).toEqual(SOURCES_COPY);
    for (const key of Object.keys(LANDING_V2_STATE_WORD) as (keyof typeof LANDING_V2_STATE_WORD)[]) {
      expect(runtime.landingV2StateWord(key, "en")).toBe(LANDING_V2_STATE_WORD[key]);
      expect(runtime.landingV2StateWord(key, "ko")).toBe(LANDING_V2_STATE_WORD_KO[key]);
    }
  });

});
