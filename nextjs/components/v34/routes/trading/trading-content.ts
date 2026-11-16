import { v34Route } from "@/lib/v34/routes";

/*
  The words of the trading page that are not the shared pieces'. Plain data, so the guard test can
  read every sentence in one place. No number is typed here: ordinals are counted from list position.
  The route is held, so every line says what the page is for and promises no date. It states no
  signal, endorsement or performance.
*/

export const HERO_ACTIONS = {
  connect: { href: v34Route("connect").path, label: "Connect your AI" },
  markets: { href: v34Route("markets").path, label: "Explore the Markets World" },
} as const;

export const ART = {
  title: "What was knowable before a decision?",
  lead: "Four dates keep a research replay honest. Each one is recorded beside the fact it belongs to.",
  steps: [
    { name: "Source publication", kind: "Known-at" },
    { name: "Observation vintage", kind: "Point-in-time" },
    { name: "Research decision", kind: "As-of cutoff" },
    { name: "Later revision", kind: "Excluded from the earlier view" },
  ],
} as const;

export const LAYERS = {
  eyebrow: "Evidence layers",
  title: "Give the same model a wider field of view.",
  art: {
    label: "A drawn price line with three dated events before a cutoff line, and a later revision shaded after it",
    caption: "A drawn price line, three dated events and one cutoff. What lies right of the cutoff is outside the view.",
  },
  items: [
    {
      title: "Price and volume",
      text: "A summary of trades. External events and their causes come from the dated sources beside it.",
    },
    {
      title: "Context packet",
      text: "Price history with as-of releases, filings, supply data and your own research. Every fact keeps its source, timestamp and uncertainty.",
    },
  ],
} as const;

export const SOURCES = {
  title: "Primary sources, traceable dates.",
  lead: "Each source publishes its own dates and terms, so a fact can be traced to its origin.",
  items: [
    { label: "SEC EDGAR", text: "Official filings and XBRL facts.", href: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces" },
    { label: "ALFRED", text: "Economic vintages and revisions. Series rights vary.", href: "https://alfred.stlouisfed.org/" },
    { label: "EIA", text: "Energy supply and inventory data.", href: "https://www.eia.gov/opendata/" },
    { label: "US Census", text: "Building permits and housing supply.", href: "https://www.census.gov/construction/bps/" },
  ],
  linkLabel: "Open the source",
} as const;

export const REPLAY = {
  title: "Compare evidence utility before strategy returns.",
  steps: [
    { title: "Freeze", text: "Select the universe, the permitted data and the exact cutoff." },
    { title: "Replay", text: "Same model, same task budget, no later data." },
    { title: "Score", text: "Evidence coverage, date validity, latency, cost and abstention." },
    { title: "Decide", text: "Any strategy test is separate, with fees and out-of-sample validation." },
  ],
} as const;

export const FINAL = {
  title: "Build a research World.",
  secondary: { href: v34Route("studio").path, label: "Open the reference walkthrough" },
} as const;
