const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('htmledit', {
  // Renderer → Main (invoke)
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  loadFile: (path) => ipcRenderer.invoke('file:load', { path }),
  saveOriginal: (payload) => ipcRenderer.invoke('file:saveOriginal', payload),
  saveAs: (payload) => ipcRenderer.invoke('file:saveAs', payload),

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
