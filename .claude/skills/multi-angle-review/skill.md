---
name: multi-angle-review
description: Text Touch(또는 비슷한 데스크탑 앱)를 UX·코드·QA·제품 4가지 독립 관점에서 동시에 검토한다. 4명 전문가를 병렬로 호출해 각자 독립된 보고서를 작성하게 한 뒤, 결과를 통합·우선순위화·중복 제거하여 단일 REVIEW.md로 산출. "다각도 검토", "리뷰", "코드 + UI 종합 평가" 요청 시 반드시 이 스킬을 사용한다.
---

# Multi-Angle Review — 4관점 병렬 검토 오케스트레이터

## 실행 모드

**서브 에이전트**. 의견 오염을 막기 위해 4명을 서로 통신 없이 독립 실행. fan-out → fan-in.

## 4명 구성

| 에이전트 | 관점 | 출력 |
|---------|------|------|
| ux-design-reviewer | UI·인터랙션·접근성 | `_workspace/reviews/01_ux.md` |
| code-architecture-reviewer | 보안·아키텍처·유지보수 | `_workspace/reviews/02_code.md` |
| edge-case-qa-reviewer | 데이터 손실·엣지 케이스 | `_workspace/reviews/03_qa.md` |
| product-value-reviewer | 사용자 가치·우선순위 | `_workspace/reviews/04_product.md` |

전원 `model: "opus"`, `subagent_type: "general-purpose"`, `run_in_background: true`.

## 데이터 흐름

```
[오케스트레이터]
  ├─ Agent(ux-design-reviewer, background)
  ├─ Agent(code-architecture-reviewer, background)
  ├─ Agent(edge-case-qa-reviewer, background)
  └─ Agent(product-value-reviewer, background)

(4명 동시 실행, 평균 5~10분)

  └─ 4개 보고서 수집 → REVIEW.md 통합
```

## 통합 보고서(REVIEW.md) 구조

```markdown
# Text Touch v{ver} — 다각도 검토 종합

## TL;DR (5줄)
가장 시급한 발견 3개, 다음 분기 핵심 결정 1개.

## 1. 발견 매트릭스 (가장 중요)
| 우선순위 | 관점 | 발견 | 영향 | 노력 |
| CRITICAL | QA | EUC-KR 파일 저장 시 ... | 데이터 손실 | M |
| HIGH | UX | ... | ... | S |
| ... |

CRITICAL/HIGH는 모두 나열. MED는 상위 5~7개. LOW는 카운트만.

## 2. 강점 (전체 합의된 것)
4명 중 2명 이상이 강점으로 언급한 항목만.

## 3. 충돌하는 의견 (있다면)
예: UX는 "토스트가 짧다"고, QA는 "토스트가 너무 자주 뜬다"고 할 때 → 사용자 결정 필요.

## 4. 다음 분기(v0.2) 추천 (3~5개)
영향·노력 매트릭스 기반 결정. 한 문장 결정 근거.

## 5. 안 할 일 (스코프 보호)
프로덕트 리뷰가 제시한 것 중 합의된 것.

## 6. 회귀 테스트 우선순위 (QA)
다음 빌드 전 반드시 통과해야 할 시나리오 Top 10.

## 부록: 4개 원본 보고서 링크
- [UX](./_workspace/reviews/01_ux.md)
- [Code](./_workspace/reviews/02_code.md)
- [QA](./_workspace/reviews/03_qa.md)
- [Product](./_workspace/reviews/04_product.md)
```

## 에러 핸들링

- 4명 중 1명이 실패 → 1회 재시도. 재실패 시 그 관점은 비워두고 진행, REVIEW.md에 누락 명시.
- 보고서가 형식을 안 지킴 → 정성적 정보는 그대로 통합 보고서에 인용.
- 동일 항목 중복 발견 → 통합 시 1개로 합치되 4명 중 누가 발견했는지 출처 병기.

## 우선순위 산정 규칙

- **CRITICAL**: 데이터 손실 또는 사용자 신뢰 즉시 깨짐. 다음 빌드 전 무조건 해결.
- **HIGH**: 자주 마주치는 마찰. 2주 내 해결 권장.
- **MED**: 가끔 마주치는 어색함. v0.2 후보.
- **LOW**: 디테일 폴리시. v0.3 이후.

## 테스트 시나리오

정상 흐름: 4명 모두 보고서 작성 완료 → 통합 → 사용자 보고.
에러 흐름: QA 에이전트가 timeout → 1회 재시도 → 그래도 실패 시 "QA 관점 누락 — 사용자 직접 확인 권장" 명시 후 진행.

## 산출물 체크리스트

- [ ] `_workspace/reviews/01_ux.md`
- [ ] `_workspace/reviews/02_code.md`
- [ ] `_workspace/reviews/03_qa.md`
- [ ] `_workspace/reviews/04_product.md`
- [ ] `REVIEW.md` (루트, 사용자가 읽는 최종 산출물)
- [ ] CRITICAL 항목 강조 보고
