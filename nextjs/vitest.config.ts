import { defineConfig } from "vitest/config";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: packageRoot,
  resolve: {
    alias: { "@": packageRoot },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/*.spec.ts"],
  },
});
