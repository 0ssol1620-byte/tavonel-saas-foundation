import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { CONTRACT, EXAMPLE, FINAL, HERO_ACTIONS, TRUST } from "./skills-content";
import s from "./skills.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const record = v34Route("skills");

/** The route's own drawing: a manifest card with four checked fields and a gate before an action. */
function ManifestArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={CONTRACT.art.label} preserveAspectRatio="xMidYMid meet">
      <rect className={s.box} x="40" y="40" width="340" height="240" rx="12" />
      <path className={s.field} d="M76 90H250M76 140H300M76 190H220M76 240H280" />
      <path className={s.seal} d="M330 84L340 96L358 74M330 134L340 146L358 124M330 184L340 196L358 174M330 234L340 246L358 224" />
      <path className={s.seal} d="M380 160H470" />
      <path className={s.gate} d="M490 90V230" />
      <circle className={s.dot} cx="490" cy="160" r="10" />
      <rect className={s.box} x="530" y="130" width="70" height="60" rx="8" />
    </svg>
  );
}

export function SkillsBody() {
  return (
    <>
      <RouteJsonLd route="skills" />
      <Hero
        variant="sub"
        eyebrow={record.ogLabel}
        title={record.title.replace(/ — TAVONEL$/, "")}
        lead={record.description}
        actions={
          <>
            <ButtonLink href={HERO_ACTIONS.connect.href} tone="primary">{HERO_ACTIONS.connect.label}</ButtonLink>
            <ButtonLink href={HERO_ACTIONS.capabilities.href} tone="secondary">{HERO_ACTIONS.capabilities.label}</ButtonLink>
          </>
        }
      />

      <Section
        surface="dark"
        eyebrow={CONTRACT.eyebrow}
        title={CONTRACT.title}
        aside={<Figure art={<ManifestArt />} caption={CONTRACT.art.caption} />}
      >
        <div className={s.layers}>
          {CONTRACT.items.map((item) => (
            <div key={item.title} className={s.layer}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section surface="light" eyebrow={EXAMPLE.eyebrow} title={EXAMPLE.title} lead={EXAMPLE.lead}>
        <pre className={s.code} tabIndex={0} aria-label={EXAMPLE.manifestLabel}>{EXAMPLE.manifest}</pre>
      </Section>

      <Section surface="green" title={TRUST.title}>
        <ol className={s.facts}>
          {TRUST.rows.map((row, i) => (
            <li key={row.title} className={s.fact}>
              <span className={s.factNo}>{ordinal(i)}</span>
              <h3 className={s.factTitle}>{row.title}</h3>
              <p className={s.factText}>{row.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <FinalCta title={FINAL.title} secondary={FINAL.secondary} />
    </>
  );
}

export default function Skills() {
  return (
    <V34Page route="skills">
      <SkillsBody />
    </V34Page>
  );
}
