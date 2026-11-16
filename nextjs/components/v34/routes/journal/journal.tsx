import Link from "next/link";
import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { articleReadMinutes } from "@/components/v34/ui/article-layout";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { surfaceClass } from "@/components/v34/ui/surface";
import { V34_LIVE_ROUTES, v34Route, type V34RouteKey } from "@/lib/v34/routes";
import { COMPILER_BLOCKS } from "../journal-compiler/compiler-article";
import { MCP_BLOCKS } from "../journal-mcp/mcp-article";
import { COVERS } from "./covers";
import { CATEGORY, FEATURED, FINAL, GUIDES, HERO, REFERENCE } from "./journal-content";
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
        <h3 className={s.cardTitle}>{article.title.replace(/ — TAVONEL$/, "")}</h3>
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
        title={record.title.replace(/ — TAVONEL$/, "")}
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
        <ul className={s.reference}>
          {REFERENCE.items.map((item) => (
            <li key={item.href} className={s.referenceItem}>
              <h3 className={s.referenceTitle}>
                <Link className={s.referenceLink} href={item.href} prefetch={false}>{item.label}</Link>
              </h3>
              <p className={s.referenceText}>{item.text}</p>
            </li>
          ))}
        </ul>
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
