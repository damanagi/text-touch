const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('htmledit', {
  // ─── 기존: Renderer → Main (invoke) ───
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  loadFile: (path) => ipcRenderer.invoke('file:load', { path }),
  saveOriginal: (payload) => ipcRenderer.invoke('file:saveOriginal', payload),
  saveAs: (payload) => ipcRenderer.invoke('file:saveAs', payload),

  // ─── v0.5 신규: 백업 ───
  listBackups: (originalPath) => ipcRenderer.invoke('file:listBackups', { originalPath }),
  restoreBackup: (backupPath, targetPath) =>
    ipcRenderer.invoke('file:restoreBackup', { backupPath, targetPath }),

  // ─── v0.5 신규: Finder에서 보기 (send) ───
  revealInFinder: (path) => ipcRenderer.send('file:revealInFinder', { path }),

  // ─── v0.5 신규: 윈도우 dirty 동기화 ───
  confirmClose: (dirty, fileName) =>
    ipcRenderer.invoke('win:confirmClose', { dirty, fileName }),
  setDirty: (dirty, fileName) =>
    ipcRenderer.send('win:setDirty', { dirty, fileName }),

  // 드래그앤드롭으로 떨어진 File에서 절대 경로 추출
  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file.path || null;
    }
  },

  // 윈도우 zoom (macOS 표준 동작 — 더블클릭으로 최대화/원복 토글)
  toggleZoom: () => ipcRenderer.send('window:toggleZoom'),

  // Main → Renderer (listener 등록)
  onFileFromOS: (callback) => {
    ipcRenderer.on('open-file-from-os', (_event, path) => callback(path));
  },
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  }
});
