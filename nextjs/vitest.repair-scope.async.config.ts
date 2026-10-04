import baseConfig from "./vitest.config";
import { defineConfig } from "vitest/config";

type ScopedBase = typeof baseConfig & {
  test?: { include?: string[]; [key: string]: unknown };
};

const inherited = baseConfig as ScopedBase;
const inheritedIncludes = inherited.test?.include ?? [];

/** Repair-only discovery for the reviewed asynchronous compile-job route test. */
export default defineConfig({
  ...inherited,
  test: {
    ...inherited.test,
    include: [
      ...inheritedIncludes,
      "components/compile-stage.test.tsx",
      "app/api/documents/**/route.test.ts",
      "app/api/compile-jobs/route.test.ts",
    ],
  },
});
