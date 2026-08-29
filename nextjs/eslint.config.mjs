import { FlatCompat } from "@eslint/eslintrc";

/**
 * There was no linter. `npm run check` ran `tsc --noEmit` and nothing else, which meant the
 * jsx-a11y rules had never executed against this codebase -- part of why the contrast and
 * labelling problems had to be found by hand.
 *
 * `next/core-web-vitals` brings the accessibility and Next-correctness rules; the additions below
 * are the ones this product specifically wants.
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

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
