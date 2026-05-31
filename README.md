# Text Touch

로컬 HTML 파일을 **PowerPoint처럼 인라인으로 편집**하는 데스크탑 앱 (macOS · Windows).

> 디자인·구조는 그대로 두고 텍스트와 서식만 그 자리에서 수정합니다. 원본 자리에 안전하게 저장하고, 자동 백업으로 실수도 되돌릴 수 있습니다. LLM이 만든 HTML 슬라이드·리포트·아티팩트를 코드 에디터 켜지 않고 빠르게 다듬을 때 가장 잘 맞습니다.

## 설치

[GitHub Releases](https://github.com/damanagi/text-touch/releases/latest)에서 OS에 맞는 인스톨러를 다운로드하세요.

### macOS (Apple Silicon)

1. `Text Touch-0.6.0-arm64.dmg` 다운로드
2. 더블클릭으로 마운트 → 열린 창에서 **Text Touch.app 아이콘을 Applications 폴더로 드래그**
3. 첫 실행 시 macOS가 "확인되지 않은 개발자" 라고 막을 수 있어요. 터미널에서 한 번만:

   ```bash
   xattr -cr "/Applications/Text Touch.app"
   ```

   또는 시스템 설정 → 개인정보 보호 및 보안 → 하단의 "확인 없이 열기" 클릭.

### Windows (x64)

1. `Text Touch-0.6.0-win-x64.exe` 다운로드
2. 더블클릭 → 설치 마법사 진행 (설치 경로 변경 가능, 바탕화면·시작 메뉴 바로가기 자동 생성)
3. 코드 서명이 없어 SmartScreen이 막으면 **"추가 정보" → "실행"** 클릭
4. 시작 메뉴 또는 바탕화면에서 **Text Touch** 실행

## 사용법

### 파일 열기 3가지 방법

1. 앱 메뉴 (⌘O)
2. 창에 HTML 파일 **드래그앤드롭**
3. **Finder에서 .html 우클릭** → "다음으로 열기" → Text Touch

### PowerPoint 스타일 서식 툴바

편집 모드(⌘⇧E)를 켜면 상단 리본에 **글꼴**과 **단락** 그룹이 활성화됩니다.

- **글꼴**: 글꼴 패밀리 / 크기 / **B I U S** / 위·아래 첨자 / 글자 색 / 형광펜
- **단락**: 글머리 기호 / 번호 매기기 / 내어쓰기 / 들여쓰기 / 정렬 4종 / 서식 지우기

텍스트를 드래그 선택하면 그 자리에 **부동 미니 툴바**가 함께 표시됩니다.

### 단축키 (Word / PowerPoint 표준)

| 키 | 동작 |
|----|------|
| ⌘O / ⌘S / ⌘⇧S | 열기 / 저장 / 다른 이름으로 저장 |
| ⌘Z / ⌘⇧Z | 실행 취소 / 다시 하기 |
| ⌘⇧E | 편집 모드 켜기/끄기 |
| ⌘F / ⌘⇧H / ⌘G / ⌘⇧G | 찾기 / 바꾸기 / 다음 / 이전 |
| ⌘B / ⌘I / ⌘U / ⌘⇧X | 굵게 / 기울임 / 밑줄 / 취소선 |
| ⌘⇧= / ⌘= | 위 첨자 / 아래 첨자 |
| ⌘L / ⌘E / ⌘R / ⌘J | 왼쪽 / 가운데 / 오른쪽 / 양쪽 정렬 |
| ⌘] / ⌘[ | 들여쓰기 / 내어쓰기 |
| ⌘\\ | 서식 지우기 |
| ⌘⇧> / ⌘⇧< | 폰트 크기 단계 키우기 / 작게 |
| ⌘⇧A | 이미지 alt 편집 패널 열기/닫기 |
| Alt + 드래그 | 슬라이드형 HTML에서 텍스트 박스 이동 |

### 슬라이드형 vs 일반 본문 — 드래그 이동 정책

텍스트 박스 위치 이동(Alt+드래그)은 텍스트 박스 **자체가 `position: absolute` 또는 `fixed`로 자유 좌표에 배치된 경우에만** 활성화됩니다.

| 유형 | 예시 | 텍스트 이동 |
|------|------|------|
| **PPT 변환 스타일** | PowerPoint → HTML, Marp 등 | ✅ 가능 |
| **reveal.js 스타일** | make-slide, reveal.js, slidev | ❌ 불가 |
| **일반 본문** | 블로그, 리포트 | ❌ 불가 |

세 유형 모두 **텍스트 편집·서식·페이지 전환(키보드)은 정상 동작**합니다.

## 이미지 alt 사이드 패널 (v0.6)

**보기 → 이미지 alt 편집** 또는 ⌘⇧A 로 우측 패널을 엽니다. 문서 안 모든 이미지가 썸네일·파일명·크기와 함께 목록으로 표시되고, **alt(스크린리더 대체 텍스트)와 title(툴팁)**을 직접 입력할 수 있습니다. 입력 즉시 반영되고 dirty 표시.

## 최근 파일 (v0.6)

**파일 → 최근 파일** 서브메뉴 + macOS Dock 우클릭 메뉴에 자동 등록. 최근 10개 보관. 자체 보관 위치: `~/Library/Application Support/Text Touch/recent.json`.

## 자동 백업

저장할 때마다 자동으로 백업이 만들어집니다. 사용자 폴더는 깔끔하게 유지되도록 **시스템 위치**에 저장됩니다.

```
~/Library/Application Support/Text Touch/backups/
└── {파일별 해시 폴더}/
    ├── original.txt        ← 원본 절대 경로 기록 (복원 검증용)
    ├── 20260531-2310.html  ← 최근 5개 유지, 가장 오래된 것부터 회전
    ├── 20260531-2305.html
    └── ...
```

복구는 **파일 → 백업으로 되돌리기...** 메뉴에서. 시각, 파일 크기를 보고 선택하면 현재 작업 위에 복원됩니다.

## 데이터 안전 (v0.5)

- **저장하지 않은 변경 가드**: ⌘Q · ⌘W · 다른 파일 열기 시 3-way 확인 모달 (저장 / 저장 안 함 / 취소)
- **인코딩 라운드트립**: UTF-8 / UTF-16 / EUC-KR / CP949 / Shift_JIS 등 비표준 인코딩도 `iconv-lite`로 정확히 보존
- **원자적 쓰기**: temp → rename 패턴으로 도중 중단되어도 원본 무사
- **백업 atomic 회전**: 부분 실패 시 정상 백업 슬롯이 손상되지 않도록 tmp → rename 패턴

## 알려진 한계

- **macOS / Windows 지원**: Linux 미지원. macOS는 우클릭 "다음으로 열기", Windows는 우클릭 "연결 프로그램"으로 등록됩니다.
- **첨부 텍스트 서식**만: 이미지·표 삽입, 페이지 레이아웃 변경은 지원하지 않습니다. 도구의 정체성은 *이미 만들어진 디자인의 텍스트와 서식을 다듬는 것*입니다.
- **코드 서명 없음**: 첫 실행 시 Gatekeeper / SmartScreen 우회 절차 필요 (설치 안내 참조).

## 디렉토리 구조

```
~/_workspace/htmledit/
├── app/                    ← Electron 앱 소스
│   ├── package.json
│   ├── src/
│   │   ├── main.js         ← 메인 프로세스 + dirty 가드
│   │   ├── preload.js
│   │   ├── menu.js         ← 파일·편집·서식·보기·윈도우 메뉴
│   │   ├── ipc.js          ← 8개 IPC 채널
│   │   ├── fs-handlers.js  ← iconv-lite·atomic·백업 회전
│   │   └── renderer/
│   │       ├── index.html
│   │       ├── editor.js   ← 컨트롤러 (dirty·undo·iframe wire-up)
│   │       ├── drag.js
│   │       ├── text-format.js    ← 서식 + 단축키 (v0.5 신규)
│   │       ├── find-replace.js   ← 찾기·바꾸기 바 (v0.5 신규)
│   │       ├── mini-toolbar.js   ← 부동 미니 툴바 (v0.5 신규)
│   │       └── styles.css
│   ├── assets/
│   │   ├── icon.icns / icon.ico
│   │   ├── test-slide.html
│   │   └── test-prose.html
│   └── dist/               ← 빌드 산출물
├── .claude/
│   ├── agents/             ← 8명 에이전트 (빌드 4 + 검토 4 + 서식 1)
│   └── skills/             ← 오케스트레이터 스킬
├── contracts/
│   └── v0.5-api.md         ← 5명 병렬 작업 단일 진실 원천
├── ipc-channels.md         ← IPC 명세
├── REVIEW.md               ← v0.1.0 다각도 검토 보고서
└── README.md               ← 이 문서
```

## 재빌드

```bash
cd ~/_workspace/htmledit/app
npm install
npm run build         # macOS DMG
npm run build:win     # Windows EXE
npm run build:dir     # .app만 (DMG 없이)
```

Node.js 22+ 권장.

## 개발 모드

`npm run dev` 로 실행하면 DevTools가 함께 열립니다.

```bash
cd ~/_workspace/htmledit/app
npm run dev
```
