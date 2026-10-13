"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import styles from "./source-first-home.module.css";

export const SOURCE_INSPECTION_POSTER = "/film/source-inspection/desktop.webp";
const MOBILE_POSTER = "/film/source-inspection/mobile.webp";

/** Actual public source inspection. No upload, OCR or compilation is represented by this recording. */
export default function SourceInspectionFilm({ korean = false }: { korean?: boolean }) {
  preload(SOURCE_INSPECTION_POSTER, { as: "image", fetchPriority: "high" });
  const [opened, setOpened] = useState(false);
  const [phone, setPhone] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!opened) return;
    void video.current?.play().catch(() => {
      // Native controls remain available if the browser refuses scripted playback.
    });
  }, [opened]);
  const play = () => {
    setPhone(window.matchMedia("(max-width: 767px)").matches);
    setFailed(false);
    setOpened(true);
  };
  return <figure className={styles.film} data-testid="landing-hero-film" data-source-inspection-film>
    <div className={styles.filmFrame}>
      {opened ? <video ref={video} controls playsInline preload="metadata"
        poster={phone ? MOBILE_POSTER : SOURCE_INSPECTION_POSTER}
        aria-label={korean ? "공개 원문 영역 확인 영상" : "Public source-region inspection"}
        onError={() => { setFailed(true); setOpened(false); }}>
        <source src={phone ? "/film/source-inspection/mobile.webm" : "/film/source-inspection/desktop.webm"} type="video/webm" />
        <track kind="captions" src={korean ? "/film/source-inspection/ko.vtt" : "/film/source-inspection/en.vtt"}
          srcLang={korean ? "ko" : "en"} label={korean ? "동작 설명" : "Action description"} />
      </video> : <>
        <picture>
          <source media="(max-width: 767px)" srcSet={MOBILE_POSTER} />
          {/* Static first-party proof derivative; picture selects the independently framed phone poster. */}
          <img src={SOURCE_INSPECTION_POSTER} width={1080} height={675} loading="eager" decoding="async" fetchPriority="high"
            alt={korean ? "공개 공시의 원문 페이지와 선택한 구절. 준비된 예시이며 처리를 새로 실행한 결과가 아닙니다." : "A public filing page and selected passage. Prepared example, not a new processing result."} />
        </picture>
        <button type="button" className={styles.play} onClick={play}
          aria-label={korean ? "원문 확인 영상 재생" : "Play the source inspection"}>
          <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true"><path d="M4 2.5 13 8l-9 5.5z" fill="currentColor" /></svg>
          {korean ? "영상 보기" : "Watch the inspection"}
        </button>
      </>}
    </div>
    <figcaption>{korean
      ? "준비된 공개 샘플 · 맥락은 미해결 상태입니다. 새 OCR·컴파일 실행이나 고객 결과가 아닙니다."
      : "Prepared public sample · context remains unresolved. Not a new OCR or compilation run, or customer results."}</figcaption>
    {failed ? <p role="status" className={styles.filmError}>{korean ? "영상을 불러오지 못했습니다. 아래에서 같은 원문을 직접 확인할 수 있습니다." : "The recording could not load. Inspect the same source below."}</p> : null}
    <details className={styles.transcript}><summary>{korean ? "영상에서 보여 주는 것" : "What this video shows"}</summary>
      <p>{korean ? "준비된 공개 공시에서 표 구절, 재무제표 제목, 열 제목을 차례로 선택합니다. 누락된 맥락을 해석하거나 검증하지 않습니다. 모바일 영상은 같은 동작의 구절 영역을 확대해 보여 줍니다."
        : "A prepared public filing is inspected. The table passage, statement heading and column headings are selected. Missing context is not interpreted or verified. The phone recording focuses on the passage area of the same actions."}</p>
    </details>
  </figure>;
}
