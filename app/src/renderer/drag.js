// 슬라이드형 HTML(주요 요소가 position:absolute/fixed)에서 Alt+드래그로 텍스트 박스 이동
// iframe 안에서 동작하도록 contentDocument를 받아 처리

window.htmleditDrag = (function () {
  let dragState = null;
  const boundDocs = new WeakSet();
  let getCallbacks = () => ({});

  function isMovableTextBox(el, win) {
    win = win || (el.ownerDocument && el.ownerDocument.defaultView) || window;
    const style = win.getComputedStyle(el);
    const pos = style.position;
    if (pos !== 'absolute' && pos !== 'fixed') return false;

    const hasOwnText = Array.from(el.childNodes).some(
      n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim()
    );
    if (hasOwnText) return true;

    const children = Array.from(el.children);
    if (children.length === 0) return false;
    const allInline = children.every(c => {
      const d = win.getComputedStyle(c).display;
      return d === 'inline' || d === 'inline-block';
    });
    if (!allInline) return false;
    return el.textContent.trim().length > 0;
  }

  function isSlideStyle(root, win) {
    win = win || (root.ownerDocument && root.ownerDocument.defaultView) || window;
    const children = Array.from(root.querySelectorAll('*'));
    if (children.length === 0) return false;
    const absCount = children.filter(el => {
      const pos = win.getComputedStyle(el).position;
      return pos === 'absolute' || pos === 'fixed';
    }).length;
    return absCount / children.length > 0.3;
  }

  function onMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    dragState.host.style.left = (dragState.origLeft + dx) + 'px';
    dragState.host.style.top = (dragState.origTop + dy) + 'px';
  }

  function onUp() {
    if (!dragState) return;
    const after = { left: dragState.host.style.left, top: dragState.host.style.top };
    const changed = after.left !== dragState.before.left || after.top !== dragState.before.top;
    if (changed) {
      const cb = getCallbacks();
      if (cb && cb.onMoveComplete) cb.onMoveComplete(dragState.host, dragState.before, after);
    }
    document.body.classList.remove('htmledit-dragging');
    if (dragState.doc && dragState.doc.body) {
      dragState.doc.body.classList.remove('htmledit-dragging');
    }
    dragState = null;
  }

  function bindDocOnce(doc) {
    if (boundDocs.has(doc)) return;
    boundDocs.add(doc);
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }

  function enableDragForHost(host, doc) {
    doc = doc || host.ownerDocument;
    const win = doc.defaultView;
    if (host.dataset.htmleditDragBound === '1') return;
    if (!isMovableTextBox(host, win)) return;
    host.dataset.htmleditDragBound = '1';
    host.classList.add('htmledit-movable');

    bindDocOnce(doc);

    host.addEventListener('mousedown', (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();

      const hostRect = host.getBoundingClientRect();
      const offsetParent = host.offsetParent || doc.body;
      const parentRect = offsetParent.getBoundingClientRect();

      dragState = {
        host,
        doc,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: hostRect.left - parentRect.left,
        origTop: hostRect.top - parentRect.top,
        before: { left: host.style.left, top: host.style.top }
      };
      document.body.classList.add('htmledit-dragging');
      doc.body.classList.add('htmledit-dragging');
    });
  }

  function disableDragForHost(host) {
    if (host.dataset.htmleditDragBound !== '1') return;
    delete host.dataset.htmleditDragBound;
    host.classList.remove('htmledit-movable');
  }

  // contracts §4: body.htmledit-alt-pressed — Alt 키 시각 신호 (UX HIGH H5)
  function setAltVisualSignal(doc, on) {
    if (!doc || !doc.body) return;
    doc.body.classList.toggle('htmledit-alt-pressed', !!on);
  }

  function init(callbacksFn) {
    getCallbacks = callbacksFn;
  }

  return {
    init,
    isSlideStyle,
    isMovableTextBox,
    enableDragForHost,
    disableDragForHost,
    setAltVisualSignal
  };
})();
