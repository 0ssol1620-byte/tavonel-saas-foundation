import Link from "next/link";
import { PublicSitePage } from "@/components/public-site-chrome";
import { pageMetadata } from "@/lib/page-seo";
import styles from "@/components/marketing-story.module.css";

export const metadata = pageMetadata({
  title: "How it works — from source to a Compiled World",
  description: "Follow the source pipeline: versioned input, document reading, evidence binding, review, AI connections and a new version when sources change.",
  canonical: "/how-it-works",
});

const STEPS = [
  { title: "Bring your sources", body: "Choose files or connect a supported system. Every accepted source receives a version and a rights boundary.", input: "Source file", output: "Versioned input", href: "/sources", link: "Supported sources" },
  { title: "Read the document", body: "Sanitize to PDF and read text with page coordinates. Reading uncertainty stays with the result; the supported-format manifest defines what is recovered.", input: "Accepted source", output: "Text + page + region", href: "/product/document-understanding", link: "Document reading" },
  { title: "Bind the evidence", body: "A passage keeps the exact source version, excerpt, page and region. You can open the place it came from.", input: "Extracted passage", output: "Source-bound record", href: "/evidence", link: "Inspect the evidence" },
  { title: "Review a World", body: "The compile produces a candidate. Review state and unresolved material remain visible; a candidate and the active version are separate.", input: "Compiled candidate", output: "Reviewed version", href: "/product/compiled-world", link: "The World artifact" },
  { title: "Connect your AI", body: "Read the active World through API or MCP, or request a signed portable package. Retrieval keeps the same evidence references.", input: "Active World", output: "API · MCP · export", href: "/docs", link: "Connect your stack" },
  { title: "Compile the next version", body: "New sources create a new snapshot to compare and review. The public example uses full-corpus compiles; the selective-rebuild contract states its current implementation boundary.", input: "Changed sources", output: "Next candidate + change record", href: "/product/continuous-knowledge", link: "Recompilation contract" },
] as const;

export default function HowItWorksPage() {
  return <PublicSitePage template="T1">
    <section className={`scene doc ${styles.process}`}>
      <div className="shell">
        <div className={styles.lead}>
          <h1 className="document-title">From source files<br />to a versioned World.</h1>
          <p className="lede">Follow what happens to a document, and what your AI receives at the other end.</p>
        </div>
        <ol className={styles.pipeline} aria-label="The compilation process">
          {STEPS.map((step, index) => <li key={step.title}>
            <svg className={styles.stepArt} viewBox="0 0 48 48" aria-hidden="true">
              <path d={[
                "M12 6h18l8 8v28H12z M30 6v8h8 M17 22h16 M17 28h16 M17 34h10",
                "M12 6h18l8 8v28H12z M30 6v8h8 M17 20h16v8H17z",
                "M6 10h22v28H6z M11 18h12v8H11z M23 22h10 M33 16h10v12H33z",
                "M10 8h28v32H10z M16 24l6 6 12-12",
                "M6 12h20v24H6z M26 24h16 M36 18l6 6-6 6",
                "M8 6h20v26H8z M18 16h20v26H18z M23 24h10 M23 30h10 M23 36h6",
              ][index]} />
            </svg>
            <div className={styles.stepFlow}><span>{step.input}</span><span aria-hidden="true">→</span><strong>{step.output}</strong></div>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
            <Link href={step.href}>{step.link}</Link>
          </li>)}
        </ol>
        <div className={styles.processClose}>
          <p>Own-source processing follows the current access, rights and release conditions. This process diagram describes the product path; it is not a customer run receipt.</p>
          <Link href="/product">See the product and its outputs</Link>
          <Link href="/product/continuous-knowledge">Read the version contract</Link>
          <Link href="/knowledge-compiler">Read the Knowledge Compiler category guide</Link>
        </div>
      </div>
    </section>
  </PublicSitePage>;
}
