"use client";

import { useEffect, useRef, useState } from "react";
import {
  COMPILER_SPECIMEN_SOURCE as source,
  COMPILER_SPECIMEN_STAGES,
  compilerSpecimenShouldAdvance,
  nextCompilerStage,
} from "@/lib/compiler-specimen";
import styles from "./compiler-specimen.module.css";

const FRAME_MS = 2600;

const COPY = {
  en: {
    aria: "Knowledge Compiler stages",
    pause: "Pause",
    play: "Play",
    replay: "Replay",
    source: "Persistent source",
    titles: [
      "The source page",
      "A located region",
      "Evidence with an address",
      "Reusable knowledge",
      "A grounded question",
    ],
    bodies: [
      "One public filing enters as a page, before any interpretation.",
      "The same page is segmented without losing its location.",
      "The extracted passage stays bound to its page, box and source version.",
      "The passage becomes a reusable object while retaining the same source identity.",
      "A question returns to the same cited passage instead of hiding its origin.",
    ],
  },
  ko: {
    aria: "Knowledge Compiler 단계",
    pause: "일시 정지",
    play: "재생",
    replay: "다시 재생",
    source: "이어지는 원문",
    titles: [
      "원문 페이지",
      "위치가 있는 영역",
      "주소가 있는 근거",
      "재사용 가능한 지식",
      "근거로 돌아가는 질문",
    ],
    bodies: [
      "해석하기 전, 공개 공시의 한 페이지가 들어옵니다.",
      "같은 페이지를 위치를 잃지 않고 구조화합니다.",
      "추출한 문단은 페이지, 영역, 원문 버전에 계속 묶여 있습니다.",
      "문단은 같은 원문 정체성을 유지한 채 재사용할 수 있는 지식이 됩니다.",
      "질문은 출처를 숨기지 않고 같은 인용 문단으로 돌아갑니다.",
    ],
  },
} as const;

function stageFacts(index: number) {
  if (index === 0)
    return [
      ["Document", source.filename],
      ["Page", `${source.page} / ${source.pageCount}`],
    ];
  if (index === 1)
    return [
      ["Region", source.regionId],
      ["Box", source.bbox1000.join(", ")],
    ];
  if (index === 2)
    return [
      ["Passage", source.excerpt],
      ["Version", source.digest],
    ];
  if (index === 3)
    return [
      ["Knowledge", source.excerpt],
      ["Source", source.regionId],
    ];
  return [
    ["Question", source.question],
    [
      "Citation",
      `${source.form} · ${source.filename} · page ${source.page} · ${source.regionId}`,
    ],
  ];
}

export default function CompilerSpecimen({
  korean = false,
}: {
  korean?: boolean;
}) {
  const copy = COPY[korean ? "ko" : "en"];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const specimen = useRef<HTMLDivElement | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const ended = nextCompilerStage(index) === null;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(query.matches);
      if (query.matches) setPlaying(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const node = specimen.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        setInView(
          Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.4)
        );
      },
      { threshold: [0, 0.4, 1] }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setDocumentVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const shouldAdvance = compilerSpecimenShouldAdvance({
    requested: playing,
    reducedMotion,
    inView,
    documentVisible,
  });

  useEffect(() => {
    if (!shouldAdvance) return;
    const next = nextCompilerStage(index);
    if (next === null) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex(next), FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [index, shouldAdvance]);

  const choose = (next: number) => {
    setIndex(next);
    setPlaying(false);
  };

  const onKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.current.indexOf(
      document.activeElement as HTMLButtonElement
    );
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (current + 1) % COMPILER_SPECIMEN_STAGES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next =
        (current - 1 + COMPILER_SPECIMEN_STAGES.length) %
        COMPILER_SPECIMEN_STAGES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = COMPILER_SPECIMEN_STAGES.length - 1;
    else return;
    event.preventDefault();
    choose(next);
    tabs.current[next]?.focus();
  };

  const toggle = () => {
    if (ended) {
      setIndex(0);
      setPlaying(true);
    } else {
      setPlaying(value => !value);
    }
  };

  const active = COMPILER_SPECIMEN_STAGES[index];
  return (
    <div className={styles.specimen} data-compiler-specimen ref={specimen}>
      <div
        className={styles.rail}
        role="tablist"
        aria-label={copy.aria}
        onKeyDown={onKeys}
      >
        {COMPILER_SPECIMEN_STAGES.map((stage, position) => (
          <button
            className={styles.stage}
            data-active={position === index}
            id={`compiler-stage-${stage.id}`}
            key={stage.id}
            onClick={() => choose(position)}
            ref={node => {
              tabs.current[position] = node;
            }}
            role="tab"
            aria-controls="compiler-stage-panel"
            aria-selected={position === index}
            tabIndex={position === index ? 0 : -1}
            type="button"
          >
            {stage.label}
          </button>
        ))}
      </div>
      <div className={styles.sourceBar}>
        <span className={styles.identity}>
          {copy.source} · <span data-derived="1">{source.id}</span>
        </span>
        <button
          className={styles.motion}
          type="button"
          onClick={toggle}
          aria-pressed={playing}
        >
          {ended ? copy.replay : playing ? copy.pause : copy.play}
        </button>
      </div>
      <div
        className={styles.canvas}
        id="compiler-stage-panel"
        role="tabpanel"
        aria-labelledby={`compiler-stage-${active.id}`}
      >
        <div className={styles.page} aria-hidden="true">
          <p className={styles.pageHeader} data-derived="1">
            Apple Inc. · Form {source.form} · page {source.page}
          </p>
          <div className={styles.pageRule} />
          <div className={styles.pageLines}>
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className={styles.region} />
        </div>
        <div className={styles.output}>
          <p className={styles.eyebrow}>{active.label}</p>
          <p className={styles.title}>{copy.titles[index]}</p>
          <p className={styles.body}>{copy.bodies[index]}</p>
          <dl className={styles.facts}>
            {stageFacts(index).map(([term, value]) => (
              <div className={styles.fact} key={term}>
                <dt>{term}</dt>
                <dd data-derived="1">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
