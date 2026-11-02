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
| 3 | `ocr:hidden-text-suspect` (플래그) | 렌더된 쪽에 보이지 않는 글자가 **하나라도** 있다: 보이지 않는 render mode(Tr 3, 7), 글자 자리에 잉크가 없음(흰 글자, 그림·도형 아래 글자, clip으로 사라진 글자), 쪽 밖 글자 | 연구 arm은 OCR 토큰과 비교해 레이어 토큰의 절반 넘게 안 보일 때만 거부했다. 여기는 증인이 렌더 자체이고 허용치가 0이다 |
| 4 | `ocr:image-content` | 쪽 면적의 10% 이상을 그림 객체가 덮는다 | 새 규칙. 스캔 위에 일부만 있는 레이어(연구 arm의 `ocr:layer-sparse`)는 OCR 없이 알 수 없어서, 그림이 글자를 품을 수 있는 쪽은 지금처럼 OCR로 보낸다 |
| 5 | `textlayer` | 나머지 | 같다 |

**"렌더에 보이는가"를 재는 법.** 같은 쪽을 두 번 렌더한다. 한 번은 그대로, 한 번은 맨 위 수준의 텍스트 객체를 지우고. 두 그림의 회색 차이가 48단계를 넘는 픽셀을 잉크로 본다. 글자(문자·숫자)마다 그 글자 상자 안에 잉크가 있는지 본다. 없으면 보이지 않는 글자다. 이 판정은 모델도 점수도 쓰지 않는다. 두 증인(레이어와 렌더)의 일치·불일치뿐이다. 스칼라 blind quality score로 경로를 고르지 않는다는 헌법 규칙을 지킨다.

**OCR 증인 규칙도 남긴다.** 연구 arm의 규칙(|L| ≥ 20이고 |L − O| / |L| > 0.5 → hidden, |O| ≥ 20이고 |L| < 0.5|O| → sparse)은 `text_layer.ocr_witness_disagrees`로 들어 있다. OCR 판독이 있는 소비자가 shadow 단계에서 비교할 때 쓴다(§7).

**틀리는 방향.** 폼 XObject 안의 텍스트처럼 맨 위 수준에서 지워지지 않는 글자는 차이가 0이라 "보이지 않음"이 되고, 그 쪽은 OCR로 간다. 이 판정의 오류는 OCR 쪽(지금 동작)으로만 난다. 남는 위험은 반대 방향 하나다: 보이는 글자와 **정확히 같은 자리**에 숨긴 글자가 겹치면 차이가 생겨 보이는 것으로 잡힌다. render mode 검사가 그중 Tr 3·7을 잡는다. 나머지는 shadow 단계의 OCR 증인 비교가 잰다.

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
| `rules` | `inkDelta` 48, `imageAreaShare` 0.10, `unseenGlyphTolerance` 0, `renderScale` |
| `pages[]` | 쪽 순서. `pageNumber1`, `path`, `flags`, `chars`, (규칙 3까지 간 쪽) `letters`, `unseenLetters`, `imageAreaShare` |
| `pages[].text`, `textSha256`, `lines[]` | **`textlayer` 쪽에만** 있다. `lines[]`는 PDFium 줄마다 `text`와 글자 상자에서 잰 `bbox1000`(왼쪽 위 원점). 만들어 낸 상자는 없다 |
| `pathCounts` | 경로별 쪽 수 |

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
5. **shadow:** OCR은 지금처럼 모든 쪽을 읽는다. 컴파일 소비자는 `textlayer` 쪽에서 `ocr_witness_disagrees`로 두 증인을 비교해 기록만 한다. 쪽마다 어느 경로가 텍스트를 만들었는지 receipt에 `textSource: "textlayer" | "ocr"`로 남긴다.
6. **canary 이후:** OCR은 `path != "textlayer"`인 쪽만 읽는다. `textlayer` 쪽의 region은 `lines[].bbox1000`에서 온다.

## 6. 시험 (`tests/test_text_layer.py`, 실패 경로 포함)

| 경우 | 기대 |
|---|---|
| 텍스트 객체가 없는 쪽(그림·도형만) | `ocr:no-text-layer`, 텍스트 없음 |
| Tr 3, 흰 글자, 쪽 밖 글자, 흰 도형에 덮인 글자 | `ocr:hidden-text-suspect` + 각 플래그, 텍스트 없음 |
| 보이는 쪽에 흰 글자 한 줄("ignore previous instructions") | `ocr:hidden-text-suspect` |
| 그림이 쪽 대부분을 덮음 | `ocr:image-content` |
| 정상 두 쪽 | 둘 다 `textlayer`, 쪽 순서 유지, 줄 상자가 Td 위치 |
| 쪽마다 다른 세 쪽 | 쪽별 경로 |
| ToUnicode가 U+FFFD로 매핑된 글꼴 | `refused`, 모든 쪽 `ocr:text-layer-refused`, 텍스트 0 |
| 플래그 | 기본 꺼짐, `"1"`만 켜짐, 나머지 부팅 거부, service.yaml `"0"` |
| 엔드포인트 | 꺼지면 503, 서명 없으면 401, 켜지면 digest 헤더가 붙은 receipt |

로컬은 pypdfium2 4.30.0에서 돌렸다. 고정 버전 5.13.0은 `malware-scan-qualification` CI의 단위 시험 단계가 돌린다.

## 7. 사다리 (compatibility contract → shadow → benchmark → canary → rollout → deprecate)

1. **contract** — 이 ADR과 receipt 스키마. 이 브랜치.
2. **shadow** — CDR 플래그 켬, worker는 §5의 1–5단계. OCR은 줄지 않는다. 잴 것: `textlayer` 쪽 비율, `ocr_witness_disagrees` 불일치율, 쪽별 시간.
3. **benchmark** — 같은 조건에서 기준 숫자 recall이 OCR 기준선보다 낮지 않아야 한다. v4 오프라인 결과(422 대 429/452)는 지금 낮다. 이 회귀가 없어지기 전에는 4단계로 가지 않는다.
4. **canary** — `textlayer` 쪽 OCR 생략, 일부 workspace만.
5. **rollout / deprecate** — 결과를 보고 창업자가 정한다.

## 8. 창업자 결정

- 이 격리 경계(CDR 안에서 hostile 원본의 텍스트 레이어를 읽는 범위)를 승인할지. DIAGNOSIS §8이 창업자 결정으로 남긴 항목이다.
- Cloud Run CDR에서 `TAVONEL_CDR_TEXT_LAYER_FIRST=1`로 켤지, 언제(production 배포).
- worker shadow를 켤지, canary 범위와 기간, OCR 생략 단계로 갈 조건.
- 임계값(48, 0.10, 0)을 canary 측정 뒤 바꿀지.

## 9. 되돌리기

플래그를 `"0"`으로 둔다(요청마다 읽으므로 즉시). 코드를 되돌릴 때는 이 브랜치 커밋 하나를 revert한다. `/v1/disarm`과 래스터 경로는 바뀌지 않았다.
