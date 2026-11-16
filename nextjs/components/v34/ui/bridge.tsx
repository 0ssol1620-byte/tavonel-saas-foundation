import { ButtonLink } from "./button-link";
import { surfaceClass } from "./surface";
import { Eyebrow } from "./text";
import s from "./bridge.module.css";

/** A band that sends the reader from a product page to its field guide in the journal. */
export function Bridge({ eyebrow = "Field guide", title, text, href, label }: {
  eyebrow?: string;
  title: string;
  text?: string;
  href: string;
  label: string;
}) {
  return (
    <section className={`${surfaceClass("bridge")} ${s.band}`} aria-labelledby="v34-bridge-title">
      <div className={s.shell}>
        <div className={s.copy}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id="v34-bridge-title" className={s.title}>{title}</h2>
          {text ? <p className={s.text}>{text}</p> : null}
        </div>
        <ButtonLink href={href} tone="secondary">{label}</ButtonLink>
      </div>
    </section>
  );
}
