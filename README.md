# Text Touch

로컬 HTML 파일의 **텍스트만 그 자리에서 수정**하는 데스크탑 앱 (macOS · Windows).

> 디자인·CSS·스크립트는 한 픽셀도 흔들지 않고, 텍스트와 (슬라이드형 HTML의) 텍스트 상자 위치만 인라인으로 편집합니다. 원본 자리에 저장하거나 다른 이름으로 저장할 수 있고, 저장 전 자동으로 `.bak` 백업을 만듭니다.

## 설치

[GitHub Releases](https://github.com/damanagi/text-touch/releases/latest)에서 OS에 맞는 인스톨러를 다운로드하세요.

### macOS (Apple Silicon)

1. `Text Touch-0.1.0-arm64.dmg` 다운로드
2. 더블클릭으로 마운트 → 열린 창에서 **Text Touch.app 아이콘을 Applications 폴더로 드래그**
3. 첫 실행 시 macOS가 "확인되지 않은 개발자" 라고 막을 수 있어요. 터미널에서 한 번만:

   ```bash
   xattr -cr "/Applications/Text Touch.app"
   ```

   또는 시스템 설정 → 개인정보 보호 및 보안 → 하단의 "확인 없이 열기" 클릭.

### Windows (x64)

1. `Text Touch-0.1.0-win-x64.exe` 다운로드
2. 더블클릭 → 설치 마법사 진행 (설치 경로 변경 가능, 바탕화면·시작 메뉴 바로가기 자동 생성)
3. 코드 서명이 없어 SmartScreen이 막으면 **"추가 정보" → "실행"** 클릭
4. 시작 메뉴 또는 바탕화면에서 **Text Touch** 실행

### 3) 우클릭 메뉴 등록 (자동 인식 안 될 때)

```bash
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user
killall Finder
```

## 사용법

### 파일 열기 3가지 방법

1. 앱을 더블클릭 → 빈 화면에서 ⌘O 또는 [열기] 버튼
2. **HTML 파일을 앱 창으로 드래그앤드롭**
3. **Finder에서 .html 우클릭 → "다음으로 열기" → Text Touch**

### 편집

| 단축키 | 동작 |
|--------|------|
| ⌘E | 편집 모드 ON/OFF |
| 텍스트 클릭 | 그 자리에서 수정 |
| Alt + 드래그 | 슬라이드형 HTML에서 텍스트 상자 이동 |
| Enter | 줄바꿈 (`<br>`) |
| ⌘Z / ⌘⇧Z | 실행 취소 / 다시 하기 |
| ⌘C / ⌘V | 복사 / 붙여넣기 (서식 제거) |
| ⌘S | 저장 (원본 덮어쓰기, `.bak` 자동 생성) |
| ⌘⇧S | 다른 이름으로 저장 |

### 슬라이드형 vs 일반 본문 — 드래그 이동 정책

텍스트 박스 위치 이동(Alt+드래그)은 텍스트 박스 **자체가 `position: absolute` 또는 `fixed`로 자유 좌표에 배치된 경우에만** 활성화됩니다. 슬라이드 HTML은 두 종류로 나뉘는데, 동작이 다릅니다.

| 유형 | 예시 | 텍스트 이동 |
|------|------|------|
| **A. PPT 변환 스타일** | PowerPoint→HTML, Marp, 일부 단일 페이지 슬라이드 | ✅ 가능 — 텍스트 박스가 자유 좌표 |
| **B. reveal.js 스타일** | make-slide, reveal.js, slidev | ❌ 불가 — 텍스트가 flex/grid 자식이라 좌표 개념 없음 |
| **일반 본문** | 블로그, 리포트 | ❌ 불가 — reflow 레이아웃 |

A·B 모두 **텍스트 편집(클릭→수정)과 페이지 전환(키보드)은 정상 동작**합니다. 이 정책은 "옮긴 결과가 디자인을 안전하게 보존해야 한다"는 원칙에서 나온 것입니다. B 타입 슬라이드에서 텍스트를 강제로 옮기면 다음 페이지 전환 시 위치가 초기화되거나 다른 요소와 겹칠 수 있어 의도적으로 비활성화했습니다.

## 백업

저장할 때마다 자동으로 백업이 만들어집니다. 같은 폴더에:

```
my-slide.html        ← 현재
my-slide.html.bak    ← 가장 최근 백업 (저장 직전)
my-slide.html.bak.1  ← 한 번 전
my-slide.html.bak.2  ← 두 번 전
```

복구하려면:

```bash
mv my-slide.html.bak my-slide.html
```

## 알려진 한계

- **인코딩**: UTF-8과 UTF-16만 안전 지원. EUC-KR 등은 UTF-8로 변환되어 저장됩니다 (원본은 `.bak`에 안전).
- **외부 자원**: HTML이 절대 경로로 외부 CSS/JS/이미지를 참조하면 미리보기에서 깨질 수 있습니다. 자족형(self-contained) 단일 HTML 파일에 최적화되어 있습니다.
- **SVG 내부 텍스트**: 편집 비활성. SVG 안의 텍스트를 수정하려면 코드 에디터를 쓰세요.
- **큰 파일**: 5만 노드 이상은 로딩이 느릴 수 있습니다.
- **macOS / Windows 지원**: Linux 미지원. macOS는 우클릭 "다음으로 열기", Windows는 우클릭 "연결 프로그램"으로 등록됩니다.

## 디렉토리 구조

```
~/_workspace/Text Touch/
├── app/                ← Electron 앱 코드
│   ├── package.json
│   ├── src/
│   │   ├── main.js
│   │   ├── preload.js
│   │   ├── menu.js
│   │   ├── ipc.js
│   │   ├── fs-handlers.js
│   │   └── renderer/
│   │       ├── index.html
│   │       ├── editor.js
│   │       ├── drag.js
│   │       └── styles.css
│   ├── assets/
│   │   ├── test-slide.html
│   │   └── test-prose.html
│   └── dist/           ← 빌드 산출물
├── .claude/
│   ├── agents/         ← 하네스 에이전트 정의
│   └── skills/         ← 하네스 스킬 (재빌드 시 참조)
├── ipc-channels.md     ← IPC 명세 단일 진실 원천
└── README.md           ← 이 문서
```

## 재빌드

코드를 수정한 뒤:

```bash
cd ~/_workspace/Text Touch/app
npm run build
cp -R dist/mac-arm64/Text Touch.app /Applications/
xattr -cr /Applications/Text Touch.app
```

## 개발 모드

`npm run dev` 로 실행하면 DevTools가 함께 열립니다.

```bash
cd ~/_workspace/Text Touch/app
npm run dev
```
