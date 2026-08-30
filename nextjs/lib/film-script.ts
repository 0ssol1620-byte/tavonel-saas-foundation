/**
 * Spoken track. 16s shareable cut. Only the end card is on screen.
 */
import { CHANGE, KEPT, REBUILT, WORLD, n } from "./demo-world";

export const FILM_DURATION = 16;

export const FILM_ACT = {
  drop: 0,
  classify: 1.5,
  ocr: 3.5,
  markdown: 5.5,
  directory: 8.0,
  world: 9.5,
  change: 11.5,
  end: 14.2,
  stop: FILM_DURATION,
} as const;

export type FilmCaption = { at: number; until: number; kicker?: string; line: string; sub?: string };

export const FILM_CAPTIONS: FilmCaption[] = [
  {
    at: 0,
    until: FILM_ACT.ocr,
    kicker: "EXAMPLE",
    line: "This is the mess.",
    sub: "The files stay. They are already yours.",
  },
  {
    at: FILM_ACT.ocr,
    until: FILM_ACT.world,
    kicker: "EXAMPLE",
    line: "Read. Resolve. Compile.",
    sub: "Nothing waits for the lens.",
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
