import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import s from "./button-link.module.css";

export type ButtonTone = "primary" | "secondary" | "onDark";

const EXTERNAL = /^https?:\/\//;
const NON_ROUTE = /^(?:https?:|mailto:)/;

/**
 * A link that looks like a button. Primary is the dark pill, secondary draws its colours from the
 * surface it sits on, onDark is the lime pill for dark scenes. Height is at least 44px.
 * `disabled` renders a non-interactive span, because a link cannot be disabled.
 */
export function ButtonLink({ href, tone = "primary", disabled = false, analytics, children }: {
  href: string;
  tone?: ButtonTone;
  disabled?: boolean;
  analytics?: string;
  children: ReactNode;
}) {
  const className = `${s.button} ${s[tone]}`;
  if (disabled) return <span className={`${className} ${s.disabled}`} aria-disabled="true">{children}</span>;
  if (EXTERNAL.test(href)) {
    return (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer" data-analytics={analytics}>
        {children}<span className={s.visuallyHidden}> (opens in a new tab)</span>
      </a>
    );
  }
  if (NON_ROUTE.test(href)) return <a className={className} href={href} data-analytics={analytics}>{children}</a>;
  return <Link className={className} href={href as Route} data-analytics={analytics} prefetch={false}>{children}</Link>;
}
