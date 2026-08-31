import type { Metadata } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";

export const metadata: Metadata = { title: "What Is a Knowledge Compiler? — TAVONEL", description: "A practical guide to Knowledge Compilers, RAG, knowledge graphs and enterprise search.", alternates: { canonical: "/knowledge-compiler" }, openGraph: { url: "/knowledge-compiler" } };

export default function KnowledgeCompilerPage() {
  return <PublicProofRegistry eyebrow="CATEGORY GUIDE" title="What is a Knowledge Compiler?" state="CATEGORY DEFINITION · NOT A PERFORMANCE CLAIM" summary="A Knowledge Compiler turns changing source material into a versioned, evidence-bound, portable knowledge object that people and AI systems can inspect together." sections={[
    { title: "The compile contract", body: "The unit of value is not a chat response. It is a Compiled World with immutable inputs, structured objects, exact evidence, review state, retrieval material and portable files.", rows: [
      { key: "INPUT", description: "Versioned source files and connector cursors.", state: "IMMUTABLE" },
      { key: "STRUCTURE", description: "Directory, ontology, entities, claims and relations.", state: "REVIEWABLE" },
      { key: "EVIDENCE", description: "Source version, page, bounding box, excerpt and digest.", state: "TRACEABLE" },
      { key: "WORLD", description: "Candidate and active revisions separated by a human decision.", state: "VERSIONED" },
    ] },
    { title: "Compared with RAG", body: "RAG retrieves chunks at question time. A Knowledge Compiler can produce retrieval units too, but treats them as one projection of a reviewed World rather than the final asset.", rows: [
      { key: "RAG", description: "Question-time retrieval over an index; quality depends on chunking, retrieval and generation.", state: "COMPLEMENTARY" },
      { key: "COMPILER", description: "Build-time structure, evidence and versions that multiple retrieval or model layers can consume.", state: "PERSISTENT ASSET" },
    ] },
    { title: "Compared with a knowledge graph", body: "A graph stores entities and relations. A Knowledge Compiler adds the source pipeline, evidence contract, review lifecycle, retrieval projections and portable package around that graph.", rows: [
      { key: "GRAPH", description: "A representation of connected objects.", state: "COMPONENT" },
      { key: "COMPILER", description: "The process and receipts that make the representation inspectable and maintainable.", state: "SYSTEM" },
    ] },
    { title: "Compared with enterprise search", body: "Enterprise search helps people find documents. A Knowledge Compiler materializes reusable claims, objects and evidence paths for both people and agents, while preserving links back to those documents.", rows: [
      { key: "SEARCH", description: "Find and rank relevant source material.", state: "DOCUMENT-CENTRIC" },
      { key: "COMPILER", description: "Build a versioned knowledge layer without discarding source provenance.", state: "WORLD-CENTRIC" },
    ] },
  ]} />;
}