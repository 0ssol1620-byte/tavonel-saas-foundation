import { Fragment } from "react";
import Link from "next/link";
import type { Route } from "next";
import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { articleReadMinutes } from "@/components/v34/ui/article-layout";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { surfaceClass } from "@/components/v34/ui/surface";
import { RESOURCE_LINKS, RESOURCE_TAG_LABELS } from "@/lib/site-navigation";
import { V34_LIVE_ROUTES, v34Route, type V34RouteKey } from "@/lib/v34/routes";
import { COMPILER_BLOCKS } from "../journal-compiler/compiler-article";
import { MCP_BLOCKS } from "../journal-mcp/mcp-article";
import { RESEARCH_BLOCKS } from "../journal-research/research-article";
import { REVISION_BLOCKS } from "../journal-revision/revision-article";
import { COVERS } from "./covers";
import { CATEGORY, FEATURED, FINAL, GUIDES, HERO, HUB, HUB_FILTERS, REFERENCE, REFERENCE_ONLY, hubEntry } from "./journal-content";
import s from "./journal.module.css";

const ROUTE = "journal";
const record = v34Route(ROUTE);

/**
 * Read time per article, counted from the words each article prints. An article whose body is not
 * listed here shows no read time on its card rather than a number somebody typed.
 */
export const READ_MINUTES: Partial<Record<V34RouteKey, number>> = {
  "journal-compiler": articleReadMinutes(COMPILER_BLOCKS),
  "journal-mcp": articleReadMinutes(MCP_BLOCKS),
  "journal-revision": articleReadMinutes(REVISION_BLOCKS),
  "journal-research": articleReadMinutes(RESEARCH_BLOCKS),
};

/** The live journal articles, in registry order. A held article has no card. */
export const LIVE_ARTICLES = V34_LIVE_ROUTES.filter((route) => route.schema === "Article");

function Card({ articleKey }: { articleKey: V34RouteKey }) {
  const article = v34Route(articleKey);
  const category = CATEGORY[articleKey];
  const Cover = COVERS[articleKey];
  if (!category || !Cover) throw new Error(`journal: the live article ${articleKey} has no category or cover`);
  const minutes = READ_MINUTES[articleKey];
  return (
    <li className={s.item}>
      <Link className={`${surfaceClass("nestedLight")} ${s.card}`} href={article.path} prefetch={false}>
        <span className={s.cover}><Cover /></span>
        <span className={s.meta}>{category}{minutes ? <span className={s.minutes}> / {minutes} min read</span> : null}</span>
        <h3 className={s.cardTitle}>{article.heading}</h3>
        <span className={s.cardText}>{article.description}</span>
        <span className={s.cardAction}>{GUIDES.read}</span>
      </Link>
    </li>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function JournalBody() {
  const Cover = COVERS[FEATURED];
  if (!Cover) throw new Error(`journal: the featured article ${FEATURED} has no cover`);
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={<ButtonLink href={v34Route(FEATURED).path}>{HERO.action}</ButtonLink>}
        art={<Figure art={<Cover />} caption={HERO.figure} />}
      />

      <Section surface="paper" eyebrow={GUIDES.eyebrow} title={GUIDES.title} lead={GUIDES.lead}>
        <ul className={s.grid}>
          {LIVE_ARTICLES.filter((article) => article.key !== FEATURED).map((article) => (
            <Card key={article.key} articleKey={article.key} />
          ))}
        </ul>
      </Section>

      <Section surface="cases" eyebrow={REFERENCE.eyebrow} title={REFERENCE.title} lead={REFERENCE.lead}>
        <div className={s.hub}>
          <nav className={s.filters} aria-label={HUB.label}>
            {HUB_FILTERS.map(({ tag, group }) => (
              <Fragment key={tag ?? "all"}>
                {group ? <p className={s.groupLabel}>{group}</p> : null}
                <a id={`find-${tag ?? "all"}`} className={s.filter} href={`#find-${tag ?? "all"}`}>
                  {tag ? RESOURCE_TAG_LABELS[tag] : HUB.all}
                </a>
              </Fragment>
            ))}
          </nav>
          <ul className={s.reference}>
            {RESOURCE_LINKS.map((link) => {
              const entry = hubEntry(link);
              return (
                <li key={link.href} className={s.referenceItem} data-tags={[...link.purposes, ...link.workflows].join(" ")}>
                  <h3 className={s.referenceTitle}>
                    <Link className={s.referenceLink} href={link.href as Route} prefetch={false}>{entry.label}</Link>
                  </h3>
                  <p className={s.referenceText}>{entry.text}</p>
                  {link.representativeCase ? <p className={s.referenceNote}>{HUB.representative}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
        {REFERENCE_ONLY.length > 0 ? (
          <ul className={`${s.reference} ${s.referenceAfter}`}>
            {REFERENCE_ONLY.map((item) => (
              <li key={item.href} className={s.referenceItem}>
                <h3 className={s.referenceTitle}>
                  <Link className={s.referenceLink} href={item.href} prefetch={false}>{item.label}</Link>
                </h3>
                <p className={s.referenceText}>{item.text}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <FinalCta title={FINAL.title} />
    </>
  );
}

/** The journal index, inside the V34 frame. */
export default function Journal() {
  return (
    <V34Page route={ROUTE}>
      <RouteJsonLd route={ROUTE} />
      <JournalBody />
    </V34Page>
  );
}
