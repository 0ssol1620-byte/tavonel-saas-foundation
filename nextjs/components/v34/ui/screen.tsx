import type { HTMLAttributes, ReactNode } from "react";
import s from "./screen.module.css";

/*
  The product "screen" frame (TARGET-DESIGN-SYSTEM §5): `.screen > .screen-top (title + tag with a
  status dot) + .screen-body + .screen-foot`. The signed-in workspace draws its work surfaces in it
  (WO-WS-4); no public route renders it, so no public page's CSS changes.

  The tag is the surface's actual state, never a decoration: a screen without a state is refused,
  and so is a tone this file does not draw. The dot is the tone's shape (filled for ok and stopped,
  a ring for waiting) so it reads without colour; the words beside it carry the meaning.
*/

export const SCREEN_TONES = ["ok", "waiting", "stopped"] as const;
export type ScreenTone = (typeof SCREEN_TONES)[number];
export type ScreenStatus = { tone: ScreenTone; label: string };

type Props = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  /** A short label naming what the screen shows. A heading, when the screen's own heading is that label. */
  title: string;
  titleAs?: "span" | "h2";
  titleId?: string;
  status: ScreenStatus;
  /** `output` where the state was already announced as one (the activation block's). */
  statusAs?: "span" | "output";
  foot?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
};

/** Refuses a status the frame cannot draw honestly: an unknown tone, or no words for it. */
export function assertScreenStatus(status: ScreenStatus): ScreenStatus {
  if (!status || !(SCREEN_TONES as readonly string[]).includes(status.tone)) throw new Error("screen_status_tone_unknown");
  if (typeof status.label !== "string" || status.label.trim().length === 0) throw new Error("screen_status_label_missing");
  return status;
}

export function Screen({
  title, titleAs = "span", titleId, status, statusAs = "span", foot, bodyClassName, className, children, ...rest
}: Props) {
  const { tone, label } = assertScreenStatus(status);
  if (title.trim().length === 0) throw new Error("screen_title_missing");
  const Title = titleAs;
  const Tag = statusAs;
  return (
    <section {...rest} className={className ? `${s.screen} ${className}` : s.screen} data-v34-screen="">
      <div className={s.top}>
        <Title id={titleId} className={s.title}>{title}</Title>
        <Tag className={s.tag} data-tone={tone}><i className={s.dot} data-tone={tone} aria-hidden="true" />{label}</Tag>
      </div>
      <div className={bodyClassName ? `${s.body} ${bodyClassName}` : s.body}>{children}</div>
      {foot ? <div className={s.foot}>{foot}</div> : null}
    </section>
  );
}
