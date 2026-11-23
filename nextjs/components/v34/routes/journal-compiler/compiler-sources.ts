import type { ArticleSource } from "@/components/v34/ui/article-layout";

/** Ordered as the article cites them: retrieval, provenance, then the formats a package ships. */
export const COMPILER_SOURCES: readonly ArticleSource[] = [
  {
    label: "Lewis et al., Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    href: "https://arxiv.org/abs/2005.11401",
    note: "Defines retrieval-augmented generation: a retriever supplies passages at question time and a generator writes from them.",
  },
  {
    label: "W3C, PROV-O: The PROV Ontology",
    href: "https://www.w3.org/TR/prov-o/",
    note: "A standard vocabulary for recording where a statement came from and how it was produced.",
  },
  {
    label: "W3C, RDF 1.1 Turtle",
    href: "https://www.w3.org/TR/turtle/",
    note: "The text syntax for the graph in a package.",
  },
  {
    label: "W3C, JSON-LD 1.1",
    href: "https://www.w3.org/TR/json-ld11/",
    note: "The JSON syntax for the same graph.",
  },
  {
    label: "IETF, RFC 4180: Common Format and MIME Type for CSV Files",
    href: "https://www.rfc-editor.org/rfc/rfc4180",
    note: "The tabular form of a package.",
  },
];
