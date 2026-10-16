import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "node:module";
import { dirname } from "node:path";

/**
 * There was no linter. `npm run check` ran `tsc --noEmit` and nothing else, which meant the
 * jsx-a11y rules had never executed against this codebase -- part of why the contrast and
 * labelling problems had to be found by hand.
 *
 * `next/core-web-vitals` brings the accessibility and Next-correctness rules; the additions below
 * are the ones this product specifically wants.
 */
const require = createRequire(import.meta.url);
// Resolve the preset-owned plugins from that preset, without relying on pnpm hoisting.
// This preserves all rules and works with both isolated and hoisted node_modules layouts.
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  resolvePluginsRelativeTo: dirname(require.resolve("eslint-config-next/package.json")),
});

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "public/**", "scripts/**"],
  },
  {
    rules: {
      // An unused variable in a payment or policy path is usually a dropped branch, not litter.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // `any` erases exactly the guarantees the API boundaries here are built on.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];
