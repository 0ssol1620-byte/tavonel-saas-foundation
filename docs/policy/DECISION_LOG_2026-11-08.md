# 결정 기록 — 2026-11-08: Market-No.1 프로그램 창업자 결정 15건을 권고 기본값으로 채택

## 근거

- 창업자 메시지(2026-11-08, 원문): **"파운더 결정 필요한 부분들도 승인할테니 너가 실행하고 완료해줘"**.
  오케스트레이터 세션 `https://claude.ai/code/session_01VrHczyu61HZ4SAvu7trscP`에서 결정 실행 lane에 전달되었다.
- 채택 대상: 프로그램 설계 `PROGRAM-2026-11-04.md` §9의 15건(F-1…F-15)과 각 행의 "권고 기본값". 설계 문서는 AKC
  저장소의 untracked `outputs/tavonel-research-replan-20261013/market-20261104/`에 있고 push되지 않는다.
- 이 기록은 agent가 쓴다. 채택을 기록할 뿐 문구를 승인하지 않는다. 기본값 자체가 **창업자만 줄 수 있는 값**
  (비밀값, 계정, 법률·동의·가격 문구, 사람 이름)을 요구하면 그 칸은 `NEEDS-INPUT`이고, agent가 값을 만들지 않는다.
- 공개 문구에서는 "위임 결정, 2026-11-08(창업자 위임에 따라 오케스트레이터)"로 표시한다. "창업자가 결정했다"로 쓰지 않는다
  (`DECISION_LOG_2026-09-16.md`의 표시 규칙). 뒤집기는 이 파일에 새 항목으로 적는다.
- 특허 출원·공개 시점(F-9)은 이 기록이 정하지 않는다(헌법 "What is not an agent's call").
- **이 저장소는 공개(public)다**(2026-11-08 `gh api`: `private: false`). 프로그램 §9의 F-8·F-9·F-11 기본값과 설계 182행은
  Foundation이 private이라고 가정했다. 그 가정은 틀렸다. 그래서 receipt 없는 숫자, 증명 실행 원자료, 창업자 문서와 그 동의
  receipt는 이 저장소에도 AKC에도 push하지 않는다. 저장소 가시성을 바꿀지는 창업자가 정한다. agent는 바꾸지 않는다.

## 결정

| ID | 질문 | 채택 값 | 상태 | 이 저장소에서의 결과 |
|---|---|---|---|---|
| F-1 | 원격 MCP canary cohort | 창업자 workspace + design partner 최대 2곳(코드 상한 3). 변수는 `TAVONEL_REMOTE_MCP_COHORT`(#190 리뷰 R1 M5로 처리 cohort와 분리됨, `RELEASE_ORDER.md` "원격 MCP" 절) | **NEEDS-INPUT**: workspace key 1–3개, `FOUNDATION_WORKER_SECRET`(32자 이상). 창업자가 Vercel production env에 직접 넣는다 | 없음(env). A1.3 canary 전제 체크리스트는 그대로 |
| F-2 | trial의 AI 접근(키·MCP)과 상한·문구 | 상한: AI 창 14일 · 200 표준 쪽 · World 1개 · 질의 200회/UTC일. 이 네 값은 migration `20261104090000_trial_ai_usage`의 `foundation_trial_policy` 기본값과 같다. production 적용(prod 버전 `20261108055520`)은 campaign ledger 2026-11-08T07:00Z 기록 기준이다. 다시 migrate하지 않는다. connector 없음(`trialScopesAllowed` = `REMOTE_MCP_SCOPES`)과 살아 있는 키 1개는 migration 값이 아니라 기존 코드 규칙이고, 그대로 둔다 | **NEEDS-INPUT**: trial AI 접근 약관 문구(초안: A2.2 lane(agent), 확정: 창업자. 프로그램은 원문을 주지 않는다), 개인정보·처리 약관 갱신 문구가 필요하면 그 문구, `customerData` launch 스위치(P2-37), 창업자 승인 receipt | `nextjs/lib/trial-ai-access.ts` 주석의 F-2 TODO를 "상한 채택, 문구 대기"로 갱신. `TAVONEL_TRIAL_AI_ACCESS_ENABLED`는 문구 확정 전까지 미설정 |
| F-3 | 증명 실행 문서 출처·동의, SEC 발췌 표시 | US-GOV 4 + SEC 3 + KOGL 제1유형 2 + 창업자 문서 1(동의 receipt). GDP set은 내부 측정 전용. SEC 발췌는 사이트에 표시하지 않는다 | 창업자 문서 1건: **NEEDS-INPUT**(문서와 동의 범위) | SEC EDGAR User-Agent 연락처를 아래 "SEC User-Agent"대로 고정 |
| F-4 | `OPERATIONS_ALERT_WEBHOOK_URL` | 창업자 휴대폰에서 받는 Slack 또는 Discord incoming webhook 1개, https 전용 | **NEEDS-INPUT**: URL(비밀값) | 없음(env) |
| F-5 | 제품 안 LLM의 데이터 정책 등급 | **RunPod 자체 호스팅 open-weights만.** 제3자 LLM API는 공개 corpus의 Arena arm으로만. 고객 데이터를 API로 보내는 등급은 별도 결정 | 채택 | `docs/adr/0007-in-product-llm-data-policy.md` |
| F-6 | Ask 근거 생성 개방과 채널 | MCP/REST는 evidence-first + 답변 가능성 게이트. 근거 생성은 web Ask에만, E3 Arena gate 통과 뒤 cohort로 | 채택 | ADR-0007 §2. `TAVONEL_ASK_GENERATION_ENABLED`는 미설정 유지 |
| F-7 | 가격 문구, `purchasePlan.enabled`, Paddle live, 환불·세금 문구 | W4까지 닫아 둔다. sandbox 전 구간 receipt만 준비. 전환은 Gate D 뒤 | W4에 **NEEDS-INPUT**: 가격·환불·세금 문구, Paddle live 자격증명, MoR 계약 확인 | 없음 |
| F-8 | 증명 실행 결과·GDP v4 `NOT_SUPPORTED` 공개, RUN-MANIFEST 서명 방식 | 공개한다. n·분모·한계를 같이 쓴다. RUN-MANIFEST는 **서명 없이 git commit sha에 고정**한다 | 공개·고정 방식 채택. 보관 위치는 **NEEDS-INPUT**(창업자): 프로그램이 정한 "Foundation private"은 이 저장소가 public이라 성립하지 않는다. 저장소를 private으로 돌릴지, 다른 private 위치(예: AKC의 untracked `outputs/`)를 쓸지 창업자가 정한다 | 그 결정 전까지 A4 lane은 증명 실행 원자료를 이 저장소에 push하지 않는다. 공개 숫자는 receipt 규칙 그대로 |
| F-9 | 특허 출원·공개 시점, FTO-1 counsel 검토 | **이 기록은 정하지 않는다.** 별도 lane(AKC PR #152 disclosure 처분 포함). 판단 대기 목록에 더할 것: 이 PR 브랜치(public)의 ADR-0007 §2(E3 설계)는 이미 공개되어 있다. 공개에 해당하는지 분류하는 것은 F-9의 몫이다 | 창업자 | 없음 |
| F-10 | gold 주석·판정 주체 | 창업자 + 지정 검토자 1명(사람 약 4–6일) | **NEEDS-INPUT**: 지정 검토자 이름 | 없음 |
| F-11 | technology intake register owner, NVIDIA auto-ontology 항목 | owner = 창업자, 초안 = agent | 채택. 항목 초안은 register가 공개 AKC에 있으므로 F-9 판단 전에는 push하지 않는다 | 없음 |
| F-12 | 표 판독기 `model_registry` production 행 | D3 Arena gate 통과 뒤 PaddleOCR-VL-1.6 한 행만 | 조건부(D3 gate) | 없음 |
| F-13 | Google Drive OAuth 앱 | Drive read-only 최소 scope, 운영자 소유 앱 | **NEEDS-INPUT**: OAuth client 자격증명, 동의 화면 문구. 정확한 scope 문자열은 D5 qualification이 정한다 | 없음 |
| F-14 | 동일 조건 vendor 비교 | W4에 vendor 2곳, 공개 corpus만, 이기든 지든 공개 | W4에 **NEEDS-INPUT**: vendor 2곳 지정, vendor API 키·결제·약관 확인 | 없음 |
| F-15 | `channel.json` DISTRIBUTION_VERSION 갱신 | 갱신 + changelog | 채택. W1 배포(`7104a3ef`)는 올리지 않고 나갔다 | 다음 배치의 release 커밋에서 한다(아래) |

### SEC User-Agent (handoff 창업자 전용 목록)

SEC fair-access 정책은 요청자 이름과 연락 이메일을 요구한다. 이 저장소가 공개 개인정보 페이지에 이미 게시한 주소
(`nextjs/app/privacy/page.tsx` "Contact": `privacy@tavonel.com`)를 쓴다. 값: **`TAVONEL privacy@tavonel.com`**.

- `nextjs/eval/ask-quality/gen_xbrl_questions.mjs`는 기본값 없이 env `TAVONEL_SEC_USER_AGENT`를 요구한다(fail-closed 유지).
  README와 머리 주석의 실행 예시에 이 값을 쓴다.
- `nextjs/scripts/fetch-explore-sec-corpus.mjs`의 기본값은 이메일이 없다. 이 PR에서는 바꾸지 않는다. 이 경로에는
  repair-scope owner가 없어서 바꾸면 CI가 fail-closed로 멈춘다. 다시 돌릴 때는 env `SEC_USER_AGENT`에 위 값을 넣는다.
  기본값 변경은 owner 매핑과 함께 별도 PR에서 한다.
- AKC 지식 Arena harness의 `KARENA_SEC_USER_AGENT`는 AKC PR #152에 묶여 있어 이 PR 밖이다.

### F-15를 이 PR에서 하지 않는 이유

`55a9254d` 커밋이 정한 규칙이 "distribution version bump와 changelog entry는 배포하는 release가 한다"이다. changelog
항목의 날짜는 그 배포가 tavonel.com에 닿은 서울 날짜여야 하고(`docs/CHANGELOG_ENTRY_RULE.md`), W2 lane이
`tavonel-mcp.mjs`를 더 바꿀 수 있다. 그래서 W2 배치의 release 커밋이 한 번에 한다:

1. `public/developer/tavonel-cli.mjs`, `tavonel-mcp.mjs`의 `DISTRIBUTION_VERSION`과 `channel.json` `version`을
   배포일 기준 `2026.<월>.<일>.1`로, `releasedAt`을 갱신한다.
2. `channel.json`의 `cli`·`mcp` sha256을 디스크에서 다시 계산한다.
3. `lib/developer-distribution.test.ts`의 버전 기대값을 바꾼다.
4. `lib/changelog.ts`에 Developer tools 항목을 넣는다(`version` = 새 버전). 2026.10.2.1 이후 바뀐 것:
   `search_world`의 읽기용 전달 형식(`55a9254d`, `d84788e7`)과 `3282af43`의 문구.

## 부록 — 프로그램 flag 기본값(부록 A, 채택)

| Flag | production 기본값 | 켜는 조건 |
|---|---|---|
| `TAVONEL_REMOTE_MCP_ENABLED` | 미설정 | A1.3 canary 전제(F-1 값 포함) 충족 뒤 |
| `TAVONEL_TRIAL_AI_ACCESS_ENABLED` | 미설정 | F-2 문구(필요 시 개인정보·처리 약관 포함) 확정 + P2-37 + 창업자 승인 receipt |
| `TAVONEL_ASK_RECEIPT_SIGNED` | `off` | W1 `shadow` → W2 `on`(사다리) |
| `TAVONEL_SOURCE_DEDUP_MODE` · `TAVONEL_LIBRARY_ORGANIZE_MODE` · `TAVONEL_CORPUS_REDUCE_MODE` | `off` | 각 사다리의 benchmark gate |
| `TAVONEL_ONTOLOGY_INDUCTION_ENABLED` | 미설정 | C1 gate, 모델 경로는 F-5 |
| `TAVONEL_TYPED_EXTRACTION_MODE` · `TAVONEL_TABLE_READER_MODE` · `TAVONEL_ASK_ANSWERABILITY_MODE` | `off` | 각 사다리 gate(D3는 F-12) |
| `TAVONEL_DELIVERY_FORMAT` | `v1` | C5 |
| `TAVONEL_CORE_V2_REVISION_COMPILE` | 미설정(기존) | B5 |
| `TAVONEL_OCR_PAGE_RANGES_ENABLED`, `FOUNDATION_OCR_PAGE_RANGE_SIZE` | `true`, `8`(기존, 배포됨) | D0 |
| `TAVONEL_CDR_TEXT_LAYER_FIRST` | `"0"` | ADR-2026-11-02 |
| `TAVONEL_ASK_GENERATION_ENABLED` | 미설정 | F-6: E3 Arena gate 뒤 web Ask cohort만 |

mode 값 `on`은 cohort 안에서만 효력이 있다. cohort 밖으로 넓히는 것은 별도 reviewed change다.
