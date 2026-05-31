// text-format.js — 텍스트 서식 적용 + Word/PPT 표준 단축키
// - iframe.contentDocument 안에서 동작
// - document.execCommand 래퍼 (deprecated 시 한 곳만 교체)
// - 인라인 마크업 우선(<strong>, <em>, <u>)
// - 키보드는 capture phase에 등록해 사용자 HTML 핸들러보다 먼저 가로채기
// - contracts/v0.5-api.md §2 기준

(function () {
  'use strict';

  // ─── 기본 명령 ────────────────────────────────
  function applyCommand(doc, command, value) {
    if (!doc) return;
    try {
      // styleWithCSS=false → <strong>, <em>, <u> 같은 시맨틱 태그 우선
      // 단, foreColor/hiliteColor/fontName/fontSize는 어차피 span style로 적용됨
      try { doc.execCommand('styleWithCSS', false, false); } catch (_) { /* ignore */ }
      doc.execCommand(command, false, value);
    } catch (e) {
      console.warn('[htmleditFormat] execCommand 실패:', command, e);
    }
  }

  // ─── 인라인 토글 ──────────────────────────────
  function bold(doc)          { applyCommand(doc, 'bold'); }
  function italic(doc)        { applyCommand(doc, 'italic'); }
  function underline(doc)     { applyCommand(doc, 'underline'); }
  function strikethrough(doc) { applyCommand(doc, 'strikeThrough'); }
  function superscript(doc)   { applyCommand(doc, 'superscript'); }
  function subscript(doc)     { applyCommand(doc, 'subscript'); }

  // ─── 폰트 / 크기 / 색 ─────────────────────────
  // execCommand의 fontName/fontSize는 일관성 떨어지므로
  // execCommand 우선 시도 + 실패 시 selection wrap.
  function setFontFamily(doc, family) {
    if (!doc || !family) return;
    try {
      // CSS 적용 모드로 전환 (font-family는 CSS가 자연스러움)
      try { doc.execCommand('styleWithCSS', false, true); } catch (_) {}
      doc.execCommand('fontName', false, family);
    } catch (e) {
      wrapSelectionWithStyle(doc, { fontFamily: family });
    }
  }

  function setFontSize(doc, sizePx) {
    if (!doc || !sizePx) return;
    const px = typeof sizePx === 'number' ? sizePx : parseInt(sizePx, 10);
    if (!px || isNaN(px)) return;
    // execCommand fontSize는 1~7 단계라 px 정밀도 부족 → 직접 span 래핑
    wrapSelectionWithStyle(doc, { fontSize: px + 'px' });
  }

  function setForeColor(doc, color) {
    if (!doc || !color) return;
    try {
      try { doc.execCommand('styleWithCSS', false, true); } catch (_) {}
      doc.execCommand('foreColor', false, color);
    } catch (e) {
      wrapSelectionWithStyle(doc, { color });
    }
  }

  function setHiliteColor(doc, color) {
    if (!doc) return;
    // color=null → 형광펜 끄기 (배경 투명)
    const target = color || 'transparent';
    try {
      try { doc.execCommand('styleWithCSS', false, true); } catch (_) {}
      // 브라우저 호환: hiliteColor 또는 backColor
      const ok = doc.execCommand('hiliteColor', false, target);
      if (!ok) doc.execCommand('backColor', false, target);
    } catch (e) {
      wrapSelectionWithStyle(doc, { backgroundColor: target });
    }
  }

  // ─── 정렬 ────────────────────────────────────
  function alignLeft(doc)    { applyCommand(doc, 'justifyLeft'); }
  function alignCenter(doc)  { applyCommand(doc, 'justifyCenter'); }
  function alignRight(doc)   { applyCommand(doc, 'justifyRight'); }
  function alignJustify(doc) { applyCommand(doc, 'justifyFull'); }

  // ─── 리스트 / 들여쓰기 ────────────────────────
  function insertUnorderedList(doc) { applyCommand(doc, 'insertUnorderedList'); }
  function insertOrderedList(doc)   { applyCommand(doc, 'insertOrderedList'); }
  function indent(doc)              { applyCommand(doc, 'indent'); }
  function outdent(doc)             { applyCommand(doc, 'outdent'); }

  // ─── 서식 지우기 ──────────────────────────────
  function removeFormat(doc) {
    if (!doc) return;
    applyCommand(doc, 'removeFormat');
    // execCommand removeFormat은 정렬·리스트는 안 풀므로 추가 시도는 하지 않음
    // (사용자가 명시적으로 정렬/리스트 해제하길 원하면 별도 단축키)
  }

  // ─── 헬퍼: 선택 영역에 style span 래핑 ────────
  function wrapSelectionWithStyle(doc, styleObj) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = doc.createElement('span');
    for (const key in styleObj) {
      span.style[key] = styleObj[key];
    }
    try {
      // 선택 영역을 span으로 감싼다
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
      // 선택 영역 재설정 (span 전체 선택)
      sel.removeAllRanges();
      const newRange = doc.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    } catch (e) {
      console.warn('[htmleditFormat] wrapSelectionWithStyle 실패:', e);
    }
  }

  // ─── 상태 조회 ────────────────────────────────
  function getActiveFormats(doc) {
    const empty = {
      bold: false, italic: false, underline: false, strikethrough: false,
      superscript: false, subscript: false,
      fontFamily: '', fontSize: 0, foreColor: '',
      textAlign: 'left',
      unorderedList: false, orderedList: false
    };
    if (!doc) return empty;

    const safeState = (cmd) => {
      try { return !!doc.queryCommandState(cmd); } catch (_) { return false; }
    };
    const safeValue = (cmd) => {
      try { return doc.queryCommandValue(cmd) || ''; } catch (_) { return ''; }
    };

    // 정렬 상태
    let textAlign = 'left';
    if (safeState('justifyCenter')) textAlign = 'center';
    else if (safeState('justifyRight')) textAlign = 'right';
    else if (safeState('justifyFull')) textAlign = 'justify';
    else if (safeState('justifyLeft')) textAlign = 'left';

    // 폰트 패밀리: queryCommandValue('fontName') — 따옴표 제거
    const rawFamily = safeValue('fontName');
    const fontFamily = rawFamily.replace(/^['"]|['"]$/g, '').split(',')[0].trim();

    // 폰트 크기: 1) computed style 우선, 2) queryCommandValue 폴백
    let fontSize = 0;
    try {
      const sel = doc.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let node = range.startContainer;
        if (node.nodeType === 3) node = node.parentElement;
        if (node && doc.defaultView) {
          const cs = doc.defaultView.getComputedStyle(node);
          fontSize = parseInt(cs.fontSize, 10) || 0;
        }
      }
    } catch (_) { /* ignore */ }

    // 글자 색: computed style 우선
    let foreColor = '';
    try {
      const sel = doc.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let node = range.startContainer;
        if (node.nodeType === 3) node = node.parentElement;
        if (node && doc.defaultView) {
          foreColor = doc.defaultView.getComputedStyle(node).color || '';
        }
      }
    } catch (_) { /* ignore */ }

    return {
      bold: safeState('bold'),
      italic: safeState('italic'),
      underline: safeState('underline'),
      strikethrough: safeState('strikeThrough'),
      superscript: safeState('superscript'),
      subscript: safeState('subscript'),
      fontFamily,
      fontSize,
      foreColor,
      textAlign,
      unorderedList: safeState('insertUnorderedList'),
      orderedList: safeState('insertOrderedList')
    };
  }

  // ─── 키보드 단축키 (contracts §5) ─────────────
  function bindKeyboard(doc, callbacks) {
    if (!doc) return;
    callbacks = callbacks || {};

    const fire = () => {
      try { callbacks.onCommandApplied && callbacks.onCommandApplied(); }
      catch (e) { console.warn('[htmleditFormat] onCommandApplied 콜백 에러:', e); }
    };

    doc.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.isComposing) return;

      // 셸이 처리하는 ⌘O/⌘S/⌘⇧S/⌘Z/⌘⇧Z/⌘⇧E는 건드리지 않음
      const key = e.key.toLowerCase();
      if (key === 'o' || key === 's' || key === 'z') return;
      if (e.shiftKey && key === 'e') return;  // ⌘⇧E = 편집 모드 토글

      let handled = true;

      switch (key) {
        case 'b': bold(doc); break;
        case 'i': italic(doc); break;
        case 'u': underline(doc); break;
        case 'x':
          if (e.shiftKey) strikethrough(doc);
          else handled = false;
          break;
        case 'l':
          if (e.shiftKey) insertUnorderedList(doc);  // ⌘⇧L (PPT 관행)
          else alignLeft(doc);
          break;
        case 'e':
          // ⌘E = align center (⌘⇧E는 위에서 이미 return)
          alignCenter(doc);
          break;
        case 'r': alignRight(doc); break;
        case 'j': alignJustify(doc); break;
        case ']': indent(doc); break;
        case '[': outdent(doc); break;
        case '\\':
          removeFormat(doc);
          break;
        case '=':
          if (e.shiftKey) superscript(doc);
          else subscript(doc);
          break;
        case '7':
          if (e.shiftKey) insertOrderedList(doc);  // ⌘⇧7 (Word 관행)
          else handled = false;
          break;
        // ⌘F/G/⇧G/⇧H는 셸에서 처리 (find-replace.js)
        case 'f':
        case 'g':
        case 'h':
          handled = false;
          break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        fire();
      }
    }, true);  // capture phase
  }

  // ─── 글로벌 export ────────────────────────────
  window.htmleditFormat = {
    applyCommand,
    bold, italic, underline, strikethrough, superscript, subscript,
    setFontFamily, setFontSize, setForeColor, setHiliteColor,
    alignLeft, alignCenter, alignRight, alignJustify,
    insertUnorderedList, insertOrderedList, indent, outdent,
    removeFormat,
    getActiveFormats,
    bindKeyboard
  };
})();
