import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the markets page that are not the shared pieces' own. Plain data, so the guard test
  can read every sentence in one place. A destination is a registry key, never a typed path (the
  public sample's own link comes from EXPLORE_CTA). There is no number here: counts, dates and
  digests are read from the compiled sample at render time.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

export const HERO = {
  eyebrow: "Finance and markets",
  secondary: { href: to("connect"), label: "Connect your AI" },
  caption: "Filings in time order, with a figure traced back to the filing that states it.",
} as const;

export const SAMPLE = {
  eyebrow: "Sample",
  title: "One company's SEC filings, compiled.",
  lead: "The sample is a compiled World of one company's public SEC filings. Each row opens the filing on the SEC site, and the World keeps the page and region behind every figure.",
  tableLabel: "Filings in the compiled sample",
  columns: ["Filing", "Form", "Filed", "Pages"],
  digestLabel: "Manifest digest of the compiled sample",
} as const;

export const TIME = {
  eyebrow: "Reporting periods",
  title: "Compare periods side by side.",
  lead: "Each filing is its own source with its own date, so a change between reports points at the filings that differ.",
  items: [
    { title: "Follow a figure", text: "Open a figure and read the page and region of the filing that states it." },
    { title: "Compare periods", text: "Set the World of the annual report beside the World after the later filings arrived and see what each arrival added." },
    { title: "Keep each filing whole", text: "A later filing arrives as a new source and the earlier one stays as filed." },
  ],
} as const;

export const ACCESS = {
  eyebrow: "Read from your AI",
  title: "A read-only layer for your research agent.",
  lead: "A World is read through the MCP server with these tools. Every result carries its source, and the server only reads.",
  primary: { href: to("connect"), label: "Connect your AI" },
  secondary: { href: to("developers"), label: "API and MCP reference" },
} as const;

export const JOURNAL = {
  eyebrow: "Field guide",
  title: "See how a filing becomes evidence.",
  text: "A short guide to what the compiler keeps from a source document and why.",
  href: to("journal-compiler"),
  label: "Understand the workflow",
} as const;

export const FINAL = { title: "Create a World from filings you choose." } as const;

/** Every route this page links to, for the guard test. */
export const MARKETS_DESTINATIONS: readonly string[] = [
  HERO.secondary.href, ACCESS.primary.href, ACCESS.secondary.href, JOURNAL.href,
];
