"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { caseStatus, displayableRegions, publishableClaims, type EvidenceCase, type EvidenceRegion } from "@/lib/home-evidence-view";
import styles from "./landing-hero.module.css";

/*
  The Home workbench: source -> highlighted passage -> inspectable record.

  It renders an `EvidenceCase` the server built from the committed sample, so everything a reader
  sees is the World's own text bound to a digest, page and bbox. What it never renders is an
  answer: the case carries no published claim, the status line says the composition is prepared
  and no processing ran for it, and the passage pane names its contents an existing extracted
  passage -- the extractor's words, not a reply to a question.

  ORDER
  The source's name and page, then the page itself, then the passage: on a phone the real raster is
  the first thing under the name, not something a reader scrolls past the explanation to reach.
  The page is windowed from just above the highest region to just under the lowest, both read off
  the regions' bboxes; the full page is one link beside it.

  FULL FILING
  When the source has a verified official filing, it is linked beside the page, next to the full
  page, and Source details says it is the original HTML, apart from the reference render the page
  shows. The link is navigation only: rights, run and claims read the same with or without it.

  SELECTION
  The boxes on the page are inert drawings (at phone widths they are far under any touch floor,
  and inflating one would move it off the passage). The controls are native buttons in a list,
  `aria-pressed` on the chosen one; activating one moves the box, the passage and its citation
  link together. No animation: a keyboard-driven selection should land instantly.

  FIGURES
  Every digit is read off the case and sits in a `data-derived` element, for the landing's
  figure guard. Step numbers are CSS counters, not text.
*/

type Copy = {
  label: string;
  title: string;
  /** By run: the whole line while nothing ran, only the composition's word once a run qualified. */
  status: { not_run: string; qualified: string };
  steps: { source: string; passage: string; record: string };
  existing: string;
  roles: Record<EvidenceRegion["role"], string>;
  selectedNote: string;
  contextNote: string;
  regions: string;
  openRegion: string;
  openPage: string;
  openFull: string;
  filing: { open: string; original: string; render: string };
  fields: { source: string; version: string; location: string };
  record: {
    passage: [string, string];
    version: [string, string];
    regions: [string, string];
    claims: [string, string];
  };
  details: string;
  detailFields: { file: string; digest: string; basis: string; jurisdiction: string; attribution: string; publication: string };
  publication: Record<"cleared" | "public_sample" | "not_cleared", string>;
  pageAlt: string;
  pageAbsent: string;
};

const COPY: Record<"en" | "ko", Copy> = {
  en: {
    label: "Source, passage and record",
    title: "Inspect one passage at its source",
    status: { not_run: "Prepared demonstration / processing not yet run", qualified: "Prepared demonstration" },
    steps: { source: "Source", passage: "Passage", record: "Record" },
    existing: "Existing extracted passage",
    roles: {
      selected: "Selected table passage",
      "statement-heading": "Statement heading",
      "column-headings": "Column headings",
    },
    selectedNote:
      "Context required. This passage prints values without their column headings or unit. Both are separate regions of the same page, and joining them is interpretation this preview has not run.",
    contextNote: "Shown as printed, for context. It has not been joined to the selected passage.",
    regions: "Regions on this page",
    openRegion: "Open this region in Explore",
    openPage: "Open full page",
    openFull: "Open full source",
    filing: {
      open: "Open full filing (SEC)",
      original: "The original HTML filing, as submitted.",
      render: "The page shown here is a reference render of it.",
    },
    fields: { source: "Source", version: "Filing", location: "Location" },
    record: {
      passage: ["Source-bound passage", "Quoted exactly as extracted, bound to its page and region."],
      version: ["Source version", "The digest every region on this page is bound to."],
      regions: ["Attached regions", "Each one opens at its exact place in Explore."],
      claims: ["Published claims", "None. A verified claim needs every region it rests on, its period and unit cited, and a qualified run."],
    },
    details: "Source details",
    detailFields: {
      file: "File",
      digest: "Version digest",
      basis: "Rights basis",
      jurisdiction: "Jurisdiction",
      attribution: "Attribution",
      publication: "Publication",
    },
    publication: { cleared: "Cleared", public_sample: "Published sample", not_cleared: "Not cleared" },
    pageAlt: "A rendered page of the filing the passage was extracted from.",
    pageAbsent: "No page image is published for this source.",
  },
  ko: {
    label: "원문, 구절, 기록",
    title: "원문에서 구절 하나 확인하기",
    status: { not_run: "준비된 시연 / 아직 처리를 실행하지 않음", qualified: "준비된 시연" },
    steps: { source: "원문", passage: "구절", record: "기록" },
    existing: "기존 추출 구절",
    roles: {
      selected: "선택한 표 구절",
      "statement-heading": "재무제표 제목",
      "column-headings": "열 제목",
    },
    selectedNote:
      "맥락 확인 필요. 이 구절에는 값만 있고 열 제목과 단위가 없습니다. 둘 다 같은 페이지의 다른 영역에 있으며, 이를 묶는 해석은 이 미리보기에서 실행하지 않았습니다.",
    contextNote: "맥락 확인용으로 인쇄된 그대로 보여 줍니다. 선택한 구절과 묶지 않았습니다.",
    regions: "이 페이지의 영역",
    openRegion: "Explore에서 이 영역 열기",
    openPage: "전체 페이지 열기",
    openFull: "원문 전체 열기",
    filing: {
      open: "전체 공시 열기 (SEC)",
      original: "제출된 그대로의 원본 HTML 공시입니다.",
      render: "여기 보이는 페이지는 그 공시의 기준 렌더입니다.",
    },
    fields: { source: "원문", version: "공시", location: "위치" },
    record: {
      passage: ["원문에 묶인 구절", "추출된 그대로 인용하며, 페이지와 영역에 묶여 있습니다."],
      version: ["원문 버전", "이 페이지의 모든 영역이 묶인 다이제스트입니다."],
      regions: ["연결된 영역", "각 영역은 Explore에서 정확한 위치로 열립니다."],
      claims: ["게시된 진술", "없음. 검증된 진술에는 근거 영역 전체, 기간과 단위의 인용, 적격 판정을 받은 실행이 필요합니다."],
    },
    details: "원문 상세",
    detailFields: {
      file: "파일",
      digest: "버전 다이제스트",
      basis: "권리 근거",
      jurisdiction: "관할",
      attribution: "출처 표기",
      publication: "게시 상태",
    },
    publication: { cleared: "허가됨", public_sample: "공개 샘플", not_cleared: "허가되지 않음" },
    pageAlt: "구절을 추출한 공시 문서의 페이지 렌더입니다.",
    pageAbsent: "이 원문의 페이지 이미지는 공개되지 않았습니다.",
  },
};

/** `sourcePageQualifier`'s two spellings, inlined so the client bundle skips the page manifest. */
const QUALIFIER = {
  en: { reference_render: "reference render", original: "original PDF" },
  ko: { reference_render: "기준 렌더", original: "원본 PDF" },
} as const;

const letter = (index: number) => String.fromCharCode(65 + index);

export default function HeroSourceCard({ view, korean = false }: { view: EvidenceCase; korean?: boolean }) {
  const locale = korean ? "ko" : "en";
  const t = COPY[locale];
  const passageId = useId();
  const regions = displayableRegions(view);
  const [selectedId, setSelectedId] = useState(view.selectedRegionId);
  const active = regions.find(region => region.id === selectedId) ?? regions[0];
  const source = view.sources.find(item => item.id === active?.sourceId);
  const page = view.pages.find(item => item.sourceId === active?.sourceId && item.page === active?.page);
  if (!active || !source || !page) return null;

  const qualifier = source.representation === "reference_render" ? QUALIFIER[locale].reference_render : QUALIFIER[locale].original;
  const where = (region: EvidenceRegion) =>
    `${korean ? `${region.page}쪽` : `p.${region.page}`} · bbox ${region.bbox1000.join(",")}`;
  /* The page window spans the regions plus a margin each way, so every selectable box is in view. */
  const windowStart = Math.max(0, Math.min(...regions.map(region => region.bbox1000[1])) - 80);
  const windowEnd = Math.min(1000, Math.max(...regions.map(region => region.bbox1000[3])) + 80);

  return (
    <article
      className={styles.bench}
      data-source-digest={source.digest}
      data-source-page={active.page}
      data-case-status={caseStatus(view)}
      aria-labelledby={`${passageId}-title`}
    >
      <header className={styles.benchHead}>
        <h2 className={styles.benchTitle} id={`${passageId}-title`}>{t.title}</h2>
        <p className={styles.runStatus} data-run={view.run}>{t.status[view.run]}</p>
      </header>

      <div className={styles.benchGrid}>
        <div className={`${styles.locator} ${styles.step}`} data-step={t.steps.source}>
          <p className={styles.filename} data-derived="1">{source.filename}</p>
          <p className={styles.locatorMeta}>
            <span className={styles.metaField}>{t.fields.location}</span>{" "}
            <span data-derived="1">
              {`${korean ? `${source.pageCount}쪽 중 ${active.page}쪽` : `page ${active.page} of ${source.pageCount}`} · ${qualifier}`}
            </span>
          </p>
        </div>

        {/* Straight under the name, ahead of the passage: on a phone the page is seen before it is explained. */}
        <div className={styles.pageFrame}>
          {page.image ? (
            <div
              className={styles.pageWindow}
              data-page-window={`${windowStart},${windowEnd}`}
              style={{ aspectRatio: `${page.image.width} / ${(page.image.height * (windowEnd - windowStart)) / 1000}` }}
            >
              <div className={styles.pageSheet} style={{ transform: `translateY(-${windowStart / 10}%)` }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the committed raster, unre-encoded */}
                <img
                  src={page.image.src}
                  width={page.image.width}
                  height={page.image.height}
                  alt={t.pageAlt}
                  fetchPriority="high"
                  decoding="async"
                  loading="eager"
                />
                {regions.map((region, index) => {
                  const [x, y, x2, y2] = region.bbox1000;
                  return (
                    <span
                      key={region.id}
                      aria-hidden="true"
                      className={styles.box}
                      data-region-id={region.id}
                      data-selected={region.id === active.id ? "1" : undefined}
                      style={{ left: `${x / 10}%`, top: `${y / 10}%`, width: `${(x2 - x) / 10}%`, height: `${(y2 - y) / 10}%` }}
                    >
                      <span className={styles.boxMark}>{letter(index)}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className={styles.pageAbsent}>{t.pageAbsent}</p>
          )}
          <p className={styles.sourceLinks}>
            {source.fullSourceHref ? (
              <a className={styles.quietLink} href={source.fullSourceHref}>{t.openFull}</a>
            ) : null}
            {page.image ? (
              <a className={styles.quietLink} href={page.image.src}>{t.openPage}</a>
            ) : null}
            {source.officialFiling ? (
              <a className={styles.quietLink} href={source.officialFiling.href} data-full-filing>
                {t.filing.open}
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </p>
        </div>

        <div className={`${styles.passagePane} ${styles.step}`} data-step={t.steps.passage} id={passageId} aria-live="polite">
          <p className={styles.paneLabel}>
            <span className={styles.extracted}>{t.existing}</span>
            <span>{t.roles[active.role]}</span>
          </p>
          <blockquote className={styles.quote} lang="en" data-derived="1">
            {active.passage}{active.passageTruncated ? "…" : ""}
          </blockquote>
          <p className={styles.citation} data-derived="1">{`${source.filename} · ${where(active)}`}</p>
          <p className={styles.contextNote}>{active.role === "selected" ? t.selectedNote : t.contextNote}</p>
          {active.href ? (
            <Link className={styles.evidenceLink} href={active.href as Route} prefetch={false} data-hero-evidence data-analytics="source-open">
              {t.openRegion}
              <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </div>

        <div className={styles.regionPane}>
          <p className={styles.regionsLabel} id={`${passageId}-regions`}>{t.regions}</p>
          <ul className={styles.regionList} aria-labelledby={`${passageId}-regions`}>
            {regions.map((region, index) => (
              <li key={region.id}>
                <button
                  type="button"
                  className={styles.regionButton}
                  aria-pressed={region.id === active.id}
                  aria-controls={passageId}
                  onClick={() => setSelectedId(region.id)}
                >
                  <span className={styles.regionLetter} aria-hidden="true">{letter(index)}</span>
                  <span className={styles.regionText}>
                    <span className={styles.regionRole}>{t.roles[region.role]}</span>
                    <span className={styles.regionWhere} data-derived="1">{where(region)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className={`${styles.record} ${styles.step}`} data-step={t.steps.record}>
        <dl className={styles.recordList}>
          <div>
            <dt>{t.record.passage[0]}</dt>
            <dd>{t.record.passage[1]}</dd>
          </div>
          <div>
            <dt>{t.record.version[0]}</dt>
            <dd><code className={styles.digestShort} data-derived="1">{source.digest.slice(0, 15)}…</code> {t.record.version[1]}</dd>
          </div>
          <div>
            <dt>{t.record.regions[0]}</dt>
            <dd><b className={styles.count} data-derived="1">{regions.length}</b> {t.record.regions[1]}</dd>
          </div>
          {/* "None" is only said while it is true; this workbench renders no claim either way. */}
          {publishableClaims(view).length === 0 ? (
            <div>
              <dt>{t.record.claims[0]}</dt>
              <dd>{t.record.claims[1]}</dd>
            </div>
          ) : null}
        </dl>

        <details className={styles.details}>
          <summary className={styles.detailsSummary}>{t.details}</summary>
          <dl className={styles.detailList}>
            <div><dt>{t.detailFields.file}</dt><dd data-derived="1">{source.filename}</dd></div>
            <div>
              <dt>{t.fields.version}</dt>
              <dd>
                <span data-derived="1">{`${source.form} · ${source.filingDate}`}</span>
                {source.officialFiling
                  ? ` ${t.filing.original}${source.representation === "reference_render" ? ` ${t.filing.render}` : ""}`
                  : null}
              </dd>
            </div>
            <div><dt>{t.detailFields.digest}</dt><dd><code className={styles.digest} data-derived="1">{source.digest}</code></dd></div>
            <div><dt>{t.detailFields.basis}</dt><dd lang="en">{source.rights.basis}</dd></div>
            <div><dt>{t.detailFields.jurisdiction}</dt><dd lang="en">{source.rights.jurisdiction}</dd></div>
            <div><dt>{t.detailFields.attribution}</dt><dd lang="en">{source.rights.attribution}</dd></div>
            <div><dt>{t.detailFields.publication}</dt><dd>{t.publication[source.rights.publication]}</dd></div>
          </dl>
          <ul className={styles.detailRegions}>
            {regions.map((region, index) => (
              <li key={region.id}>
                <span className={styles.regionLetter} aria-hidden="true">{letter(index)}</span>
                <span className={styles.detailRegionText}>
                  <span>{t.roles[region.role]}</span>
                  <code className={styles.digest} data-derived="1">{region.id}</code>
                  <span data-derived="1">{where(region)}</span>
                </span>
                {region.href ? (
                  <Link className={styles.quietLink} href={region.href as Route} prefetch={false}>
                    {t.openRegion}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      </footer>
    </article>
  );
}
