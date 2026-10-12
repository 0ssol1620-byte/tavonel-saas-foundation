import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AFFECTED_GROUPS, HOME_AFFECTED_BROWSER_FILE, HOME_AFFECTED_UNIT_FILES,
  HOME_READER_HEADING_CSS_AFFECTED_PATHS, HOME_READER_HEADING_CSS_AFFECTED_UNIT_FILES,
  REPAIR_NODE_EVIDENCE_CONTRACT_FILE, buildAffectedMap, vitestDiscoveryConfigFailures,
} from "../scripts/repair-scope.mjs";

const paths = [
  "components/landing-v2/landing-hero.module.css", "app/tavonel.css",
  "lib/home-reader-heading-css-contract.test.ts", "lib/home-reader-heading-css-registration.test.ts",
  "scripts/fixtures/home-reader-heading-css-baseline.json", "scripts/repair-scope.mjs",
];
const cssFiles = ["lib/home-reader-heading-css-contract.test.ts", "lib/home-reader-heading-css-registration.test.ts"];
function plan(path: string, headHasFile: (path: string) => boolean = () => true) {
  // The JS default is inferred as a zero-argument callback; runtime supplies the path.
  return buildAffectedMap({ headSha: "a".repeat(40), records: [{ oldMode: "100644", newMode: "100644", status: "M", paths: [path] }], headHasFile: headHasFile as () => boolean });
}

describe("portable reader heading CSS repository registration", () => {
  it("owns the exact CSS, fixture, contract and registration paths and selects both new suites", () => {
    expect([...HOME_READER_HEADING_CSS_AFFECTED_PATHS]).toEqual(paths);
    expect([...HOME_READER_HEADING_CSS_AFFECTED_UNIT_FILES]).toEqual(cssFiles);
    const owner = AFFECTED_GROUPS.find(({ group }) => group === "home-reader-heading-css")!;
    for (const path of paths) {
      expect(owner.match.test(`nextjs/${path}`)).toBe(true);
      const result = plan(`nextjs/${path}`);
      expect(result.failures).toEqual([]);
      expect(result.unmappedPaths).toEqual([]);
      expect(result.groups).toContain("home-reader-heading-css");
      for (const file of cssFiles) expect(result.unitFiles).toContain(file);
      expect(result.databaseChanged).toBe(false);
      expect(result.runCdrWorkerChecks).toBe(false);
    }
    for (const neighbor of ["app/globals.css", "app/tavonel.scss", "app/tavonel.css.bak",
      "components/landing-v2/other.module.css", "components/landing-v2/landing-hero.module.scss",
      "lib/home-reader-heading-css-contract.ts", "scripts/fixtures/other.json"]) {
      expect(owner.match.test(`nextjs/${neighbor}`)).toBe(false);
    }
  });

  it("keeps the prior Home unit and browser selections while adding the CSS source contracts", () => {
    const result = plan("nextjs/components/landing-v2/landing-hero.module.css");
    expect(result.groups).toEqual(["home-landing", "home-reader-heading-css"]);
    expect(result.unitFiles).toEqual([...new Set([...HOME_AFFECTED_UNIT_FILES, ...cssFiles])].sort());
    expect(result.browserFiles).toEqual([HOME_AFFECTED_BROWSER_FILE]);
    expect(result.nativeEvidence.freshRunClaimed).toBe(false);
    expect(result.nativeEvidence.disposition).toBe("fresh-seven-case-native-run-required");
    const global = plan("nextjs/app/tavonel.css");
    expect(global.groups).toEqual(["home-reader-heading-css"]);
    expect(global.unitFiles).toEqual(cssFiles);
    expect(global.browserFiles).toEqual([]);
  });

  it("discovers both CSS suites through the unchanged repository Vitest configuration", () => {
    const source = readFileSync(new URL("../vitest.config.ts", import.meta.url), "utf8");
    expect(vitestDiscoveryConfigFailures(source)).toEqual([]);
    expect(source).toContain('"lib/**/*.test.ts"');
    for (const file of cssFiles) expect(file).toMatch(/^lib\/.+\.test\.ts$/);
    const fixture = JSON.parse(readFileSync(new URL("../scripts/fixtures/home-reader-heading-css-baseline.json", import.meta.url), "utf8"));
    expect(fixture.schemaVersion).toBe("tavonel.reader_heading_css_source_contract.v1");
    expect(fixture.modulePath).toBe("components/landing-v2/landing-hero.module.css");
    expect(fixture.globalPath).toBe("app/tavonel.css");
  });

  it("fails admission if either selected CSS contract is missing at head", () => {
    for (const missing of cssFiles) {
      const result = plan("nextjs/app/tavonel.css", (path: string) => path !== `nextjs/${missing}`);
      expect(result.failures).toContain(`selected owner check is absent at head: ${missing}`);
    }
  });

  it("selects the runner's exact new Node contract for its own endpoint and CI-selector inputs", () => {
    expect(REPAIR_NODE_EVIDENCE_CONTRACT_FILE).toBe("lib/repair-node-evidence.test.mjs");
    for (const path of ["nextjs/lib/repair-node-evidence.test.mjs", "nextjs/scripts/run-repair-check.mjs",
      "nextjs/scripts/verify-repair-workflows.mjs", "nextjs/scripts/repair-scope.mjs"]) {
      const result = plan(path);
      expect(result.failures).toEqual([]);
      expect(result.groups).toContain("ci-selector");
      expect(result.runSelectorContracts).toBe(true);
      expect(result.unitFiles).toContain(REPAIR_NODE_EVIDENCE_CONTRACT_FILE);
      expect(result.databaseChanged).toBe(false);
    }
    const result = plan("nextjs/lib/repair-node-evidence.test.mjs", (path: string) => path !== "nextjs/lib/repair-node-evidence.test.mjs");
    expect(result.failures).toContain("selected owner check is absent at head: lib/repair-node-evidence.test.mjs");
    expect(AFFECTED_GROUPS.filter(({ group }) => group === "ci-selector").some(({ match }) =>
      match.test("nextjs/lib/repair-node-evidence.test.ts"))).toBe(false);
  });
});
