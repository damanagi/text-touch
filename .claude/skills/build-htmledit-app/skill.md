---
name: build-htmledit-app
description: htmledit macOS 데스크탑 앱(로컬 HTML 파일의 텍스트만 인라인 편집하고 원본을 안전하게 덮어쓰는 도구)을 처음부터 .app 산출물까지 빌드하는 오케스트레이터. 4명 에이전트 팀(electron-architect, editor-engineer, fs-keeper, integration-qa)을 구성해 Phase 1~5를 순차/병렬로 진행한다. "htmledit 앱을 만들어줘", "텍스트 에디터 빌드해줘", "/build-htmledit-app" 호출 시 반드시 이 스킬을 사용한다.
---

# Build htmledit App — 오케스트레이터

## 실행 모드

**에이전트 팀**. 4명이 협업하며, electron-architect가 리더(IPC 명세 + 빌드 책임). 팀원 간 직접 통신 + 파일 기반 산출물 전달.

## 팀 구성

```
TeamCreate(
  team_name="htmledit-build",
  members=[
    "electron-architect",  // 셸·IPC·메뉴·빌드
    "editor-engineer",     // 텍스트 감지·contentEditable·드래그
    "fs-keeper",           // 파일 I/O·백업·인코딩
    "integration-qa"       // 점진적 검증
  ]
)
```

전원 `model: "opus"`. Agent 호출 시 반드시 명시.

## 데이터 흐름

```
프로젝트 루트: ~/_workspace/htmledit/

app/
├── package.json
├── src/
│   ├── main.js       ← electron-architect 산출
│   ├── preload.js    ← electron-architect 산출
│   ├── menu.js       ← electron-architect 산출
│   ├── ipc.js        ← electron-architect (fs-keeper 함수 import)
│   └── renderer/
│       ├── index.html ← editor-engineer 산출
│       ├── editor.js  ← editor-engineer 산출
│       ├── drag.js    ← editor-engineer 산출
│       └── styles.css ← editor-engineer 산출
├── assets/
│   ├── icon.icns     ← electron-architect (또는 임시 아이콘)
│   ├── test-slide.html ← integration-qa 산출
│   └── test-prose.html ← integration-qa 산출
└── dist/             ← 빌드 산출물

_workspace/  (중간 산출물, 사후 감사)
├── electron-architect/
├── editor-engineer/
├── fs-keeper/
└── integration-qa/

ipc-channels.md  (단일 진실 원천 — 루트에 배치)
```

**핵심 규칙:** `ipc-channels.md`는 모든 에이전트가 참조하는 단일 명세. electron-architect만 수정 권한. 다른 에이전트는 변경 필요 시 SendMessage로 요청.

## Phase별 진행

### Phase 1 — 스캐폴딩 (electron-architect 단독, ~3분)

- `app/package.json` 작성 (의존성, electron-builder 설정 포함)
- `app/src/main.js` 골격 (BrowserWindow + open-file + ready)
- `app/src/preload.js` 골격 (contextBridge 노출, 채널은 stub)
- `app/src/menu.js`
- `ipc-channels.md` 초안 작성 (electron-shell-build 스킬의 IPC 표 기반)
- `npm install`

**완료 조건:** `cd app && npm run dev` 시 빈 윈도우가 뜨고 DevTools에서 `window.htmledit`가 정의됨.

**완료 시 메시지:** "Phase 1 완료. IPC 채널 명세는 ipc-channels.md에. 다음 단계 시작 가능."

### Phase 2 — 모듈 병렬 작성 (editor-engineer + fs-keeper 동시, ~10분)

병렬:
- **editor-engineer**: `app/src/renderer/` 전체 작성 (html-inline-editor 스킬 따름)
- **fs-keeper**: `app/src/fs-handlers.js` 작성 후 electron-architect에게 전달 → architect가 `app/src/ipc.js`에서 import

editor-engineer는 IPC 호출만 stub으로 두고(window.htmledit.* 호출), 실제 응답은 fs-keeper 완성 후 통합.

**점진적 QA (integration-qa, 이 단계와 동시):**
- editor-engineer가 텍스트 감지 함수 완성 → 즉시 test-prose.html(없으면 생성)로 호스트 수 확인
- fs-keeper가 인코딩 감지 완성 → BOM/no-BOM 두 종 파일로 단위 검증

**완료 조건:**
- editor-engineer: 단독으로 test-slide.html 임포트해서 텍스트 편집·드래그 동작 (저장은 console.log)
- fs-keeper: Node REPL에서 함수 직접 호출 시 백업·저장·인코딩 보존 동작

### Phase 3 — 통합 (전원, ~5분)

- electron-architect가 fs-keeper 함수를 ipc.js에 연결, IPC 핸들러 등록 완성
- editor-engineer의 IPC 호출이 실제 응답 받기 시작
- integration-qa가 경계면 교차 비교 수행 (qa-incremental-check 스킬의 IPC 체크리스트)

발견된 버그는 SendMessage로 담당 에이전트에 즉시 전달. 2회 재실패 시 오케스트레이터 에스컬레이션.

**완료 조건:** `npm run dev` 상태에서 test-slide.html 열기 → 편집 → 저장 → 다시 열어 변경 확인 (골든 패스 1 통과).

### Phase 4 — 빌드 + OS 통합 (electron-architect + integration-qa, ~5분)

- electron-architect: `npm run build` 실행 → `app/dist/mac-arm64/htmledit.app` 생성
- macOS 코드 서명 미적용 — `xattr -cr` 안내
- integration-qa: `.app`을 `/Applications`로 복사 후 OS 통합 체크리스트 수행
  - 우클릭 "다음으로 열기" 목록에 등장 확인
  - 더블클릭 실행
  - 골든 패스 1, 2 재수행

빌드 실패 시 stderr 전문을 `_workspace/electron-architect/build-error.log`에 저장, 사용자에게 보고.

### Phase 5 — 사용자 전달 (오케스트레이터)

- `README.md` 작성 (루트, 사용자가 읽음):
  - 설치 방법 (.app을 Applications로)
  - 첫 실행 시 Gatekeeper 해제 (`xattr -cr`)
  - 기본 사용법 (편집 모드 ON, Alt+드래그, Cmd+S)
  - 백업 위치 안내 (`.bak`, `.bak.1`, `.bak.2`)
  - 알려진 한계 (slide 외 reflow는 이동 불가, euc-kr 등은 utf-8로 변환)
- 사용자에게 .app 위치, README 위치, 빠른 시연 절차 보고

## 에러 핸들링

| 시나리오 | 처리 |
|---------|------|
| npm install 실패 | 1회 재시도 → 실패 시 Node 버전 점검 후 사용자에게 보고 |
| 모듈 작성 중 한 에이전트가 다른 에이전트 산출물을 기다리며 멈춤 | TaskCreate 의존성으로 명시. blockedBy 관계 설정 |
| IPC 채널 명세 충돌 | electron-architect가 단독 결정권. 다른 에이전트는 요청만 |
| 빌드 후 .app이 "손상" 메시지 | `xattr -cr` 안내, README에 명시 |
| 골든 패스 1 또는 2 미통과 | 해당 시나리오의 첫 실패 지점부터 역추적, 담당 에이전트에 수정 요청. 2회 재실패 시 사용자에게 상태 그대로 보고 (숨기지 말 것) |

## 테스트 시나리오 (정상 흐름)

1. 오케스트레이터 시작 → 팀 구성
2. Phase 1 진행, 완료 후 .check
3. Phase 2 병렬 진행, 점진적 QA
4. Phase 3 통합, 골든 패스 1
5. Phase 4 빌드 + OS 통합
6. Phase 5 사용자 전달

## 테스트 시나리오 (에러 흐름)

editor-engineer가 텍스트 감지 함수에서 `<svg>` 내부 텍스트도 편집 가능하게 잘못 노출 → integration-qa가 점진적 QA에서 발견 → editor-engineer에게 SKIP_TAGS에 SVG TEXT 노드 추가 요청 → 수정 후 재검증 통과 → Phase 진행 계속.

## 진행 시 사용자 보고 양식

각 Phase 시작/완료 시 사용자에게:

```
## 🔄 Phase N: [이름] 시작
[수행할 작업 요약]

[테이블 형식: 에이전트 / 상태 / 산출물]
```

```
## ✅ Phase N: [이름] 완료
- 산출물: [파일 목록]
- 다음 단계: Phase N+1
```

## 산출물 체크리스트

오케스트레이터 종료 시:

- [ ] `~/_workspace/htmledit/app/dist/mac-arm64/htmledit.app` 존재
- [ ] `/Applications/htmledit.app` 복사 완료 (또는 사용자에게 명령어 안내)
- [ ] `README.md` 작성 완료
- [ ] 골든 패스 1, 2 모두 통과
- [ ] OS 통합 체크리스트 모두 통과
- [ ] 미통과 항목이 있다면 명시
