/**
 * Spoken track. Locked four-up. Caption stays in the lower band, never a poster title.
 */
import { CHANGE, KEPT, REBUILT, WORLD, n } from "./demo-world";

export const FILM_DURATION = 18;

export const FILM_ACT = {
  drop: 0,
  classify: 2.0,
  ocr: 5.0,
  markdown: 8.0,
  directory: 11.0,
  world: 13.0,
  change: 15.0,
  end: 16.8,
  stop: FILM_DURATION,
} as const;

export type FilmCaption = { at: number; until: number; kicker?: string; line: string; sub?: string };

export const FILM_CAPTIONS: FilmCaption[] = [
  {
    at: 0,
    until: FILM_ACT.ocr,
    kicker: "EXAMPLE",
    line: "This is the mess.",
    sub: "Four rooms already at work. The files do not leave the drive.",
  },
  {
    at: FILM_ACT.ocr,
    until: FILM_ACT.markdown,
    kicker: "EXAMPLE",
    line: "A contract is not a spreadsheet.",
    sub: "Originals keep their shape: table, figure, stamp, sheet.",
  },
  {
    at: FILM_ACT.markdown,
    until: FILM_ACT.world,
    kicker: "EXAMPLE",
    line: "Scan writes a line. Markdown names it.",
    sub: "A table becomes rows. A figure becomes a caption.",
  },
  {
    at: FILM_ACT.world,
    until: FILM_ACT.end,
    kicker: "ONE WORLD",
    line: `${n(WORLD.facts)} facts.`,
    sub: `${CHANGE.changed} lines would move. ${REBUILT} rebuilt. ${n(KEPT)} left alone.`,
  },
  {
    at: FILM_ACT.end,
    until: Number.POSITIVE_INFINITY,
    kicker: "EXAMPLE",
    line: "The files stayed. The world compiled.",
    sub: "Declared fixture data. Not a customer run.",
  },
];
