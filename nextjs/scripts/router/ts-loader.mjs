/**
 * Resolve hook for the router operator CLIs.
 *
 * `node --experimental-strip-types` runs TypeScript, but Node's ESM resolver never adds an
 * extension, and `lib/` imports its siblings extensionlessly (`./collection-compiler`). Without
 * this the CLIs could not import the runtime's own digest functions and would have to
 * reimplement them -- which is exactly the drift that makes a seeded policy unresolvable.
 *
 * Registered by `register-ts-loader.mjs`. Vitest resolves TypeScript itself and does not use it.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
