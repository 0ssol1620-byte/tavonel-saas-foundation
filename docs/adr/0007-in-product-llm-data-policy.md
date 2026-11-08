# ADR-0007 — 제품 안 LLM은 자체 호스팅 open-weights만 쓰고, 근거 생성은 web Ask에만 연다 (F-5, F-6)

- **상태:** 채택(위임 결정, 2026-11-08). 근거는 `docs/policy/DECISION_LOG_2026-11-08.md` F-5·F-6.
- **범위:** 분류(B2b), 스키마 유도(C1), 타입 추출(C2), 근거 생성(E3). OCR 판독기는 이 ADR 밖이다(이미 RunPod).
- **이 ADR이 정하지 않는 것:** 어떤 모델을 쓰는가. 모델은 Model Arena receipt(모델 ID·revision·입력 방식·prompt·schema·가격
  snapshot)와 registry 행(code·weights·dataset·hosted-API licence 네 개를 따로)이 정한다. 이름이나 vendor 점수로 정하지 않는다.

## 1. 데이터 정책 등급 (F-5)

| 등급 | 고객 문서 | 공개 corpus |
|---|---|---|
| RunPod serverless, 자체 호스팅 open-weights (`workers/foundation-knowledge-gpu`, OCR worker와 같은 형태: HMAC, image digest pin) | **허용** | 허용 |
| 제3자 LLM API | **금지** | Arena arm으로만 |

- 고객 데이터가 가는 곳은 OCR이 이미 쓰는 RunPod뿐이다. 새 subprocessor가 생기지 않는다. 다만 `/subprocessors`의 RunPod 행은
  지금 목적을 "Scale-to-zero GPU OCR"로만 적는다(`nextjs/app/subprocessors/page.tsx`). 고객 문서가 knowledge worker로 가는
  첫 canary **전에** 그 행의 목적·데이터 범주 문구를 고쳐야 한다. 그 문구는 공개·법률 문구라 F4 lane과 창업자 확인 대상이다.
- 모델 실행에는 도구·외부 네트워크·자격증명이 없다. 문서는 적대적 데이터다.
- 고객 데이터를 제3자 API로 보내는 등급은 열려 있지 않다. 그것은 동의·subprocessor 문구가 필요한 별도 창업자 결정이고,
  이 ADR을 고쳐서 여는 것이 아니라 새 ADR로 연다.
- registry 행이 없거나 licence 네 개 중 하나라도 미확인인 모델은 고객 문서 경로에 들어가지 않는다(fail-closed).

## 2. Ask 근거 생성의 채널 (F-6)

- **MCP와 REST:** evidence-first를 유지한다(`answerMode: "evidence_excerpts"`, `lib/grounded-ask.ts`). 답변 가능성 게이트(E2)만
  붙인다. MCP 소비자(Claude, ChatGPT)가 이미 생성기이므로 생성을 하나 더 얹지 않는다.
- **workspace web Ask:** 근거 생성(`grounded_generation`, v4 §13.7 계약)은 E3 Arena gate를 통과한 뒤 cohort에만 연다.
  `TAVONEL_ASK_GENERATION_ENABLED`는 그때까지 미설정이다.
- gate: 잘못된 답 비율이 excerpts 경로보다 나쁘지 않음(CI), 검증 안 된 claim이 사용자에게 나간 수 0, 답당 비용 상한.
- 검증에 실패한 claim은 제거하거나 전체를 abstain한다. **더 큰 모델이나 다른 모델로 재시도하지 않는다**(escalation cascade
  금지, IBM US11605028B2 design-around). 게이트는 생성 **전**의 결정적 판정이다.
- rollback: flag 제거. evidence-only 검색은 남는다(v4 PHASE 11).

## 3. 결과

- B2b·C1·C2·E3 lane은 RunPod 자체 호스팅 arm만 고객 경로 후보로 둔다. API arm은 공개 corpus Arena에서 비교 기준으로만 쓴다.
- `/trust`·`/subprocessors`(F4)는 이 등급을 그대로 설명한다. 새 LLM subprocessor를 쓰지 않는다. RunPod 행 목적 문구 갱신은
  고객 문서 canary의 전제 조건이다(위 §1).
