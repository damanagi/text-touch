const fsHandlers = require('./fs-handlers');

function registerIpcHandlers(ipcMain, getMainWindow) {
  // 파일 열기 다이얼로그 → 로드 결과 반환
  ipcMain.handle('file:openDialog', async () => {
    const w = getMainWindow();
    try {
      return await fsHandlers.openFileDialog(w);
    } catch (e) {
      throw new Error(e.message || '파일을 열 수 없어요.');
    }
  });

  // 경로로 직접 로드
  ipcMain.handle('file:load', async (_event, payload) => {
    const { path: filePath } = payload || {};
    if (!filePath) throw new Error('경로가 없어요.');
    try {
      return await fsHandlers.loadFile(filePath);
    } catch (e) {
      throw new Error(e.message || '파일을 읽을 수 없어요.');
    }
  });

  // 원본 덮어쓰기
  ipcMain.handle('file:saveOriginal', async (_event, payload) => {
    try {
      return await fsHandlers.saveOriginal(payload);
    } catch (e) {
      throw new Error(e.message || '저장 실패');
    }
  });

  // 다른 이름으로 저장
  ipcMain.handle('file:saveAs', async (_event, payload) => {
    const w = getMainWindow();
    try {
      return await fsHandlers.saveAs(payload, w);
    } catch (e) {
      throw new Error(e.message || '저장 실패');
    }
  });
}

module.exports = { registerIpcHandlers };
