const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { buildMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');

let mainWindow = null;
let pendingFilePath = null;

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

app.whenReady().then(() => {
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
