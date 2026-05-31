// Text Touch 렌더러 (iframe 격리 버전) — v0.5
// - 사용자 HTML은 iframe.srcdoc으로 마운트되어 CSS/JS/viewport가 완전 격리
// - 셸의 toolbar/hint-bar는 사용자 CSS의 영향을 받지 않음
// - contentEditable/드래그/단축키는 iframe.contentDocument 안에서 동작
// - v0.5: text-format/find-replace/mini-toolbar 모듈 wire-up,
//   dirty 가드, ⌘E → ⌘⇧E 단축키 이동, iframe sandbox, 백업 복원 모달.

(function () {
  'use strict';

  // ─── 상태 ──────────────────────────────────
  const state = {
    filePath: null,
    dir: null,  // v0.6: 원본 파일의 부모 디렉터리 (base 주입용)
    encoding: 'utf-8',
    bom: false,
    lineEnding: '\n',
    iframeDoc: null,
    editMode: false,
    dirty: false,
    undoStack: [],
    redoStack: [],
    isApplyingHistory: false
  };

  // H10: 저장 in-flight 가드 (중복 save 방지)
  let saving = false;

  const MAX_HISTORY = 300;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
    'TITLE', 'META', 'LINK', 'HEAD',
    'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED'
  ]);

  // ─── DOM 참조 (셸 — 우리 윈도우) ───────────
  const dom = {
    btnOpen: document.getElementById('btn-open'),
    btnEditToggle: document.getElementById('btn-edit-toggle'),
    btnUndo: document.getElementById('btn-undo'),
    btnRedo: document.getElementById('btn-redo'),
    btnSave: document.getElementById('btn-save'),
    btnSaveAs: document.getElementById('btn-save-as'),
    fileInfo: document.getElementById('file-info'),
    hintBar: document.getElementById('hint-bar'),
    hintText: document.getElementById('hint-text'),
    emptyState: document.getElementById('empty-state'),
    contentFrame: document.getElementById('content-frame'),
    toast: document.getElementById('toast'),
    formatBar: document.getElementById('format-bar'),
    restoreModal: document.getElementById('restore-modal'),
    restoreList: document.getElementById('restore-list'),
    restoreCancel: document.getElementById('restore-cancel')
  };

  // ─── 토스트 ────────────────────────────────
  let toastTimer = null;
  function showToast(msg, kind) {
    dom.toast.textContent = msg;
    dom.toast.className = kind || '';
    dom.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dom.toast.hidden = true;
    }, kind === 'error' ? 6000 : 3000);
  }

  // ─── 힌트 바 ───────────────────────────────
  function setHint(text) {
    dom.hintText.textContent = text || '';
    dom.hintBar.classList.toggle('empty', !text);
  }

  // ─── 파일 정보 / 타이틀 ─────────────────────
  function updateFileInfo() {
    let label = '파일을 열어주세요';
    if (state.filePath) {
      const name = state.filePath.split('/').pop();
      label = name + (state.dirty ? ' • 저장되지 않음' : '');
    }
    dom.fileInfo.textContent = label;
    document.title = state.filePath
      ? `${state.filePath.split('/').pop()}${state.dirty ? ' •' : ''} — Text Touch`
      : 'Text Touch';
  }

  function updateButtons() {
    const hasFile = !!state.filePath;
    dom.btnSave.disabled = !hasFile;
    dom.btnSaveAs.disabled = !hasFile;
    dom.btnEditToggle.disabled = !hasFile;
    dom.btnEditToggle.classList.toggle('active', state.editMode);
    dom.btnSave.classList.toggle('dirty', state.dirty);
    dom.btnUndo.disabled = state.undoStack.length === 0;
    dom.btnRedo.disabled = state.redoStack.length === 0;
  }

  // v0.6: 사용자 HTML의 상대 경로 자원(./images/foo.png 등) 로드를 위해 <base> 태그 주입
  function injectBase(htmlString, baseDir) {
    if (!baseDir || /<base\b/i.test(htmlString)) return htmlString;
    // file:// URL 인코딩 (공백 + 한글 처리)
    const parts = baseDir.split('/').map(p => encodeURIComponent(p));
    const fileUrl = 'file://' + parts.join('/') + '/';
    const baseTag = `<base href="${fileUrl}" data-htmledit-injected="base">`;
    if (/<head\b[^>]*>/i.test(htmlString)) {
      return htmlString.replace(/<head\b[^>]*>/i, m => m + baseTag);
    }
    if (/<html\b[^>]*>/i.test(htmlString)) {
      return htmlString.replace(/<html\b[^>]*>/i, m => m + '<head>' + baseTag + '</head>');
    }
    return '<!DOCTYPE html><head>' + baseTag + '</head>' + htmlString;
  }

  // ─── iframe 마운트 ──────────────────────────
  function mountDocument(htmlString) {
    return new Promise((resolve, reject) => {
      const iframe = dom.contentFrame;
      // 보안 HIGH H1: sandbox 적용 (allow-same-origin은 contentEditable·드래그 등 동작에 필요)
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups');

      // v0.6: 이미지 alt 패널은 새 문서 마운트 직전에 닫는다 (stale 참조 회피)
      if (window.htmleditAltPanel && window.htmleditAltPanel.isOpen && window.htmleditAltPanel.isOpen()) {
        window.htmleditAltPanel.close();
      }

      const onLoad = () => {
        iframe.removeEventListener('load', onLoad);
        try {
          const doc = iframe.contentDocument;
          if (!doc) throw new Error('iframe document에 접근할 수 없어요.');
          injectEditorStyles(doc);
          bindIframeKeyboard(doc);

          // v0.5 신규: text-format 모듈 단축키 등록
          if (window.htmleditFormat && typeof window.htmleditFormat.bindKeyboard === 'function') {
            window.htmleditFormat.bindKeyboard(doc, {
              onCommandApplied: () => markDirty()
            });
          }

          // v0.5 신규: 선택 변경 감지 → 미니 툴바
          bindSelectionChange(doc);

          resolve(doc);
        } catch (e) {
          reject(e);
        }
      };
      iframe.addEventListener('load', onLoad);
      // v0.6: 사용자 HTML 상대 경로 자원 로드를 위한 <base> 주입
      const finalHtml = injectBase(htmlString, state.dir);
      // srcdoc은 새 HTML을 통째로 iframe에 로드. 이전 문서는 자동으로 해제됨.
      iframe.srcdoc = finalHtml;
    });
  }

  // ─── iframe 안 편집 보조 스타일 주입 (호버/포커스 표시, 드래그 커서, Alt 시각 신호 등)
  function injectEditorStyles(doc) {
    if (doc.getElementById('texttouch-injected-style')) return;
    const style = doc.createElement('style');
    style.id = 'texttouch-injected-style';
    style.textContent = `
.htmledit-mode-on .htmledit-editable {
  outline: 1px dashed transparent;
  outline-offset: 2px;
  transition: outline-color 0.1s;
}
.htmledit-mode-on .htmledit-editable:hover {
  outline-color: rgba(10, 132, 255, 0.55);
  cursor: text;
}
/* UX HIGH H6: 키보드 포커스 강화 */
.htmledit-mode-on .htmledit-editable:focus {
  outline: 2px solid #0a84ff;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(255,255,255,0.4);
}
.htmledit-mode-on .htmledit-movable {
  cursor: grab;
}
.htmledit-mode-on .htmledit-movable.htmledit-editable:hover {
  cursor: text;
}
body.htmledit-dragging,
body.htmledit-dragging * {
  cursor: grabbing !important;
  user-select: none !important;
}
/* UX HIGH H5: Alt 키 눌리면 movable 상자 시각 신호 */
body.htmledit-alt-pressed .htmledit-movable {
  cursor: grab;
  outline: 2px solid rgba(255, 159, 10, 0.7);
  outline-offset: 3px;
}
.htmledit-changed {
  position: relative;
}
.htmledit-changed::after {
  content: '';
  position: absolute;
  top: -2px;
  right: -6px;
  width: 6px;
  height: 6px;
  background: #ff9f0a;
  border-radius: 50%;
  pointer-events: none;
  z-index: 99999;
}
/* find-replace 하이라이트 */
mark.htmledit-find-highlight {
  background: rgba(255, 245, 157, 0.7);
  color: #1c1c1e;
  border-radius: 2px;
}
mark.htmledit-find-current {
  background: rgba(255, 159, 10, 0.85);
  color: #1c1c1e;
  outline: 1px solid rgba(255, 159, 10, 1);
}
`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // ─── 선택 변경 → 미니 툴바 위치/상태 갱신 ───
  function bindSelectionChange(doc) {
    doc.addEventListener('selectionchange', () => {
      try {
        const sel = doc.getSelection();
        const miniToolbar = window.htmleditMiniToolbar;
        if (!miniToolbar) return;

        if (sel && !sel.isCollapsed && state.editMode && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const iframe = dom.contentFrame;
          const iframeRect = iframe.getBoundingClientRect();
          // iframe 내부 좌표 → 셸 좌표로 변환
          const shellRect = new DOMRect(
            rect.left + iframeRect.left,
            rect.top + iframeRect.top,
            rect.width,
            rect.height
          );
          miniToolbar.show(shellRect);
          if (window.htmleditFormat) {
            miniToolbar.update(window.htmleditFormat.getActiveFormats(doc));
          }
        } else {
          miniToolbar.hide();
        }
      } catch (e) {
        console.warn('[editor] selectionchange 처리 실패:', e);
      }
    });
  }

  // ─── 직렬화 ────────────────────────────────
  function serializeForSave() {
    const doc = state.iframeDoc;
    if (!doc) return '';

    // 편집 보조 스타일은 저장에서 제외
    const injected = doc.getElementById('texttouch-injected-style');
    if (injected) injected.remove();

    // v0.6: 우리가 주입한 <base data-htmledit-injected="base">는 저장에서 제외
    const injectedBase = doc.querySelector('base[data-htmledit-injected="base"]');
    if (injectedBase) injectedBase.remove();

    // v0.5: find-replace 하이라이트 청소 (contracts §7)
    if (window.htmleditFindReplace && typeof window.htmleditFindReplace.clearHighlights === 'function') {
      try { window.htmleditFindReplace.clearHighlights(); } catch (_) { /* ignore */ }
    }
    // 안전망: 남은 mark.htmledit-find-highlight/current를 직접 unwrap
    const findMarks = doc.querySelectorAll('mark.htmledit-find-highlight, mark.htmledit-find-current, .htmledit-find-highlight, .htmledit-find-current');
    findMarks.forEach(m => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });

    // 편집/이동 표식 클래스 제거 (저장 시 빠져야)
    const cleanups = doc.querySelectorAll(
      '.htmledit-editable, .htmledit-movable, .htmledit-changed, .htmledit-mode-on, .htmledit-alt-pressed'
    );
    cleanups.forEach(el => {
      el.classList.remove(
        'htmledit-editable', 'htmledit-movable', 'htmledit-changed',
        'htmledit-mode-on', 'htmledit-alt-pressed'
      );
      el.removeAttribute('contenteditable');
      if (el.dataset.htmleditDragBound) delete el.dataset.htmleditDragBound;
    });
    doc.body.classList.remove('htmledit-mode-on', 'htmledit-dragging', 'htmledit-alt-pressed');

    const doctype = doc.doctype
      ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ' PUBLIC "' + doc.doctype.publicId + '"' : ''}${doc.doctype.systemId ? ' "' + doc.doctype.systemId + '"' : ''}>\n`
      : '<!DOCTYPE html>\n';
    const html = doctype + doc.documentElement.outerHTML;

    // 직렬화 후 다시 보조 스타일 복원 (편집 모드 유지)
    if (injected) injectEditorStyles(doc);
    if (state.editMode) doc.body.classList.add('htmledit-mode-on');

    return html;
  }

  // ─── 편집 호스트 식별 ───────────────────────
  function findEditableHosts(root) {
    if (!root || !root.ownerDocument) return [];
    const ownerDoc = root.ownerDocument;
    const hosts = new Set();
    const walker = ownerDoc.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          let p = node.parentElement;
          while (p && p !== root) {
            if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (parent && !SKIP_TAGS.has(parent.tagName)) hosts.add(parent);
    }
    return Array.from(hosts);
  }

  // ─── 편집 이벤트 바인딩 ─────────────────────
  const eventStore = new WeakMap();

  function bindEditEvents(host, doc) {
    if (eventStore.has(host)) return;

    let beforeValue = host.innerHTML;

    const onFocus = () => { beforeValue = host.innerHTML; };

    const onBlur = () => {
      const afterValue = host.innerHTML;
      if (afterValue !== beforeValue && !state.isApplyingHistory) {
        pushHistory({ type: 'text', host, before: beforeValue, after: afterValue });
        host.classList.add('htmledit-changed');
        markDirty();
      }
    };

    const onKeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doc.execCommand('insertLineBreak');
      }
    };

    const onPaste = (e) => {
      e.preventDefault();
      const text = (e.clipboardData || doc.defaultView.clipboardData).getData('text/plain');
      doc.execCommand('insertText', false, text);
    };

    host.addEventListener('focus', onFocus);
    host.addEventListener('blur', onBlur);
    host.addEventListener('keydown', onKeydown);
    host.addEventListener('paste', onPaste);
    eventStore.set(host, { onFocus, onBlur, onKeydown, onPaste });
  }

  function unbindEditEvents(host) {
    const handlers = eventStore.get(host);
    if (!handlers) return;
    host.removeEventListener('focus', handlers.onFocus);
    host.removeEventListener('blur', handlers.onBlur);
    host.removeEventListener('keydown', handlers.onKeydown);
    host.removeEventListener('paste', handlers.onPaste);
    eventStore.delete(host);
  }

  // ─── 편집 모드 토글 ─────────────────────────
  function setEditMode(on) {
    state.editMode = on;
    document.body.classList.toggle('htmledit-mode-on', on);

    if (!state.iframeDoc || !state.filePath) {
      updateButtons();
      return;
    }

    const doc = state.iframeDoc;
    doc.body.classList.toggle('htmledit-mode-on', on);

    const hosts = findEditableHosts(doc.body);

    if (on) {
      const slideLike = window.htmleditDrag.isSlideStyle(doc.body, doc.defaultView);
      hosts.forEach(host => {
        host.setAttribute('contenteditable', 'true');
        host.classList.add('htmledit-editable');
        bindEditEvents(host, doc);
        if (slideLike) {
          window.htmleditDrag.enableDragForHost(host, doc);
        }
      });
      setHint(slideLike
        ? '편집 모드 ON · 텍스트를 클릭해 수정, Alt+드래그로 위치 이동'
        : '편집 모드 ON · 텍스트를 클릭해 수정 (일반 본문은 이동 불가)');
    } else {
      hosts.forEach(host => {
        host.removeAttribute('contenteditable');
        host.classList.remove('htmledit-editable');
        unbindEditEvents(host);
        window.htmleditDrag.disableDragForHost(host);
      });
      setHint('');
      // 편집 모드 끄면 미니 툴바도 숨김
      if (window.htmleditMiniToolbar) {
        try { window.htmleditMiniToolbar.hide(); } catch (_) { /* ignore */ }
      }
    }
    updateButtons();
  }

  // ─── Undo/Redo ─────────────────────────────
  function pushHistory(entry) {
    state.undoStack.push(entry);
    if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
    state.redoStack.length = 0;
    updateButtons();
  }

  function applyEntry(entry, direction) {
    const target = direction === 'undo' ? entry.before : entry.after;
    state.isApplyingHistory = true;
    if (entry.type === 'text') {
      entry.host.innerHTML = target;
    } else if (entry.type === 'move') {
      entry.host.style.left = target.left;
      entry.host.style.top = target.top;
    }
    state.isApplyingHistory = false;
  }

  function undo() {
    const entry = state.undoStack.pop();
    if (!entry) return;
    applyEntry(entry, 'undo');
    state.redoStack.push(entry);
    markDirty();
    updateButtons();
  }

  function redo() {
    const entry = state.redoStack.pop();
    if (!entry) return;
    applyEntry(entry, 'redo');
    state.undoStack.push(entry);
    markDirty();
    updateButtons();
  }

  function markDirty() {
    state.dirty = state.undoStack.length > 0;
    updateFileInfo();
    updateButtons();
    // CRITICAL C3·C4: 메인 프로세스에 dirty 상태 전송
    try {
      const fileName = state.filePath ? state.filePath.split('/').pop() : null;
      if (window.htmledit && typeof window.htmledit.setDirty === 'function') {
        window.htmledit.setDirty(state.dirty, fileName);
      }
    } catch (e) {
      console.warn('[editor] setDirty 실패:', e);
    }
  }

  function clearHistory() {
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.dirty = false;
    // CRITICAL C3·C4: 메인 프로세스에 dirty 해제 알림
    try {
      const fileName = state.filePath ? state.filePath.split('/').pop() : null;
      if (window.htmledit && typeof window.htmledit.setDirty === 'function') {
        window.htmledit.setDirty(false, fileName);
      }
    } catch (e) {
      console.warn('[editor] setDirty(clear) 실패:', e);
    }
  }

  // ─── 파일 열기/저장 ─────────────────────────
  async function applyLoadedFile(payload) {
    if (!payload || !payload.html) {
      showToast('파일을 열 수 없어요.', 'error');
      return;
    }

    // CRITICAL C3·C4: dirty 가드 — 새 파일 열기 전 사용자 확인
    if (state.dirty) {
      try {
        const fileName = state.filePath ? state.filePath.split('/').pop() : null;
        const result = await window.htmledit.confirmClose(true, fileName);
        if (!result || result.action === 'cancel') return;
        if (result.action === 'save') {
          await triggerSave();
          // 저장 실패 → 진행 중단
          if (state.dirty) return;
        }
        // 'discard'면 그대로 진행
      } catch (e) {
        // confirmClose 실패 시 안전하게 중단
        showToast('확인 다이얼로그 실패: ' + (e.message || e), 'error');
        return;
      }
    }

    try {
      state.filePath = payload.path;
      // v0.6: 디렉터리는 base 주입에 사용 — fs-handlers가 안 보내면 path에서 파생
      state.dir = payload.dir || (payload.path ? payload.path.replace(/[^/]+$/, '').replace(/\/$/, '') : null);
      state.encoding = payload.encoding || 'utf-8';
      state.bom = !!payload.bom;
      state.lineEnding = payload.lineEnding || '\n';

      clearHistory();
      state.editMode = false;
      document.body.classList.remove('htmledit-mode-on');

      dom.emptyState.hidden = true;
      dom.contentFrame.hidden = false;

      const doc = await mountDocument(payload.html);
      state.iframeDoc = doc;

      // v0.6: OS 최근 문서에 등록
      if (window.htmledit && typeof window.htmledit.addRecent === 'function') {
        window.htmledit.addRecent(payload.path);
      }

      updateFileInfo();
      updateButtons();

      if (payload.legacyEncodingWarn) {
        showToast(`인코딩(${payload.encoding}) 추정. 저장 시 UTF-8로 변환됩니다. 원본은 백업에 안전.`);
      } else {
        const fileName = payload.path.split('/').pop();
        showToast(`'${fileName}' 열기 완료`, 'success');
      }
    } catch (e) {
      console.error(e);
      showToast(e.message || '파일을 열 수 없어요.', 'error');
    }
  }

  async function triggerOpen() {
    try {
      const result = await window.htmledit.openFileDialog();
      if (result) await applyLoadedFile(result);
    } catch (e) {
      showToast(e.message || '파일 열기 실패', 'error');
    }
  }

  async function triggerSave() {
    if (!state.filePath || !state.iframeDoc) return;
    // H10: in-flight 가드
    if (saving) return;
    saving = true;
    try {
      const html = serializeForSave();
      const result = await window.htmledit.saveOriginal({
        filePath: state.filePath,
        html,
        encoding: state.encoding,
        bom: state.bom,
        lineEnding: state.lineEnding
      });
      if (result && result.success) {
        clearHistory();
        state.iframeDoc.querySelectorAll('.htmledit-changed').forEach(el => {
          el.classList.remove('htmledit-changed');
        });
        updateFileInfo();
        updateButtons();
        const bakName = (result.backupPath || '').split('/').pop();
        showToast(`저장 완료 · 백업: ${bakName}`, 'success');
      }
    } catch (e) {
      // A-8: 인코딩 호환 에러는 명시 메시지 그대로 표시
      const msg = e && e.message ? String(e.message) : '저장 실패';
      if (msg.startsWith('ENCODING_INCOMPATIBLE')) {
        showToast(msg, 'error');
      } else {
        showToast(msg || '저장 실패', 'error');
      }
    } finally {
      saving = false;
    }
  }

  async function triggerSaveAs() {
    if (!state.filePath || !state.iframeDoc) return;
    // H10: in-flight 가드
    if (saving) return;
    saving = true;
    try {
      const html = serializeForSave();
      const suggestedName = state.filePath.split('/').pop().replace(/\.html?$/i, '_edited.html');
      const result = await window.htmledit.saveAs({
        suggestedName,
        html,
        encoding: state.encoding,
        bom: state.bom,
        lineEnding: state.lineEnding
      });
      if (result && result.success) {
        state.filePath = result.newPath;
        clearHistory();
        state.iframeDoc.querySelectorAll('.htmledit-changed').forEach(el => {
          el.classList.remove('htmledit-changed');
        });
        updateFileInfo();
        updateButtons();
        showToast(`'${result.newPath.split('/').pop()}'로 저장됨`, 'success');
      }
    } catch (e) {
      const msg = e && e.message ? String(e.message) : '저장 실패';
      if (msg.startsWith('ENCODING_INCOMPATIBLE')) {
        showToast(msg, 'error');
      } else {
        showToast(msg || '저장 실패', 'error');
      }
    } finally {
      saving = false;
    }
  }

  // ─── 백업 복원 다이얼로그 (v0.5) ───────────
  async function openRestoreBackupDialog() {
    if (!state.filePath) {
      showToast('파일을 먼저 여세요.', 'error');
      return;
    }
    let backups;
    try {
      backups = await window.htmledit.listBackups(state.filePath);
    } catch (e) {
      showToast(e.message || '백업 목록을 불러올 수 없어요.', 'error');
      return;
    }
    if (!Array.isArray(backups) || backups.length === 0) {
      showToast('백업이 없습니다.', 'error');
      return;
    }
    renderRestoreList(backups);
    dom.restoreModal.hidden = false;
  }

  function closeRestoreModal() {
    dom.restoreModal.hidden = true;
    dom.restoreList.innerHTML = '';
  }

  function renderRestoreList(backups) {
    dom.restoreList.innerHTML = '';
    backups.forEach(b => {
      const li = document.createElement('li');
      const labelDiv = document.createElement('div');
      labelDiv.className = 'restore-label';
      labelDiv.textContent = b.label || (b.path ? b.path.split('/').pop() : '백업');
      const metaDiv = document.createElement('div');
      metaDiv.className = 'restore-meta';
      const mtime = b.mtime ? new Date(b.mtime).toLocaleString('ko-KR') : '';
      const sizeKb = typeof b.size === 'number' ? (b.size / 1024).toFixed(1) + ' KB' : '';
      metaDiv.textContent = [mtime, sizeKb].filter(Boolean).join(' · ');
      li.appendChild(labelDiv);
      li.appendChild(metaDiv);
      li.addEventListener('click', async () => {
        const ok = window.confirm(
          `이 백업으로 되돌리시겠어요?\n\n${labelDiv.textContent}\n${metaDiv.textContent}\n\n현재 작업은 새 백업으로 저장됩니다.`
        );
        if (!ok) return;
        try {
          const result = await window.htmledit.restoreBackup(b.path, state.filePath);
          if (result && result.success) {
            closeRestoreModal();
            // 복원 후 다시 로드
            const loaded = await window.htmledit.loadFile(state.filePath);
            // dirty 강제 해제 (방금 복원했으므로)
            state.dirty = false;
            await applyLoadedFile(loaded);
            showToast('백업으로 되돌렸어요.', 'success');
          }
        } catch (e) {
          showToast(e.message || '복원 실패', 'error');
        }
      });
      dom.restoreList.appendChild(li);
    });
  }

  // ─── 드래그앤드롭 ───────────────────────────
  function setupDropZone() {
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      document.body.classList.add('drag-over');
    });
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        document.body.classList.remove('drag-over');
      }
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      document.body.classList.remove('drag-over');

      const files = Array.from(e.dataTransfer.files);
      const htmlFile = files.find(f => /\.html?$/i.test(f.name));
      if (!htmlFile) {
        showToast('HTML 파일만 열 수 있어요.', 'error');
        return;
      }
      const filePath = window.htmledit.getFilePath(htmlFile);
      if (!filePath) {
        showToast('파일 경로를 알 수 없어요.', 'error');
        return;
      }
      try {
        const result = await window.htmledit.loadFile(filePath);
        await applyLoadedFile(result);
      } catch (err) {
        showToast(err.message || '파일을 열 수 없어요.', 'error');
      }
    });
  }

  // ─── 키보드 단축키: 셸 측 ───────────────────
  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      // Undo/Redo
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault(); redo(); return;
      }

      // UX HIGH H3: ⌘⇧E → 편집 모드 토글 (옛 ⌘E에서 이동)
      if (e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        // IME 가드
        if (e.isComposing) return;
        e.preventDefault();
        setEditMode(!state.editMode);
      }
    }, true);
  }

  // ─── 키보드 단축키: iframe 측 ───────────────
  // 폰트 크기 단계 증감 (⌘⇧> / ⌘⇧< 처리용)
  const FONT_SIZE_STOPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 54, 60, 72, 80, 96];

  function adjustFontSize(doc, delta) {
    if (!doc || !window.htmleditFormat) return;
    const formats = window.htmleditFormat.getActiveFormats(doc) || {};
    let current = parseInt(formats.fontSize, 10) || 16;
    let idx = FONT_SIZE_STOPS.findIndex(v => v >= current);
    if (idx < 0) idx = FONT_SIZE_STOPS.length - 1;
    if (delta > 0) idx = Math.min(idx + 1, FONT_SIZE_STOPS.length - 1);
    else idx = Math.max(idx - 1, 0);
    const next = FONT_SIZE_STOPS[idx];
    window.htmleditFormat.setFontSize(doc, next);
    markDirty();
  }

  function bindIframeKeyboard(doc) {
    doc.addEventListener('keydown', (e) => {
      // UX HIGH H5: Alt 키 시각 신호
      if (e.key === 'Alt' || e.altKey) {
        if (window.htmleditDrag && window.htmleditDrag.setAltVisualSignal) {
          window.htmleditDrag.setAltVisualSignal(doc, true);
        }
      }

      // 슬라이드 자체 ArrowKey 핸들러로부터 contentEditable 보호
      if (state.editMode && e.target && e.target.isContentEditable) {
        const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Home', 'End', 'PageUp', 'PageDown'];
        if (navKeys.includes(e.key)) e.stopPropagation();
      }

      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      // ⌘Z / ⌘⇧Z 는 iframe 안에서는 가로채지 않고 브라우저 contentEditable 기본 undo에 위임.
      // 그래야 execCommand로 적용된 모든 서식 변경(굵게/색/정렬 등)이 자연스럽게 복원된다.
      // 우리 자체 undo 스택(드래그 이동 등)은 셸 측 setupKeyboard에서 처리.

      if (e.key === 's' && !e.shiftKey) { e.preventDefault(); triggerSave(); return; }
      if (e.key === 'S' || (e.key === 's' && e.shiftKey)) { e.preventDefault(); triggerSaveAs(); return; }
      if (e.key === 'o') { e.preventDefault(); triggerOpen(); return; }

      // 폰트 크기 단축키 (Word/PPT 표준)
      // ⌘⇧> (또는 ⌘⇧.) — 키우기 / ⌘⇧< (또는 ⌘⇧,) — 작게
      if (e.shiftKey && (e.key === '>' || e.key === '.')) {
        e.preventDefault();
        adjustFontSize(doc, +2);
        return;
      }
      if (e.shiftKey && (e.key === '<' || e.key === ',')) {
        e.preventDefault();
        adjustFontSize(doc, -2);
        return;
      }

      // UX HIGH H3: ⌘⇧E → 편집 모드 토글
      // (⌘E 단독은 text-format.js가 alignCenter로 처리)
      if (e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        if (e.isComposing) return;
        e.preventDefault();
        setEditMode(!state.editMode);
      }
    }, true);

    doc.addEventListener('keyup', (e) => {
      // Alt 키 떨어지면 시각 신호 해제
      if (e.key === 'Alt' || !e.altKey) {
        if (window.htmleditDrag && window.htmleditDrag.setAltVisualSignal) {
          window.htmleditDrag.setAltVisualSignal(doc, false);
        }
      }
    }, true);

    // window blur 시 Alt 상태 해제 (사용자가 다른 앱으로 가도 안전)
    if (doc.defaultView) {
      doc.defaultView.addEventListener('blur', () => {
        if (window.htmleditDrag && window.htmleditDrag.setAltVisualSignal) {
          window.htmleditDrag.setAltVisualSignal(doc, false);
        }
      });
    }
  }

  // ─── 상단 서브툴바 이벤트 (v0.5) ───────────
  function setupFormatBar() {
    if (!dom.formatBar) return;
    dom.formatBar.addEventListener('input', handleFormatBar);
    dom.formatBar.addEventListener('click', handleFormatBar);
  }

  function handleFormatBar(e) {
    const t = e.target.closest('[data-format-cmd]');
    if (!t) return;
    const cmd = t.dataset.formatCmd;
    const doc = state.iframeDoc;
    if (!doc || !window.htmleditFormat) return;
    const fmt = window.htmleditFormat;
    const value = t.value;

    switch (cmd) {
      case 'bold': fmt.bold(doc); break;
      case 'italic': fmt.italic(doc); break;
      case 'underline': fmt.underline(doc); break;
      case 'strikethrough': fmt.strikethrough(doc); break;
      case 'superscript': fmt.superscript(doc); break;
      case 'subscript': fmt.subscript(doc); break;
      case 'fontFamily': fmt.setFontFamily(doc, value); break;
      case 'fontSize': fmt.setFontSize(doc, parseInt(value, 10)); break;
      case 'foreColor': {
        fmt.setForeColor(doc, value);
        // 색 막대 시각 업데이트 (PPT 스타일)
        const pick = t.closest('.fmt-color-pick');
        if (pick) pick.style.setProperty('--current-color', value);
        break;
      }
      case 'alignLeft': fmt.alignLeft(doc); break;
      case 'alignCenter': fmt.alignCenter(doc); break;
      case 'alignRight': fmt.alignRight(doc); break;
      case 'alignJustify': fmt.alignJustify(doc); break;
      case 'alignToggle': {
        const s = fmt.getActiveFormats(doc).textAlign;
        const next = { left: 'center', center: 'right', right: 'left', justify: 'left' }[s] || 'left';
        if (next === 'center') fmt.alignCenter(doc);
        else if (next === 'right') fmt.alignRight(doc);
        else fmt.alignLeft(doc);
        break;
      }
      case 'insertUnorderedList': fmt.insertUnorderedList(doc); break;
      case 'insertOrderedList': fmt.insertOrderedList(doc); break;
      case 'indent': fmt.indent(doc); break;
      case 'outdent': fmt.outdent(doc); break;
      case 'removeFormat': fmt.removeFormat(doc); break;
      case 'hiliteColor': {
        // 색 picker로 형광펜 색 적용
        fmt.setHiliteColor(doc, value);
        const pick = t.closest('.fmt-color-pick');
        if (pick) pick.style.setProperty('--current-color', value);
        break;
      }
      default:
        return;
    }
    markDirty();
  }

  // ─── 메뉴 → 서식 액션 dispatch ─────────────
  function handleMenuAction(action) {
    if (action === 'open') { triggerOpen(); return; }
    if (action === 'save') { triggerSave(); return; }
    if (action === 'saveAs') { triggerSaveAs(); return; }
    if (action === 'toggleEdit') { setEditMode(!state.editMode); return; }

    // v0.5 신규
    if (action === 'find') {
      window.htmleditFindReplace && window.htmleditFindReplace.openFindBar();
      return;
    }
    if (action === 'findNext') {
      window.htmleditFindReplace && window.htmleditFindReplace.goToNext();
      return;
    }
    if (action === 'findPrev') {
      window.htmleditFindReplace && window.htmleditFindReplace.goToPrev();
      return;
    }
    if (action === 'replace') {
      window.htmleditFindReplace && window.htmleditFindReplace.openReplaceBar();
      return;
    }
    if (action === 'restoreBackup') {
      openRestoreBackupDialog();
      return;
    }
    if (action === 'revealInFinder') {
      if (state.filePath) window.htmledit.revealInFinder(state.filePath);
      return;
    }

    // v0.6: 이미지 alt 패널 토글
    if (action === 'toggleAltPanel') {
      if (!state.iframeDoc) {
        showToast('파일을 먼저 열어주세요.', 'error');
        return;
      }
      if (window.htmleditAltPanel && typeof window.htmleditAltPanel.toggle === 'function') {
        window.htmleditAltPanel.toggle();
      }
      return;
    }

    if (typeof action === 'string' && action.startsWith('format:')) {
      const cmd = action.slice(7);
      const doc = state.iframeDoc;
      const fmt = window.htmleditFormat;
      if (!doc || !fmt) return;
      const map = {
        bold: () => fmt.bold(doc),
        italic: () => fmt.italic(doc),
        underline: () => fmt.underline(doc),
        strikethrough: () => fmt.strikethrough(doc),
        superscript: () => fmt.superscript(doc),
        subscript: () => fmt.subscript(doc),
        alignLeft: () => fmt.alignLeft(doc),
        alignCenter: () => fmt.alignCenter(doc),
        alignRight: () => fmt.alignRight(doc),
        alignJustify: () => fmt.alignJustify(doc),
        insertUnorderedList: () => fmt.insertUnorderedList(doc),
        insertOrderedList: () => fmt.insertOrderedList(doc),
        indent: () => fmt.indent(doc),
        outdent: () => fmt.outdent(doc),
        removeFormat: () => fmt.removeFormat(doc)
      };
      const fn = map[cmd];
      if (fn) {
        fn();
        markDirty();
      }
      return;
    }
  }

  // ─── 백업 복원 모달 wire-up ─────────────────
  function setupRestoreModal() {
    if (!dom.restoreModal) return;
    if (dom.restoreCancel) {
      dom.restoreCancel.addEventListener('click', closeRestoreModal);
    }
    // 배경 클릭으로 닫기
    const backdrop = dom.restoreModal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeRestoreModal);
    }
    // Esc로 닫기
    document.addEventListener('keydown', (e) => {
      if (!dom.restoreModal.hidden && e.key === 'Escape') {
        closeRestoreModal();
      }
    });
  }

  // ─── 초기화 ────────────────────────────────
  function init() {
    window.htmleditDrag.init(() => ({
      onMoveComplete: (host, before, after) => {
        if (state.isApplyingHistory) return;
        pushHistory({ type: 'move', host, before, after });
        host.classList.add('htmledit-changed');
        markDirty();
      }
    }));

    // v0.5 신규 모듈 초기화
    if (window.htmleditMiniToolbar && typeof window.htmleditMiniToolbar.init === 'function') {
      window.htmleditMiniToolbar.init(document.body, () => state.iframeDoc, {
        onCommandApplied: () => markDirty()
      });
    }
    if (window.htmleditFindReplace && typeof window.htmleditFindReplace.init === 'function') {
      window.htmleditFindReplace.init(document.body, () => state.iframeDoc);
    }

    // v0.6: 이미지 alt 패널 초기화
    if (window.htmleditAltPanel && typeof window.htmleditAltPanel.init === 'function') {
      window.htmleditAltPanel.init(document.body, () => state.iframeDoc, {
        onChange: () => markDirty()
      });
    }

    dom.btnOpen.addEventListener('click', triggerOpen);
    dom.btnEditToggle.addEventListener('click', () => setEditMode(!state.editMode));
    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);
    dom.btnSave.addEventListener('click', triggerSave);
    dom.btnSaveAs.addEventListener('click', triggerSaveAs);

    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.addEventListener('dblclick', (e) => {
        const tag = e.target.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;
        window.htmledit.toggleZoom();
      });
    }

    setupDropZone();
    setupKeyboard();
    setupFormatBar();
    setupRestoreModal();

    window.htmledit.onMenuAction(handleMenuAction);

    window.htmledit.onFileFromOS(async (filePath) => {
      try {
        const result = await window.htmledit.loadFile(filePath);
        await applyLoadedFile(result);
      } catch (e) {
        showToast(e.message || '파일을 열 수 없어요.', 'error');
      }
    });

    updateButtons();
    updateFileInfo();
    setHint('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
