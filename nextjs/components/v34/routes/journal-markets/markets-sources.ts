import type { ArticleSource } from "@/components/v34/ui/article-layout";

/** The public documentation of the filing record the article uses as its example of dated data (legal hold D21-L1: no FRED/ALFRED). */
export const MARKETS_SOURCES: readonly ArticleSource[] = [
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
