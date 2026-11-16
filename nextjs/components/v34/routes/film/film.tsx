import Link from "next/link";
import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { FILM, FRAMES } from "./film-content";
import { FilmArt } from "./film-art";
import s from "./film.module.css";

const KEY = "film";

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function FilmBody() {
  const action = createWorldAction();
  return (
    <>
      <Hero
        variant="split"
        eyebrow={FILM.eyebrow}
        title={v34Route(KEY).heading}
        lead={FILM.lead}
        actions={<ButtonLink href={action.href} tone="primary">{action.label}</ButtonLink>}
        art={<Figure kind="Storyboard" art={<FilmArt />} caption="Storyboard frames: source, evidence, answer." />}
      />
      <Section surface="paper" title={FILM.frames.title} lead={FILM.frames.lead}>
        <ol className={s.frames}>
          {FRAMES.map((f, i) => (
            <li key={f.route} className={s.frame}>
              <RecordCard kind={`Frame ${String(i + 1).padStart(2, "0")}`} label={f.label}>
                <p>{f.text}</p>
                <Link className={s.link} href={v34Route(f.route).path} prefetch={false}>{f.link}</Link>
              </RecordCard>
            </li>
          ))}
        </ol>
      </Section>
      <FinalCta title={FILM.final} />
    </>
  );
}

export default function Film() {
  return (
    <V34Page route={KEY}>
      <RouteJsonLd route={KEY} />
      <FilmBody />
    </V34Page>
  );
}
