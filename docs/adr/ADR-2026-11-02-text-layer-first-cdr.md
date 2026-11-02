# ADR-2026-11-02 — 텍스트 레이어 우선 CDR

- **상태:** Proposed. 코드는 들어갔고 **기본값은 꺼져 있다**(`TAVONEL_CDR_TEXT_LAYER_FIRST` 미설정 또는 `"0"`, `service.yaml`도 `"0"`). 켜는 것, canary, 그리고 OCR을 건너뛰는 단계는 모두 창업자 결정이다.
- **날짜:** 2026-11-02
- **브랜치:** `codex/packet-delivery-textlayer-20261102`, `main` `4252bead` 위.
- **구현:** `quarantine-sidecar/cdr-cloudrun/text_layer.py`, `app.py`의 `POST /v1/text-layer`, `request_boundary.py`의 `AUTHENTICATED_PATHS`, 시험 `tests/test_text_layer.py`.
- **근거 자료(연구 기록, 공개 주장 아님):**
  - `hard-proof-20261027/research/beat-baseline/DIAGNOSIS.md` §0, §4.1, §5 레버 3, §8
  - `hard-proof-20261027/research/beat-baseline/V4-OFFLINE-RECALL.md`
  - core-GDP `research/gdp_pdf_v4_20261027/render.py`(`page_source`, `textlayer_texts`), `PROTOCOL-v4.md` §5, `REPORT-v4.md`

## 1. 문제

CDR은 모든 원본을 PDFium으로 열어 쪽마다 그림으로 다시 만든다(`app.py` `rasterize_to_pdf`, `RENDER_SCALE = 1.5` = 108 DPI). 돌려주는 PDF에는 텍스트 레이어가 없다. 그래서 OCR worker는 원본이 이미 글자로 들고 있던 쪽도 108 DPI 그림에서 다시 읽는다.

GDP.pdf v3 적격 62건에서 잰 것:

- 1,350쪽 중 1,300쪽에 텍스트 레이어가 있었다. 그 1,300쪽이 모두 다시 OCR되었다.
- 판독기 시간은 합계 3,252.6 s(쪽당 2.41 s)였다. 85 s timeout을 넘은 9건 중 8건은 텍스트 레이어가 없는 쪽이 0이다.
- 텍스트 레이어에 있는 기준 숫자 중 OCR이 놓친 것은 0개였다(DIAGNOSIS §0.5). 즉 OCR이 글자를 크게 잃지는 않았다. 문제는 **비용과 시간**이다. 표 구조, 빈 칸 `-`, 문자 치환(`l`→`1`)은 부차적이다.

## 2. 이 결정이 주장하지 않는 것

- **품질 향상을 주장하지 않는다.** v4 확증 실행에서 `compiled_v4_textlayer`는 다수결 전 항목 통과 17/62, native 16/62였다. 순증 +1, McNemar p = 1.0, 판정 `NOT_SUPPORTED`다(`REPORT-v4.md`).
- 오프라인 기준 숫자 recall은 텍스트 레이어 arm이 422/452, OCR 본문 arm이 429/452였다(`V4-OFFLINE-RECALL.md`). **텍스트 레이어 쪽이 7개 적다.** 이 회귀가 없어지기 전에는 OCR을 건너뛰는 단계로 가지 않는다(§7).
- 아래 임계값은 하나도 보정되지 않았다. 고른 값이고, 모든 receipt에 기록되고, canary가 잰다.

## 3. 결정

CDR이 이미 PDFium을 여는 같은 격리 단계 안에서, 같은 프로세스가 원본 PDF의 텍스트 레이어를 **데이터로** 읽는다. 쪽마다 어느 경로가 그 쪽의 텍스트를 만들지 정하고, 그 결정을 receipt로 돌려준다. 래스터 PDF는 그대로 하류가 여는 유일한 문서다.

### 3.1 격리 경계

| 항목 | 규칙 |
|---|---|
| 실행 위치 | `/v1/disarm`과 같은 Cloud Run gen1(gVisor) 컨테이너, 같은 프로세스. `containerConcurrency: 1`, egress는 `service.yaml`대로 VPC 고정(인터넷 경로 없음) |
| 네트워크 | 추출은 네트워크를 쓰지 않는다. 새 외부 호출, 새 서비스, 새 의존성이 없다(`pypdfium2==5.13.0`, `Pillow==12.3.0`은 이미 고정된 것) |
| 입력 경계 | `/v1/disarm`과 같은 HMAC·타임스탬프·request id·입력 digest 계약(`request_boundary.py` `AUTHENTICATED_PATHS`), 같은 ClamAV 판정, 같은 Office 패키지·HTML 거부, 같은 LibreOffice 변환, 같은 쪽 수·픽셀 상한 |
| 출력 | JSON 데이터뿐이다. 문서를 만들지 않는다. 텍스트는 실행·해석·렌더되지 않는다. 래스터 PDF에 텍스트 레이어를 다시 넣지 않는다 |
| hostile document 규칙 | 그대로다. 문서는 적대적 데이터이고, 파싱 모델에게 도구·자격 증명·외부 네트워크가 없다. 레이어 텍스트도 같은 취급이다(하류 packet의 delivery 형식은 텍스트가 header를 위조하지 못하게 한 줄에 가둔다) |
| 꺼짐 | 플래그가 꺼져 있으면 `/v1/text-layer`는 서명 검증 뒤 503이다. 아무것도 읽지 않는다. 4xx가 아닌 것은 worker의 고정 실패 분류(`sanitize.ts` `CDR_DETAIL_FAILURE_CLASS`)가 4xx를 문서에 대한 판정으로 읽기 때문이다 |

### 3.2 쪽 규칙 (위에서부터 처음 맞는 것)

v4 연구 arm의 `page_source`(PROTOCOL-v4.md §5)를, OCR 증인이 아직 없는 CDR 안으로 옮긴 것이다.

| 순서 | 경로 | 조건 | 연구 arm과의 차이 |
|---:|---|---|---|
| 1 | `ocr:no-text-layer` | 레이어에 글자·숫자가 하나도 없다 | 같다 |
| 2 | `ocr:geometry-unsupported` | 회전 ≠ 0, CropBox ≠ MediaBox, MediaBox 원점 ≠ (0, 0) | 같다 |
| 3 | `ocr:hidden-text-suspect` (플래그) | 아래 휴리스틱 중 하나에 걸리는 글자가 **하나라도** 있다(이것이 "보이지 않는 글자 전부"는 아니다. 아래 "휴리스틱의 범위" 표): 보이지 않는 render mode(Tr 3, 7), 글자 자리에 잉크가 없음(흰 글자, 그림·도형 아래 글자, clip으로 전부 가린 글자), 잉크가 글자 픽셀 상자의 0.15(`MIN_INK_COVERAGE`) 미만인 글자(clip이나 나중에 그린 도형이 얇은 띠만 남김), 쪽 밖 글자, 렌더 높이가 4 px(`MIN_GLYPH_PX`, 기본 배율 1.5에서 약 5 pt 글자의 x-height) 미만인 글자(높이는 쪽 좌표의 글자 상자 높이와, 텍스트 행렬의 가장 작은 특잇값 × 글꼴 크기로 잰 em 크기 중 작은 쪽), 다른 텍스트 객체의 글자 상자와 조금이라도 겹치는 글자(보이는 글자 위나 아래에 깐 흰 글자는 그 글자의 잉크를 빌려 쓴다), **같은** 텍스트 객체의 글자와 작은 상자 면적의 0.5(`SAME_OBJECT_OVERLAP_SHARE`) 이상을 함께 차지하는 글자(TJ 배열 하나가 글자마다 뒤로 돌아가면 문장 전체가 글자 한 칸에 쌓인다) | 연구 arm은 OCR 토큰과 비교해 레이어 토큰의 절반 넘게 안 보일 때만 거부했다. 여기는 증인이 렌더 자체이고 허용치가 0이다 |
| 4 | `ocr:image-content` | 쪽 면적의 10% 이상을 그림 객체가 덮는다 | 새 규칙. 스캔 위에 일부만 있는 레이어(연구 arm의 `ocr:layer-sparse`)는 OCR 없이 알 수 없어서, 그림이 글자를 품을 수 있는 쪽은 지금처럼 OCR로 보낸다 |
| 5 | `textlayer` | 나머지 | 같다 |

**"렌더에 보이는가"를 재는 법.** 같은 쪽을 두 번 렌더한다. 한 번은 그대로, 한 번은 맨 위 수준의 텍스트 객체를 지우고. 두 그림의 회색 차이가 48단계를 넘는 픽셀을 잉크로 본다. 글자(문자·숫자)마다 그 글자 상자 안에 잉크가 있는지 본다. 없으면 보이지 않는 글자다. 이 검사는 잉크가 *누구의* 잉크인지 모른다. 또 잉크가 *얼마나* 있는지도 모른다. 그래서 검사를 더한다. 하나, 높이가 4 px 미만인 글자는 잉크가 있어도 사람이 읽을 수 없으므로 보이지 않는 글자로 센다. 높이는 쪽 좌표의 글자 상자 높이와 em 크기 중 작은 쪽이다. em 크기는 PDFium이 글자마다 주는 텍스트 행렬(`FPDFText_GetMatrix`, Tm·cm·Tz가 합쳐진 것)의 가장 작은 특잇값에 글꼴 크기(`FPDFText_GetFontSize`)를 곱한 값이다. 1 pt 글자를 진행 방향으로 30배 늘리고 90° 돌리면 쪽 상자는 높지만 em 크기는 1 pt다(REVIEW-PRODUCT-R3 B1). 같은 값이 Tz로 세게 누른 글자도 잡는다. 둘, 상자 안 잉크 픽셀이 글자 픽셀 상자 면적의 0.15 미만이면 보이지 않는 글자로 센다(`glyphs-partly-inked`). clip이나 나중에 그린 흰 도형이 14 pt 글자의 0.4–2 pt 띠만 남기면 상자마다 잉크가 있지만 그 비율은 0.02–0.12다. 정상 글자(Helvetica, Times, Courier, Helvetica-Bold, Times-Italic, 5–72 pt)는 가장 낮은 것이 Courier 72 pt `i`의 0.185였다. 0.15는 그 사이에서 고른 값이고 보정하지 않았다. 셋, 서로 다른 텍스트 객체(PDFium `FPDFText_GetTextObject`, 고정된 pypdfium2 5.13에 있다)의 글자 상자가 겹치면 두 글자 모두 보이지 않는 글자로 센다. 사람이 읽는 쪽에서는 두 텍스트 객체가 같은 자리에 글자를 놓지 않는다. 넷, 같은 텍스트 객체 안의 두 글자가 작은 상자 면적의 0.5 이상을 함께 차지하면 두 글자 모두 보이지 않는 글자로 센다. 이 경우 상자마다 잉크가 있고(옆 글자의 잉크다), 높이도 정상이고, 다른 객체도 가까이 없다. 그래도 렌더에는 점 하나만 남는다. REVIEW-PRODUCT-R2 probe에서 같은 객체 안 글자 쌍의 최댓값은 정상 문장, 8 pt 각주, kerning 쌍(`AVATAR Wolf`)이 0.0이었고, 쌓은 문장이 1.0이었다. 시험의 kerning 대조(`[(A) 80 (V) 80 …] TJ`)는 0.118이다. 0.5는 그 사이에서 고른 값이고 보정하지 않았다. 이 판정은 모델도 점수도 쓰지 않는다. 두 증인(레이어와 렌더)의 일치·불일치뿐이다. 스칼라 blind quality score로 경로를 고르지 않는다는 헌법 규칙을 지킨다.

**OCR 증인 규칙도 남긴다.** 연구 arm의 규칙(|L| ≥ 20이고 |L − O| / |L| > 0.5 → hidden, |O| ≥ 20이고 |L| < 0.5|O| → sparse)은 `text_layer.ocr_witness_disagrees`로 들어 있다. OCR 판독이 있는 소비자가 shadow 단계에서 비교할 때 쓴다(§7).

**틀리는 방향.** 폼 XObject 안의 텍스트처럼 맨 위 수준에서 지워지지 않는 글자는 차이가 0이라 "보이지 않음"이 되고, 그 쪽은 OCR로 간다. 이 판정의 오류는 OCR 쪽(지금 동작)으로만 난다. 같은 이유로, 가짜 굵은 글씨(같은 글을 조금 비켜 두 번 그림)나 글자마다 따로 그린 객체가 서로 겹치는 쪽, 5 pt 안팎보다 작은 각주도 OCR로 간다. 한 텍스트 객체 안에서 글자 상자를 절반 넘게 겹쳐 그리는 정상 문서(손으로 맞춘 첨자, 일부 문자 체계의 글꼴)도 OCR로 간다. 합성 대조에서 본 것: Times-Italic 알파벳 한 줄(기울어진 상자끼리 겹침), 6 pt Courier, 90°·45°로 돌린 12 pt 정상 글자. 획이 아주 가는 표시용 글꼴은 잉크 비율 0.15 아래로 내려가 OCR로 간다. 그 비율은 shadow에서 잰다.

**이것은 휴리스틱이다. 완전성은 주장하지 않는다.** 원본은 적대적 입력이고, PDF는 글자를 그리는 방법이 셀 수 없이 많다. 위 검사들은 지금까지 시도한 숨김 구성을 막을 뿐이다. 이 목록 밖의 구성이 `textlayer`로 통과할 수 있다고 본다. 그래서 이 규칙은 OCR을 생략할 근거가 되지 못한다(§3.5).

**휴리스틱의 범위: 시도한 구성과 결과.** 고정 pypdfium2 5.13.0, 배율 1.5, 시험 fixture `pdf()`로 만든 합성 PDF다. "잡힘"은 `ocr:hidden-text-suspect`이고 텍스트를 돌려주지 않는다는 뜻이다. "못 잡음"은 `textlayer`로 레이어 텍스트가 나온다는 뜻이다.

| 구성 | 처음 지적 | 결과 | 근거 |
|---|---|---|---|
| 보이는 글 아래·위에 깐 흰 글자, 반 줄 비켜 깐 흰 글자 | R1 B1 | 잡힘(R1부터), `overlapping-glyphs` | 시험 |
| 보이는 글 위의 Tr 3 글자 | R1 nit 2 | 잡힘, `invisible-render-mode`·`overlapping-glyphs` | 시험 |
| 1 pt·2 pt 글자 | R1 B1 | 잡힘(R1부터), `glyphs-too-small` | 시험 |
| 한 TJ 배열이 글자마다 뒤로 돌아가 문장을 한 칸에 쌓음 | R2 B1 | 잡힘(R2부터), `overlapping-glyphs` | 시험 |
| 두 텍스트 객체에 나눠 같은 자리에 쌓음, `Tc` −4 ~ −7.784로 쌓음, `Tm` 0.05배로 점 크기에 쌓음 | R3 probe | 잡힘 | R3 probe |
| clip이나 나중에 그린 흰 사각형이 전부 가림 | R3 probe | 잡힘, `glyphs-without-ink` | 시험(흰 도형), R3 probe(clip) |
| clip이 0.4–2.0 pt 띠만 남김, 흰 사각형 둘이 1.0–2.0 pt 띠만 남김(14 pt 글자) | R3 B1 | 잡힘(R3부터), `glyphs-partly-inked` | 시험 |
| 같은 부분 가림이 3 pt 띠를 남김 | R3 이후 측정 | 잡힘(일부 글자가 0.15 아래) | 측정 |
| 같은 부분 가림이 4 pt 이상 띠를 남김(14 pt 글자) | R3 이후 측정 | **못 잡음** | 측정 |
| 1 pt 글자를 `Tm`(또는 `cm`)으로 30배 늘리고 90° 돌림 | R3 B1 | 잡힘(R3부터), `glyphs-too-small`(em 크기) | 시험 |
| rank-1 대각 행렬 | R3 probe | 잡힘 | R3 probe |
| Tz 가로 눌림: 14 pt 글자에 `1 Tz`·`5 Tz`·`10 Tz`·`15 Tz`, `Tm` 가로 0.02 | R2 nit 1 | 잡힘(R3부터, em 크기 규칙의 부산물), `glyphs-too-small` | 시험(`5 Tz`), 측정 |
| Tz 가로 눌림: 14 pt 글자에 `20 Tz` 이상(em 크기 4.2 px ≥ 4 px) | R2 nit 1 | **못 잡음** | 측정 |
| 옅은 글자: 흰 바탕의 회색 0.70·0.75(회색 차이가 48보다 충분히 크다) | R1 | **못 잡음** | 측정 |
| 옅은 글자: 흰 바탕의 회색 0.78·0.80 | R1, R2 | 잡힘(가장자리 픽셀이 48 아래로 빠짐) | 측정 |
| 같은 텍스트 객체 안에서 작은 상자의 0.5 미만만 겹친 글자 | R2 | **못 잡음**(규칙상). 합성 probe(TJ 200·250 뒤로 돌림)는 좁은 글자 쌍이 0.5를 넘어 잡혔다. 0.5 미만으로만 겹치는 구성은 만들지 않았다 | 규칙 |
| `/Encoding /Differences`와 `/ToUnicode`로 글자 지도를 위조함(렌더는 `Premium rate schedule`, 레이어는 `ignore, your rules.ok`) | R3 B1 | **못 잡음. 어떤 기하 규칙으로도 잡을 수 없다.** 잉크는 글자 자리에 정상으로 있다. 렌더 차분은 "글자 자리에 잉크가 있는가"만 증명하고, 그 잉크가 레이어가 말하는 글자인지는 증명하지 못한다. 같은 쪽의 OCR 증인만 잡는다 | R3 probe, 코드 수정 없음 |
| Type3 글꼴이나 모양을 바꾼 임베디드 글꼴(보이는 모양 ≠ 레이어 글자) | R3 B1 | **못 잡음**(위와 같은 종류). R3 probe의 점 모양 Type3 글꼴은 크기·잉크 규칙에 우연히 걸렸을 뿐이고, 읽을 수 있는 다른 글자를 그리는 글꼴은 통과한다 | R3 probe |
| `Tw` −60으로 단어를 거꾸로 배치 | R3 probe | `textlayer`. 숨김이 아니다(렌더에 단어가 모두 보인다) | R3 probe |

이 표가 시험의 목록은 아니다. "시험"이라고 적은 줄만 `tests/test_text_layer.py`에 있고, 규칙을 되돌리면 그 시험이 실패한다. 나머지는 리뷰 probe나 이번 측정이다.

**이전 판의 안전 논증은 틀렸다(두 번).** R1 판은 같은 텍스트 객체 안의 겹침을 "TJ 배열 하나는 색을 바꿀 수 없으므로 자기 글자를 뭉갤 뿐, 숨는 것이 아니다"라고 적었다. 그렇지 않았다(REVIEW-PRODUCT-R2 B1). R2 판은 "이 범위 밖은 모두 시험이 있다"라고 적었다. 그것도 틀렸다. 부분 가림, 돌려 세운 1 pt 글자, 글자 지도 위조가 그 범위 밖에서 통과했다(REVIEW-PRODUCT-R3 B1). 그래서 이 판은 목록이 완전하다고 적지 않는다.

### 3.3 깨진 레이어: 문서 전체를 거부한다 (fail closed)

다음 중 하나면 쪽 판정이 아니라 `TextLayerCorrupt`다. 그 문서의 레이어 전체를 쓰지 않는다.

- PDFium이 텍스트 레이어를 읽지 못한다, 글자 수가 음수이거나 쪽당 200,000자를 넘는다.
- 코드 포인트가 U+FFFD, NUL, 짝 없는 surrogate다(코드 포인트는 pypdfium2 helper가 아니라 `FPDFText_GetUnicode`로 직접 읽는다. 4.x helper는 쪽 경계 안으로 바꿔 읽고 디코딩 오류를 버리기 때문이다).
- 글자 상자가 유한하지 않다, 두 렌더의 크기가 다르다.
- 그 밖에 이 서비스가 실패하면 receipt 없이 5xx다. 문서에 대한 판정으로 기록되지 않는다.

이때 receipt는 `status: "refused"`, `reason`, 모든 쪽 `ocr:text-layer-refused`다. **그 레이어의 텍스트는 한 글자도 돌려주지 않는다.** 모든 쪽이 지금처럼 OCR로 간다. 조용한 fallback이 아니다: 거부와 이유가 receipt에 남는다.

### 3.4 receipt (`tavonel.cdr_text_layer.v1`)

응답은 JSON 하나다. 헤더 `x-tavonel-input-sha256`(원본 digest), `x-tavonel-text-layer-sha256`(응답 본문 바이트의 sha256), `cache-control: no-store`.

| 필드 | 뜻 |
|---|---|
| `schemaVersion`, `adr` | 이 계약과 이 문서 |
| `status`, `reason` | `extracted` 또는 `refused`와 그 이유 |
| `inputSha256` | 인증된 원본 digest |
| `extractor` | `pdfium`, pypdfium2 버전 |
| `rules` | `inkDelta` 48, `imageAreaShare` 0.10, `unseenGlyphTolerance` 0, `minGlyphPx` 4, `minInkCoverage` 0.15, `sameObjectOverlapShare` 0.5, `renderScale`. 모두 보정하지 않은 값이다 |
| `pages[]` | 쪽 순서. `pageNumber1`, `path`, `flags`, `chars`, (규칙 3까지 간 쪽) `letters`, `unseenLetters`, `imageAreaShare` |
| `pages[].text`, `textSha256`, `lines[]` | **`textlayer` 쪽에만** 있다. `lines[]`는 PDFium 줄마다 `text`와 글자 상자에서 잰 `bbox1000`(왼쪽 위 원점). 만들어 낸 상자는 없다 |
| `pathCounts` | 경로별 쪽 수 |

`path: "textlayer"`는 후보 판정이다. OCR 생략 허가가 아니다(§3.5).

### 3.5 안전 경계: 이 휴리스틱은 OCR 생략을 정하지 않는다 (구속 규칙)

- **텍스트 레이어 경로는 어떤 쪽의 OCR 출력도 대신하지 않는다.** 같은 문서의 shadow OCR 증인이 그 쪽에서 레이어와 일치하고(`ocr_witness_disagrees`가 `None`), 그 일치율이 창업자가 정한 임계값 이상이 되기 전에는 그렇다.
- 이 휴리스틱이 정하는 것은 **경로의 우선순위**뿐이다. 예를 들어 어느 쪽을 shadow에서 먼저 비교할지, 어느 쪽을 `textlayer` 후보로 receipt에 적을지다. **어느 쪽의 OCR을 빼먹을지는 정하지 않는다.**
- 이유는 §3.2 표의 글자 지도 위조다. 렌더 규칙은 그것을 원리적으로 볼 수 없다. OCR 증인만 본다. 그래서 OCR 생략의 전제는 같은 쪽의 OCR 증인 비교다.
- **지금 OCR 생략은 0쪽이다.** worker 쪽(§5)은 구현하지 않았다. `ocr.ts`는 지금도 `sanitized.pdf` 전체를 OCR에 보낸다. CDR 플래그도 기본 꺼짐이다.

## 4. 플래그

| 이름 | 위치 | 값 |
|---|---|---|
| `TAVONEL_CDR_TEXT_LAYER_FIRST` | Cloud Run CDR 환경 변수, `service.yaml` | 미설정 또는 `"0"` = 꺼짐(기본), `"1"` = 켜짐, 그 밖의 값 = 부팅 거부 |

요청마다 읽으므로 다시 빌드하지 않고 켜고 끌 수 있다. 플래그는 이 ADR과 `text_layer.FLAG_ENV`, `text_layer.ADR`, `tests/test_text_layer.py::FlagTest`(service.yaml이 `"0"`으로 배포하는지 확인)가 서로 묶는다.

## 5. worker 인터페이스 계약 (아직 구현하지 않음)

OCR을 할지 정하는 곳은 Cloudflare worker(`quarantine-sidecar/foundation-cdr-worker/src/ocr.ts`)다. 지금은 깨끗한 `sanitized.pdf` 전체를 OCR에 보낸다. 이 브랜치는 worker를 바꾸지 않는다. 쪽 범위 OCR은 다른 lane(`codex/ocr-page-range-20261102`)이 `ocr.ts`를 고치고 있어서, 그 위에 올리는 것이 순서다. 계약은 이렇다.

1. worker 쪽 플래그 `FOUNDATION_CDR_TEXT_LAYER_FIRST=1`일 때만 동작한다.
2. 깨끗한 `/v1/disarm` 뒤, 같은 원본을 새 request id로 `/v1/text-layer`에 보낸다.
3. 응답을 검증한다: 200, `x-tavonel-input-sha256` = 원본 digest, `x-tavonel-text-layer-sha256` = 받은 본문의 sha256, `schemaVersion`, 쪽 수 = `sanitized.pdf` 쪽 수. 하나라도 어긋나면 레이어를 쓰지 않고 지금처럼 전체 OCR, `ocr-review`가 아니라 receipt에 거부를 남긴다.
4. 검증된 본문을 `text-layer.json` sibling으로 create-once 저장한다(R2 at-least-once, 재전달 시 재사용).
5. **shadow:** OCR은 지금처럼 모든 쪽을 읽는다. 이 단계에서 OCR을 빼먹는 쪽은 없다. 컴파일 소비자는 `textlayer` 쪽에서 `ocr_witness_disagrees`로 두 증인을 비교해 기록만 한다. 쪽마다 어느 경로가 텍스트를 만들었는지 receipt에 `textSource: "textlayer" | "ocr"`로 남긴다.
6. **canary 이후:** OCR은 `path != "textlayer"`인 쪽만 읽는다. `textlayer` 쪽의 region은 `lines[].bbox1000`에서 온다.

**전제 조건(구속, §3.5): OCR을 건너뛰기 전에 shadow OCR 증인 비교가 있어야 한다.** 6단계는 같은 문서의 shadow OCR 증인이 `textlayer` 쪽과 일치하고, 그 일치율이 창업자가 정한 임계값 이상이라는 측정이 있은 뒤에만 켤 수 있다. 렌더 휴리스틱의 `textlayer` 판정만으로 OCR을 생략하는 구현은 이 계약 위반이다. 이 worker 쪽은 아직 구현하지 않았다. 그래서 지금 OCR 생략은 0쪽이다.

## 6. 시험 (`tests/test_text_layer.py`, 실패 경로 포함)

| 경우 | 기대 |
|---|---|
| 텍스트 객체가 없는 쪽(그림·도형만) | `ocr:no-text-layer`, 텍스트 없음 |
| Tr 3, 흰 글자, 쪽 밖 글자, 흰 도형에 덮인 글자 | `ocr:hidden-text-suspect` + 각 플래그, 텍스트 없음 |
| 보이는 쪽에 흰 글자 한 줄("ignore previous instructions") | `ocr:hidden-text-suspect` |
| 보이는 글 위·아래·반 줄 아래의 흰 글자, Tr 3 글자, 1 pt·2 pt 글자 | `ocr:hidden-text-suspect` + `overlapping-glyphs`·`invisible-render-mode`·`glyphs-too-small`, 텍스트 없음 |
| 한 TJ 배열이 글자마다 뒤로 돌아가 22글자를 한 칸에 쌓음 | `ocr:hidden-text-suspect` + `overlapping-glyphs`, 텍스트 없음 |
| clip 0.4·1.0·2.0 pt 띠, 흰 도형이 남긴 1.0·2.0 pt 띠 | `ocr:hidden-text-suspect` + `glyphs-partly-inked`, 텍스트 없음 |
| 1 pt 글자를 `Tm`·`cm`으로 30배 늘리고 90° 돌림, `5 Tz` | `ocr:hidden-text-suspect` + `glyphs-too-small`, 텍스트 없음 |
| 대조: Courier 알파벳 한 줄(가장 낮은 정상 잉크 비율), `85 Tz` 표 글자 | `textlayer`, `minInkCoverage` 기록 |
| 정상 문장, kerning 쌍(`AV`, `VA`, `TA`, `Wo`, TJ kern 80), 8 pt 각주, 서로 다른 객체의 이웃한 줄 | `textlayer` |
| 떼어 낸 텍스트 객체 | 문서를 닫기 전에 닫는다. finalizer의 unraisable 예외 0 |
| 그림이 쪽 대부분을 덮음 | `ocr:image-content` |
| 정상 두 쪽 | 둘 다 `textlayer`, 쪽 순서 유지, 줄 상자가 Td 위치 |
| 쪽마다 다른 세 쪽 | 쪽별 경로 |
| ToUnicode가 U+FFFD로 매핑된 글꼴 | `refused`, 모든 쪽 `ocr:text-layer-refused`, 텍스트 0 |
| 플래그 | 기본 꺼짐, `"1"`만 켜짐, 나머지 부팅 거부, service.yaml `"0"` |
| 엔드포인트 | 꺼지면 503, 서명 없으면 401, 켜지면 digest 헤더가 붙은 receipt |

고정 버전 pypdfium2 5.13.0으로 돌린다. CI는 `malware-scan-qualification`의 단위 시험 단계다. 로컬은 그 wheel을 풀어 `sys.path`로만 썼다(설치하지 않음). 4.30에는 `FPDFText_GetTextObject`가 없어서 이 시험이 돌지 않는다.

## 7. 사다리 (compatibility contract → shadow → benchmark → canary → rollout → deprecate)

1. **contract** — 이 ADR과 receipt 스키마. 이 브랜치.
2. **shadow** — CDR 플래그 켬, worker는 §5의 1–5단계. OCR은 줄지 않는다. 잴 것: `textlayer` 쪽 비율, `ocr_witness_disagrees` 불일치율, 쪽별 시간.
3. **benchmark** — 같은 조건에서 기준 숫자 recall이 OCR 기준선보다 낮지 않아야 한다. v4 오프라인 결과(422 대 429/452)는 지금 낮다. 이 회귀가 없어지기 전에는 4단계로 가지 않는다.
4. **canary** — `textlayer` 쪽 OCR 생략, 일부 workspace만. §3.5의 전제(같은 문서 shadow OCR 증인의 일치율이 창업자 임계값 이상)를 채운 뒤에만 간다.
5. **rollout / deprecate** — 결과를 보고 창업자가 정한다.

## 8. 창업자 결정

- 이 격리 경계(CDR 안에서 hostile 원본의 텍스트 레이어를 읽는 범위)를 승인할지. DIAGNOSIS §8이 창업자 결정으로 남긴 항목이다.
- Cloud Run CDR에서 `TAVONEL_CDR_TEXT_LAYER_FIRST=1`로 켤지, 언제(production 배포).
- worker shadow를 켤지, canary 범위와 기간, OCR 생략 단계로 갈 조건.
- **OCR 생략의 전제 조건(구속, §3.5): shadow OCR 증인 비교가 OCR 생략보다 먼저다.** 텍스트 레이어 경로는 같은 문서의 shadow OCR 증인이 그 쪽에서 레이어와 일치하고, 그 일치율이 창업자가 정한 임계값 이상이 되기 전에는 어떤 쪽의 OCR 출력도 대신하지 않는다. 렌더 휴리스틱은 우선순위만 정하고 OCR 생략은 정하지 않는다. 창업자가 정할 것은 그 일치 임계값과 측정 범위다. worker 쪽은 구현되지 않았고 지금 OCR 생략은 0쪽이다.
- 임계값(48, 0.10, 0, 4 px, 잉크 비율 0.15, 같은 객체 겹침 0.5)을 shadow·canary 측정 뒤 바꿀지. 0.5와 0.15는 정상 합성 문서 몇 건과 공격 probe 몇 개 사이에서 고른 값이다. 정상 문서를 OCR로 보내는 비율은 shadow에서 잰다.
- **플래그를 켜기 전에 알아야 할 것.** 휴리스틱이 못 잡는 구성이 있다(§3.2 표): 4 pt 이상 띠를 남긴 부분 가림, `20 Tz` 이상의 가로 눌림, 회색 차이가 충분한 옅은 글자, 0.5 미만의 같은 객체 겹침, 글자 지도·글꼴 모양 위조. 플래그를 켜도 receipt만 생기고 OCR은 줄지 않는다(§3.5). 이 구성들은 shadow OCR 증인 비교가 잰다.

## 9. 되돌리기

플래그를 `"0"`으로 둔다(요청마다 읽으므로 즉시). 코드를 되돌릴 때는 PR #180의 text-layer 커밋(52c10d71, 8a3a0949, 024ae563, 그리고 0e9ca07c의 해당 줄과 Round 1 수정 커밋)을 함께 revert한다. 가장 간단한 것은 PR 전체 revert다. `/v1/disarm`과 래스터 경로는 바뀌지 않았다.
