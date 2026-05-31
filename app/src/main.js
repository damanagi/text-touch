const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const { buildMenu } = require('./menu');
const { registerIpcHandlers, getDirtyState, clearDirtyState } = require('./ipc');

let mainWindow = null;
let pendingFilePath = null;
let isQuitting = false;
let suppressCloseGuard = false; // 저장 완료 후 강제 종료 진입 시 가드 우회

function getMainWindow() {
  return mainWindow;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#1c1c1e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // iframe(srcdoc) 안의 사용자 HTML이 외부 폰트/CSS/이미지를 자유롭게 로드할 수 있게.
      // 로컬 HTML 편집 도구 특성상 보안 트레이드오프 수용.
      webSecurity: false,
      allowRunningInsecureContent: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (pendingFilePath) {
      mainWindow.webContents.send('open-file-from-os', pendingFilePath);
      pendingFilePath = null;
    }
  });

  // 윈도우 닫기 — 저장되지 않은 변경 가드
  mainWindow.on('close', async (e) => {
    if (suppressCloseGuard) return; // 이미 한 번 통과한 경로
    const { currentDirty, currentFileName } = getDirtyState();
    if (!currentDirty) return;

    e.preventDefault();
    try {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['저장', '저장 안 함', '취소'],
        defaultId: 0,
        cancelId: 2,
        message: `'${currentFileName || '문서'}'에 저장되지 않은 변경 사항이 있습니다.`,
        detail: '저장하지 않으면 변경 사항이 손실됩니다.'
      });
      if (result.response === 0) {
        // 저장: 렌더러에 저장 액션 보내고 사용자가 다시 닫기 시도하면 통과되도록 둠
        // (렌더러는 저장 완료 후 win:setDirty(false) 호출)
        mainWindow.webContents.send('menu-action', 'save');
      } else if (result.response === 1) {
        // 저장 안 함: 강제 닫기
        clearDirtyState();
        suppressCloseGuard = true;
        mainWindow.destroy();
      }
      // 취소: 그대로 두면 닫기 취소됨
    } catch (_) {
      // 다이얼로그 실패 시 안전하게 닫지 않음
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 개발 모드: DevTools 열기
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// macOS: Finder에서 우클릭 → 다음으로 열기로 받은 파일
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // OS 최근 문서 등록 — macOS Dock·메뉴에 자동 노출 (다른 플랫폼은 silent noop)
  try { app.addRecentDocument(filePath); } catch (_) { /* noop */ }
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('open-file-from-os', filePath);
  } else {
    pendingFilePath = filePath;
  }
});

// 윈도우 zoom 토글 (더블클릭 zoom 표준 동작 재현)
ipcMain.on('window:toggleZoom', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

// 앱 종료 가드 — ⌘Q, 메뉴 종료 등
app.on('before-quit', async (e) => {
  if (isQuitting) return;
  const { currentDirty, currentFileName } = getDirtyState();
  if (!currentDirty || !mainWindow) return;

  e.preventDefault();
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      message: `'${currentFileName || '문서'}'에 저장되지 않은 변경 사항이 있습니다.`,
      detail: '저장하지 않으면 변경 사항이 손실됩니다.'
    });
    if (result.response === 0) {
      mainWindow.webContents.send('menu-action', 'save');
    } else if (result.response === 1) {
      clearDirtyState();
      isQuitting = true;
      suppressCloseGuard = true;
      app.quit();
    }
    // 취소: 그대로 두면 종료 취소
  } catch (_) {
    // noop
  }
});

app.whenReady().then(() => {
  // fs-handlers에 백업 루트 디렉터리 전달 (macOS는 ~/Library/Application Support/Text Touch)
  process.env.TEXTTOUCH_USER_DATA_DIR = app.getPath('userData');

  registerIpcHandlers(ipcMain, getMainWindow);
  Menu.setApplicationMenu(buildMenu(getMainWindow));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
