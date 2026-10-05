import baseConfig from "./vitest.config";
import { defineConfig } from "vitest/config";

type ScopedBase = typeof baseConfig & {
  test?: { include?: string[]; [key: string]: unknown };
};

const inherited = baseConfig as ScopedBase;
const inheritedIncludes = inherited.test?.include ?? [];

/**
 * Repair-only discovery for the two reviewed tests outside the base include set.
 * Explicit Vitest file arguments still limit each invocation to selected files.
 */
export default defineConfig({
  ...inherited,
  test: {
    ...inherited.test,
    include: [
      ...inheritedIncludes,
      "components/compile-stage.test.tsx",
      "components/intake-triage-review.interaction.test.ts",
      "components/intake-triage-review.test.tsx",
      "app/api/documents/**/route.test.ts",
    ],
  },
});
