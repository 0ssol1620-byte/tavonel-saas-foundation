import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import classification from "./security/route-classification.json";

/*
  Blueprint 2026-09-08 §34 asked for every state-changing route to be classified by the
  credential it accepts. A classification written once and left in a document is a snapshot of
  a surface that keeps moving, so it lives in security/route-classification.json and this test
  is what keeps it true: a new POST route, a new method on a classified route, or a deleted
  route all fail here until the entry is updated by someone who had to look at it.

  The finding the inventory records: every authenticated route on this surface reads its
  credential from the Authorization header (lib/foundation-pilot.ts getRequestUser,
  lib/developer-auth.ts authorizeFoundationRequest / requireFoundationSession,
  lib/enterprise-auth.ts authorizeEnterpriseRequest), so there is no Type B route and nothing
  for a cross-site request to ride. The shared Origin guard §34 asks for is therefore not
  built -- it would guard nothing -- and the "no Type B route without a guard" assertion below
  is what makes that a decision rather than an oversight.
*/

const appDirectory = resolve(import.meta.dirname, "../app");
const nextjsRoot = resolve(import.meta.dirname, "..");
const STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE"] as const;
const METHOD_EXPORT = /^export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/gm;

type Entry = {
  type: string;
  methods: string[];
  credential: string;
  note?: string;
};

const entries = classification.routes as Record<string, Entry>;

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (name === "route.ts" || name === "route.tsx") found.push(path);
  }
  return found;
}

function exportedMethods(source: string): string[] {
  return [...new Set([...source.matchAll(METHOD_EXPORT)].map((match) => match[1]!))].sort();
}

// Read once at module load: the same on-access-scanner cost that pushed
// production-route-surface.test.ts to do this applies here.
const routes = walk(join(appDirectory, "api")).map((path) => {
  const key = relative(nextjsRoot, path).split(sep).join("/");
  return { key, methods: exportedMethods(readFileSync(path, "utf8")) };
});

describe("state-changing route classification", () => {
  it("classifies every route that exports a state-changing method", () => {
    const unclassified = routes
      .filter((route) => route.methods.some((method) => STATE_CHANGING.includes(method as never)))
      .filter((route) => !(route.key in entries))
      .map((route) => route.key);
    expect(unclassified).toEqual([]);
  });

  it("classifies no route that no longer exists", () => {
    const known = new Set(routes.map((route) => route.key));
    expect(Object.keys(entries).filter((key) => !known.has(key))).toEqual([]);
  });

  it("records the methods each classified route actually exports", () => {
    const drifted = routes
      .filter((route) => route.key in entries)
      .filter((route) => JSON.stringify(route.methods) !== JSON.stringify([...entries[route.key]!.methods].sort()))
      .map((route) => `${route.key}: file=${route.methods.join(",")} json=${entries[route.key]!.methods.join(",")}`);
    expect(drifted).toEqual([]);
  });

  it("uses only the declared classification types", () => {
    const legend = new Set(Object.keys(classification.legend));
    expect(Object.entries(entries).filter(([, entry]) => !legend.has(entry.type))).toEqual([]);
  });

  it("classifies the destructive founder reset as Supabase bearer-only", () => {
    expect(entries["app/api/account/test-reset/route.ts"]).toEqual({
      type: "A-bearer",
      methods: ["POST"],
      credential: "bearer:supabase-jwt",
      note: expect.stringContaining("Destructive founder-only"),
    });
  });

  /*
    The forward guard. Today no route derives privilege from an ambient cookie, so no Origin
    guard exists. The day one does, this fails until the entry names the guard that protects
    it -- which is the point at which writing the shared helper becomes real work rather than
    speculative work.
  */
  it("has no cookie-credential route without a named origin guard", () => {
    const unguarded = Object.entries(entries)
      .filter(([, entry]) => entry.type === "B-cookie")
      .filter(([, entry]) => !entry.note?.includes("origin guard"))
      .map(([key]) => key);
    expect(unguarded).toEqual([]);
  });
});

describe("bodyless signed-service routes", () => {
  it("tracks the dedicated identity broker separately from raw-body webhooks", () => {
    expect(Object.entries(entries).filter(([, entry]) => entry.type === "E-signed-service").map(([key]) => key))
      .toEqual(["app/api/internal/cdr/identity/route.ts"]);
    const handler = readFileSync(resolve(import.meta.dirname, "cdr-identity-handler.ts"), "utf8");
    expect(handler).toContain("verifyCdrIdentityRequest");
    expect(handler).toContain("hasEmptyBody(request)");
    expect(handler).toContain("deps.claim(id)");
    // Behavioral failure/order tests live in cdr-identity-handler.test.ts and the DB suite.
  });
});

describe("CORS posture", () => {
  it("sets no Access-Control-Allow-* header anywhere on the API surface", () => {
    const offenders = walk(appDirectory)
      .concat([resolve(nextjsRoot, "next.config.mjs")])
      .filter((path) => /Access-Control-Allow-/i.test(readFileSync(path, "utf8")))
      .map((path) => relative(nextjsRoot, path).split(sep).join("/"));
    // No credentialed cross-origin access exists, so no wildcard origin can exist either.
    expect(offenders).toEqual([]);
  });
});

describe("webhook routes (Type C)", () => {
  const webhooks = Object.entries(entries).filter(([, entry]) => entry.type === "C-webhook");

  it("covers the three signature-verified routes", () => {
    expect(webhooks.map(([key]) => key).sort()).toEqual([
      "app/api/internal/billing/settle/route.ts",
      "app/api/operations/p0/credits/release/route.ts",
      "app/api/paddle/webhook/route.ts",
    ]);
  });

  it("verifies a signature over the raw body, not a parsed object", () => {
    for (const [key] of webhooks) {
      const source = readFileSync(resolve(nextjsRoot, key), "utf8");
      // request.text() before any JSON.parse is what makes the signature cover the bytes signed.
      expect(source, key).toMatch(/request\.text\(\)/);
      expect(source, key).toMatch(/verifyPaddleSignature|verifyComputeSettlementRequest/);
    }
  });

  it("bounds replay with a timestamp window", () => {
    // 300_000 ms in both verifiers; asserted at the verifier rather than the route because that
    // is where a widened window would actually be widened.
    for (const helper of ["paddle-webhook.ts", "compute-settlement-auth.ts"]) {
      expect(readFileSync(resolve(import.meta.dirname, helper), "utf8"), helper).toMatch(/300_000/);
    }
  });
});

/*
  WO-C-T3: a workspace member reads a World only when every source behind it is in their scope,
  and lists drop what a member cannot read. Every API route is in exactly one of three maps, so a
  new route that returns document, World, evidence, search or ask content cannot arrive without
  someone deciding how a member's scope reaches it. An enforced entry names its mechanism, and the
  route file must contain that mechanism; a delegating entry must point at a route that is itself
  enforced.
*/
describe("member source scope classification", () => {
  const scope = classification.memberScope as {
    enforced: Record<string, string>; elsewhere: Record<string, string>; noSourceContent: Record<string, string>;
  };
  const maps = [scope.enforced, scope.elsewhere, scope.noSourceContent];
  const TOKEN: Record<string, string> = {
    chokepoint: "checkConnectorSourceAccessForViewer",
    "world-gate": "memberCollectionScopeRefusal",
    "sources-gate": "memberSourcesRefusal",
    filter: "filterMemberReadableDocumentIds",
  };

  it("puts every API route in exactly one map", () => {
    const placed = routes.map((route) => [route.key, maps.filter((map) => route.key in map).length] as const)
      .filter(([, count]) => count !== 1)
      .map(([key, count]) => `${key}: ${count}`);
    expect(placed).toEqual([]);
  });

  it("names no route that no longer exists", () => {
    const known = new Set(routes.map((route) => route.key));
    expect(maps.flatMap((map) => Object.keys(map)).filter((key) => !known.has(key))).toEqual([]);
  });

  it("gives every unenforced route a reason", () => {
    for (const map of [scope.elsewhere, scope.noSourceContent]) {
      for (const [key, reason] of Object.entries(map)) expect(reason.length, key).toBeGreaterThan(20);
    }
  });

  it("finds the named mechanism in every enforced route's file", () => {
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(scope.enforced)) {
      const source = readFileSync(resolve(nextjsRoot, key), "utf8");
      const [mechanism, rest] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
      if (mechanism in TOKEN) {
        if (!source.includes(TOKEN[mechanism]!)) wrong.push(`${key}: no ${TOKEN[mechanism]}`);
      } else if (mechanism === "chokepoint-via") {
        const fn = rest.split(":")[0]!;
        if (!/^[A-Za-z]+$/.test(fn) || !source.includes(fn)) wrong.push(`${key}: no ${fn}`);
      } else if (mechanism === "refused") {
        const code = rest.split(":")[0]!;
        if (!source.includes(`"${code}"`)) wrong.push(`${key}: no ${code}`);
      } else if (mechanism === "delegates") {
        const target = relative(nextjsRoot, resolve(dirname(resolve(nextjsRoot, key)), `${rest}.ts`)).split(sep).join("/");
        if (!source.includes(`from "${rest}"`) || !(target in scope.enforced)) wrong.push(`${key}: delegates to unenforced ${target}`);
      } else {
        wrong.push(`${key}: unknown mechanism ${mechanism}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
