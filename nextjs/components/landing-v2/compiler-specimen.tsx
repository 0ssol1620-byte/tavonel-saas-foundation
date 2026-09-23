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
const STAGE_LABELS_KO = ["원문", "구조", "근거", "지식", "활용"] as const;
const ui = (korean: boolean, ko: string, en: string) => korean ? ko : en;

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

function SourceSheet({ index, korean }: { index: number; korean: boolean }) {
  return (
    <div className={styles.sourceViewport} data-camera-stage={index} aria-label={ui(korean, `원문 ${source.page}쪽`, `Source page ${source.page}`)}>
      <picture className={`${styles.sourceAsset} ${styles.fullPage}`}>
        <source
          type="image/avif"
          srcSet="/landing/v2/apple-2026-q1-10-q-reference-p004-720.avif 720w, /landing/v2/apple-2026-q1-10-q-reference-p004-1080.avif 1080w"
          sizes="(max-width: 767px) calc(100vw - 72px), 430px"
        />
        <source
          type="image/webp"
          srcSet="/landing/v2/apple-2026-q1-10-q-reference-p004-720.webp 720w, /landing/v2/apple-2026-q1-10-q-reference-p004-1080.webp 1080w"
          sizes="(max-width: 767px) calc(100vw - 72px), 430px"
        />
        <img
          data-source-image="page"
          src="/explore-sample/pages/apple-2026-q1-10-q-reference-p004.webp"
          alt={ui(korean, "요약 연결손익계산서가 있는 Apple 분기 공시 페이지", "Apple quarterly filing page showing the condensed consolidated statements of operations")}
          width="1080"
          height="1398"
          loading="lazy"
          decoding="async"
        />
      </picture>
      <picture className={`${styles.sourceAsset} ${styles.regionCrop}`}>
        <source
          type="image/avif"
          srcSet="/landing/v2/apple-2026-q1-10-q-reference-p004-r64-476-932-538-560.avif 560w, /landing/v2/apple-2026-q1-10-q-reference-p004-r64-476-932-538-1120.avif 1120w"
          sizes="(max-width: 767px) calc(100vw - 72px), 430px"
        />
        <source
          type="image/webp"
          srcSet="/landing/v2/apple-2026-q1-10-q-reference-p004-r64-476-932-538-560.webp 560w, /landing/v2/apple-2026-q1-10-q-reference-p004-r64-476-932-538-1120.webp 1120w"
          sizes="(max-width: 767px) calc(100vw - 72px), 430px"
        />
        <img
          data-source-image="region"
          src="/landing/v2/apple-2026-q1-10-q-reference-p004-r64-476-932-538-560.webp"
          alt={ui(korean, "같은 공시 페이지에서 잘라 낸 영업비용 표 영역", "Exact operating expenses table region from the same filing page")}
          width="1120"
          height="103"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </picture>
      <span className={styles.region} aria-hidden="true" />
      <p className={styles.sourceCaption} data-derived="1">
        {index === 0
          ? ui(korean, `${source.page}쪽 · 원문 렌더`, `Page ${source.page} · original render`)
          : `${source.regionId} · ${ui(korean, "정확히 잘라 낸 영역", "exact crop")}`}
      </p>
    </div>
  );
}

function StageComposition({ index, korean }: { index: number; korean: boolean }) {
  if (index === 0) {
    return (
      <div className={styles.pageComposition} data-stage-composition="page">
        <p className={styles.compositionLabel}>{ui(korean, "원문 페이지 · 변경 없음", "Original page · unchanged")}</p>
        <p className={styles.compositionLead}>{ui(korean, "해석하기 전의 공시 페이지입니다.", "One filing page enters before interpretation.")}</p>
        <dl className={styles.compactLedger}>
          <div><dt>{ui(korean, "파일", "File")}</dt><dd data-derived="1">{source.filename}</dd></div>
          <div><dt>{ui(korean, "페이지", "Page")}</dt><dd data-derived="1">{ui(korean, `${source.page}/${source.pageCount}쪽`, `${source.page} of ${source.pageCount}`)}</dd></div>
        </dl>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className={styles.structureComposition} data-stage-composition="structure">
        <p className={styles.compositionLabel}>{ui(korean, "위치를 확인한 표 영역", "Located table region")}</p>
        <div className={styles.cellMap}>
          <span className={styles.rowName}>{ui(korean, "연구개발비", "Research and development")}</span>
          <span className={styles.cell} data-derived="1" data-critical-value="structured-current">{source.currentValue}</span>
          <span className={styles.cell} data-derived="1">{source.priorValue}</span>
        </div>
        <details className={styles.sourceDetails}>
          <summary>{korean ? "원문 좌표 살펴보기" : "Inspect the source coordinates"}</summary>
          <div className={styles.coordinateRow}>
            <span>row · operating_expenses.r_and_d</span>
            <span data-derived="1">bbox · {source.bbox1000.join(" / ")}</span>
          </div>
        </details>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className={styles.evidenceComposition} data-stage-composition="evidence">
        <p className={styles.compositionLabel}>{ui(korean, "근거의 원문 주소", "Evidence address")}</p>
        <blockquote data-derived="1">{source.excerpt}</blockquote>
        <p className={styles.sourceLocator} data-derived="1">{source.filename} · {ui(korean, `${source.page}쪽`, `page ${source.page}`)} · {source.regionId}</p>
        <details className={styles.sourceDetails}>
          <summary>{korean ? "전체 원문 주소 살펴보기" : "Inspect the full source address"}</summary>
          <div className={styles.addressGrid}>
            <span>{ui(korean, "문서", "document")}</span><b data-derived="1">{source.id}</b>
            <span>{ui(korean, "페이지", "page")}</span><b data-derived="1">{source.page}</b>
            <span>{ui(korean, "영역", "region")}</span><b data-derived="1">{source.regionId}</b>
            <span>{ui(korean, "버전", "version")}</span><b data-derived="1">{source.digest}</b>
          </div>
        </details>
      </div>
    );
  }
  if (index === 3) {
    return (
      <div className={styles.knowledgeComposition} data-stage-composition="knowledge">
        <p className={styles.compositionLabel}>{ui(korean, "재사용 가능한 지식 객체", "Reusable knowledge object")}</p>
        <div className={styles.knowledgeObject}>
          <span className={styles.objectType}>{ui(korean, "영업비용", "Operating expense")}</span>
          <strong>{ui(korean, "연구개발비", "Research and development")}</strong>
          <span className={styles.objectValue} data-derived="1" data-critical-value="knowledge-current">{source.currentValue}</span>
          <span className={styles.objectUnit} data-derived="1">{ui(korean, source.unitKo, source.unit)} · {ui(korean, source.currentPeriodKo, source.currentPeriod)}</span>
        </div>
        <div className={styles.sourceTether}>
          <span aria-hidden="true" />
          <p data-derived="1">{ui(korean, "근거 영역", "Grounded in")} {source.regionId}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.intelligenceComposition} data-stage-composition="intelligence">
      <p className={styles.compositionLabel}>{ui(korean, "원문에 근거한 답", "Grounded answer")}</p>
      <p className={styles.question}>{ui(korean, "연구개발비는 얼마였나요?", source.question)}</p>
      <p className={styles.answer}>
        <strong data-derived="1" data-critical-value="answer-current">{source.currentValue}</strong>
        <span data-derived="1">{ui(korean, source.unitKo, source.unit)} · {ui(korean, source.currentPeriodKo, source.currentPeriod)}</span>
      </p>
      <p className={styles.citation} data-derived="1">↗ {source.filename} · {ui(korean, `${source.page}쪽`, `page ${source.page}`)} · {source.regionId}</p>
    </div>
  );
}

export default function CompilerSpecimen({
  korean = false,
}: {
  korean?: boolean;
}) {
  const copy = COPY[korean ? "ko" : "en"];
  // Show the source-linked result on first paint. Playback begins only on request.
  const [index, setIndex] = useState(2);
  const [playing, setPlaying] = useState(false);
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
    if (reducedMotion) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    setIndex(0);
    setPlaying(true);
  };

  const active = COMPILER_SPECIMEN_STAGES[index];
  return (
    <div
      className={styles.specimen}
      data-compiler-specimen
      data-playing={playing}
      ref={specimen}
    >
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
            {korean ? STAGE_LABELS_KO[position] : stage.label}
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
          disabled={reducedMotion}
        >
          {ended ? copy.replay : playing ? copy.pause : copy.play}
        </button>
      </div>
      <div
        className={styles.canvas}
        data-stage={active.id}
        id="compiler-stage-panel"
        role="tabpanel"
        aria-labelledby={`compiler-stage-${active.id}`}
      >
        <SourceSheet index={index} korean={korean} />
        <div className={styles.output}>
          <p className={styles.eyebrow}>{korean ? STAGE_LABELS_KO[index] : active.label}</p>
          <p className={styles.title}>{copy.titles[index]}</p>
          <p className={styles.body}>{copy.bodies[index]}</p>
          <StageComposition key={active.id} index={index} korean={korean} />
        </div>
      </div>
    </div>
  );
}
