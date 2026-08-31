import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as openApi } from "../app/api/openapi/route";
import { resolveOpenApiOrigin } from "./openapi-origin";

// The published OpenAPI document is a contract other people generate SDKs from, so the
// `servers` URL is not cosmetic -- it is where their generated client will send requests.
//
// This route was force-static, which means Next.js ran the handler once at build time and
// froze the response. `new URL(request.url).origin` therefore captured the builder's own
// origin, and production served a spec whose servers entry was http://localhost:3000. Anyone
// generating a client from the live document got one pointed at their own machine.

afterEach(() => {
  vi.unstubAllEnvs();
});

const routeSource = readFileSync(resolve(import.meta.dirname, "../app/api/openapi/route.ts"), "utf8");

async function specFor(url: string) {
  const response = openApi(new Request(url));
  return (await response.json()) as { servers: Array<{ url: string }>; paths: Record<string, unknown> };
}

describe("OpenAPI production contract", () => {
  it("is not force-static, so the origin cannot be frozen at build time", () => {
    expect(routeSource).not.toContain('dynamic = "force-static"');
    expect(routeSource).toContain('dynamic = "force-dynamic"');
  });

  it("publishes the apex origin for a request to tavonel.com", async () => {
    const spec = await specFor("https://tavonel.com/api/openapi");
    expect(spec.servers).toEqual([{ url: "https://tavonel.com/api/v1" }]);
  });

  it("publishes a preview deployment's own origin rather than the apex", async () => {
    // A preview must describe itself, or testing against it silently hits production.
    const spec = await specFor("https://tavonel-git-branch.vercel.app/api/openapi");
    expect(spec.servers).toEqual([{ url: "https://tavonel-git-branch.vercel.app/api/v1" }]);
  });

  it("publishes a custom domain's own origin", async () => {
    const spec = await specFor("https://knowledge.customer.example/api/openapi");
    expect(spec.servers).toEqual([{ url: "https://knowledge.customer.example/api/v1" }]);
  });

  it("never publishes a localhost server URL in production", async () => {
    // The exact defect: a build-time or internal invocation yielding a loopback origin must
    // not become the published contract.
    for (const loopback of [
      "http://localhost:3000/api/openapi",
      "http://127.0.0.1:3000/api/openapi",
      "http://0.0.0.0:3000/api/openapi",
    ]) {
      expect(resolveOpenApiOrigin(loopback, "production")).toBe("https://tavonel.com");
    }
  });

  it("still serves a usable local origin in development", async () => {
    expect(resolveOpenApiOrigin("http://localhost:3000/api/openapi", "development")).toBe("http://localhost:3000");
  });

  it("falls back to the canonical origin when the request URL is unusable", () => {
    expect(resolveOpenApiOrigin("not-a-url", "production")).toBe("https://tavonel.com");
  });

  it("keeps the document itself intact across origins", async () => {
    const apex = await specFor("https://tavonel.com/api/openapi");
    const preview = await specFor("https://preview.vercel.app/api/openapi");
    // Only the server URL may differ between origins; the contract must not.
    expect(Object.keys(apex.paths).sort()).toEqual(Object.keys(preview.paths).sort());
    expect(apex.paths["/collections/{id}/search"]).toBeTruthy();
    expect(apex.paths["/collections/{id}/ask"]).toBeTruthy();
  });
});
