const { dialog, shell } = require('electron');
const fsHandlers = require('./fs-handlers');

// ───────────────────────────────────────────
// Dirty 상태 — 렌더러가 win:setDirty로 주기적으로 알려줌.
// main.js의 close/before-quit가 이 값을 참조해 저장 확인 다이얼로그 표시.
// ───────────────────────────────────────────
let currentDirty = false;
let currentFileName = null;

function getDirtyState() {
  return { currentDirty, currentFileName };
}

function clearDirtyState() {
  currentDirty = false;
  currentFileName = null;
}

// 3-way 저장 확인 다이얼로그 (close/open 전 공통 사용)
async function showSaveConfirmDialog(parentWindow, dirty, fileName) {
  if (!dirty) {
    return { action: 'discard' };
  }
  const result = await dialog.showMessageBox(parentWindow, {
    type: 'warning',
    buttons: ['저장', '저장 안 함', '취소'],
    defaultId: 0,
    cancelId: 2,
    message: `'${fileName || '문서'}'에 저장되지 않은 변경 사항이 있습니다.`,
    detail: '저장하지 않으면 변경 사항이 손실됩니다.'
  });
  if (result.response === 0) return { action: 'save' };
  if (result.response === 1) return { action: 'discard' };
  return { action: 'cancel' };
}

function registerIpcHandlers(ipcMain, getMainWindow) {
  // ─── 기존 파일 채널 ───
  ipcMain.handle('file:openDialog', async () => {
    const w = getMainWindow();
    try {
      return await fsHandlers.openFileDialog(w);
    } catch (e) {
      throw new Error(e.message || '파일을 열 수 없어요.');
    }
  });

  ipcMain.handle('file:load', async (_event, payload) => {
    const { path: filePath } = payload || {};
    if (!filePath) throw new Error('경로가 없어요.');
    try {
      return await fsHandlers.loadFile(filePath);
    } catch (e) {
      throw new Error(e.message || '파일을 읽을 수 없어요.');
    }
  });

  ipcMain.handle('file:saveOriginal', async (_event, payload) => {
    try {
      return await fsHandlers.saveOriginal(payload);
    } catch (e) {
      throw new Error(e.message || '저장 실패');
    }
  });

  ipcMain.handle('file:saveAs', async (_event, payload) => {
    const w = getMainWindow();
    try {
      return await fsHandlers.saveAs(payload, w);
    } catch (e) {
      throw new Error(e.message || '저장 실패');
    }
  });

  // ─── v0.5 신규: 백업 관련 ───
  // fs-keeper가 fs-handlers.js에 listBackups / restoreBackup 함수를 추가하면
  // 자동으로 연결된다. 아직 없으면 통합 단계에서 throw.
  ipcMain.handle('file:listBackups', async (_event, payload) => {
    const { originalPath } = payload || {};
    if (!originalPath) throw new Error('원본 경로가 없어요.');
    if (typeof fsHandlers.listBackups !== 'function') {
      // fs-keeper 미작성 시 안전 폴백 — 빈 배열
      return [];
    }
    try {
      return await fsHandlers.listBackups(originalPath);
    } catch (e) {
      throw new Error(e.message || '백업 목록을 가져올 수 없어요.');
    }
  });

  ipcMain.handle('file:restoreBackup', async (_event, payload) => {
    const { backupPath, targetPath } = payload || {};
    if (!backupPath || !targetPath) throw new Error('백업 또는 대상 경로가 없어요.');
    if (typeof fsHandlers.restoreBackup !== 'function') {
      throw new Error('백업 복원 기능이 아직 준비되지 않았어요.');
    }
    try {
      return await fsHandlers.restoreBackup(backupPath, targetPath);
    } catch (e) {
      throw new Error(e.message || '백업을 복원할 수 없어요.');
    }
  });

  // ─── v0.5 신규: Finder에서 보기 ───
  ipcMain.on('file:revealInFinder', (_event, payload) => {
    const { path: filePath } = payload || {};
    if (!filePath) return;
    try {
      shell.showItemInFolder(filePath);
    } catch (_) { /* noop */ }
  });

  // ─── v0.5 신규: dirty 상태 동기화 ───
  ipcMain.on('win:setDirty', (_event, payload) => {
    const { dirty, fileName } = payload || {};
    currentDirty = !!dirty;
    currentFileName = fileName || null;
  });

  // ─── v0.5 신규: 다른 파일 열기 직전 저장 확인 ───
  ipcMain.handle('win:confirmClose', async (_event, payload) => {
    const { dirty, fileName } = payload || {};
    const w = getMainWindow();
    return await showSaveConfirmDialog(w, !!dirty, fileName);
  });
}

module.exports = {
  registerIpcHandlers,
  getDirtyState,
  clearDirtyState,
  showSaveConfirmDialog
};
