import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  outputFileTracingRoot: packageRoot,
};
export default nextConfig;
