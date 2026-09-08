import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as compile } from "../app/api/collections/compile/route";
import { POST as contact } from "../app/api/contact/route";

/*
  Blueprint 2026-09-08 §34's test matrix, run against the two shapes this surface actually has.

  The inventory in security/route-classification.json records the finding: every authenticated
  route reads its credential from the Authorization header, so there is nothing ambient for a
  cross-site request to ride, and the shared Origin guard §34 asks for would guard nothing.
  That is a claim, and this is the evidence for it -- a credential-less request in each of the
  five hostile shapes, against a route that does real work when it is authorized.

  The forged-Origin case is the one worth being explicit about. A Type A route is expected to
  IGNORE Origin entirely; it refuses because no credential was presented, not because the
  origin was wrong. Asserting 401 rather than 403 is what records that distinction.
*/

const HOSTILE = "https://attacker.test";
const ATTEMPTS = [
  ["cross-site POST", { Origin: HOSTILE, "Content-Type": "application/json" }],
  ["missing Origin", { "Content-Type": "application/json" }],
  ["forged Origin", { Origin: "https://tavonel.com.attacker.test", "Content-Type": "application/json" }],
  ["text/plain form post", { Origin: HOSTILE, "Content-Type": "text/plain;charset=UTF-8" }],
  ["multipart form post", { Origin: HOSTILE, "Content-Type": "multipart/form-data; boundary=x" }],
] as const;

const body = JSON.stringify({ documentIds: ["doc-1"] });

describe("Type A route under cross-site request shapes", () => {
  for (const [name, headers] of ATTEMPTS) {
    it(`refuses a ${name} for want of a credential, not for want of an origin`, async () => {
      const response = await compile(
        new Request("https://tavonel.test/api/collections/compile", { method: "POST", headers, body }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "AUTH_REQUIRED" });
    });
  }

  it("refuses a request carrying only a cookie, however plausible the cookie looks", async () => {
    // The one cookie this product sets is the trial device signal, and it is not a credential.
    // A browser that had it and nothing else must get exactly the same refusal.
    const response = await compile(
      new Request("https://tavonel.test/api/collections/compile", {
        method: "POST",
        headers: {
          Origin: HOSTILE,
          "Content-Type": "application/json",
          Cookie: "tavonel_device=v1.abc.def; sb-access-token=not-a-credential-here",
        },
        body,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns no CORS header on any of them, so a browser could not read the answer either", async () => {
    const response = await compile(
      new Request("https://tavonel.test/api/collections/compile", {
        method: "POST",
        headers: { Origin: HOSTILE, "Content-Type": "application/json" },
        body,
      }),
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

/*
  The public form is the other half. It carries no credential either, so its origin check is
  anti-abuse rather than CSRF defence -- but it IS the check, so the same matrix runs against
  it and the codes differ on purpose: origin first, then content type.
*/
describe("public contact form under the same shapes", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AKC_CONTACT_ALLOWED_ORIGINS", "https://tavonel.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const submission = JSON.stringify({
    name: "Probe", email: "probe@matrix.test", company: "", topic: "sales",
    message: "A message long enough to pass the minimum length check.",
    website: "", startedAt: Date.now() - 5_000,
  });

  it.each([
    ["cross-site POST", HOSTILE, "application/json", 403],
    ["forged Origin", "https://tavonel.com.attacker.test", "application/json", 403],
    ["missing Origin", null, "application/json", 403],
    ["text/plain form post", "https://tavonel.com", "text/plain;charset=UTF-8", 415],
    ["multipart form post", "https://tavonel.com", "multipart/form-data; boundary=x", 415],
  ])("refuses a %s with %s", async (_name, origin, contentType, expected) => {
    const headers: Record<string, string> = { "Content-Type": contentType as string };
    if (origin) headers.Origin = origin as string;
    const response = await contact(
      new Request("https://tavonel.com/api/contact", { method: "POST", headers, body: submission }),
    );
    expect(response.status).toBe(expected);
  });
});

/*
  §34's last two matrix rows: the CORS preflight, and `Access-Control-Allow-Origin: *`.

  route-classification.test.ts already proves no file on the surface writes an
  `Access-Control-Allow-*` header. This is the other side of the same fact, asked as a request
  rather than as a grep: a browser's preflight has nothing to reach, because no route exports an
  OPTIONS handler at all -- and if a caller skips the preflight entirely (which a non-browser
  client can), the actual request is still refused and still carries nothing a browser would be
  allowed to read.

  The distinction matters for what is claimed. "We answer the preflight with a narrow allowlist"
  is a policy that can drift; "there is no preflight to answer" is a shape, and the assertion
  below fails the day somebody adds one.
*/
describe("the CORS preflight rows of the §34 matrix", () => {
  const nextjsRoot = resolve(import.meta.dirname, "..");
  const OPTIONS_EXPORT = /^export\s+(?:async\s+)?(?:function\s+|const\s+)OPTIONS\b/m;

  function apiRoutes(directory: string): string[] {
    const found: string[] = [];
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) found.push(...apiRoutes(path));
      else if (name === "route.ts" || name === "route.tsx") found.push(path);
    }
    return found;
  }

  it("exports no OPTIONS handler anywhere, so no preflight is ever answered affirmatively", () => {
    const withOptions = apiRoutes(join(nextjsRoot, "app/api"))
      .filter((path) => OPTIONS_EXPORT.test(readFileSync(path, "utf8")))
      .map((path) => relative(nextjsRoot, path).split(sep).join("/"));
    expect(withOptions).toEqual([]);
  });

  it("refuses the actual request even when a client skips the preflight it would have failed", async () => {
    // The headers a browser would have sent in the preflight, put on the real request instead.
    const response = await compile(
      new Request("https://tavonel.test/api/collections/compile", {
        method: "POST",
        headers: {
          Origin: HOSTILE,
          "Content-Type": "application/json",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
        body,
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("access-control-allow-headers")).toBeNull();
  });

  it("gives the public form the same answer, so neither shape has a wildcard origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AKC_CONTACT_ALLOWED_ORIGINS", "https://tavonel.com");
    const response = await contact(
      new Request("https://tavonel.com/api/contact", {
        method: "POST",
        headers: {
          Origin: HOSTILE,
          "Content-Type": "application/json",
          "Access-Control-Request-Method": "POST",
        },
        body: JSON.stringify({ name: "Probe", email: "probe@matrix.test", topic: "sales", message: "x".repeat(60), website: "", startedAt: Date.now() - 5_000 }),
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    vi.unstubAllEnvs();
  });
});
