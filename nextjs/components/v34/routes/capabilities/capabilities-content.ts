import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the capabilities page that are not computed. The page title and lead are the
  registry's; clause names, promises, states and evidence come from lib/compiler-contract.ts and the
  format table from shared/capabilityManifest.ts. This file holds only headings and destinations.
  There is no number here: ordinals are counted from the list position and every count comes from
  the data at render time.
*/

/** A destination is a registry key, resolved here; the page test fails if it names a held route. */
const to = (key: V34RouteKey): Route => v34Route(key).path;

/** /sources is a retained page outside the registry; the page test checks that it exists. */
export const SOURCES_HREF = "/sources" satisfies Route;

export const HERO = {
  figure: "Each clause of the compiler contract as one point: filled where it is demonstrated, outlined where it is direction.",
} as const;

export const CONTRACT = {
  eyebrow: "The compiler contract",
  title: "Every clause carries its state.",
  lead: "A state says what the evidence supports. A clause becomes qualified when a receipt exists for it.",
  check: "Where to check it",
} as const;

export const FORMATS = {
  eyebrow: "Source formats",
  title: "Formats the compiler reads.",
  lead: "Read from the capability manifest the upload route validates against. Every accepted format shares the limits listed under the table.",
  table: "Source formats and what each one keeps",
  columns: ["Format", "Tier", "Keeps", "Specific to this format"],
  shared: "Shared by every accepted format",
  link: { href: SOURCES_HREF, label: "Limits for each format →" },
  stats: { listed: "Formats listed", accepted: "Accepted at upload", converted: "Converted before reading" },
} as const;

export const DEPLOYMENT = {
  eyebrow: "This deployment",
  title: "What is open today.",
  lead: "Read from the live status when the page loads. A status that cannot be read shows as Unknown.",
  table: "Capabilities of this deployment and their state",
  columns: ["Capability", "State", "Note"],
} as const;

export const EXPLORE = {
  eyebrow: "Explore by outcome",
  title: "Pick the question you are asking.",
  items: [
    { href: to("world"), title: "See the connections", text: "Inspect a typed, source-linked graph." },
    { href: to("evidence"), title: "Trace a claim", text: "Review its source and its uncertainty." },
    { href: to("changes"), title: "Keep up with change", text: "Compare source releases." },
    { href: to("connect"), title: "Use your own AI", text: "Set up a client." },
    { href: to("compiler"), title: "Follow the compiler", text: "See how a source becomes records." },
    { href: to("methods"), title: "Read the methods", text: "Read how the compiler works." },
  ],
} as const;

export const FINAL = {
  title: "Understand the full lifecycle.",
  cta: { href: to("platform"), label: "Platform" },
} as const;

/** Every route the page links to, for the guard test. */
export const CAPABILITIES_DESTINATIONS: readonly Route[] = [...EXPLORE.items.map((i) => i.href), FINAL.cta.href, FORMATS.link.href];
