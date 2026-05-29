// Text Touch 렌더러 (iframe 격리 버전)
// - 사용자 HTML은 iframe.srcdoc으로 마운트되어 CSS/JS/viewport가 완전 격리
// - 셸의 toolbar/hint-bar는 사용자 CSS의 영향을 받지 않음
// - contentEditable/드래그/단축키는 iframe.contentDocument 안에서 동작

(function () {
  'use strict';

  // ─── 상태 ──────────────────────────────────
  const state = {
    filePath: null,
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
    toast: document.getElementById('toast')
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

  // ─── iframe 마운트 ──────────────────────────
  function mountDocument(htmlString) {
    return new Promise((resolve, reject) => {
      const iframe = dom.contentFrame;
      const onLoad = () => {
        iframe.removeEventListener('load', onLoad);
        try {
          const doc = iframe.contentDocument;
          if (!doc) throw new Error('iframe document에 접근할 수 없어요.');
          injectEditorStyles(doc);
          bindIframeKeyboard(doc);
          resolve(doc);
        } catch (e) {
          reject(e);
        }
      };
      iframe.addEventListener('load', onLoad);
      // srcdoc은 새 HTML을 통째로 iframe에 로드. 이전 문서는 자동으로 해제됨.
      iframe.srcdoc = htmlString;
    });
  }

  // iframe 안에 편집 보조 스타일 주입 (호버/포커스 표시, 드래그 커서 등)
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
.htmledit-mode-on .htmledit-editable:focus {
  outline: 2px solid rgba(10, 132, 255, 0.85);
  outline-offset: 2px;
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
`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // ─── 직렬화 ────────────────────────────────
  function serializeForSave() {
    const doc = state.iframeDoc;
    if (!doc) return '';

    // 편집 보조 스타일은 저장에서 제외
    const injected = doc.getElementById('texttouch-injected-style');
    if (injected) injected.remove();

    // 편집/이동 표식 클래스 제거 (이건 저장 시 빠져야)
    const cleanups = doc.querySelectorAll(
      '.htmledit-editable, .htmledit-movable, .htmledit-changed, .htmledit-mode-on'
    );
    cleanups.forEach(el => {
      el.classList.remove('htmledit-editable', 'htmledit-movable', 'htmledit-changed', 'htmledit-mode-on');
      el.removeAttribute('contenteditable');
      if (el.dataset.htmleditDragBound) delete el.dataset.htmleditDragBound;
    });
    doc.body.classList.remove('htmledit-mode-on', 'htmledit-dragging');

    const doctype = doc.doctype
      ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ' PUBLIC "' + doc.doctype.publicId + '"' : ''}${doc.doctype.systemId ? ' "' + doc.doctype.systemId + '"' : ''}>\n`
      : '<!DOCTYPE html>\n';
    const html = doctype + doc.documentElement.outerHTML;

    // 직렬화 후 다시 보조 스타일 복원 (편집 모드 유지를 위해)
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
  }

  function clearHistory() {
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.dirty = false;
  }

  // ─── 파일 열기/저장 ─────────────────────────
  async function applyLoadedFile(payload) {
    if (!payload || !payload.html) {
      showToast('파일을 열 수 없어요.', 'error');
      return;
    }

    try {
      state.filePath = payload.path;
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

      updateFileInfo();
      updateButtons();

      if (payload.legacyEncodingWarn) {
        showToast(`인코딩(${payload.encoding}) 추정. 저장 시 UTF-8로 변환됩니다. 원본은 .bak 백업에 안전.`);
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
      showToast(e.message || '저장 실패', 'error');
    }
  }

  async function triggerSaveAs() {
    if (!state.filePath || !state.iframeDoc) return;
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
      showToast(e.message || '저장 실패', 'error');
    }
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
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    }, true);
  }

  // 키보드 단축키: iframe 측 (포커스가 iframe 안에 있을 때)
  function bindIframeKeyboard(doc) {
    doc.addEventListener('keydown', (e) => {
      // 슬라이드 자체 ArrowKey 핸들러로부터 contentEditable 보호
      if (state.editMode && e.target && e.target.isContentEditable) {
        const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Home', 'End', 'PageUp', 'PageDown'];
        if (navKeys.includes(e.key)) e.stopPropagation();
      }

      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (e.key === 's' && !e.shiftKey) { e.preventDefault(); triggerSave(); }
      else if (e.key === 'S' || (e.key === 's' && e.shiftKey)) { e.preventDefault(); triggerSaveAs(); }
      else if (e.key === 'o') { e.preventDefault(); triggerOpen(); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setEditMode(!state.editMode); }
    }, true);
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

    window.htmledit.onMenuAction((action) => {
      if (action === 'open') triggerOpen();
      else if (action === 'save') triggerSave();
      else if (action === 'saveAs') triggerSaveAs();
      else if (action === 'toggleEdit') setEditMode(!state.editMode);
    });

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
