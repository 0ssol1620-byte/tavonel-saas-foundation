import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TermsPage from "../app/terms/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/terms",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {} }),
}));

/*
  One agreement on the public surfaces.

  An owner accepts the hashed 2026-09-30 terms and processing addendum. /terms, /privacy, /trust
  and /refunds may not publish a second, different contract beside them: /terms renders the
  accepted file itself, the old drafts are replaced for an accepting workspace, and the money and
  transfer sentences say the same thing on every page that states them.
*/
const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const withoutComments = (source: string) =>
  source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

const TERMS = "public/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md";
const ADDENDUM = "public/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md";
const manifest = JSON.parse(read("public/policy/processing-terms-2026-09-30.json"));
const terms = read(TERMS);
const addendum = read(ADDENDUM);

describe("the published 2026-09-30 documents", () => {
  it("are the bytes the manifest hashes, with LF line endings", () => {
    for (const [path, entry] of [[TERMS, manifest.terms], [ADDENDUM, manifest.processing]] as const) {
      const bytes = readFileSync(resolve(import.meta.dirname, "..", path));
      expect(bytes.includes(13), `${path} must stay LF: the receipt hashes the bytes`).toBe(false);
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(entry.sha256);
    }
  });

  it("replace the earlier drafts for an accepting workspace and yield to executed agreements", () => {
    expect(terms).toContain("replace every earlier draft of the terms of service and every earlier draft data processing agreement");
    expect(terms).toContain("do not form a second agreement");
    expect(terms).toContain("A separately executed agreement, including an enterprise, data-processing or transfer agreement, prevails for its stated scope.");
    expect(addendum).toContain("it replaces every earlier draft data processing agreement published on this site");
    expect(addendum).toContain("A separately executed data-processing or transfer agreement prevails within its scope");
  });

  it("require TAVONEL's agreement before transfer-restricted data, not the customer acting alone", () => {
    expect(addendum).toContain("TAVONEL and the customer agree that arrangement before the affected personal data is submitted");
    expect(addendum).not.toContain("that arrangement must be in place before");
    expect(terms).toContain("until TAVONEL and you have agreed that arrangement");
  });

  it("pause renewal while processing is unavailable and resume only on confirmation", () => {
    expect(terms).toContain("If processing is unavailable for your workspace, renewal of its paid subscription is paused rather than charged.");
    expect(terms).toContain("resumes only after you confirm the resumption, because the payment provider may charge immediately");
    expect(terms).toContain("Pausing does not by itself refund a completed payment.");
    expect(terms).toContain("a renewal or resumption does not ask you to accept them again");
  });

  it("describe the deletion periods as configuration, not a deadline", () => {
    expect(addendum).toContain("recovery protection of 28 days from object creation");
    expect(addendum).toContain("eligible for physical purge 30 days after the verified request");
    expect(addendum).toContain("not a guaranteed completion deadline");
  });

  it("claim no legal review or certification", () => {
    for (const document of [terms, addendum]) {
      expect(document).not.toMatch(/reviewed by (?:a )?(?:lawyer|counsel)|legally reviewed|certified compliant/i);
    }
  });
});

describe("/terms is the accepted terms, not a second contract", () => {
  const page = read("app/terms/page.tsx");
  const copy = withoutComments(page);

  it("renders the manifest's terms file and fails closed on a hash mismatch", () => {
    expect(page).toContain('import manifest from "@/public/policy/processing-terms-2026-09-30.json"');
    expect(page).toContain("readPublished(manifest.terms)");
    expect(page).toContain("if (digest !== document.sha256) throw");
    expect(page).toContain("<LegalOperatorDisclosure />");
    expect(page).toContain("href={manifest.processing.path}");
  });

  it("renders every heading and the operator disclosure from the published file", () => {
    const operator = {
      TAVONEL_LEGAL_BUSINESS_NAME: "Example Operator",
      TAVONEL_LEGAL_REPRESENTATIVE: "Example Representative",
      TAVONEL_LEGAL_BUSINESS_NUMBER: "123-45-67890",
      TAVONEL_LEGAL_ADDRESS: "Example Address",
      TAVONEL_LEGAL_PHONE: "+82 2 0000 0000",
      TAVONEL_LEGAL_EMAIL: "operator@example.com",
    };
    for (const [key, value] of Object.entries(operator)) vi.stubEnv(key, value);
    try {
      const html = renderToStaticMarkup(TermsPage());
      for (const heading of terms.match(/^## .+$/gm)!) {
        expect(html).toMatch(new RegExp(`<h2[^>]*>${heading.slice(3).replace(/&/g, "&amp;").replace(/'/g, "&#x27;")}</h2>`));
      }
      expect(html).toContain("Example Operator");
      expect(html).toContain('<a href="mailto:support@tavonel.com">support@tavonel.com</a>');
      expect(html).toContain(manifest.terms.sha256);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("carries none of the superseded draft clauses", () => {
    for (const draft of ["Indemnity", "defend and indemnify", "continuing to use the service", "LEGAL_DRAFT_NOTICE", "readCommercialState", "renews automatically each month"]) {
      expect(copy, `"${draft}" belongs to the replaced draft`).not.toContain(draft);
    }
  });
});

describe("the old drafts are archived everywhere they are reachable", () => {
  it("each served draft DPA says it is archived and replaced by the addendum", () => {
    const v2 = read("public/policy/TAVONEL_DPA_v2_2026-09-23.md").replace(/\s+/g, " ");
    expect(v2).toContain("**Archived — enterprise negotiation template.**");
    expect(v2).toContain("/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md replaces this draft");
    expect(v2).toContain("No signed bilateral agreement exists on these terms unless both parties execute one.");
    const v1 = read("public/policy/TAVONEL_DPA_v1_2026-09-11.md");
    expect(v1).toContain("**Archived — superseded.**");
  });

  it("every public link to the v2 draft labels it archived, and the shared records cite the addendum", () => {
    const enterprise = withoutComments(read("app/enterprise/page.tsx"));
    expect(enterprise).toContain("archived 2026-09-23 template</a>");
    expect(enterprise).toContain('href="/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md"');
    expect(enterprise).not.toMatch(/>data processing agreement<\/a>\s+is\s+available as a draft/);
    expect(read("lib/public-trust-contract.ts")).not.toContain("TAVONEL_DPA_v2");
    expect(read("content/trust/provisions.ts")).toContain('label: "Enterprise DPA template (archived draft)"');
  });

  it("the in-place notice no longer calls the pages Draft v1 beside a versioned agreement", async () => {
    const { LEGAL_DRAFT_NOTICE, LEGAL_LAST_UPDATED } = await import("./operations");
    expect(LEGAL_LAST_UPDATED).toBe("2026-09-30");
    expect(LEGAL_DRAFT_NOTICE).not.toContain("Draft v1");
    expect(LEGAL_DRAFT_NOTICE).toContain("versioned self-service terms and processing addendum");
  });
});

describe("/privacy, /trust and /refunds state the same terms", () => {
  it("/privacy requires agreed transfer terms and links the addendum", () => {
    const privacy = withoutComments(read("app/privacy/page.tsx"));
    expect(privacy).toContain("we agree it with that customer before processing the affected documents");
    expect(privacy).toContain("href={processingTerms.processing.path}");
    expect(privacy).not.toContain("Our draft data processing agreement");
  });

  it("/trust links the addendum and no unlabelled draft", () => {
    const trust = withoutComments(read("app/trust/page.tsx"));
    expect(trust).not.toContain("remains clearly labelled as a draft");
    expect(trust.match(/TAVONEL_DPA_v2_2026-09-23\.md/g)).toHaveLength(1);
  });

  it("/refunds pauses renewal on unavailability in both templates and promises no automatic refund", () => {
    const refunds = withoutComments(read("app/refunds/page.tsx"));
    expect(refunds.match(/paused rather than charged/g)).toHaveLength(2);
    expect(refunds).toContain("Paddle may charge immediately when a subscription resumes");
    expect(refunds.match(/does not by itself\s+refund a completed payment/g)).toHaveLength(2);
  });
});
