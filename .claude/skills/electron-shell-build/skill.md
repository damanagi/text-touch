---
name: electron-shell-build
description: Electron 데스크탑 앱의 메인 프로세스·preload·IPC·macOS 메뉴·파일 연결(.html 우클릭 "다음으로 열기")·electron-builder .app 패키징을 수행. 데스크탑 앱을 만들거나 macOS에서 더블클릭으로 실행 가능한 .app을 빌드해야 할 때 반드시 이 스킬을 사용한다. Node.js 의존성 외 추가 도구 없이 동작.
---

# Electron Shell Build — macOS .app 빌드 레시피

## 왜 이 구조를 따르는가

Electron은 두 종류 프로세스를 분리한다. **메인 프로세스**는 OS와 통신하며 파일 시스템, 메뉴, 윈도우를 관리한다. **렌더러 프로세스**는 Chromium 안에서 돌아 사용자 UI만 담당한다. 둘 사이는 IPC로만 통신한다. 이 분리를 무너뜨리면(예: 렌더러에서 직접 fs 호출) 보안 구멍이 생기고 macOS 샌드박스에서 동작이 비일관적이 된다. 그래서 처음부터 **contextIsolation + preload + ipcMain.handle** 패턴을 박아둔다.

## 프로젝트 구조

```
app/
├── package.json          ← electron-builder 설정 포함
├── src/
│   ├── main.js           ← 메인 프로세스 진입점
│   ├── preload.js        ← contextBridge로 IPC 노출
│   ├── menu.js           ← 메뉴 정의
│   ├── ipc.js            ← IPC 핸들러 등록 (fs-save-backup 함수 import)
│   └── renderer/         ← 렌더러 (html-inline-editor 산출물)
│       ├── index.html
│       ├── editor.js
│       ├── drag.js
│       └── styles.css
├── assets/
│   └── icon.icns         ← macOS 앱 아이콘 (512px PNG → .icns 변환)
└── dist/                 ← 빌드 산출물 (electron-builder가 채움)
```

## 의존성

```json
{
  "name": "htmledit",
  "version": "0.1.0",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev",
    "build": "electron-builder --mac --x64 --arm64"
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "electron-builder": "^25.0.0"
  }
}
```

Node.js 22+ 권장 (Electron 32 호환). 사용자 환경의 v25에서 무리 없음.

## main.js 핵심 패턴

```js
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const { buildMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');

let mainWindow = null;
let pendingFilePath = null; // open-file이 ready 전에 오면 보관

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload에서 fs 보조 함수 호출 위함
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset' // macOS 네이티브 느낌
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // 이미 받아둔 파일 경로 있으면 로드
  if (pendingFilePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('open-file-from-os', pendingFilePath);
      pendingFilePath = null;
    });
  }
}

// macOS: Finder에서 우클릭으로 연 파일
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-file-from-os', filePath);
  } else {
    pendingFilePath = filePath;
  }
});

app.whenReady().then(() => {
  registerIpcHandlers(ipcMain);
  Menu.setApplicationMenu(buildMenu(mainWindow));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

## preload.js — 안전한 IPC 노출

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('htmledit', {
  // 파일 열기 (메인이 dialog 띄움)
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  // 경로로 직접 로드
  loadFile: (filePath) => ipcRenderer.invoke('file:load', filePath),
  // 원본 덮어쓰기
  saveOriginal: (filePath, html) => ipcRenderer.invoke('file:saveOriginal', { filePath, html }),
  // 다른 이름으로 저장
  saveAs: (suggestedName, html) => ipcRenderer.invoke('file:saveAs', { suggestedName, html }),
  // OS가 보내준 파일 경로 받기
  onFileFromOS: (callback) => ipcRenderer.on('open-file-from-os', (_, path) => callback(path)),
  // 메뉴 트리거 받기 (예: 메뉴 → "열기")
  onMenuAction: (callback) => ipcRenderer.on('menu-action', (_, action) => callback(action))
});
```

## IPC 채널 명세 (단일 진실 원천)

| 채널 | 방향 | 페이로드 | 응답 | 담당 |
|------|-----|---------|------|------|
| `file:openDialog` | R→M | (없음) | `{path, html, encoding}` 또는 `null` | fs-keeper |
| `file:load` | R→M | `path: string` | `{path, html, encoding}` | fs-keeper |
| `file:saveOriginal` | R→M | `{filePath, html}` | `{success, backupPath}` | fs-keeper |
| `file:saveAs` | R→M | `{suggestedName, html}` | `{success, newPath}` 또는 취소 시 `null` | fs-keeper |
| `open-file-from-os` | M→R | `path: string` | (없음) | electron-architect |
| `menu-action` | M→R | `action: string` | (없음) | electron-architect |

**중요:** 이 표를 바꿀 때는 electron-architect와 editor-engineer와 fs-keeper가 모두 동기화해야 한다. `ipc-channels.md`에 보관하고 모든 에이전트가 참조.

## macOS 메뉴

```js
function buildMenu(window) {
  return Menu.buildFromTemplate([
    {
      label: 'htmledit',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '파일',
      submenu: [
        { label: '열기...', accelerator: 'CmdOrCtrl+O',
          click: () => window.webContents.send('menu-action', 'open') },
        { label: '저장', accelerator: 'CmdOrCtrl+S',
          click: () => window.webContents.send('menu-action', 'save') },
        { label: '다른 이름으로 저장...', accelerator: 'CmdOrCtrl+Shift+S',
          click: () => window.webContents.send('menu-action', 'saveAs') }
      ]
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 하기' },
        { type: 'separator' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' }
      ]
    },
    { role: 'viewMenu' }
  ]);
}
```

> `undo`/`redo`는 렌더러의 자체 undo 스택과 별개. 메뉴는 OS 기본 동작을 트리거하고, 우리 스택은 별도 키 핸들러로 작동. 둘이 충돌하지 않게 editor-engineer가 처리.

## 파일 연결 (.html 우클릭 → "다음으로 열기")

`package.json`의 build 섹션:

```json
{
  "build": {
    "appId": "kr.kay.htmledit",
    "productName": "htmledit",
    "mac": {
      "category": "public.app-category.developer-tools",
      "icon": "assets/icon.icns",
      "target": [
        { "target": "dir", "arch": ["arm64", "x64"] }
      ]
    },
    "fileAssociations": [
      {
        "ext": "html",
        "name": "HTML Document",
        "role": "Editor"
      },
      {
        "ext": "htm",
        "name": "HTML Document",
        "role": "Editor"
      }
    ]
  }
}
```

`role: Editor`로 등록되면 Finder에서 "다음으로 열기" 목록에 자동 등장한다. `target: dir`은 .dmg 없이 .app만 만든다 (사용자가 본인 사용이라 인스톨러 불필요).

## 빌드 절차

```bash
cd app/
npm install
npm run build
# 결과: app/dist/mac-arm64/htmledit.app
```

빌드 후 `/Applications`로 복사하거나 `~/Applications`에 두면 LaunchServices가 자동 인덱싱해 우클릭 메뉴에 노출된다.

```bash
cp -R app/dist/mac-arm64/htmledit.app /Applications/
# LaunchServices 재인덱싱 (선택)
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user
```

## 자주 발생하는 에러

| 증상 | 원인 | 처방 |
|------|------|------|
| 빌드 후 .app 실행 시 "손상되어 열 수 없음" | macOS Gatekeeper가 미서명 앱 차단 | `xattr -cr /Applications/htmledit.app` 후 재실행 |
| 우클릭 메뉴에 안 보임 | LaunchServices 미반영 | 위 lsregister 명령 실행, Finder 재시작 |
| open-file 이벤트가 안 옴 | macOS 외에서 테스트 (Windows/Linux) | macOS에서만 동작. 다른 OS는 argv로 처리 |
| ipcRenderer.invoke가 응답 없음 | ipcMain.handle 미등록 또는 채널명 오타 | `ipc-channels.md`와 실제 코드 교차 검증 |

## 검증 시점

- main.js 작성 직후 → `npm run dev`로 빈 윈도우 뜨는지
- preload.js 작성 직후 → DevTools 콘솔에서 `window.htmledit`가 정의되었는지
- IPC 핸들러 등록 직후 → `window.htmledit.openFileDialog()` 호출이 응답 받는지
- 빌드 직후 → /Applications에 두고 우클릭 메뉴 확인

## 참고

- Electron 공식: https://www.electronjs.org/docs/latest/
- 보안 베스트 프랙티스: contextIsolation + nodeIntegration:false 패턴
- macOS 파일 연결: `app.on('open-file')` 이벤트는 macOS 전용
