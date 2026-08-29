# 배포 인가 — 커밋 작성자가 게이트다

**기준일:** 2026-08-29 KST
**적용 대상:** `tavonel-saas-foundation` Vercel 프로젝트 전체

---

## 증상

빌드가 아니라 **배포가** 막힌다. GitHub 체크에 `Vercel — Deployment was blocked`가 뜨고,
Vercel 배포 상태는 `BLOCKED`이다. 빌드 로그는 없다 — **빌드가 시작조차 하지 않기 때문이다.**

로컬에서 `tsc`, `eslint`, `vitest`, `next build`가 전부 통과해도 이 실패는 그대로 난다.
코드 문제가 아니다.

## 원인

Vercel이 **git 커밋 작성자**로 배포를 인가한다. 이 프로젝트에서 인가된 계정은
`0ssol1620-byte` / `0ssol1620@gmail.com` 하나다.

2026-08-29 배포 이력 20건을 대조한 결과는 예외가 없었다.

| 커밋 작성자 | 결과 |
|---|---|
| `0ssol1620-byte <0ssol1620@gmail.com>` | `READY` — 전건 |
| `0ssol1620-byte <227160161+0ssol1620-byte@users.noreply.github.com>` | `READY` — 전건 |
| `phillipsoul <yspower1620@gmail.com>` | `BLOCKED` — **전건** |

프리뷰만의 문제가 아니다. `main`의 `675913be`와 `140754df`는 **프로덕션 배포가** 같은 이유로
막혔다. 즉 인가되지 않은 작성자의 커밋은 `main`에 들어가도 배포되지 않는다.

## 조치

저장소 로컬로 고정한다. 전역 설정은 건드리지 않는다 — 다른 프로젝트에서는 다른 identity가
맞을 수 있다.

```bash
cd <repo>
git config user.name  "0ssol1620-byte"
git config user.email "0ssol1620@gmail.com"
```

이미 만들어진 커밋에는 소급 적용되지 않는다. `git commit --amend --reset-author`로 고치거나,
아래 우회로를 쓴다.

## 우회로 — 머지 커밋

인가되지 않은 작성자의 커밋이 이미 브랜치에 있다면, **머지 커밋**으로 `main`에 넣는다.
머지 커밋의 작성자는 머지를 실행한 GitHub 계정이 되므로 배포가 인가된다.

```bash
gh pr merge <n> --merge
```

**squash는 안 된다.** squash 커밋은 원본 커밋의 작성자를 그대로 가져가므로 다시 막힌다.
2026-08-29의 PR #2가 이 경로로 배포됐다(`a23abe5`).

## 진단

체크 이름만 보면 빌드 실패와 구분되지 않는다. 구분하는 법:

```bash
gh api repos/<owner>/<repo>/commits/<sha>/status \
  --jq '.statuses[] | {context, state, description}'
```

`"description": "Deployment was blocked"`이면 인가 문제다. 빌드 실패면 다른 문구가 나온다.

## 하지 말 것

- 배포가 막혔을 때 코드를 고치기 — 빌드는 시작도 하지 않았다
- squash 머지로 우회 시도
- 전역 git identity 변경으로 해결
- 인가 문제를 빌드 실패로 보고
