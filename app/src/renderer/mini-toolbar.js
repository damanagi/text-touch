// mini-toolbar.js — PowerPoint 스타일 부동 미니 툴바
// - 선택 영역 위에 떠서 서식 적용 (B/I/U/S, 폰트, 크기, 색, 정렬, 리스트, 서식 지우기)
// - rect는 셸 좌표 기준 (editor-engineer가 iframe 좌표 → 셸 좌표 변환 후 넘김)
// - 외부 클릭 시 자동 hide
// - update(activeFormats)로 버튼 aria-pressed / select value 갱신
// - contracts/v0.5-api.md §2 / §4 기준

(function () {
  'use strict';

  // ─── 상태 ──────────────────────────────────
  const state = {
    shellEl: null,
    getDoc: null,
    tb: null,
    callbacks: {},
    isVisible: false,
    hiliteActive: false
  };

  // ─── 마크업 마운트 ─────────────────────────
  function mountToolbar(shellEl) {
    let tb = document.getElementById('mini-toolbar');
    if (!tb) {
      tb = document.createElement('div');
      tb.id = 'mini-toolbar';
      tb.hidden = true;
      tb.setAttribute('role', 'toolbar');
      tb.setAttribute('aria-label', '텍스트 서식');
      shellEl.appendChild(tb);
    }
    tb.innerHTML = `
      <select class="mt-select" data-format-cmd="fontFamily" aria-label="글꼴" title="글꼴">
        <option value="-apple-system">-apple-system</option>
        <option value="Pretendard Variable">Pretendard Variable</option>
        <option value="Noto Sans KR">Noto Sans KR</option>
        <option value="Apple SD Gothic Neo">Apple SD Gothic Neo</option>
        <option value="Times">Times</option>
        <option value="Georgia">Georgia</option>
        <option value="Courier">Courier</option>
        <option value="Menlo">Menlo</option>
      </select>
      <select class="mt-select" data-format-cmd="fontSize" aria-label="크기" title="크기">
        <option value="10">10</option>
        <option value="12">12</option>
        <option value="14">14</option>
        <option value="16">16</option>
        <option value="18">18</option>
        <option value="20">20</option>
        <option value="24">24</option>
        <option value="28">28</option>
        <option value="32">32</option>
        <option value="40">40</option>
        <option value="48">48</option>
        <option value="60">60</option>
        <option value="72">72</option>
      </select>
      <span class="sep"></span>
      <button type="button" class="format-btn" data-format-cmd="bold" aria-label="굵게 ⌘B" title="굵게 ⌘B"><b>B</b></button>
      <button type="button" class="format-btn" data-format-cmd="italic" aria-label="기울임 ⌘I" title="기울임 ⌘I"><i>I</i></button>
      <button type="button" class="format-btn" data-format-cmd="underline" aria-label="밑줄 ⌘U" title="밑줄 ⌘U"><u>U</u></button>
      <button type="button" class="format-btn" data-format-cmd="strikethrough" aria-label="취소선 ⌘⇧X" title="취소선 ⌘⇧X"><s>S</s></button>
      <span class="sep"></span>
      <input type="color" class="format-btn color-input" data-format-cmd="foreColor" aria-label="글자 색" title="글자 색" value="#000000" />
      <button type="button" class="format-btn hilite-btn" data-format-cmd="hiliteColor" aria-label="형광펜" title="형광펜">▒</button>
      <span class="sep"></span>
      <button type="button" class="format-btn" data-format-cmd="alignLeft" aria-label="왼쪽 정렬 ⌘L" title="왼쪽 정렬 ⌘L">⫷</button>
      <button type="button" class="format-btn" data-format-cmd="alignCenter" aria-label="가운데 ⌘E" title="가운데 ⌘E">⫶</button>
      <button type="button" class="format-btn" data-format-cmd="alignRight" aria-label="오른쪽 ⌘R" title="오른쪽 ⌘R">⫸</button>
      <button type="button" class="format-btn" data-format-cmd="alignJustify" aria-label="양쪽 ⌘J" title="양쪽 ⌘J">⫼</button>
      <span class="sep"></span>
      <button type="button" class="format-btn" data-format-cmd="insertUnorderedList" aria-label="글머리 기호" title="글머리 기호">•</button>
      <button type="button" class="format-btn" data-format-cmd="insertOrderedList" aria-label="번호 매기기" title="번호 매기기">1.</button>
      <button type="button" class="format-btn" data-format-cmd="removeFormat" aria-label="서식 지우기 ⌘\\" title="서식 지우기 ⌘\\">⌫</button>
    `;
    return tb;
  }

  // ─── 보이기 / 숨기기 ───────────────────────
  function show(rect) {
    if (!state.tb || !rect) return;
    state.tb.hidden = false;
    state.tb.classList.add('visible');

    // 측정 (hidden 해제 후)
    const tbRect = state.tb.getBoundingClientRect();
    const tbH = tbRect.height || 40;
    const tbW = tbRect.width || 480;

    // 기본: 선택 영역 위 8px, 가운데 정렬
    let top = rect.top - tbH - 8;
    let left = rect.left + rect.width / 2 - tbW / 2;

    // 상단 toolbar(약 76px) + format-bar(약 28px) 영역 침범 시 선택 영역 아래로
    const minTop = 76 + 28;
    if (top < minTop) {
      top = rect.bottom + 8;
    }

    // 좌우 화면 경계
    const margin = 8;
    left = Math.max(margin, Math.min(left, window.innerWidth - tbW - margin));

    // 하단 경계 (혹시 아래로도 넘치면 그냥 위쪽 강제)
    if (top + tbH > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - tbH - margin);
    }

    state.tb.style.top = top + 'px';
    state.tb.style.left = left + 'px';
    state.isVisible = true;
  }

  function hide() {
    if (!state.tb) return;
    state.tb.hidden = true;
    state.tb.classList.remove('visible');
    state.isVisible = false;
  }

  function isVisible() {
    return state.isVisible;
  }

  // ─── 활성 상태 갱신 ───────────────────────
  function update(activeFormats) {
    if (!state.tb || !activeFormats) return;
    const tb = state.tb;

    // 토글 버튼들의 aria-pressed
    const setPressed = (cmd, on) => {
      const btn = tb.querySelector(`button[data-format-cmd="${cmd}"]`);
      if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    setPressed('bold', activeFormats.bold);
    setPressed('italic', activeFormats.italic);
    setPressed('underline', activeFormats.underline);
    setPressed('strikethrough', activeFormats.strikethrough);

    // 정렬: 한 번에 하나만 활성
    setPressed('alignLeft',   activeFormats.textAlign === 'left');
    setPressed('alignCenter', activeFormats.textAlign === 'center');
    setPressed('alignRight',  activeFormats.textAlign === 'right');
    setPressed('alignJustify', activeFormats.textAlign === 'justify');

    setPressed('insertUnorderedList', activeFormats.unorderedList);
    setPressed('insertOrderedList',   activeFormats.orderedList);

    // 폰트 패밀리 select
    const fontSel = tb.querySelector('select[data-format-cmd="fontFamily"]');
    if (fontSel && activeFormats.fontFamily) {
      const target = activeFormats.fontFamily.toLowerCase();
      for (let i = 0; i < fontSel.options.length; i++) {
        if (fontSel.options[i].value.toLowerCase() === target) {
          fontSel.selectedIndex = i;
          break;
        }
      }
    }

    // 폰트 크기 select
    const sizeSel = tb.querySelector('select[data-format-cmd="fontSize"]');
    if (sizeSel && activeFormats.fontSize) {
      const target = String(activeFormats.fontSize);
      let matched = false;
      for (let i = 0; i < sizeSel.options.length; i++) {
        if (sizeSel.options[i].value === target) {
          sizeSel.selectedIndex = i;
          matched = true;
          break;
        }
      }
      // 일치 옵션 없으면 가장 가까운 값으로 (별도 처리 생략)
      if (!matched) sizeSel.selectedIndex = -1;
    }

    // 글자 색
    const colorInput = tb.querySelector('input[data-format-cmd="foreColor"]');
    if (colorInput && activeFormats.foreColor) {
      const hex = rgbToHex(activeFormats.foreColor);
      if (hex) colorInput.value = hex;
    }
  }

  // rgb(255,0,0) → #ff0000
  function rgbToHex(input) {
    if (!input) return null;
    if (input[0] === '#') return input;
    const m = input.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const toHex = (n) => {
      const h = parseInt(n, 10).toString(16);
      return h.length === 1 ? '0' + h : h;
    };
    return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
  }

  // ─── 명령 디스패치 ─────────────────────────
  function dispatch(cmd, value, btn) {
    if (!window.htmleditFormat) {
      console.warn('[htmleditMiniToolbar] htmleditFormat 미로드');
      return;
    }
    const doc = state.getDoc && state.getDoc();
    if (!doc) return;
    const F = window.htmleditFormat;

    switch (cmd) {
      case 'bold':           F.bold(doc); break;
      case 'italic':         F.italic(doc); break;
      case 'underline':      F.underline(doc); break;
      case 'strikethrough':  F.strikethrough(doc); break;
      case 'superscript':    F.superscript(doc); break;
      case 'subscript':      F.subscript(doc); break;
      case 'fontFamily':     F.setFontFamily(doc, value); break;
      case 'fontSize':       F.setFontSize(doc, parseInt(value, 10)); break;
      case 'foreColor':      F.setForeColor(doc, value); break;
      case 'hiliteColor':
        // v0.5: 노란색 토글
        if (state.hiliteActive) {
          F.setHiliteColor(doc, null);
          state.hiliteActive = false;
          if (btn) btn.removeAttribute('data-active');
        } else {
          F.setHiliteColor(doc, '#fff59d');
          state.hiliteActive = true;
          if (btn) btn.setAttribute('data-active', '1');
        }
        break;
      case 'alignLeft':      F.alignLeft(doc); break;
      case 'alignCenter':    F.alignCenter(doc); break;
      case 'alignRight':     F.alignRight(doc); break;
      case 'alignJustify':   F.alignJustify(doc); break;
      case 'alignToggle': {
        // 순환: left → center → right → left
        const af = F.getActiveFormats(doc);
        if (af.textAlign === 'left') F.alignCenter(doc);
        else if (af.textAlign === 'center') F.alignRight(doc);
        else F.alignLeft(doc);
        break;
      }
      case 'insertUnorderedList': F.insertUnorderedList(doc); break;
      case 'insertOrderedList':   F.insertOrderedList(doc); break;
      case 'indent':              F.indent(doc); break;
      case 'outdent':             F.outdent(doc); break;
      case 'removeFormat':        F.removeFormat(doc); break;
      default:
        console.warn('[htmleditMiniToolbar] unknown cmd:', cmd);
        return;
    }

    // dirty 알림
    try { state.callbacks.onCommandApplied && state.callbacks.onCommandApplied(); }
    catch (e) { console.warn('[htmleditMiniToolbar] onCommandApplied 콜백 에러:', e); }

    // 상태 갱신
    try {
      update(F.getActiveFormats(doc));
    } catch (_) { /* ignore */ }
  }

  // ─── 이벤트 바인딩 ─────────────────────────
  function bindToolbarEvents() {
    const tb = state.tb;
    if (!tb) return;

    // 미니 툴바 자체 mousedown은 selection 유실 방지를 위해 preventDefault
    tb.addEventListener('mousedown', (e) => {
      // input/select는 default 동작 허용 (포커스·드롭다운 열기)
      const target = e.target;
      const tag = target.tagName;
      if (tag === 'INPUT' && target.type === 'color') return;
      if (tag === 'SELECT') return;
      e.preventDefault();
    });

    // 버튼 클릭
    tb.addEventListener('click', (e) => {
      const el = e.target.closest('[data-format-cmd]');
      if (!el) return;
      const cmd = el.dataset.formatCmd;
      // 버튼은 즉시 dispatch (select/color는 change에서 처리)
      const tag = el.tagName;
      if (tag === 'BUTTON') {
        dispatch(cmd, undefined, el);
      }
    });

    // select 변경
    tb.addEventListener('change', (e) => {
      const el = e.target.closest('[data-format-cmd]');
      if (!el) return;
      const cmd = el.dataset.formatCmd;
      dispatch(cmd, el.value, el);
    });

    // color input은 input 이벤트로도 라이브 반영
    const colorInput = tb.querySelector('input[type="color"][data-format-cmd="foreColor"]');
    if (colorInput) {
      colorInput.addEventListener('input', (e) => {
        dispatch('foreColor', e.target.value, e.target);
      });
    }
  }

  // ─── 외부 클릭 시 닫기 ─────────────────────
  function bindOutsideClick() {
    document.addEventListener('mousedown', (e) => {
      if (!state.isVisible || !state.tb) return;
      if (state.tb.contains(e.target)) return;
      // iframe 안 클릭은 selectionchange가 처리. 셸 영역의 미니툴바 밖 클릭만 닫기.
      hide();
    }, true);
  }

  // ─── 초기화 ────────────────────────────────
  function init(shellEl, getDoc, callbacks) {
    state.shellEl = shellEl || document.body;
    state.getDoc = getDoc;
    state.callbacks = callbacks || {};
    state.tb = mountToolbar(state.shellEl);
    bindToolbarEvents();
    bindOutsideClick();
  }

  // ─── 글로벌 export ────────────────────────
  window.htmleditMiniToolbar = {
    init,
    show,
    hide,
    update,
    isVisible
  };
})();
