---
name: qa-incremental-check
description: htmledit 앱의 통합 정합성·경계면 버그·OS 연동을 점진적으로 검증한다. 모듈이 완성될 때마다 즉시 인접 모듈과의 경계면을 교차 비교하고, 빌드 후에는 슬라이드형/일반 HTML 두 유형으로 골든 패스를 수행한다. "각자는 통과했지만 합쳐서 깨지는" 버그가 의심되거나, .app 빌드 후 macOS 통합을 검증해야 할 때 반드시 이 스킬을 사용한다.
---

# QA Incremental Check — 경계면 교차 비교 + 골든 패스 레시피

## 왜 점진적 + 경계면 교차 비교인가

모듈마다 자기 단위 테스트만 통과하면 "다 됐다"고 보고하지만, 실제 통합 시 IPC 채널명·페이로드 shape·파일 경로 가정이 어긋나서 깨진다. 빌드가 끝난 뒤 한꺼번에 검증하면 어느 모듈을 손봐야 할지 추적이 어렵다. 그래서 **모듈 완성 즉시 + 인접 모듈만** 좁게 검증한다.

## 경계면 체크리스트 — IPC

이 표를 단일 진실 원천(`ipc-channels.md`)으로 두고, 각 행마다 4곳을 동시에 읽어 비교한다:

| 채널 | preload.js 노출? | main의 ipcMain.handle 등록? | 페이로드 shape 일치? | 응답 shape 일치? |
|-----|-----------------|---------------------------|--------------------|----------------|
| `file:openDialog` | ☐ | ☐ | ☐ | ☐ |
| `file:load` | ☐ | ☐ | ☐ | ☐ |
| `file:saveOriginal` | ☐ | ☐ | ☐ | ☐ |
| `file:saveAs` | ☐ | ☐ | ☐ | ☐ |
| `open-file-from-os` | ☐ (on 리스너) | ☐ (mainWindow.webContents.send) | ☐ | (단방향) |
| `menu-action` | ☐ (on 리스너) | ☐ (mainWindow.webContents.send) | ☐ | (단방향) |

각 칸을 ☑로 채우려면 실제 파일을 grep으로 찾아 비교한다:

```bash
# 예: file:saveOriginal 채널 검증
grep -n "file:saveOriginal" app/src/preload.js
grep -n "file:saveOriginal" app/src/ipc.js
grep -n "saveOriginal" app/src/renderer/editor.js
```

세 결과의 페이로드/응답이 일치하지 않으면 즉시 SendMessage로 담당 에이전트에게 알린다.

## 경계면 체크리스트 — 직렬화

editor-engineer가 직렬화한 HTML이 fs-keeper의 저장 함수와 호환되는지:

- [ ] 직렬화 결과에 `<!DOCTYPE>` 포함
- [ ] `<html>`, `<head>`, `<body>` 모두 유지
- [ ] `<script>`, `<style>` 태그 내용 변경 없음
- [ ] 메타 태그(viewport, charset) 유지
- [ ] 인라인 이벤트 핸들러(`onclick=` 등) 유지

검증 방법:

```bash
# 저장 전후 비교
diff <(htmlbeautify before.html) <(htmlbeautify after.html)
# 의도한 변경(텍스트, style left/top)만 보이고 그 외 모두 동일해야 함
```

## 골든 패스 1: 슬라이드형 HTML

`app/assets/test-slide.html` 준비:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>테스트 슬라이드</title>
  <style>
    body { margin: 0; font-family: -apple-system; }
    .slide { position: relative; width: 1280px; height: 720px; background: #f4f4f4; }
    .title { position: absolute; left: 80px; top: 80px; font-size: 48px; font-weight: bold; }
    .sub { position: absolute; left: 80px; top: 200px; font-size: 24px; color: #555; }
    .item { position: absolute; left: 80px; font-size: 20px; }
    .item-1 { top: 320px; }
    .item-2 { top: 380px; }
  </style>
</head>
<body>
  <div class="slide">
    <div class="title">슬라이드 제목입니다</div>
    <div class="sub">부제 텍스트</div>
    <div class="item item-1">• 항목 하나</div>
    <div class="item item-2">• 항목 둘</div>
  </div>
</body>
</html>
```

시나리오:

1. [ ] 앱에서 파일 열기 → 슬라이드가 그대로 렌더링
2. [ ] [편집 모드 ON]
3. [ ] "슬라이드 제목입니다" 클릭 → 커서 깜빡, "수정한 제목"으로 변경
4. [ ] Alt+드래그로 "부제 텍스트"를 우측으로 100px 이동
5. [ ] Cmd+Z → 부제가 원위치
6. [ ] Cmd+Shift+Z → 다시 이동된 위치
7. [ ] [저장] → 백업 `test-slide.html.bak` 생성 확인
8. [ ] 앱 종료 후 파일 다시 열기 → 변경 사항 유지
9. [ ] 파일을 일반 브라우저(Chrome)에서 직접 열어도 동일하게 보임
10. [ ] DevTools에서 `<style>` 내용이 원본과 글자 단위로 동일

## 골든 패스 2: 일반 본문 HTML

`app/assets/test-prose.html` 준비 — 블로그 글 같은 reflow 레이아웃:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>테스트 본문</title>
  <style>
    body { max-width: 700px; margin: 40px auto; font-family: serif; line-height: 1.7; }
    h1 { font-size: 32px; }
    h2 { font-size: 24px; margin-top: 40px; }
    blockquote { border-left: 3px solid #ccc; padding-left: 16px; color: #555; }
  </style>
</head>
<body>
  <h1>본문 제목</h1>
  <p>첫 단락입니다. 텍스트를 클릭해 수정해보세요.</p>
  <h2>소제목</h2>
  <p>두 번째 단락. <strong>강조 텍스트</strong>도 편집 가능합니다.</p>
  <blockquote>인용문도 편집 대상.</blockquote>
  <ul>
    <li>리스트 항목 1</li>
    <li>리스트 항목 2</li>
  </ul>
</body>
</html>
```

시나리오:

1. [ ] 파일 열기 → 본문 렌더링
2. [ ] [편집 모드 ON]
3. [ ] 모든 단락·제목·리스트 항목·인용문 호버 시 점선 표시
4. [ ] Alt+드래그 시도해도 핸들 안 보임 + 이동 안 됨 (일반 reflow 요소이므로)
5. [ ] "첫 단락입니다"의 "첫" → "첫번째"로 수정
6. [ ] Enter 키 → 새 줄 생성, `<div>` 분할 없이 `<br>`만 삽입 (또는 단락 단위로 처리)
7. [ ] 복사·붙여넣기 시 서식 제거되고 평문만 들어감
8. [ ] [저장] → 백업 생성 + 원본 덮어쓰기
9. [ ] 다시 열어 변경 사항 유지
10. [ ] 인코딩이 UTF-8 그대로, 줄바꿈도 원본 유지

## OS 통합 검증

빌드된 .app에 대해:

1. [ ] `cp -R app/dist/mac-arm64/htmledit.app /Applications/` 후 Finder에서 보임
2. [ ] /Applications/htmledit.app 더블클릭 → 빈 윈도우 열림 (또는 "파일 열기" 안내)
3. [ ] Finder에서 임의의 .html 우클릭 → "다음으로 열기" 목록에 "htmledit" 보임
4. [ ] 그것을 선택 → 앱이 열리고 해당 파일이 자동 로드 (open-file 이벤트 동작)
5. [ ] 앱 메뉴 > "파일" > "열기" → 다이얼로그, .html 필터 적용
6. [ ] Cmd+S 단축키 동작
7. [ ] Cmd+Shift+S 동작 (다른 이름으로 저장)
8. [ ] Cmd+Z / Cmd+Shift+Z 동작
9. [ ] 윈도우 빨간 버튼 클릭 시 dirty 상태면 확인 다이얼로그

## 점진적 QA 시점

| 시점 | 검증할 것 |
|------|----------|
| electron-architect가 main.js 초안 완성 | `npm run dev`로 빈 윈도우 뜨는지 |
| preload.js 완성 | DevTools에서 `window.htmledit` 노출 확인 |
| fs-keeper의 핸들러 완성 | 단독 테스트 스크립트로 saveOriginal 호출 |
| editor-engineer의 텍스트 감지 완성 | test-prose.html 로드 후 호스트 수 확인 |
| editor-engineer의 드래그 완성 | test-slide.html에서 Alt+드래그 |
| electron-architect의 빌드 완성 | .app 생성 + 실행 |
| 빌드 완료 | 골든 패스 1, 2, OS 통합 |

## 버그 보고 형식

발견된 버그는 `_workspace/integration-qa/bugs-found.md`에 다음 형식으로:

```markdown
### BUG-001: 저장 후 파일이 비어있음
- **모듈**: fs-save-backup
- **재현**: test-slide.html 열기 → 텍스트 수정 → 저장
- **예상**: 원본 자리에 수정된 HTML이 저장됨
- **실제**: 파일이 0바이트로 저장됨
- **원인 추정**: atomicWrite의 tmpPath 경로 권한 문제 또는 rename 실패
- **담당**: fs-keeper
- **상태**: 보고 → 수정 중 → 재검증 → 종결
```

## 검증 결과 종합

골든 패스 모두 통과 + 경계면 체크리스트 100% + OS 통합 통과 → 오케스트레이터에 "릴리즈 가능" 보고.

하나라도 미해결이면 명확한 미해결 항목 목록과 함께 보고. "안 됨"이 아니라 "다음 시나리오 N개 미해결".
