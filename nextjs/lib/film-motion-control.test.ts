import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILM_CONTROL_LABEL, filmMotionControl } from "@/components/compile-stage-player";

/*
  The one control on the landing film (film-01, film-02).

  It used to be rendered only when reduced motion was off, which is backwards: the two states in
  which the frame is a still that nothing will ever start -- `prefers-reduced-motion` and
  Save-Data -- were the two states with no control at all. These cases are the state machine; the
  Playwright side (`e2e/film-motion-control-audit.spec.ts`) is that the rendered button really
  starts the film.
*/
const source = readFileSync(join(process.cwd(), "components/compile-stage-player.tsx"), "utf8");
const state = (over: Partial<Parameters<typeof filmMotionControl>[0]> = {}) => ({
  reducedMotion: false,
  saveData: false,
  paused: false,
  playRequested: false,
  ...over,
});

describe("film motion control", () => {
  it("offers Play where the still is the preference, not a pause", () => {
    expect(filmMotionControl(state({ reducedMotion: true }))).toBe("play");
    expect(filmMotionControl(state({ saveData: true }))).toBe("play");
    expect(filmMotionControl(state({ reducedMotion: true, saveData: true }))).toBe("play");
    // Even while the visitor is also in a paused state: nothing is running to resume.
    expect(filmMotionControl(state({ reducedMotion: true, paused: true }))).toBe("play");
  });

  it("offers Resume once a playing film has been paused", () => {
    expect(filmMotionControl(state({ paused: true }))).toBe("resume");
    // A lifted preference behaves like any other playback from then on.
    expect(filmMotionControl(state({ reducedMotion: true, playRequested: true, paused: true }))).toBe("resume");
  });

  it("offers Pause while the film is running", () => {
    expect(filmMotionControl(state())).toBe("pause");
    expect(filmMotionControl(state({ saveData: true, playRequested: true }))).toBe("pause");
  });

  it("says out loud which of the three it is", () => {
    expect(FILM_CONTROL_LABEL.play.label).toMatch(/^Play\b/);
    expect(FILM_CONTROL_LABEL.resume.label).toMatch(/^Resume\b/);
    expect(FILM_CONTROL_LABEL.pause.label).toMatch(/^Pause\b/);
    /*
      type-09. The mark is drawn, not typed: the record carries no glyph any more, so the guard
      follows it to the SVG the control renders. A text glyph coming back would fail here.
    */
    expect(source).toContain("<FilmControlMark control={control} />");
    expect(source).toMatch(/<svg className="compile-film-motion-mark"[^>]*fill="currentColor"/);
    expect(source).toContain('<path d="M4 2.5 13 8 4 13.5Z" />');
    expect(source.match(/<rect x="[49]" y="2.5"/g)).toHaveLength(2);
    const rendered = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rendered, "no typed play/pause glyph in the control").not.toMatch(/[\u25AE\u25B6\u2161]/);
  });

  it("is rendered in every state, and never behind a reduced-motion branch", () => {
    expect(source).not.toContain("{reducedMotion ? null : (");
    expect(source).toContain('className="compile-film-motion-control"');
    expect(source).toContain('data-control={control}');
  });

  it("never lets the page lift a preference on the visitor's behalf", () => {
    // `playRequested` has exactly one writer, and it is the control's own click handler.
    expect(source.match(/setPlayRequested\(/g)).toHaveLength(1);
    expect(source).toContain("const autoplay = (!reducedMotion && !saveData) || playRequested;");
  });
});
