import s from "./config-block.module.css";

/**
 * A short block of configuration text. It is a focusable named region, so a keyboard reader can
 * scroll a long line, and it prints plain text on one dark surface: no syntax colours to contrast-check.
 */
export function ConfigBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className={s.region} role="region" tabIndex={0} aria-label={label} data-v34-scroll="">
      <pre className={s.code}><code>{text}</code></pre>
    </div>
  );
}
