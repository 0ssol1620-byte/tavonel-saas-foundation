import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompileStagePlayer, { FILM_POSTER_SIZES, STAGE_FRAMES, nextWideChoice, stillTookAvif, toggleMobileFilmFit, wideChoiceOnStageChange, type MobileFilmView, type WideView } from "@/components/compile-stage-player";
import HeroFilm, { HOME_FILM_CUTS } from "@/components/landing-v2/hero-film";
import { LANDING_MOBILE_FILM_VIEW, LANDING_WIDE_FILM_VIEW } from "@/components/landing-v2/hero-film-disclosure";
import { COMPILE_STAGES } from "@/lib/compile-stages";

/*
  The frame cross-check (redesign-r2-20261015/FILM-STRING-CROSSCHECK.md), reduced to the strings
  and the sampled seconds each one is on screen. A quoted string that is not in it, or is on screen
  for under 80% of the loop, fails here -- the Release 1 line named a string visible 2 of 10 times.
*/
const crossCheck = JSON.parse(readFileSync(new URL("./compile-stage-player.frame-strings.json", import.meta.url), "utf8")) as {
  times: number[];
  stages: Record<string, { cut: string; strings: Record<string, { pane: string; visibleAt: number[] }> }>;
  cropCheck: { stages: Record<string, { text: string; box: { x: number; w: number; h: number }; yAt: Record<string, number[]>; insideWindow: number; holdsTarget: boolean }> };
  blankScan: { threshold: number; blankAt: number; stages: Record<string, { crop: { x: number; y: number }; frames: number; inkBoth: number; share: number; defaultView: "crop" | "fit" }> };
  phonePaneScan: {
    threshold: number; blankAt: number; rect: string;
    stages: Record<string, { phonePane: { x: number; y: number; w: number }; frames: number; blankFrames: number; share: number }>;
  };
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
      // Re-record (2026-11-05): the cuts are product screens with no drawn panes; the table names the quarter column.
      expect(frame!.panes, stage.id).toBeUndefined();
      expect(row!.pane, stage.id).toMatch(new RegExp(`^Q${target.pane + 1} `));
    }
  });

  it("names the re-recorded cut each Home stage plays", () => {
    COMPILE_STAGES.forEach((stage, index) => expect(HOME_FILM_CUTS[index], stage.id).toBe(`/film/${crossCheck.stages[stage.id]!.cut}`));
  });

  /*
    FINAL-SPEC 2026-10-26 (§6 #6, T13): the HTML reading line under the frame is gone. Film re-record (2026-11-05):
    the four cuts are product screens with their own headings, so no stage names panes and no pane strip is drawn.
  */
  it("renders no pane strip and no reading line on the re-recorded cuts", () => {
    const story = renderToStaticMarkup(<CompileStagePlayer storyLayout />);
    expect(story).not.toContain("data-film-reading");
    expect(renderToStaticMarkup(<CompileStagePlayer />)).not.toContain("data-film-reading");
    for (const markup of [story, renderToStaticMarkup(<CompileStagePlayer storyLayout korean />)]) {
      expect(markup).not.toContain("<q");
      expect(markup).not.toContain("WORKING COPY.md");
    }
  });

  it("gives only the Home tab row the compact-group class", () => {
    expect(renderToStaticMarkup(<CompileStagePlayer storyLayout />)).toMatch(/<div class="compile-film-stages [^"]+" role="tablist"/);
    expect(renderToStaticMarkup(<CompileStagePlayer />)).toContain('<div class="compile-film-stages" role="tablist"');
  });

  it("opens Focus details on the reading-target column", () => {
    const markup = renderToStaticMarkup(<CompileStagePlayer storyLayout preferVideo initialMobileFilmView="focus" />);
    expect(markup).toContain(`data-mobile-focus-pane="${STAGE_FRAMES.sources!.readingTarget.pane}"`);
    expect(STAGE_FRAMES.sources!.readingTarget).toEqual({ pane: 2, text: "Extracted lines" });
  });

  it("keeps the hero's walkthrough label in both locales, with no reading line or hint paragraph", () => {
    const en = renderToStaticMarkup(<HeroFilm />);
    expect(en).toContain("Product walkthrough on sample files");
    const ko = renderToStaticMarkup(<HeroFilm korean />);
    expect(ko).toContain("샘플 파일로 보는 제품 흐름");
    for (const markup of [en, ko]) {
      expect(markup).not.toContain("compile-film-caption");
      expect(markup).not.toMatch(/<p aria-live="polite">/);
    }
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

  /*
    Founder ask 2026-10-27 ("영상은 축소상태가 디폴트여야"), over FINAL-SPEC 2026-10-26 §2.1 (which asked for Focus): the
    landing asks for the compact view explicitly, on the phone and on the desktop, and the same "Focus details"
    toggle, not pressed, is the expand. Focus itself is held below ("opens on focus only when a caller asks for it").
  */
  // Recording R3 (2026-11-09): the founder kept the compact opening on phones too; the pane stays one press away.
  it("the landing disclosure opens compact, explicitly, with Focus details one press away", () => {
    expect(LANDING_MOBILE_FILM_VIEW).toBe("fit");
    expect(LANDING_WIDE_FILM_VIEW).toBe("fit");
    const source = readFileSync(new URL("./landing-v2/hero-film-disclosure.tsx", import.meta.url), "utf8");
    expect(source).toContain("initialMobileFilmView={LANDING_MOBILE_FILM_VIEW}");
    expect(source).toContain("initialWideView={LANDING_WIDE_FILM_VIEW}");
    const markup = renderToStaticMarkup(<CompileStagePlayer preferVideo initialMobileFilmView={LANDING_MOBILE_FILM_VIEW} />);
    expect(markup).toContain('data-mobile-view="fit"');
    expect(focusControl(markup)).toEqual({ attrs: expect.stringContaining('aria-pressed="false"'), label: "Focus details" });
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
  /*
    Film re-record (2026-11-05): a product recording scrolls, so the window is held to the same 80% rule as the
    reading target itself; a stage whose window does not hold its target opens on Fit (structure, 5 of 10).
  */
  it("keeps each quoted string inside its stage's 2x window at >= 80% of sampled seconds, or opens that stage on Fit", () => {
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
      expect(inside.length, stage.id).toBe(row!.insideWindow);
      expect(row!.holdsTarget, stage.id).toBe(inside.length / crossCheck.times.length >= 0.8);
      if (frame.wideView === "crop") expect(row!.holdsTarget, `${stage.id} opens cropped`).toBe(true);
      // The pane the line names is one of the two the window shows.
      expect([frame.crop.x * 4, frame.crop.x * 4 + 1], stage.id).toContain(frame.readingTarget.pane);
    }
  });

  /*
    The stage-default crop is still what a story-layout player opens on when no initial view is asked for, and what
    "Focus details" shows on Home; Home itself now opens compact (founder 2026-10-27), held in the next test.
  */
  it("opens a story-layout film on the crop with a pressed Focus details toggle, and names only the window's panes", () => {
    const en = renderToStaticMarkup(<CompileStagePlayer storyLayout preferVideo initialMobileFilmView="focus" />);
    expect(en).toContain('data-wide-view="crop"');
    expect(en).toContain("--film-crop-x:25%;--film-crop-y:20%");
    // Fix round 3 (M1): the pressed state is the visible state -- the crop is on screen, so pressed.
    // FINAL-SPEC 2026-10-26 (§6 #7, G15): the name stays "Focus details", as an aria-label on a drawn mark.
    expect(en).toMatch(/<button type="button" class="compile-film-view-control [^"]+" aria-controls="[^"]+" aria-pressed="true" aria-label="Focus details"><svg class="compile-film-view-mark"[^>]*aria-hidden="true"[^>]*>.*?<\/svg><\/button>/);
    expect(en).not.toContain("data-film-reading");
    // The phone in Focus (one pane below 768px), as "Focus details" shows it.
    expect(en).toContain('data-mobile-view="focus"');
    // The phone toggle in Focus: pressed, the same name, a drawn mark instead of the words.
    const phone = en.match(/<button([^>]*class="compile-film-focus-control"[^>]*)>(.*?)<\/button>/);
    expect(phone?.[1]).toContain('aria-pressed="true"');
    expect(phone?.[1]).toContain('aria-label="Focus details"');
    expect(phone?.[2]).toMatch(/^<svg class="compile-film-view-mark"[^>]*aria-hidden="true"/);
    const ko = renderToStaticMarkup(<CompileStagePlayer storyLayout preferVideo korean initialMobileFilmView="focus" />);
    expect(ko).toMatch(/class="compile-film-view-control [^"]+" aria-controls="[^"]+" aria-pressed="true" aria-label="세부 내용 확대"><svg/);
    expect(ko).toMatch(/class="compile-film-focus-control"[^>]*aria-label="세부 내용 확대"><svg/);
    // On Home the motion control names its next action and carries no pressed state (M1).
    expect(en).toMatch(/<button type="button" class="compile-film-motion-control" data-control="pause" aria-label="Pause the compilation film">/);
    const plain = renderToStaticMarkup(<CompileStagePlayer />);
    for (const homeOnly of ["data-wide-view", "compile-film-view-control", "--film-crop-x", "data-in-crop"]) expect(plain).not.toContain(homeOnly);
  });

  /*
    Founder ask 2026-10-27: Home opens compact at every width -- the whole frame, both toggles not pressed, named
    "Focus details" as before -- so the expand is the one control that already existed. The crop window and the
    phone rect stay set on the sequence, for the press that shows them.
  */
  it("opens the Home film compact, both Focus details toggles not pressed, in English and Korean", () => {
    for (const korean of [false, true]) {
      const home = renderToStaticMarkup(<HeroFilm korean={korean} />);
      const name = korean ? "세부 내용 확대" : "Focus details";
      expect(home).toContain('data-wide-view="fit"');
      expect(home).toContain('data-mobile-view="fit"');
      expect(home).toMatch(new RegExp(`<button type="button" class="compile-film-view-control [^"]+" aria-controls="[^"]+" aria-pressed="false" aria-label="${name}"><svg class="compile-film-view-mark"`));
      const phone = home.match(/<button([^>]*class="compile-film-focus-control"[^>]*)>(.*?)<\/button>/);
      expect(phone?.[1]).toContain('aria-pressed="false"');
      expect(phone?.[1]).toContain(`aria-label="${name}"`);
      expect(phone?.[2]).toMatch(/^<svg class="compile-film-view-mark"[^>]*aria-hidden="true"/);
      expect(home).toContain("--film-crop-x:25%;--film-crop-y:20%");
      expect(home).toContain("--pane-x:1016;--pane-y:369;--pane-w:848");
    }
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
      else expect(row!.share < scan.threshold || !crossCheck.cropCheck.stages[stage.id]!.holdsTarget, `${stage.id} opens on Fit for a reason`).toBe(true);
    }
    // The failure path this guards: stage 3 scrolls its target through any one window (5 of 10 sampled seconds).
    expect(crossCheck.cropCheck.stages.structure!.holdsTarget).toBe(false);
    expect(STAGE_FRAMES.structure!.wideView).toBe("fit");
  });

  /*
    Fix round 4 (M1). The desktop toggle's choice is kept relative to the stage default. The player's
    own two transitions are walked here: a press (nextWideChoice) and a stage change
    (wideChoiceOnStageChange); what the stage shows is the choice, else the stage default.
  */
  it("keeps the view choice relative to the stage default, so stage 3 never inherits a crop", () => {
    const ids = COMPILE_STAGES.map(stage => stage.id);
    const defaults = ids.map(id => STAGE_FRAMES[id]!.wideView);
    // R3: only stage 1 holds its target in the 2x window; the other three open on Fit (measured in frame-strings).
    expect(defaults).toEqual(["crop", "fit", "fit", "fit"]);
    let stage = 0;
    let choice: WideView | null = null;
    const shown = () => choice ?? defaults[stage]!;
    const press = () => { choice = nextWideChoice(shown(), defaults[stage]!); };
    const go = (next: number) => { if (next !== stage) choice = wideChoiceOnStageChange(choice); stage = next; };

    // The critic's walk: Fit -> Focus on stage 1, then stage 3. The round trip records nothing.
    press();
    expect([shown(), choice]).toEqual(["fit", "fit"]);
    press();
    expect([shown(), choice]).toEqual(["crop", null]);
    go(2);
    expect(shown()).toBe("fit");

    // Focus asked for on stage 3 stays on stage 3 (its own tab again included) ...
    press();
    expect([shown(), choice]).toEqual(["crop", "crop"]);
    go(2);
    expect(shown()).toBe("crop");
    // ... and clears with the stage: stage 1 is on its default, and stage 3 is Fit again.
    go(0);
    expect([shown(), choice]).toEqual(["crop", null]);
    go(2);
    expect(shown()).toBe("fit");

    // A Fit asked for holds across stages; pressing back to a stage's default clears it.
    go(0);
    press();
    expect(shown()).toBe("fit");
    go(3);
    expect(shown()).toBe("fit");
    go(2);
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

  it("serves the stage-1 re-record poster at 2x for the crop and 1x for a phone in Fit, with no mask", () => {
    const en = renderToStaticMarkup(<HeroFilm />);
    // Home opens compact (2026-10-27, kept for R3 2026-11-09): no phone pane still until Focus details is pressed.
    expect(en).not.toContain("data-pane-poster");
    expect(en).not.toContain("767.98px");
    const homeStage = { ...COMPILE_STAGES[0]!, poster: "/film/poster-r3-c1-t10.40-2x.webp", poster1x: "/film/poster-r3-c1-t10.40.webp", posterAvif: "/film/poster-r3-c1-t10.40-2x.avif", posterAvif1x: "/film/poster-r3-c1-t10.40.avif", phonePoster: "/film/poster-r3-c1-t10.40-pane1-848x1060.webp", phonePosterAvif: "/film/poster-r3-c1-t10.40-pane1-848x1060.avif" };
    const focused = renderToStaticMarkup(<CompileStagePlayer stages={[homeStage]} storyLayout initialMobileFilmView="focus" />);
    const still = en.match(/<img[^>]*class="compile-film-still"[^>]*>/)?.[0] ?? "";
    // Re-record (D-11 encoders): the WebP pair of t = 10.40s is the <img>, the fallback inside the <picture>.
    expect(still).toContain('src="/film/poster-r3-c1-t10.40-2x.webp"');
    expect(still).toMatch(/srcSet="\/film\/poster-r3-c1-t10\.40\.webp 1440w, \/film\/poster-r3-c1-t10\.40-2x\.webp 2880w"/i);
    expect(still).toContain(`sizes="${FILM_POSTER_SIZES}"`);
    // ...and the AVIF pair of the same frame is the <source> ahead of it, with the same sizes.
    const picture = en.match(/<picture[^>]*>([\s\S]*?)<\/picture>/)?.[1] ?? "";
    expect(picture.indexOf("<source")).toBe(0);
    expect(picture).toMatch(/<source type="image\/avif" srcSet="\/film\/poster-r3-c1-t10\.40\.avif 1440w, \/film\/poster-r3-c1-t10\.40-2x\.avif 2880w" sizes="[^"]+"\/?>/i);
    expect(picture).toContain(still);
    // FINAL-SPEC 2026-10-26 §2.1, in Focus: ahead of them, the stage-1 pane still for a screen below 768px, AVIF then WebP.
    const focusedPicture = focused.match(/<picture[^>]*>([\s\S]*?)<\/picture>/)?.[1] ?? "";
    expect(focusedPicture).toMatch(/^<source media="\(max-width: 767\.98px\)" type="image\/avif" srcSet="\/film\/poster-r3-c1-t10\.40-pane1-848x1060\.avif"\/><source media="\(max-width: 767\.98px\)" type="image\/webp" srcSet="\/film\/poster-r3-c1-t10\.40-pane1-848x1060\.webp"\/><source type="image\/avif"/);
    expect(focused).toContain('data-pane-poster="1"');
    expect(en).toContain("--pane-x:1016;--pane-y:369;--pane-w:848");
    // No re-recorded frame carries an overprint, so no stage has a Tier 2 mask.
    expect(en).not.toContain("data-poster-mask");
    expect(renderToStaticMarkup(<CompileStagePlayer storyLayout />)).not.toContain("data-poster-mask");
    for (const id of ["sources", "read", "structure", "world"]) expect(STAGE_FRAMES[id]!.posterMask, id).toBeUndefined();
  });

  /*
    FINAL-SPEC 2026-10-26 §2.1 / §9 #29. A phone pane is used only where the blank scan of that exact
    rect over every presented frame of its cut clears the threshold; a new rect fails here until it is
    scanned and recorded. Fit has no pane: no pane source and no pane flag.
  */
  it("opens a phone on a pane only where the pane's own blank scan clears the threshold", () => {
    const scan = crossCheck.phonePaneScan;
    expect([scan.threshold, scan.blankAt]).toEqual([crossCheck.blankScan.threshold, crossCheck.blankScan.blankAt]);
    for (const stage of COMPILE_STAGES) {
      const pane = STAGE_FRAMES[stage.id]!.phonePane;
      const row = scan.stages[stage.id];
      // The scan is of this exact rect, width included: a rect that was not scanned fails here.
      expect(row?.phonePane, stage.id).toEqual(pane);
      expect(row!.share, stage.id).toBeCloseTo((row!.frames - row!.blankFrames) / row!.frames, 3);
      expect(row!.share, stage.id).toBeGreaterThanOrEqual(scan.threshold);
      // 4:5 in whole source pixels, inside the frame. R3 type is 32 source px (R2: 24), so an 848px rect draws it larger than R2's
      // 684px rect drew 24px (32/848 > 24/684): the cap is 912, the width at which the two are equal.
      expect((pane.w * 5) % 4, stage.id).toBe(0);
      expect(pane.w <= 912 && pane.x >= 0 && pane.y >= 0 && pane.x + pane.w <= 2880 && pane.y + (pane.w * 5) / 4 <= 1800, stage.id).toBe(true);
    }
    // R3: the stage-1 pane still is cut from the same rect the playing cut is drawn at, so still and video match pixel for pixel.
    const posters = (JSON.parse(readFileSync(new URL("../lib/locked-film-assets.json", import.meta.url), "utf8")) as { posters: { file: string; cropRect?: { x: number; y: number; width: number; height: number } }[] }).posters;
    const pane1 = STAGE_FRAMES.sources!.phonePane;
    const crops = posters.filter(poster => poster.file.startsWith("poster-r3-c1-t10.40-pane1-"));
    expect(crops.map(poster => poster.file).sort()).toEqual(["poster-r3-c1-t10.40-pane1-848x1060.avif", "poster-r3-c1-t10.40-pane1-848x1060.webp"]);
    for (const poster of crops) expect(poster.cropRect, poster.file).toEqual({ x: pane1.x, y: pane1.y, width: pane1.w, height: (pane1.w * 5) / 4 });

    const fit = renderToStaticMarkup(<CompileStagePlayer stages={[{ ...COMPILE_STAGES[0]!, phonePoster: "/film/poster-1-t8.16-pane1-684x855.webp", phonePosterAvif: "/film/poster-1-t8.16-pane1-684x855.avif" }]} storyLayout />);
    expect(fit).toContain('data-mobile-view="fit"');
    expect(fit).not.toContain("data-pane-poster");
    expect(fit).not.toContain("767.98px");
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
