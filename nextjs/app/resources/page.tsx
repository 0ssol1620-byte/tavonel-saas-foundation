import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import {
  RESOURCE_LINKS,
  RESOURCE_PURPOSES,
  RESOURCE_TAG_LABELS,
  RESOURCE_WORKFLOWS,
  type ResourceTag,
} from "@/lib/site-navigation";
import styles from "./resources.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/resources" },
  openGraph: { url: "/resources" },
  title: "Resources — TAVONEL",
  description:
    "Explore a compiled world, read the documentation and API, and inspect the research and evidence behind the compiler.",
};

/*
  The hub the navigation was already promising.

  "Resources" in the top nav pointed straight at /research — one page, wearing the label of a
  section. Anyone who clicked it expecting docs, the API reference or a changelog landed on a
  research page instead and had to go looking. The links below already existed; nothing here is
  new except somewhere to find them.
*/

const DESCRIPTIONS: Record<string, string> = {
  "/explore": "Follow a result from an answer back to the exact source location it came from, without signing in.",
  "/knowledge-compiler": "What a knowledge compiler is, and how it differs from a parser, a RAG pipeline and a graph database.",
  "/docs": "Quickstart, concepts, supported files, compiling, review, and using a world through Ask, the API and MCP.",
  "/api": "Endpoints, authentication, errors and limits, with the machine-readable OpenAPI document alongside.",
  "/changelog": "What changed, in the order it changed, written for the people using it.",
  "/research": "The open problems in compiling documents into evidence-bound, versioned knowledge.",
  "/benchmarks": "The eight metric families, the receipt a result must carry, and the rules that decide whether it may be compared.",
  "/evidence": "What an exact source location is for each kind of source, how a result stays bound to one, and how to verify a signed package.",
  "/reproducibility": "Fixture identity and the material needed to reproduce a published run.",
};

/*
  WG-048 / WG-051: nine links, and a way to ask for the three you came for.

  The filter is a fragment link per tag and `:target` in `resources.module.css` -- no client
  component, no query string, and every one of the nine descriptions stays in the HTML at every
  filter state (WG-074). Nothing here links to a page that does not exist: `/cookbooks/*` is a
  proposal, and a draft cookbook is not linked from this hub as a representative case.
*/
const FILTERS: readonly { tag: ResourceTag | null; group: string | null }[] = [
  { tag: null, group: "SHOW" },
  ...RESOURCE_PURPOSES.map((tag, index) => ({ tag, group: index === 0 ? "BY PURPOSE" : null })),
  ...RESOURCE_WORKFLOWS.map((tag, index) => ({ tag, group: index === 0 ? "BY WORKFLOW" : null })),
];

export default function ResourcesPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>RESOURCES</b><span />TAVONEL</p>
              <h1 className="document-title">Everything that explains<br />how this works.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                A sample world you can take apart, the documentation and API you build against,
                and the research and evidence behind the compiler.
              </p>
              <div className={styles.hub}>
                {/*
                  One selection at a time, and never an empty result: every control names a tag
                  some entry actually carries, so no combination of them can hide all nine.
                */}
                <nav className={styles.filters} aria-label="Narrow the resources by purpose or workflow">
                  {FILTERS.map(({ tag, group }) => (
                    <Fragment key={tag ?? "all"}>
                      {group ? <p className={styles.groupLabel}>{group}</p> : null}
                      <a id={`find-${tag ?? "all"}`} href={`#find-${tag ?? "all"}`}>
                        {tag ? RESOURCE_TAG_LABELS[tag] : "Everything"}
                      </a>
                    </Fragment>
                  ))}
                </nav>
                <div className="tiles">
                  {RESOURCE_LINKS.map((link) => {
                    const tags = [...link.purposes, ...link.workflows];
                    return (
                      <article className="tile" key={link.href} data-tags={tags.join(" ")}>
                        <h3><Link href={link.href as Route}>{link.label}</Link></h3>
                        <p>{DESCRIPTIONS[link.href]}</p>
                        {link.representativeCase ? (
                          <p className={styles.representative}>
                            Representative case — a real compiled result, published read-only.
                          </p>
                        ) : null}
                        {/*
                          BA-083 / BA-084. The tag line was the loudest thing in each tile and
                          the least informative: tracked 9.5px uppercase mono, longer than the
                          card's own description, wrapping to two lines on four of nine tiles,
                          and repeating the filter the reader had just used. It was also the same
                          seven labels the filter above prints in sentence case, so one page
                          showed one vocabulary in two casings and the filter's words did not
                          look like the tiles' words.

                          The filter already encodes what these said, so they are gone rather
                          than restyled, and the space goes to the card's action link -- the card
                          anatomy /product already uses.
                        */}
                        <p className={styles.tileAction}>
                          <Link href={link.href as Route}>Open →</Link>
                        </p>
                      </article>
                    );
                  })}
                </div>
              </div>

              {/*
                BA-082. The hub ended at the closing div of the tile grid: no action, no next
                step, no closing line, and 200px of dead space before the footer. It was the one
                page in this lens that simply stopped, having handed a reader nine descriptions
                and nothing to do with them. The action row is the one its sibling pages carry.
              */}
              <div className="actions">
                <Link className="btn" href="/explore">Explore a compiled world</Link>
                <Link className="btn ghost" href={"/docs/quickstart" as Route}>Read the quickstart</Link>
              </div>
              <p className="fine">
                Building something specific? The exact contract is in the{" "}
                <Link href="/docs">documentation</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
