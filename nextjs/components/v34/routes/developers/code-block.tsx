import { Fragment } from "react";
import { codeTokens } from "@/components/docs/code-tokens";
import s from "./code-block.module.css";

/**
 * One code sample on its own dark surface. The block scrolls inside a named, keyboard-focusable
 * region, so a long line never widens the page. Comments and string literals are set apart by
 * `codeTokens`, which keeps every character of the input.
 */
export function CodeBlock({ label, language, body }: { label: string; language: string; body: string }) {
  return (
    <figure className={s.block}>
      <figcaption className={s.language}>{language}</figcaption>
      <div className={s.region} role="region" tabIndex={0} aria-label={label} data-v34-scroll="">
        <pre className={s.pre}>
          {codeTokens(body).map((token, index) => (
            token.kind === "plain"
              ? <Fragment key={index}>{token.text}</Fragment>
              : <span key={index} className={token.kind === "string" ? s.string : s.comment}>{token.text}</span>
          ))}
        </pre>
      </div>
    </figure>
  );
}
