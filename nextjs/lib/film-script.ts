/**
 * Timing only. The four-up cut has no spoken caption — the columns are the copy.
 */
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

export const FILM_CAPTIONS: FilmCaption[] = [];
