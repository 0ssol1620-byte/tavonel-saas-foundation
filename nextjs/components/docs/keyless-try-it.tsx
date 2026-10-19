import Link from "next/link";
import type { Route } from "next";
import { DocsCopyButton } from "@/components/docs-copy-button";
import { CodeTokens } from "@/components/docs/code-tokens";
import { ApiTryIt, type TryItRoute } from "@/components/docs/api-try-it";
import { findDocsSection } from "@/lib/docs-content";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import styles from "./api-try-it.module.css";

/*
  The keyless first result, as one mount (EN-4).

  /api, /docs/quickstart and /developers all render this, so the three reads, their copy and the
  terminal recipes beside them cannot drift apart page by page. It is a server component: only the
  list of Run buttons is a client island (`api-try-it.tsx`), and everything a reader only reads is
  HTML, which keeps it off the §22 script budget.

  The unauthenticated routes, and nothing else. Each is a GET carrying no tenant, no document and
  no credential, which is why it can be called from a browser at all. /reproducibility/sample-world
  is included because it is the one that shows the shape of an answer -- object, evidence, source
  version, page, region -- without anyone having compiled anything, and the one that sends a
  Content-Digest, so it is the run that shows a match.
*/
export const KEYLESS_READS: readonly TryItRoute[] = [
  {
    path: "/api/v1/capabilities",
    label: "What TAVONEL can read",
    note: "The same list the upload route validates against. A format absent from it is refused at upload rather than accepted and dropped.",
  },
  {
    path: "/api/status",
    label: "What is open right now",
    note: "The deployment's own state, including whether compiling your own files is open here.",
  },
  {
    path: "/reproducibility/sample-world",
    label: "The shape of an answer",
    note: "A deterministic product fixture, unsigned and labelled as such in its own disclosure field. Build against the shape; do not judge extraction from it.",
  },
];

/*
  The terminal versions, read out of /docs/integration-recipes rather than typed a second time.
  A renamed block fails the build here instead of leaving a stale copy on three pages.
*/
const RECIPES = [
  { language: "curl", recipe: "Recipe 3", label: "What TAVONEL can read, publish and sign" },
  { language: "Python", recipe: "Recipe 2", label: "Read the sample and follow one claim to its evidence" },
] as const;

export function recipeBody(label: string): string {
  const block = findDocsSection("integration-recipes")?.blocks.find((item) => item.kind === "code" && item.label === label);
  if (block?.kind !== "code") throw new Error(`/docs/integration-recipes has no code block labelled "${label}"`);
  return block.body;
}

export function KeylessTryIt() {
  return (
    <section className={styles.tryIt} aria-labelledby="try-it-heading" data-keyless-try-it="">
      <h2 id="try-it-heading" className={styles.heading}>Try it, with no key</h2>
      <p className={styles.lede}>
        Three unauthenticated reads, run from this page against TAVONEL. No signup, no
        credential, nothing that spends. Where a response sends a <code>Content-Digest</code>{" "}
        header, this page hashes the bytes it received and says whether they match.
      </p>
      <ApiTryIt routes={KEYLESS_READS} />
      {/*
        The two copy buttons are on the page, not inside the disclosure (gap §4c.3 asks for the
        buttons; reading the commands is the optional step). Inside a closed <details> they were the
        first copy controls on the quickstart and could not be seen or pressed until it was opened
        (premium-craft.spec). The recipes are not `figure.docs-code` blocks: on /developers that
        figure is the page's one first-request sample (visual-refinement.spec), and these two are a
        reading aid for the buttons above them, copied from /docs/integration-recipes.
      */}
      <div className={styles.copies}>
        {RECIPES.map(({ language, label }) => (
          <DocsCopyButton key={label} value={recipeBody(label)} label={`Copy ${language}`} />
        ))}
      </div>
      <details className={styles.terminal}>
        <summary>The same checks from a terminal</summary>
        {RECIPES.map(({ language, recipe, label }) => (
          <figure className={styles.recipe} key={recipe}>
            <figcaption>{language} · {recipe}</figcaption>
            <pre tabIndex={0} role="group" aria-label={label}><code><CodeTokens body={recipeBody(label)} /></code></pre>
          </figure>
        ))}
        <p className={styles.note}>
          Both are from <Link href={"/docs/integration-recipes" as Route}>Integration recipes</Link>,
          which says what each one proves.
        </p>
      </details>
      <p className={styles.note}>
        The same shape as a person reads it, a claim with its evidence and the page region it came
        from:{" "}
        {/*
          No prefetch. On the quickstart this link is in the first viewport, and prefetching it
          pulled the Explore route's own scripts -- three chunks, about 31 KB transferred -- into
          the quickstart's load, past the §22 script budget. Measured, see EN-4's receipt.
        */}
        <Link href={EXPLORE_CTA.href as Route} prefetch={false}>{EXPLORE_CTA.label}</Link>.
      </p>
    </section>
  );
}
