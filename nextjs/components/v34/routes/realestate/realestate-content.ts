import { v34Route } from "@/lib/v34/routes";

/*
  The words of the real estate page that are not the shared pieces'. Plain data, so the guard test
  can read every sentence in one place. No number is typed here: ordinals are counted from list
  position. The route is held, so every line says what the page is for and promises no date. It
  states no valuation, parcel record, price or yield.
*/

export const HERO_ACTIONS = {
  studio: { href: v34Route("studio").path, label: "Open the reference walkthrough" },
  markets: { href: v34Route("markets").path, label: "Market context" },
} as const;

export const ART = {
  title: "A property is a relationship between records",
  lead: "Start with geography and data rights. Each record keeps its authority, its date and its coverage.",
  label: "A drawn parcel grid with one parcel outlined, standing for the records that meet at a property",
  caption: "A drawn parcel grid. The outlined parcel stands for one property.",
  entries: [
    { name: "Parcel", detail: "Location identifier" },
    { name: "Planning rule", detail: "Official authority" },
    { name: "Transaction context", detail: "Date and method" },
    { name: "Hazard data", detail: "Source coverage" },
  ],
} as const;

export const LAYERS = {
  eyebrow: "Layered due diligence",
  title: "Different sources. One decision record.",
  lead: "Compare the same region across time. Geographic boundaries, publication dates, coverage and missing fields stay explicit.",
  items: ["Location and parcel", "Supply and permits", "Rates and financing", "Local evidence"],
  link: { href: v34Route("evidence").path, label: "Inspect original evidence" },
  art: {
    label: "Stacked layers over one region: location and parcel, supply and permits, rates and financing, local evidence",
    caption: "Layers over one region. Each layer keeps its own source and date.",
  },
} as const;

export const SOURCES = {
  title: "Start with what can be audited.",
  items: [
    { label: "FHFA HPI", text: "Regional price indexes at published geographies.", href: "https://www.fhfa.gov/data/hpi" },
    { label: "Census Building Permits", text: "Permits by published geographic scope.", href: "https://www.census.gov/construction/bps/" },
    { label: "FRED", text: "Rate and macro series. Check rights and vintages.", href: "https://fred.stlouisfed.org/" },
  ],
  linkLabel: "Open the source",
} as const;

export const UNCERTAINTY = {
  title: "Keep uncertainty visible.",
  lead: "Inputs stay separate and cited, so a reader can see what is known and what is missing.",
  items: [
    { title: "Coverage", text: "Confirm local geographies, data freshness and property-specific rights." },
    { title: "Scenario", text: "Compare your own assumptions under different financing and vacancy inputs." },
    { title: "Evidence", text: "Show cited inputs and the discrepancies that remain unresolved." },
  ],
} as const;

export const FINAL = {
  title: "Bring your own research.",
  secondary: { href: v34Route("markets").path, label: "See the Markets sample" },
} as const;
