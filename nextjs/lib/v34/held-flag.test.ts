import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_MOUNTS_LANDING_V2, mountsLandingV2 } from "../../e2e/support/held-feature";

/*
  The specs of the held film and specimen strip skip on one fact: whether Home's import graph reaches
  components/landing-v2/**. This holds the gate to that fact, and shows it turns true when it is true.
*/
const nextRoot = fileURLToPath(new URL("../../", import.meta.url));

function withFixture(files: Record<string, string>, check: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "held-gate-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the held-feature gate is the import fact", () => {
  it("is false at this head: V34 Home does not import landing-v2", () => {
    expect(HOME_MOUNTS_LANDING_V2).toBe(false);
    expect(mountsLandingV2(nextRoot, "app/page.tsx")).toBe(false);
  });

  it.each([
    ["directly", `import X from "@/components/landing-v2/film";\nexport default X;`],
    ["through a hop", `import Home from "@/home";\nexport default Home;`],
    ["by dynamic import", `import dynamic from "next/dynamic";\nexport default dynamic(() => import("@/components/landing-v2/film"));`],
  ])("is true when the entry reaches landing-v2 %s", (_name, entry) => {
    withFixture(
      {
        "app/page.tsx": entry,
        "home.tsx": `export { default } from "@/components/landing-v2/film";`,
        "components/landing-v2/film.tsx": "export default 1;",
      },
      (dir) => expect(mountsLandingV2(dir, "app/page.tsx")).toBe(true),
    );
  });

  it("is false when the entry does not reach landing-v2, though the components exist", () => {
    withFixture(
      {
        "app/page.tsx": `import X from "@/components/v34/home";\nexport default X;`,
        "components/v34/home.tsx": "export default 1;",
        "components/landing-v2/film.tsx": "export default 1;",
      },
      (dir) => expect(mountsLandingV2(dir, "app/page.tsx")).toBe(false),
    );
  });

  it("does not read the environment", () => {
    expect(readFileSync(join(nextRoot, "e2e/support/held-feature.ts"), "utf8")).not.toContain("process.env");
  });
});
