import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompileStagePlayer, { STAGE_FRAMES, toggleMobileFilmFit, type MobileFilmView } from "@/components/compile-stage-player";
import HeroFilm from "@/components/landing-v2/hero-film";
import { LANDING_MOBILE_FILM_VIEW } from "@/components/landing-v2/hero-film-disclosure";
import { COMPILE_STAGES } from "@/lib/compile-stages";

/*
  The frame cross-check (redesign-r2-20261015/FILM-STRING-CROSSCHECK.md), reduced to the strings
  and the sampled seconds each one is on screen. A quoted string that is not in it, or is on screen
  for under 80% of the loop, fails here -- the Release 1 line named a string visible 2 of 10 times.
*/
const crossCheck = JSON.parse(readFileSync(new URL("./compile-stage-player.frame-strings.json", import.meta.url), "utf8")) as {
  times: number[];
  stages: Record<string, { cut: string; strings: Record<string, { pane: string; visibleAt: number[] }> }>;
};

describe("film reading layer (brief 2026-10-15 move 2b/2c)", () => {
  it("quotes, per stage, a string the cross-check table shows on screen for >= 80% of the loop", () => {
    for (const stage of COMPILE_STAGES) {
      const frame = STAGE_FRAMES[stage.id];
      expect(frame, stage.id).toBeDefined();
      const target = frame!.readingTarget;
      const row = crossCheck.stages[stage.id]?.strings[target.text];
      expect(row, `${stage.id}: "${target.text}" is not in the cross-check table`).toBeDefined();
      expect(row!.visibleAt.length / crossCheck.times.length, stage.id).toBeGreaterThanOrEqual(0.8);
      expect(frame!.panes, stage.id).toContain(row!.pane);
      // Both lines carry the quote exactly once and name the pane it sits in; KO quotes the frame.
      for (const line of [target.line, target.lineKo]) {
        expect(line.split("{q}"), `${stage.id}: ${line}`).toHaveLength(2);
        expect(line, stage.id).toContain(row!.pane);
        // Entry pages carry no unreceipted figures (lib/landing-v2-page.test.ts).
        expect(line, stage.id).not.toMatch(/\d/);
      }
    }
  });

  it("names the locked cut each stage plays", () => {
    for (const stage of COMPILE_STAGES) expect(stage.src).toBe(`/film/${crossCheck.stages[stage.id]!.cut}`);
  });

  it("renders the reading line below the frame only on the Home story layout", () => {
    const story = renderToStaticMarkup(<CompileStagePlayer storyLayout />);
    expect(story).toContain("data-film-reading");
    expect(story).toMatch(/The ORIGINAL pane opens one source page at a time; EXTRACT writes it out in <q[^>]*>WORKING COPY\.md<\/q>\./);
    expect(story.indexOf("data-film-reading")).toBeGreaterThan(story.indexOf('class="compile-film-viewport"'));
    // The strip only repeats the line's pane name outside a panning phone.
    expect(story).toMatch(/<ol[^>]*aria-hidden="true"[^>]*><li>SOURCES<\/li><li data-marked="1">ORIGINAL<\/li>/);
    expect(renderToStaticMarkup(<CompileStagePlayer />)).not.toContain("data-film-reading");

    const ko = renderToStaticMarkup(<CompileStagePlayer storyLayout korean />);
    expect(ko).toMatch(/EXTRACT 패널은 그 내용을 <q[^>]*lang="en"[^>]*>WORKING COPY\.md<\/q>에 옮겨 적습니다\./);
  });

  it("gives only the Home tab row the compact-group class", () => {
    expect(renderToStaticMarkup(<CompileStagePlayer storyLayout />)).toMatch(/<div class="compile-film-stages [^"]+" role="tablist"/);
    expect(renderToStaticMarkup(<CompileStagePlayer />)).toContain('<div class="compile-film-stages" role="tablist"');
  });

  it("opens Focus details on the reading-target pane, not SOURCES", () => {
    const markup = renderToStaticMarkup(<CompileStagePlayer storyLayout preferVideo initialMobileFilmView="focus" />);
    expect(markup).toContain('data-mobile-focus-pane="1"');
    expect(STAGE_FRAMES.sources!.panes[1]).toBe("ORIGINAL");
  });

  it("keeps the hero's illustrative label and adds the reading line in both locales", () => {
    const en = renderToStaticMarkup(<HeroFilm />);
    expect(en).toContain("Illustrative product demo · examples, not customer results.");
    expect(en).toContain("WORKING COPY.md");
    const ko = renderToStaticMarkup(<HeroFilm korean />);
    expect(ko).toContain("제품 흐름 예시 · 실제 고객 결과가 아닙니다.");
    expect(ko).toContain("옮겨 적습니다");
  });
});

/*
  Every caller opens a phone on the whole frame unless it asks for the focus pane; the landing
  disclosure asks for fit explicitly. Server rendering runs no effects, so what is asserted here
  is the player's initial state only.
*/

const view = (fit: boolean): MobileFilmView => (fit ? "fit" : "focus");

function focusControl(markup: string) {
  const match = markup.match(/<button([^>]*class="compile-film-focus-control"[^>]*)>([^<]*)<\/button>/);
  expect(match).not.toBeNull();
  return { attrs: match![1]!, label: match![2]! };
}

function expectFit(markup: string) {
  expect(markup).toContain('data-mobile-view="fit"');
  const control = focusControl(markup);
  expect(control.label).toBe("Focus details");
  expect(control.attrs).toContain('aria-pressed="false"');
  expect(markup).toContain("Full frame · Focus details to inspect small type.");
}

describe("mobile film view", () => {
  it("opens on fit when a caller omits initialMobileFilmView", () => {
    expectFit(renderToStaticMarkup(<CompileStagePlayer />));
  });

  it("the landing disclosure selects fit explicitly", () => {
    expect(LANDING_MOBILE_FILM_VIEW).toBe("fit");
    const source = readFileSync(new URL("./landing-v2/hero-film-disclosure.tsx", import.meta.url), "utf8");
    expect(source).toContain("initialMobileFilmView={LANDING_MOBILE_FILM_VIEW}");
    expectFit(renderToStaticMarkup(<CompileStagePlayer preferVideo initialMobileFilmView={LANDING_MOBILE_FILM_VIEW} />));
  });

  it("opens on focus only when a caller asks for it", () => {
    const markup = renderToStaticMarkup(<CompileStagePlayer preferVideo initialMobileFilmView="focus" />);
    expect(markup).toContain('data-mobile-view="focus"');
    const control = focusControl(markup);
    expect(control.label).toBe("Fit full frame");
    expect(control.attrs).toContain('aria-pressed="true"');
    expect(markup).toContain("Focused view · Swipe or use arrow keys to inspect the frame.");
  });

  it("names both views in Korean", () => {
    const fit = renderToStaticMarkup(<CompileStagePlayer preferVideo korean />);
    expect(fit).toContain('data-mobile-view="fit"');
    expect(focusControl(fit).label).toBe("세부 내용 확대");
    expect(fit).toContain("전체 프레임 · 작은 글자는 세부 내용 확대에서 확인하세요.");

    const focus = renderToStaticMarkup(<CompileStagePlayer preferVideo korean initialMobileFilmView="focus" />);
    expect(focus).toContain('data-mobile-view="focus"');
    expect(focusControl(focus).label).toBe("전체 프레임 보기");
    expect(focus).toContain("확대 보기 · 옆으로 밀거나 방향키로 화면을 살펴보세요.");
  });

  it("toggles fit -> focus -> fit with the toggle's own updater", () => {
    let fit = true;
    expect(view(fit)).toBe("fit");
    fit = toggleMobileFilmFit(fit);
    expect(view(fit)).toBe("focus");
    fit = toggleMobileFilmFit(fit);
    expect(view(fit)).toBe("fit");
  });
});
