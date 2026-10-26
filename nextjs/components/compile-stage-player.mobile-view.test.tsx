import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompileStagePlayer, { FILM_POSTER_SIZES, STAGE_FRAMES, nextWideChoice, stillTookAvif, toggleMobileFilmFit, wideChoiceOnStageChange, type MobileFilmView, type WideView } from "@/components/compile-stage-player";
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
  cropCheck: { stages: Record<string, { text: string; box: { x: number; w: number; h: number }; yAt: Record<string, number[]> }> };
  blankScan: { threshold: number; blankAt: number; stages: Record<string, { crop: { x: number; y: number }; frames: number; inkBoth: number; share: number; defaultView: "crop" | "fit" }> };
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
    expect(story).toMatch(/<ol[^>]*aria-hidden="true"[^>]*><li>SOURCES<\/li><li data-marked="1"[^>]*>ORIGINAL<\/li>/);
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
    expect(en).toContain("Illustrative demo · not customer results.");
    expect(en).toContain("WORKING COPY.md");
    const ko = renderToStaticMarkup(<HeroFilm korean />);
    expect(ko).toContain("제품 흐름 예시 · 고객 결과가 아닙니다.");
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
    // Fix round 3 (M1): one toggle -- the label names the action and stays; pressed = Focus on screen.
    expect(control.label).toBe("Focus details");
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
    expect(focusControl(focus)).toEqual({ attrs: expect.stringContaining('aria-pressed="true"'), label: "세부 내용 확대" });
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

/*
  Release 3 (brief move 2c, §5.3). The Home desktop opens on a 2x crop of each stage; the window
  has to hold the string the reading line quotes for the whole loop, not for the poster alone, so
  it is checked against where that string sits in every sampled second of its cut (cropCheck).
*/
describe("Home Focus crop and re-cut posters (Release 3)", () => {
  it("keeps each quoted string inside its stage's 2x window at every sampled second", () => {
    for (const stage of COMPILE_STAGES) {
      const frame = STAGE_FRAMES[stage.id]!;
      const row = crossCheck.cropCheck.stages[stage.id];
      expect(row, stage.id).toBeDefined();
      expect(row!.text).toBe(frame.readingTarget.text);
      // At 2x the window is half the 2880x1800 frame each way, starting at crop.x / crop.y.
      const x0 = frame.crop.x * 2880, y0 = frame.crop.y * 1800;
      expect(y0 + 900, stage.id).toBeLessThanOrEqual(1800);
      expect(row!.box.x, stage.id).toBeGreaterThanOrEqual(x0);
      expect(row!.box.x + row!.box.w, stage.id).toBeLessThanOrEqual(x0 + 1440);
      const inside = crossCheck.times.filter(t => (row!.yAt[String(t)] ?? []).some(y => y >= y0 && y + row!.box.h <= y0 + 900));
      expect(inside, stage.id).toEqual(crossCheck.times);
      // The pane the line names is one of the two the window shows.
      expect([frame.crop.x * 4, frame.crop.x * 4 + 1], stage.id).toContain(frame.readingTarget.pane);
    }
  });

  it("opens the Home film on the crop with a pressed Focus details toggle, and names only the window's panes", () => {
    const en = renderToStaticMarkup(<HeroFilm />);
    expect(en).toContain('data-wide-view="crop"');
    expect(en).toContain("--film-crop-x:25%;--film-crop-y:50%");
    // Fix round 3 (M1): the pressed state is the visible state -- the crop is on screen, so pressed.
    expect(en).toMatch(/<button type="button" class="compile-film-view-control [^"]+" aria-controls="[^"]+" aria-pressed="true">Focus details<\/button>/);
    expect(en).toMatch(/<li>SOURCES<\/li><li data-marked="1" data-in-crop="1">ORIGINAL<\/li><li data-in-crop="1">EXTRACT<\/li><li>WORLD<\/li>/);
    // The phone keeps Fit as its default (brief §2); only the desktop view starts cropped (R3-D1).
    expect(en).toContain('data-mobile-view="fit"');
    // The phone toggle in Fit: same label, not pressed.
    expect(focusControl(en)).toEqual({ attrs: expect.stringContaining('aria-pressed="false"'), label: "Focus details" });
    expect(renderToStaticMarkup(<HeroFilm korean />)).toMatch(/class="compile-film-view-control [^"]+" aria-controls="[^"]+" aria-pressed="true">세부 내용 확대<\/button>/);
    // On Home the motion control names its next action and carries no pressed state (M1).
    expect(en).toMatch(/<button type="button" class="compile-film-motion-control" data-control="pause" aria-label="Pause the compilation film">/);
    const plain = renderToStaticMarkup(<CompileStagePlayer />);
    for (const homeOnly of ["data-wide-view", "compile-film-view-control", "--film-crop-x", "data-in-crop"]) expect(plain).not.toContain(homeOnly);
  });

  /*
    Fix round 3 (B1). A stage opens on the 2x crop only where the crop stays inked: the blank scan of
    every presented frame over the stage's whole window (blankScan in the frame-strings table,
    redesign-r3-20261015/fix2/BLANK-SCAN-2.json) must show ink in both panes for >= threshold of the
    frames. A new crop window, or a crop default on a stage that fails, fails here until it is
    re-scanned and recorded.
  */
  it("opens each stage cropped only where the blank scan of that exact window clears the threshold", () => {
    const scan = crossCheck.blankScan;
    expect(scan.threshold).toBe(0.85);
    expect(scan.blankAt).toBe(0.99);
    for (const stage of COMPILE_STAGES) {
      const frame = STAGE_FRAMES[stage.id]!;
      const row = scan.stages[stage.id];
      expect(row, stage.id).toBeDefined();
      expect(row!.crop, stage.id).toEqual(frame.crop);
      expect(row!.share, stage.id).toBeCloseTo(row!.inkBoth / row!.frames, 3);
      expect(frame.wideView, stage.id).toBe(row!.defaultView);
      if (frame.wideView === "crop") expect(row!.share, `${stage.id} opens cropped`).toBeGreaterThanOrEqual(scan.threshold);
    }
    // The failure path this guards: stage 4's window on "nodes lit" leaves TERMINAL blank for ~11 s.
    expect(scan.stages.world!.share).toBeLessThan(scan.threshold);
    expect(STAGE_FRAMES.world!.wideView).toBe("fit");
  });

  /*
    Fix round 4 (M1). The desktop toggle's choice is kept relative to the stage default. The player's
    own two transitions are walked here: a press (nextWideChoice) and a stage change
    (wideChoiceOnStageChange); what the stage shows is the choice, else the stage default.
  */
  it("keeps the view choice relative to the stage default, so stage 4 never inherits a crop", () => {
    const ids = COMPILE_STAGES.map(stage => stage.id);
    const defaults = ids.map(id => STAGE_FRAMES[id]!.wideView);
    expect(defaults).toEqual(["crop", "crop", "crop", "fit"]);
    let stage = 0;
    let choice: WideView | null = null;
    const shown = () => choice ?? defaults[stage]!;
    const press = () => { choice = nextWideChoice(shown(), defaults[stage]!); };
    const go = (next: number) => { if (next !== stage) choice = wideChoiceOnStageChange(choice); stage = next; };

    // The critic's walk: Fit -> Focus on stage 1, then stage 4. The round trip records nothing.
    press();
    expect([shown(), choice]).toEqual(["fit", "fit"]);
    press();
    expect([shown(), choice]).toEqual(["crop", null]);
    go(3);
    expect(shown()).toBe("fit");

    // Focus asked for on stage 4 stays on stage 4 (its own tab again included) ...
    press();
    expect([shown(), choice]).toEqual(["crop", "crop"]);
    go(3);
    expect(shown()).toBe("crop");
    // ... and clears with the stage: stage 1 is on its default, and stage 4 is Fit again.
    go(0);
    expect([shown(), choice]).toEqual(["crop", null]);
    go(3);
    expect(shown()).toBe("fit");

    // A Fit asked for holds across stages; pressing back to a stage's default clears it.
    go(1);
    press();
    expect(shown()).toBe("fit");
    go(2);
    expect(shown()).toBe("fit");
    go(3);
    expect(shown()).toBe("fit");
    go(0);
    press();
    expect([shown(), choice]).toEqual(["crop", null]);

    // The two pure transitions on their own.
    expect(nextWideChoice("crop", "crop")).toBe("fit");
    expect(nextWideChoice("fit", "crop")).toBeNull();
    expect(nextWideChoice("fit", "fit")).toBe("crop");
    expect(nextWideChoice("crop", "fit")).toBeNull();
    expect([wideChoiceOnStageChange("crop"), wideChoiceOnStageChange("fit"), wideChoiceOnStageChange(null)]).toEqual([null, "fit", null]);
  });

  it("wires the desktop toggle and the stage change through those two transitions", () => {
    const source = readFileSync(new URL("./compile-stage-player.tsx", import.meta.url), "utf8");
    expect(source).toContain('onClick={() => setWideChoice(nextWideChoice(wideFit ? "fit" : "crop", stageFrame?.wideView ?? "crop"))}');
    expect(source).toContain("if (wrapped !== index) setWideChoice(wideChoiceOnStageChange);");
    expect(source).toContain('const wideFit = (wideChoice ?? stageFrame?.wideView ?? "crop") === "fit";');
  });

  it("serves the stage-1 re-cut poster at 2x for the crop and 1x for a phone in Fit, masked only on its own frame", () => {
    const en = renderToStaticMarkup(<HeroFilm />);
    const still = en.match(/<img[^>]*class="compile-film-still"[^>]*>/)?.[0] ?? "";
    // POSTER-RECUT (D-11): the WebP pair of t = 8.16s is the <img>, the fallback inside the <picture>.
    expect(still).toContain('src="/film/poster-1-t8.16-2x.webp"');
    expect(still).toMatch(/srcSet="\/film\/poster-1-t8\.16\.webp 1440w, \/film\/poster-1-t8\.16-2x\.webp 2880w"/i);
    expect(still).toContain(`sizes="${FILM_POSTER_SIZES}"`);
    // ...and the AVIF pair of the same frame is the <source> ahead of it, with the same sizes.
    const picture = en.match(/<picture[^>]*>([\s\S]*?)<\/picture>/)?.[1] ?? "";
    expect(picture.indexOf("<source")).toBe(0);
    expect(picture).toMatch(/<source type="image\/avif" srcSet="\/film\/poster-1-t8\.16\.avif 1440w, \/film\/poster-1-t8\.16-2x\.avif 2880w" sizes="[^"]+"\/?>/i);
    expect(picture).toContain(still);
    expect(en).toContain('data-poster-mask="/film/poster-1-t8.16-2x.webp"');
    // The mask is bound to the poster it was measured on: any other stage-1 poster draws none.
    expect(renderToStaticMarkup(<CompileStagePlayer storyLayout />)).not.toContain("data-poster-mask");
    expect(STAGE_FRAMES.sources!.posterMask!.rects.every(rect => rect.x + rect.w <= 2880 && rect.y + rect.h <= 1800)).toBe(true);
  });

  /*
    SPECIMEN merge review A1 (2026-10-25). The <video poster> names the still's format only once the
    still has reported AVIF, and the mount effect reads `currentSrc` once -- empty in Chromium until
    the image has data. With the specimen strip on, the poster is lazy and unpreloaded, so it often
    has no data yet at mount, and the <video> would fetch the WebP copy of a frame it already holds.
    The still's own load event reports the format too.
  */
  it("takes the still's AVIF format from its load event as well as at mount (merge review A1)", () => {
    expect(stillTookAvif({ currentSrc: "https://tavonel.com/film/poster-1-t8.16-2x.avif" })).toBe(true);
    expect(stillTookAvif({ currentSrc: "https://tavonel.com/film/poster-1-t8.16-2x.webp" })).toBe(false);
    // Chromium before the image has data: nothing chosen yet, so nothing recorded.
    expect(stillTookAvif({ currentSrc: "" })).toBe(false);
    expect(stillTookAvif(null)).toBe(false);
    const source = readFileSync(new URL("./compile-stage-player.tsx", import.meta.url), "utf8");
    expect(source).toContain("if (still && stillTookAvif(stillRef.current)) setPosterAvifTaken(true);");
    expect(source).toContain("onLoad={(event) => { if (stillTookAvif(event.currentTarget)) setPosterAvifTaken(true); }}");
  });
});
