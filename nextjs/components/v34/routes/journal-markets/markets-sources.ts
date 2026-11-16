import type { ArticleSource } from "@/components/v34/ui/article-layout";

/** The public documentation of the two archives the article uses as examples of dated data. */
export const MARKETS_SOURCES: readonly ArticleSource[] = [
  {
    label: "ALFRED, the archival economic data service of the St. Louis Fed",
    href: "https://fred.stlouisfed.org/docs/api/fred/alfred.html",
    note: "Archives the vintages of a data series, so a past value can be read as it was first published.",
  },
  {
    label: "FRED API documentation: real-time periods",
    href: "https://fred.stlouisfed.org/docs/api/fred/realtime_period.html",
    note: "How to request the information that was available over a historical date range.",
  },
  {
    label: "SEC EDGAR application programming interfaces",
    href: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    note: "Filing histories and extracted XBRL facts.",
  },
  {
    label: "SEC filing search",
    href: "https://www.sec.gov/search-filings",
    note: "The official record of each filing and its timestamp.",
  },
];
