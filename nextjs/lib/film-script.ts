/**
 * Spoken track. 16s shareable cut. Only the end card is on screen.
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
    sub: "Drive, original, extract, world — four rooms, already working.",
  },
  {
    at: FILM_ACT.ocr,
    until: FILM_ACT.markdown,
    kicker: "EXAMPLE",
    line: "Originals keep changing form.",
    sub: "Contract. Scan. Sheet. Handbook. Not one page on a loop.",
  },
  {
    at: FILM_ACT.markdown,
    until: FILM_ACT.world,
    kicker: "EXAMPLE",
    line: "Scan reveals. Markdown cites.",
    sub: "A table becomes rows. A figure becomes a caption. The picture does not copy.",
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
    kicker: "TAVONEL",
    line: "The files stayed. The world compiled.",
    sub: "One world. Every AI.",
  },
];
