# IPC 채널 명세 (단일 진실 원천) — v0.5

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
- **응답:** `{ success: true, backupPath: string }` — backupPath는 `~/Library/Application Support/Text Touch/backups/...` (v0.5)
- **에러:** 권한 없음, 디스크 가득 참 등 → 예외 throw, 사용자에게 다이얼로그

### `file:saveAs`
- **요청 페이로드:** `{ suggestedName: string, html: string, encoding: string, bom: boolean, lineEnding: '\n' | '\r\n' }`
- **응답:** `{ success: true, newPath: string } | null`

### `file:listBackups` (v0.5 신규)
- **요청 페이로드:** `{ originalPath: string }`
- **응답:** `[{ path: string, mtime: number (epoch ms), size: number, label: string }]` — 최근순. 비어있으면 `[]`
- **에러:** 백업 디렉터리 없음 → 빈 배열 반환 (에러 X)

### `file:restoreBackup` (v0.5 신규)
- **요청 페이로드:** `{ backupPath: string, targetPath: string }`
- **응답:** `{ success: true, restored: true }`
- **에러:** 경로 불일치 검증 실패 또는 권한 → throw

### `file:revealInFinder` (v0.5 신규)
- **요청 페이로드:** `{ path: string }`
- **응답:** (없음, send 형태)
- **구현:** `shell.showItemInFolder(path)`

### `win:confirmClose` (v0.5 신규)
- **요청 페이로드:** `{ dirty: boolean, fileName: string | null }`
- **응답:** `{ action: 'save' | 'discard' | 'cancel' }`
- **사용:** 렌더러가 dirty 상태일 때 close/open 시 메인 모달을 호출
- **구현:** `dialog.showMessageBox` 3-way

## Main → Renderer (webContents.send)

### `open-file-from-os`
- **방향:** Main → Renderer (단방향)
- **페이로드:** `path: string`
- **트리거:** macOS Finder 우클릭 → 다음으로 열기 → Text Touch 선택

### `menu-action`
- **방향:** Main → Renderer (단방향)
- **페이로드:** `action: string` — 다음 값 중 하나:
  - 기존: `'open' | 'save' | 'saveAs' | 'toggleEdit'`
  - v0.5 신규: `'restoreBackup' | 'revealInFinder' | 'find' | 'findNext' | 'findPrev' | 'replace' | 'format:bold' | 'format:italic' | 'format:underline' | 'format:strikethrough' | 'format:superscript' | 'format:subscript' | 'format:alignLeft' | 'format:alignCenter' | 'format:alignRight' | 'format:alignJustify' | 'format:insertUnorderedList' | 'format:insertOrderedList' | 'format:indent' | 'format:outdent' | 'format:removeFormat'`
- **트리거:** 앱 메뉴의 항목 클릭

## 명세 변경 정책

- **단독 변경 권한:** electron-architect (메뉴/IPC), text-format-engineer (서식 액션 키 이름 합의)
- **변경 요청 방법:** 다른 에이전트는 SendMessage로 요청
- **변경 시 동기화 대상:** preload.js, main.js, ipc.js, renderer/editor.js (4곳 모두 수정)
- **검증:** integration-qa가 grep으로 4곳 일치 확인
