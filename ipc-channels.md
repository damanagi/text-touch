# IPC 채널 명세 (단일 진실 원천)

이 파일은 모든 에이전트가 동기화해야 하는 IPC 채널의 단일 명세다. 변경 시 main.js, preload.js, ipc.js, renderer/editor.js 네 곳을 모두 일치시킨다.

## Renderer → Main (ipcRenderer.invoke)

### `file:openDialog`
- **요청 페이로드:** 없음
- **응답:** `{ path: string, html: string, encoding: string, bom: boolean, lineEnding: '\n' | '\r\n', legacyEncodingWarn: boolean } | null`
- **null인 경우:** 사용자가 다이얼로그 취소
- **에러:** 권한 없음, 파일 없음 → 예외 throw

### `file:load`
- **요청 페이로드:** `{ path: string }`
- **응답:** `file:openDialog`와 동일 형태

### `file:saveOriginal`
- **요청 페이로드:** `{ filePath: string, html: string, encoding: string, bom: boolean, lineEnding: '\n' | '\r\n' }`
- **응답:** `{ success: true, backupPath: string }`
- **에러:** 권한 없음, 디스크 가득 참 등 → 예외 throw, 사용자에게 다이얼로그

### `file:saveAs`
- **요청 페이로드:** `{ suggestedName: string, html: string, encoding: string, bom: boolean, lineEnding: '\n' | '\r\n' }`
- **응답:** `{ success: true, newPath: string } | null`
- **null인 경우:** 사용자가 다이얼로그 취소

## Main → Renderer (webContents.send)

### `open-file-from-os`
- **방향:** Main → Renderer (단방향)
- **페이로드:** `path: string`
- **트리거:** macOS Finder 우클릭 → 다음으로 열기 → htmledit 선택

### `menu-action`
- **방향:** Main → Renderer (단방향)
- **페이로드:** `action: 'open' | 'save' | 'saveAs' | 'toggleEdit'`
- **트리거:** 앱 메뉴의 항목 클릭

## 명세 변경 정책

- **단독 변경 권한:** electron-architect
- **변경 요청 방법:** 다른 에이전트는 SendMessage로 요청
- **변경 시 동기화 대상:** preload.js, main.js, ipc.js, renderer/editor.js (4곳 모두 수정)
- **검증:** integration-qa가 grep으로 4곳 일치 확인
