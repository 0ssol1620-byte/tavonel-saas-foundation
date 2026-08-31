// Resolves the origin published as the OpenAPI document's `servers` URL.
//
// This lives in lib/ rather than in the route file because a Next.js App Router route module
// may only export route handlers and its own config -- exporting a helper from route.ts fails
// the build with "Property ... is not assignable to type 'never'".
//
// The rule it encodes: the published server URL is the origin the caller actually reached, so
// the apex, a preview deployment and a custom domain each describe themselves. The one origin
// that must never be published is a loopback address. /api/openapi used to be force-static,
// which meant Next.js evaluated the handler once at build time and froze
// `new URL(request.url).origin` to the builder's own machine -- production served a contract
// whose servers entry was http://localhost:3000, so an SDK generated from the live document
// targeted localhost. The route is now force-dynamic, and this function is the second line of
// defence in case any invocation still arrives with a loopback URL.
export const OPENAPI_CANONICAL_ORIGIN = "https://tavonel.com";

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

export function resolveOpenApiOrigin(
  requestUrl: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  try {
    const origin = new URL(requestUrl).origin;
    if (LOOPBACK.test(origin)) {
      // Locally, a developer wants the document to describe their own server. In production a
      // loopback origin is never correct for a published contract.
      return nodeEnv === "production" ? OPENAPI_CANONICAL_ORIGIN : origin;
    }
    return origin;
  } catch {
    return OPENAPI_CANONICAL_ORIGIN;
  }
}
