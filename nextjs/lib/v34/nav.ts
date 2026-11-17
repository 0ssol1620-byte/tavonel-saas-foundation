/**
 * The V34 navigation, as data.
 *
 * The shell (`components/v34/shell/**`) renders what this file declares and decides nothing
 * itself: five primary items, the four columns of the More panel and the drawer, and the footer's
 * five groups. At integration this folds into `lib/site-navigation.ts`.
 *
 * An entry is either a registry key or a retained route's path. A registry key is typed against
 * `V34RouteKey`, so a route that is renamed or dropped in the registry stops compiling here; its
 * href comes from the registry, so a path lives in one place. A retained route (docs, legal,
 * status, benchmarks ...) is not in the registry and is named by its path.
 *
 * A route that is held in production does not render as a link anywhere in the shell: `isHeld`
 * from `release.ts` removes it, so no page, server payload or client bundle carries a link to a
 * route that answers 404.
 */
import { isHeld } from "@/lib/v34/release";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

export type NavEntry =
  | { readonly key: V34RouteKey; readonly label: string }
  | { readonly path: string; readonly label: string };

/** What the shell renders: a resolved link. Client components import this type only. */
export interface NavLink {
  readonly href: string;
  readonly label: string;
}

export interface NavGroup<T = NavEntry> {
  readonly title: string;
  readonly entries: readonly T[];
}

export interface NavGroupLinks {
  readonly title: string;
  readonly links: readonly NavLink[];
}

const route = (key: V34RouteKey, label: string): NavEntry => ({ key, label });
const retained = (path: string, label: string): NavEntry => ({ path, label });

/** The five items the bar always carries. */
export const V34_PRIMARY_NAV: readonly NavEntry[] = [
  route("platform", "Product"),
  route("solutions", "Solutions"),
  route("connect", "Integrations"),
  route("pricing", "Pricing"),
  route("journal", "Journal"),
];

/** The More panel on desktop, and the accordion in the phone drawer. Four columns. */
export const V34_MORE_GROUPS: readonly NavGroup[] = [
  {
    title: "Product",
    entries: [
      route("platform", "Platform"),
      route("compiler", "Compiler"),
      route("world", "World"),
      route("evidence", "Evidence"),
      route("changes", "Changes"),
      route("autopilot", "Autopilot"),
      /* Decision 2: /studio is the reference walkthrough; the filled action is "Create your World". */
      route("studio", "Reference walkthrough"),
      route("capabilities", "Capabilities"),
      route("methods", "How it works"),
      route("steward", "Steward"),
      route("skills", "Skills"),
      route("outcomes", "Outcomes"),
      route("catalog", "Catalog"),
    ],
  },
  {
    title: "For you",
    entries: [
      route("solutions", "Solutions"),
      route("personal", "Personal"),
      route("research", "Research"),
      route("creators", "Creative work"),
      route("teams", "Teams"),
      route("enterprise", "Enterprise"),
      route("markets", "Markets"),
      route("engineering", "Engineering"),
      route("trading", "Trading research"),
      route("realestate", "Real estate"),
    ],
  },
  {
    title: "Build & trust",
    entries: [
      route("connect", "Connect"),
      route("developers", "Developers"),
      route("security", "Security"),
      route("governance", "Governance"),
      route("federation", "Federation"),
      route("marketplace", "Marketplace"),
      route("community", "Community"),
    ],
  },
  {
    title: "TAVONEL",
    entries: [
      route("pricing", "Pricing"),
      route("company", "Company"),
      route("contact", "Contact"),
      route("journal", "Journal"),
      route("film", "Film"),
      route("billing", "Billing"),
    ],
  },
];

/** Footer groups. Registry routes and the retained public routes, in the order a reader leaves a page with. */
export const V34_FOOTER_GROUPS: readonly NavGroup[] = [
  {
    title: "Product",
    entries: [
      route("platform", "Platform"),
      route("world", "World"),
      route("evidence", "Evidence"),
      route("changes", "Changes"),
      route("compiler", "Compiler"),
      route("capabilities", "Capabilities"),
      route("studio", "Reference walkthrough"),
      retained("/explore", "Explore a Compiled World"),
    ],
  },
  {
    title: "Solutions",
    entries: [
      route("solutions", "Solutions"),
      route("personal", "Personal"),
      route("research", "Research"),
      route("creators", "Creative work"),
      route("teams", "Teams"),
      route("enterprise", "Enterprise"),
      route("markets", "Markets"),
      route("engineering", "Engineering"),
      route("trading", "Trading research"),
      route("realestate", "Real estate"),
    ],
  },
  {
    title: "Developers",
    entries: [
      route("developers", "Developers"),
      route("connect", "Connect"),
      retained("/docs", "Docs"),
      retained("/api", "API"),
      retained("/changelog", "Changelog"),
      retained("/status", "Status"),
    ],
  },
  {
    title: "Trust",
    entries: [
      route("security", "Security"),
      retained("/trust", "Trust center"),
      retained("/benchmarks", "Benchmarks"),
      retained("/reproducibility", "Reproducibility"),
      retained("/research/notes", "Research notes"),
      retained("/research/program", "Research program"),
    ],
  },
  {
    title: "Company",
    entries: [
      route("company", "Company"),
      route("contact", "Contact"),
      route("journal", "Journal"),
      route("pricing", "Pricing"),
      route("billing", "Billing"),
    ],
  },
];

/** The legal row under the footer groups. The copyright and the security address are `FOOTER_LEGAL_ROW`'s. */
export const V34_FOOTER_LEGAL_LINKS: readonly NavLink[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/refunds", label: "Refunds" },
  { href: "/subprocessors", label: "Subprocessors" },
];

/** The two lookups the resolvers need. Injected in tests; the registry and the release gate otherwise. */
export interface NavDeps {
  readonly pathOf: (key: V34RouteKey) => string;
  readonly isHeld: (key: V34RouteKey) => boolean;
}

const registryDeps: NavDeps = {
  pathOf: (key) => v34Route(key).path,
  isHeld: (key) => isHeld(key),
};

/** The entry as a link, or null when it names a held route. */
export function resolveEntry(entry: NavEntry, deps: NavDeps = registryDeps): NavLink | null {
  if ("path" in entry) return { href: entry.path, label: entry.label };
  if (deps.isHeld(entry.key)) return null;
  return { href: deps.pathOf(entry.key), label: entry.label };
}

export function resolveEntries(entries: readonly NavEntry[], deps?: NavDeps): NavLink[] {
  return entries.flatMap((entry) => resolveEntry(entry, deps) ?? []);
}

/** Groups with their held entries removed. A group left with no entry is dropped rather than rendered empty. */
export function resolveGroups(groups: readonly NavGroup[], deps?: NavDeps): NavGroupLinks[] {
  return groups
    .map((group) => ({ title: group.title, links: resolveEntries(group.entries, deps) }))
    .filter((group) => group.links.length > 0);
}

/** The exact page is current; a page inside the item's section is a location within it. */
export function current(href: string, currentPath: string | null): "page" | "true" | undefined {
  // usePathname() is null when the shell renders outside a router (a static render).
  if (currentPath === null) return undefined;
  if (currentPath === href) return "page";
  return href !== "/" && currentPath.startsWith(`${href}/`) ? "true" : undefined;
}
