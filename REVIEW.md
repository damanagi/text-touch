# Text Touch v0.1.0 — 다각도 검토 종합

> 검토 일시: 2026-05-30
> 4명 독립 검토자: UX/UI · 코드/아키텍처 · 엣지 케이스 QA · 제품 가치
> 발견 총계: **CRITICAL 5 · HIGH 13 · MED 14 · LOW 2** (강점 17 / 약점 26 / v0.2 제안 17)
> 원본 보고서: [01_ux](_workspace/reviews/01_ux.md) · [02_code](_workspace/reviews/02_code.md) · [03_qa](_workspace/reviews/03_qa.md) · [04_product](_workspace/reviews/04_product.md)

---

## TL;DR — 5줄

1. **데이터 손실 위험이 5건 발견**. 모두 v0.1.1로 즉시 핫픽스 권장.
   - EUC-KR/UTF-16 파일을 첫 저장하면 본문이 영구 깨짐 (가장 시급).
   - 저장 안 한 채 ⌘Q·⌘W·⌘O로 다른 파일 열기 → 확인 없이 작업 전체 증발.
   - 백업 회전 부분 실패 시 정상 세대까지 연쇄 손상.
2. **보안 위험 2건**: `webSecurity: false` + 사용자 HTML `<script>` 임의 실행 조합. iframe `sandbox` 속성만 추가해도 큰 차이.
3. **UX HIGH 4건**: ⌘E 단축키 충돌, 색대비 AA 미달, Alt+드래그 어포던스 부재, 포커스 표시 누락. 총 노력 ~반나절.
4. **다음 분기(v0.2) 결정**: "신기능 1개(검색·치환) + 누락분 4개(편집모드 디폴트 ON / 이미지 alt / 최근 파일 / 저장 전 diff)"로 한정. 야심 부풀리지 말 것.
5. **결론**: 동작은 견고하지만 "데이터 손실 못 일으킨다"는 약속이 일부 깨져 있음. v0.1.1 CRITICAL 핫픽스 → v0.2 누락 기능 → 그 후 마케팅.

---

## 1. 발견 매트릭스 (가장 중요)

### CRITICAL — 데이터 손실 또는 사용자 신뢰 즉시 붕괴 (다음 빌드 전 필수)

| # | 관점 | 발견 | 위치 | 노력 |
|---|------|------|------|------|
| C1 | QA + Code | **EUC-KR/CP949 첫 저장 시 한글 영구 손실** — `fs-handlers.js:49`가 비표준 인코딩을 `buf.toString('utf-8')`로 강제 변환. 시뮬레이션 결과 한글 100% U+FFFD로 치환. 토스트만 뜨고 저장은 그대로 진행됨 | `fs-handlers.js:49` `editor.js:386` | M |
| C2 | QA | **UTF-16(LE/BE) 파일이 깨진 채로 저장** — UTF-16BE 분기 없음, BOM 없는 LE는 meta charset 정규식 미매칭 | `fs-handlers.js:42-50, 112-124` | M |
| C3 | QA | **dirty 상태에서 다른 파일 열기 시 확인 다이얼로그 없음** — `applyLoadedFile`이 무조건 `clearHistory()` 호출. 메모리에서 작업 통째 증발 | `editor.js:360` | S |
| C4 | QA | **⌘Q/⌘W 시 dirty 확인 없음** — `main.js`에 `close`/`before-quit` 가드 0건 | `main.js` 전체 | M |
| C5 | QA + Code | **백업 회전 중 부분 실패 시 정상 백업 슬롯 영구 손실** — `rotateBackup`이 rename 3단계 도중 죽으면 한 세대가 비고, 다음 회전이 손상본을 보존하는 방향으로 누적 | `fs-handlers.js:96-106` | S |

### HIGH — 자주 마주치는 마찰, 2주 내 권장

| # | 관점 | 발견 | 위치 | 노력 |
|---|------|------|------|------|
| H1 | Code | **사용자 HTML 임의 `<script>` 실행 + `webSecurity: false`** — iframe sandbox 미적용. file:// 임의 읽기·외부 데이터 유출 표면 | `main.js:24-25` `editor.js:107` | M |
| H2 | Code | **셸 CSP가 사실상 비어있음** — `default-src *` `unsafe-eval` 허용. 향후 의존성 사고 시 마지막 방어선 부재 | `index.html:5` | S |
| H3 | UX | **⌘E 단축키가 macOS 시스템 컨벤션("선택을 검색으로") 침범** — IME 가드도 없어 한글 입력 중 오발동 가능. `⌘⇧E` 또는 `⌘L`로 이동 권장 | `editor.js:532` `menu.js:67` | S |
| H4 | UX | **색대비 WCAG AA 미달** — 빈 상태 메타(`#636366` on `#2c2c2e` = 2.8:1), 힌트 바, 툴바 중앙 텍스트 등 4곳 | `styles.css:51,114,162,167` | S |
| H5 | UX | **Alt+드래그 어포던스 부재** — 슬라이드 박스 옮기는 핵심 동선인데 발견되지 않음. 핸들 아이콘 + Alt 키 감지 시각 신호 필요 | `editor.js:294` `drag.js:82` | M |
| H6 | UX | **포커스 표시(:focus-visible) 누락** — Tab 키 내비게이션 시 어디에 포커스인지 0 단서. WCAG 2.4.7 위배 | `styles.css:79-91` | S |
| H7 | QA | **혼합 줄바꿈(앞 LF / 뒤 CRLF) 저장 시 LF로 통일** — 앞 2KB만 검사하는 한계. Windows 호환성 문제 | `fs-handlers.js:52` | S |
| H8 | QA | **슬라이드 자체 JS가 `addEventListener(keydown, h, true)` + `stopImmediatePropagation`으로 ArrowKey 흡수 시 contentEditable 캐럿 이동 불가** — 등록 순서 의존 | `editor.js:516` | M |
| H9 | QA | **`.tmp.<pid>.<ts>` 잔재 누적** — 강제 종료 후 자동 정리 없음. Finder 폴더 어지러움 | `fs-handlers.js:113` | S |
| H10 | QA + Code | **⌘S 연타 시 in-flight 가드 없음** — 두 번 호출이 백업 회전을 두 번 돌려 정상 세대가 한 칸 더 밀려남 | `editor.js:392` | S |
| H11 | QA | **(L11 라벨 통합) — H10에 흡수** | — | — |
| H12 | UX | **Quick wins: ⌘E + 색대비 + 포커스 합치면 반나절** — v0.1.1에 함께 묶기 권장 | (위 H3·H4·H6) | S |
| H13 | Code | **백업 회전 비원자성** — C5와 동일. 새 백업을 `.bak.tmp.*`로 만들어 검증 후 atomic rename 권장 | `fs-handlers.js:96-106` | S |

### MED — 가끔 마주치는 어색함 (v0.2 후보)

상위 8개만 나열, 나머지 6개는 원본 보고서 참조.

| # | 관점 | 발견 |
|---|------|------|
| M1 | Code | 직렬화 라운드트립 — DOCTYPE legacy-compat 버그 + `outerHTML` 정규화로 git diff 폭발 |
| M2 | UX | 토스트가 ARIA live region 아님 → 스크린리더 묵음. 인코딩 변환은 토스트가 아니라 모달 결정 지점이어야 |
| M3 | Code | 사용자 HTML 상대 경로 자원(`./images/logo.png`)이 `<base>` 주입 없이는 전부 404 |
| M4 | Code | `applyEntry`의 `host.innerHTML = target`이 nested editable 호스트의 이벤트 핸들러를 날림 |
| M5 | UX | 한국어 톤 비일관 — 평어/존댓말/명사 종결이 같은 화면에 혼재 |
| M6 | UX | 신호등 영역 패딩 80px이 풀스크린·Windows에서 어색 (`main.js`에서 platform 분기 필요) |
| M7 | Code | `bindIframeKeyboard` ⌘S/⌘O가 셸 + 메뉴 가속기와 중복 등록 → 이중 발화 |
| M8 | QA | 중첩 contentEditable(`<p>외부<em>강조</em>본문</p>`)에서 undo 한 번이 부모만 복원해 DOM 불일치 |

### LOW — 카운트만

폴더/비-HTML 다중 드롭 시 피드백 부족 (1), 빈 HTML 로드 시 안내 부족 (1).

---

## 2. 합의된 강점 (2명 이상이 언급)

- **iframe.srcdoc 격리**가 정확하고 단단하다 — UX/Code 둘 다 핵심 자산으로 언급. CSS·viewport·JS가 모두 셸에서 분리.
- **백업 + 원자적 쓰기 + 인코딩 보존**의 3단 안전망 — Code/Product/QA가 모두 강점으로 인정. 단, 백업 회전 자체의 원자성은 약점.
- **dirty 상태 4채널 시각 신호** (툴바 중앙 + 타이틀 • + 저장 버튼 주황 + 변경 노드 닷) — UX가 강점으로, 그러나 QA가 "신호만 강하고 액션 가드는 없음(C3·C4)"으로 보강.
- **단일 진실 원천 `ipc-channels.md`** — Code가 작은 프로젝트치곤 IPC 거버넌스가 명확하다고 평가.
- **스코프 선언의 명확성** (슬라이드 A/B 유형 한계 명시) — Product가 "야심 부풀리지 않는 일관된 톤"으로 평가.

---

## 3. 충돌하는 의견

큰 충돌 없음. 다만 다음 두 영역은 우선순위 협상이 필요:

- **백업 ↔ 회전 부분 실패** (Code #3, QA #5): 동일 발견. 해결 코드는 `fs-handlers.js`의 tmp-rename 패턴 한 곳에서 가능. 중복 카운트 X.
- **인코딩 안내 형식** (Product 강점 ↔ UX MED #2, QA C1): Product는 "데이터 손실 방지 일급 시민"이라 평가하지만, UX/QA는 "토스트만으로는 부족, 모달 결정 지점이어야"라고 봄. 결론: 인코딩 경고는 토스트가 아니라 모달 다이얼로그로 격상.

---

## 4. 다음 분기(v0.2) 추천 — 5개

Product reviewer의 영향/노력 매트릭스 기반.

| 우선순위 | 기능 | 영향 | 노력 | 결정 근거 |
|---------|------|------|------|----------|
| **P0** | 검색·치환 (현재 파일) | 9 | 3 | Kay 본인이 슬라이드 30장에서 회사명 한 번에 교체하는 핵심 마찰. 모든 페르소나 도달. |
| **P0** | 편집 모드 디폴트 ON 옵션 | 5 | 1 | 1줄 설정 토글. 슬라이드 류 사용자에게 모드 토글이 추가 마찰. Quick win. |
| **P1** | 이미지 alt·title 사이드 패널 | 6 | 3 | 접근성 + v1 누락분. editor-engineer 정의에서 이미 보류로 적어둠. |
| **P1** | 최근 파일 메뉴 | 4 | 2 | OS 표준. 매월 다수 파일 다루는 일상 사용 절약. |
| **P2** | 저장 전 diff 미리보기 | 7 | 5 | 발표 30분 전 "정말 이거 맞나" 신뢰 자산. 시간 남으면. |

→ **v0.1.1은 데이터 손실 핫픽스만**, v0.2가 위 5개. 신기능 1개 + 누락분 4개.

---

## 5. "안 할 일" — 스코프 보호

매 분기 검토 시 이 줄들로 회귀 (Product reviewer):

1. **풀 HTML 빌더가 되지 않는다** — 요소 추가·삭제·CSS 편집은 Pinegrow의 영역.
2. **마크다운 에디터가 되지 않는다** — 새 문단·헤딩·리스트 *만드는* 도구가 아님.
3. **클라우드/계정/공유 없음** — 로컬 파일과 1:1로만 산다.
4. **다중 사용자 협업 없음** — Notion·Google Docs의 영역.
5. **자체 파일 포맷 없음** — `.txtouch` 같은 것 없음. HTML 원본을 in-place로.
6. **AI 생성 기능 없음** — Text Touch는 *LLM 결과물을 다루는* 도구이지 *부르는* 도구가 아님.
7. **Linux 안 늘림** — macOS + Windows로 정체성 확정.
8. **모바일 없음** — 데스크탑 마우스+키보드 도구.

---

## 6. 회귀 테스트 우선순위 — v0.1.1 빌드 전 통과 필수

QA reviewer가 작성한 15개 시나리오 중 ★(CRITICAL 회귀 가드) 우선:

1. ★ EUC-KR 라운드트립 차단 — 모달 변환 확인 또는 저장 버튼 비활성
2. ★ UTF-16BE 라운드트립 — 0바이트 변화 또는 명시적 거부
3. ★ dirty 상태에서 ⌘O / Finder open / drop 시 3-way confirm 모달
4. ★ dirty 상태에서 ⌘Q/⌘W 시 동일 모달
5. ★ 백업 회전 부분 실패 시 .bak/.bak.1/.bak.2 어느 슬롯도 사라지지 않음
6. ★ ⌘S 연타 재진입 가드
7. CRLF tail-only 파일 라운드트립
8. 슬라이드 ArrowKey + `stopImmediatePropagation` 시 캐럿 이동 보호
9. 강제 종료 후 `.tmp` 자동 정리
10. 빈 상태 hidden 회귀 (이미 수정)
11. CSS 셸 침범 회귀 (이미 수정)
12. "다른 이름" 잘림 회귀 (이미 수정)
13. 더블클릭 zoom 회귀 (이미 수정)
14. 중첩 contentEditable undo
15. 빈 폴더/비-HTML 드롭 안내

---

## 7. 권장 다음 액션 (순서)

```
v0.1.1 (핫픽스, 1~2일)
  ├─ C1: EUC-KR 모달 차단 또는 iconv-lite 도입 (M)
  ├─ C2: UTF-16BE 분기 추가, BOM 없는 UTF-16은 명시 거부 (M)
  ├─ C3: dirty 상태 다른 파일 열기 시 3-way 모달 (S)
  ├─ C4: window close + before-quit 가드 (M)
  ├─ C5: rotateBackup tmp-rename 패턴 (S)
  └─ H10: ⌘S 재진입 가드 (S)

v0.1.2 (보안 + 접근성, 반나절)
  ├─ H1: iframe sandbox + 기본 안전 모드 토글 (M)
  ├─ H2: 셸 CSP 강화 (S)
  ├─ H3: ⌘E → ⌘⇧E 또는 ⌘L + IME 가드 (S)
  ├─ H4: 색대비 AA 통과 토큰 정리 (S)
  ├─ H5: Alt+드래그 핸들 + 키 감지 시각 신호 (M)
  └─ H6: :focus-visible (S)

v0.2.0 (기능, 1~2주)
  ├─ 검색·치환 (P0)
  ├─ 편집 모드 디폴트 ON 옵션 (P0)
  ├─ 이미지 alt 사이드 패널 (P1)
  ├─ 최근 파일 메뉴 (P1)
  └─ 저장 전 diff 미리보기 (P2, 선택)

v0.3 이후
  ├─ 코드 서명 (Apple Developer ID + Windows EV)
  ├─ electron-updater 자동 업데이트
  ├─ parse5 기반 patch-only 저장 (직렬화 라운드트립 정확성)
  └─ 한국 OSS 키우기 (영문 README + GIF + ProductHunt)
```

---

## 8. 메시지/포지셔닝 (Product 권장)

### README 한 줄 카피 — 3가지 톤

- **현행**: "로컬 HTML 파일의 텍스트만 그 자리에서 수정하는 데스크탑 앱 (macOS · Windows)"
- **상황 트리거형(GitHub README 권장)**: "LLM이 만들어준 HTML, 텍스트만 그 자리에서 고치세요. 디자인은 그대로."
- **페르소나형(brunch/LinkedIn 권장)**: "비개발자를 위한, 자족형 HTML 텍스트 인라인 에디터."

### 본인 외 마케팅 타겟 페르소나

- HR/HRD 동료 (현장 트레이너): 워크북·진단 결과지 회사명 교체
- 대학원생/연구자: LLM 리서치 요약 HTML 인용·오탈자 수정
- 컨설턴트/기획자: 인터랙티브 제안서 카피 수정
- 교사/강사: 학습자료 학생 이름·반·날짜 교체

### 운영 단계

A. 본인 사용 도구 유지 (현재) → B. 한국 OSS (사용자 50명) → C. 유료화 (500명). **단계 건너뛰지 말 것.**

---

## 부록 — 4개 원본 보고서

| 보고서 | 줄 수 | 핵심 |
|--------|------|------|
| [01_ux.md](_workspace/reviews/01_ux.md) | 362 | 강점 4 · 약점 7(HIGH 4, MED 3) · v0.2 4 · 비교 7 |
| [02_code.md](_workspace/reviews/02_code.md) | 453 | 강점 5 · 약점 10(HIGH 3, MED 7) · 보안 매트릭스 10항 |
| [03_qa.md](_workspace/reviews/03_qa.md) | 182 | CRITICAL 5 · HIGH 4 · MED 3 · LOW 2 · 데이터 손실 매트릭스 15 |
| [04_product.md](_workspace/reviews/04_product.md) | 160 | 페르소나 7종 · v0.2 5개 · 안 할 일 8 · 메시지 3 |

---

검토 시점: 2026-05-30
검토 모드: 서브 에이전트 fan-out (4명 독립, 의견 오염 없음)
모델: Opus (전원)
