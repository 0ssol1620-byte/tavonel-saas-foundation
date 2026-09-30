import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PolicyLayout from "@/components/policy-layout";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import manifest from "@/public/policy/processing-terms-2026-09-30.json";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/terms" },
  openGraph: { url: "/terms" },
  title: "Terms of service — TAVONEL",
  description: "The TAVONEL self-service terms, version 2026-09-30, published exactly as a workspace owner accepts them, with the processing addendum that forms part of them.",
};

/*
  One agreement, not two.

  This page used to carry its own "Draft v1" terms in JSX -- an indemnity, "continued use is
  acceptance", monthly renewal -- while the acceptance route recorded consent to the hashed
  2026-09-30 documents under public/policy. A customer could read two contracts that disagreed.
  The page now renders the published terms file itself and refuses to render if its bytes no
  longer match the manifest hash an acceptance receipt records, so what a reader sees here is the
  document an owner accepts. The terms name this page as the operator disclosure, so it renders
  that disclosure too.

  The manifest is bundled by the import; the document is read at request time, like the
  acceptance route does, and fails closed rather than falling back to other text.
*/
type Document = { path: string; sha256: string };

function readPublished(document: Document) {
  const bytes = readFileSync(join(process.cwd(), "public", document.path.slice(1)));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== document.sha256) throw new Error(`published terms do not match the manifest: ${document.path}`);
  return bytes.toString("utf8");
}

const LINKABLE = /(https:\/\/tavonel\.com\/[a-z]+|[a-z]+@tavonel\.com)/g;

function linked(text: string) {
  return text.split(LINKABLE).map((part, index) => {
    if (index % 2 === 0) return part;
    const href = part.includes("@") ? `mailto:${part}` : part.replace("https://tavonel.com", "");
    return <a key={index} href={href}>{part}</a>;
  });
}

/** The published file is headings and paragraphs only; its `#` title is the page title. */
function render(markdown: string) {
  return markdown
    .trim()
    .split(/\n{2,}/)
    .filter((block) => !block.startsWith("# "))
    .map((block, index) =>
      block.startsWith("## ")
        ? <h2 key={index}>{block.slice(3)}</h2>
        : <p key={index}>{linked(block)}</p>,
    );
}

export default function TermsPage() {
  const terms = readPublished(manifest.terms);
  return (
    <PolicyLayout
      title="Terms of service."
      intro={
        <>
          The TAVONEL self-service terms, version {manifest.version}, exactly as a workspace owner
          accepts them. The <a href={manifest.processing.path}>processing addendum</a> of the same
          version is part of this agreement.
        </>
      }
    >
      <BreadcrumbJsonLd trail={[{ name: "Terms", path: "/terms" }]} />
      <h2>Service operator</h2>
      <p>TAVONEL is the operating brand for the service described on this site.</p>
      <LegalOperatorDisclosure />
      {render(terms)}
      <h2>Documents in this version</h2>
      <p>
        An acceptance receipt records the version and the SHA-256 hash of each document below. A
        changed document is published as a new version rather than revised in place.
      </p>
      <ul>
        <li><a href={manifest.terms.path}>Self-service terms</a> — <code>{manifest.terms.sha256}</code></li>
        <li><a href={manifest.processing.path}>Processing addendum</a> — <code>{manifest.processing.sha256}</code></li>
      </ul>
    </PolicyLayout>
  );
}
