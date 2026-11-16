import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorldAction, CREATE_WORLD_LABEL } from "@/components/v34/ui/create-world";
import { primaryCallToAction } from "@/lib/commercial-state";
import {
  current,
  resolveEntries,
  resolveGroups,
  V34_FOOTER_GROUPS,
  V34_FOOTER_LEGAL_LINKS,
  V34_MORE_GROUPS,
  V34_PRIMARY_NAV,
  type NavDeps,
  type NavEntry,
  type NavGroup,
} from "@/lib/v34/nav";
import { V34_ROUTES, v34Route, type V34RouteRecord } from "@/lib/v34/routes";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Routes the retained-path check accepts although no page file exists at the base: a batch creates them. */
const PLANNED_RETAINED_PATHS = ["/research/program"];

const allGroups: NavGroup[] = [...V34_MORE_GROUPS, ...V34_FOOTER_GROUPS];
const allEntries: NavEntry[] = [...V34_PRIMARY_NAV, ...allGroups.flatMap((group) => group.entries)];
const registryPaths = new Set(V34_ROUTES.map((route: V34RouteRecord) => route.path as string));

/** A retained route is served by a page or a route handler under app/. */
const hasRouteFile = (path: string) =>
  ["page.tsx", "route.ts", "route.tsx"].some((file) => existsSync(join(root, "app", path, file)));

afterEach(() => vi.unstubAllEnvs());

describe("every navigation target exists", () => {
  it("names a registry key or a retained route, never a free string standing in for a registry route", () => {
    const keys = new Set(V34_ROUTES.map((route: V34RouteRecord) => route.key as string));
    for (const entry of allEntries) {
      if ("key" in entry) {
        expect(keys.has(entry.key), `registry key "${entry.key}"`).toBe(true);
        expect(v34Route(entry.key).path.startsWith("/"), `${entry.key} has a path`).toBe(true);
      } else {
        expect(entry.path.startsWith("/"), `${entry.path} starts with /`).toBe(true);
        expect(registryPaths.has(entry.path), `${entry.path} is a registry route and should be named by its key`).toBe(false);
        expect(
          hasRouteFile(entry.path) || PLANNED_RETAINED_PATHS.includes(entry.path),
          `retained route ${entry.path} has app/ page or handler`,
        ).toBe(true);
      }
    }
  });

  it("links every legal page to a route that exists", () => {
    for (const link of V34_FOOTER_LEGAL_LINKS) expect(hasRouteFile(link.href), link.href).toBe(true);
  });

  it("carries the shapes the shell renders: five primary items, four More columns, five footer groups", () => {
    expect(V34_PRIMARY_NAV).toHaveLength(5);
    expect(V34_MORE_GROUPS.map((group) => group.title)).toEqual(["Product", "For you", "Build & trust", "TAVONEL"]);
    expect(V34_FOOTER_GROUPS.map((group) => group.title)).toEqual(["Product", "Solutions", "Developers", "Trust", "Company"]);
  });

  it("agrees with the registry about which five routes are primary", () => {
    const fromNav = V34_PRIMARY_NAV.map((entry) => ("key" in entry ? entry.key : entry.path)).sort();
    const fromRegistry = V34_ROUTES.filter((route: V34RouteRecord) => route.primaryNav).map((route: V34RouteRecord) => route.key as string).sort();
    expect(fromNav).toEqual(fromRegistry);
  });
});

describe("a group does not repeat itself", () => {
  const groups: Array<[string, readonly NavEntry[]]> = [
    ["primary", V34_PRIMARY_NAV],
    ...allGroups.map((group): [string, readonly NavEntry[]] => [group.title, group.entries]),
  ];

  it.each(groups)("%s has no duplicate label and no duplicate destination", (_name, entries) => {
    const labels = entries.map((entry) => entry.label);
    expect(new Set(labels).size, `labels ${labels.join(", ")}`).toBe(labels.length);
    const targets = entries.map((entry) => ("key" in entry ? v34Route(entry.key).path : entry.path));
    expect(new Set(targets).size, `targets ${targets.join(", ")}`).toBe(targets.length);
  });
});

describe("held routes do not render", () => {
  const heldKey = V34_ROUTES.find((route: V34RouteRecord) => route.release === "held")?.key;
  const liveKey = V34_ROUTES.find((route: V34RouteRecord) => route.release === "live")?.key;

  it("the registry has both a held and a live route to filter between", () => {
    expect(heldKey).toBeTruthy();
    expect(liveKey).toBeTruthy();
  });

  it("drops an entry whose route is held and keeps a retained path", () => {
    if (!heldKey || !liveKey) throw new Error("registry has no held or no live route");
    const deps: NavDeps = { pathOf: (key) => v34Route(key).path, isHeld: (key) => key === heldKey };
    const entries: NavEntry[] = [
      { key: heldKey, label: "Held" },
      { key: liveKey, label: "Live" },
      { path: "/docs", label: "Docs" },
    ];
    expect(resolveEntries(entries, deps).map((link) => link.label)).toEqual(["Live", "Docs"]);
  });

  it("drops a group left with nothing", () => {
    if (!heldKey) throw new Error("registry has no held route");
    const deps: NavDeps = { pathOf: (key) => v34Route(key).path, isHeld: () => true };
    const groups = resolveGroups([{ title: "Only held", entries: [{ key: heldKey, label: "Held" }] }], deps);
    expect(groups).toEqual([]);
  });

  it("renders no link to a held route in the primary bar, the More panel or the footer in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("V34_SHOW_HELD", "");
    const heldPaths = new Set(V34_ROUTES.filter((route: V34RouteRecord) => route.release === "held").map((route: V34RouteRecord) => route.path as string));
    const rendered = [
      ...resolveEntries(V34_PRIMARY_NAV),
      ...resolveGroups(V34_MORE_GROUPS).flatMap((group) => group.links),
      ...resolveGroups(V34_FOOTER_GROUPS).flatMap((group) => group.links),
    ];
    expect(rendered.length).toBeGreaterThan(20);
    expect(rendered.filter((link) => heldPaths.has(link.href))).toEqual([]);
  });
});

describe("the primary action", () => {
  it('is labelled "Create your World" and goes where primaryCallToAction() says', () => {
    expect(CREATE_WORLD_LABEL).toBe("Create your World");
    expect(createWorldAction()).toEqual({ href: primaryCallToAction().href, label: "Create your World" });
  });
});

describe("current", () => {
  it("marks the exact page, a section page, and nothing else", () => {
    expect(current("/pricing", "/pricing")).toBe("page");
    expect(current("/research", "/research/notes")).toBe("true");
    expect(current("/research", "/researcher")).toBeUndefined();
    expect(current("/pricing", "/platform")).toBeUndefined();
  });
  it("treats the root as current only on the root", () => {
    expect(current("/", "/")).toBe("page");
    expect(current("/", "/pricing")).toBeUndefined();
  });
});
