// find-replace.js — 찾기·바꾸기 + 부동 바 UI
// - 셸(document.body)에 부동 바 마운트
// - iframe.contentDocument 안의 텍스트 노드를 TreeWalker로 순회
// - 매치는 <mark class="htmledit-find-highlight">로 감쌈, 현재 매치는 .htmledit-find-current 추가
// - 단축키 ⌘F/G/⇧G/⇧H는 셸에 등록 (contracts §5)
// - 저장 직전 editor.js가 clearHighlights() 호출 → 모두 unwrap
// - contracts/v0.5-api.md §2 기준

(function () {
  'use strict';

  // ─── 상태 ──────────────────────────────────
  const state = {
    shellEl: null,
    getDoc: null,
    bar: null,
    qInput: null,
    rInput: null,
    countEl: null,
    caseCheckbox: null,
    wordCheckbox: null,
    replaceRow: null,
    isReplaceOpen: false,
    currentIndex: -1,
    matches: [],     // <mark> 엘리먼트 배열
    lastQuery: '',
    lastOpts: { caseSensitive: false, wholeWord: false }
  };

  // ─── UI 마운트 ─────────────────────────────
  function mountBar(shellEl) {
    if (document.getElementById('find-bar') && document.getElementById('find-bar').dataset.htmleditMounted === '1') {
      return document.getElementById('find-bar');
    }

    // editor-engineer가 만든 컨테이너가 있으면 재사용
    let bar = document.getElementById('find-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'find-bar';
      bar.hidden = true;
      bar.setAttribute('role', 'search');
      // 상단 toolbar 다음에 삽입
      const toolbar = document.getElementById('toolbar');
      if (toolbar && toolbar.parentNode) {
        toolbar.parentNode.insertBefore(bar, toolbar.nextSibling);
      } else {
        shellEl.appendChild(bar);
      }
    }

    bar.innerHTML = `
      <div class="find-replace-row">
        <input id="find-q" type="text" placeholder="찾기" autocomplete="off" spellcheck="false" />
        <span id="find-count" aria-live="polite">0 / 0</span>
        <button id="find-prev" type="button" aria-label="이전 (⌘⇧G)" title="이전 ⌘⇧G">◀</button>
        <button id="find-next" type="button" aria-label="다음 (⌘G)" title="다음 ⌘G">▶</button>
        <label class="find-opt"><input type="checkbox" id="find-case" /> Aa</label>
        <label class="find-opt"><input type="checkbox" id="find-word" /> 단어</label>
        <button id="find-toggle-replace" type="button" aria-label="바꾸기 표시">바꾸기</button>
        <button id="find-close" type="button" aria-label="닫기" title="닫기 (Esc)">✕</button>
      </div>
      <div class="find-replace-row" id="find-replace-row" hidden>
        <input id="find-r" type="text" placeholder="바꿀 텍스트" autocomplete="off" spellcheck="false" />
        <button id="find-replace-one" type="button">바꾸기</button>
        <button id="find-replace-all" type="button">모두 바꾸기</button>
      </div>
    `;
    bar.dataset.htmleditMounted = '1';
    return bar;
  }

  // ─── 정규식 이스케이프 ─────────────────────
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── 검색 ─────────────────────────────────
  function search(query, opts) {
    opts = opts || {};
    state.lastQuery = query || '';
    state.lastOpts = {
      caseSensitive: !!opts.caseSensitive,
      wholeWord: !!opts.wholeWord
    };

    // 기존 하이라이트 제거
    clearHighlights();

    if (!state.lastQuery) {
      state.matches = [];
      state.currentIndex = -1;
      updateCount();
      return { count: 0 };
    }

    const doc = state.getDoc && state.getDoc();
    if (!doc) {
      state.matches = [];
      state.currentIndex = -1;
      updateCount();
      return { count: 0 };
    }

    const flags = state.lastOpts.caseSensitive ? 'g' : 'gi';
    const escaped = escapeRegex(state.lastQuery);
    const pattern = state.lastOpts.wholeWord ? `\\b${escaped}\\b` : escaped;
    let regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      console.warn('[htmleditFindReplace] 정규식 컴파일 실패:', e);
      state.matches = [];
      state.currentIndex = -1;
      updateCount();
      return { count: 0 };
    }

    // 텍스트 노드 수집
    const textNodes = collectTextNodes(doc);

    // 각 노드 매치 → mark 래핑
    const marks = [];
    for (const node of textNodes) {
      const text = node.nodeValue;
      if (!text) continue;
      // regex.lastIndex 초기화 (전역 플래그 사용 시 상태 누적 방지)
      regex.lastIndex = 0;
      const localMatches = [];
      let m;
      while ((m = regex.exec(text)) !== null) {
        localMatches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        // zero-length 방지
        if (m.index === regex.lastIndex) regex.lastIndex++;
      }
      if (localMatches.length === 0) continue;

      // node를 분할하면서 mark 삽입
      const parent = node.parentNode;
      if (!parent) continue;
      const frag = doc.createDocumentFragment();
      let cursor = 0;
      for (const lm of localMatches) {
        if (lm.start > cursor) {
          frag.appendChild(doc.createTextNode(text.slice(cursor, lm.start)));
        }
        const mark = doc.createElement('mark');
        mark.className = 'htmledit-find-highlight';
        mark.textContent = lm.text;
        frag.appendChild(mark);
        marks.push(mark);
        cursor = lm.end;
      }
      if (cursor < text.length) {
        frag.appendChild(doc.createTextNode(text.slice(cursor)));
      }
      parent.replaceChild(frag, node);
    }

    state.matches = marks;
    state.currentIndex = marks.length > 0 ? 0 : -1;
    if (state.currentIndex >= 0) focusCurrent();
    updateCount();
    return { count: marks.length };
  }

  // ─── 텍스트 노드 수집 (SKIP_TAGS 회피 + 기존 mark 회피) ──
  function collectTextNodes(doc) {
    const SKIP = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
      'TITLE', 'META', 'LINK', 'HEAD',
      'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED'
    ]);
    const nodes = [];
    if (!doc.body) return nodes;
    const walker = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(n) {
          if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
          let p = n.parentElement;
          while (p) {
            if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
            // 이미 다른 find-highlight 안에 있으면 skip
            if (p.classList && p.classList.contains('htmledit-find-highlight')) {
              return NodeFilter.FILTER_REJECT;
            }
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  // ─── 하이라이트 제거 (저장 직전 호출) ─────
  function clearHighlights() {
    const doc = state.getDoc && state.getDoc();
    if (!doc || !doc.body) {
      state.matches = [];
      state.currentIndex = -1;
      return;
    }
    const marks = doc.querySelectorAll('mark.htmledit-find-highlight');
    marks.forEach(mark => unwrap(mark));
    state.matches = [];
    state.currentIndex = -1;
    updateCount();
  }

  function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    // 인접 텍스트 노드 병합
    parent.normalize();
  }

  // ─── 현재 매치 포커스 ─────────────────────
  function focusCurrent() {
    // 이전 current 클래스 제거
    state.matches.forEach(m => m.classList.remove('htmledit-find-current'));
    const cur = state.matches[state.currentIndex];
    if (!cur) return;
    cur.classList.add('htmledit-find-current');
    try {
      cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) {
      cur.scrollIntoView();
    }
  }

  function goToNext() {
    if (state.matches.length === 0) return;
    state.currentIndex = (state.currentIndex + 1) % state.matches.length;
    focusCurrent();
    updateCount();
  }

  function goToPrev() {
    if (state.matches.length === 0) return;
    state.currentIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length;
    focusCurrent();
    updateCount();
  }

  // ─── 바꾸기 ───────────────────────────────
  function replaceCurrent(replacement) {
    if (state.currentIndex < 0 || state.currentIndex >= state.matches.length) return;
    const cur = state.matches[state.currentIndex];
    if (!cur || !cur.parentNode) return;
    const doc = state.getDoc && state.getDoc();
    if (!doc) return;

    const textNode = doc.createTextNode(replacement != null ? replacement : '');
    cur.parentNode.replaceChild(textNode, cur);

    // 배열에서 제거
    state.matches.splice(state.currentIndex, 1);
    if (state.matches.length === 0) {
      state.currentIndex = -1;
    } else {
      // 현재 위치 유지 (다음 매치가 그 자리로 이동)
      if (state.currentIndex >= state.matches.length) {
        state.currentIndex = 0;
      }
      focusCurrent();
    }
    updateCount();
  }

  function replaceAll(replacement) {
    const doc = state.getDoc && state.getDoc();
    if (!doc) return { replaced: 0 };
    const repl = replacement != null ? replacement : '';
    let count = 0;
    for (const mark of state.matches) {
      if (!mark.parentNode) continue;
      mark.parentNode.replaceChild(doc.createTextNode(repl), mark);
      count++;
    }
    state.matches = [];
    state.currentIndex = -1;
    updateCount();
    return { replaced: count };
  }

  // ─── 카운트 표시 갱신 ──────────────────────
  function updateCount() {
    if (!state.countEl) return;
    const total = state.matches.length;
    const cur = state.currentIndex >= 0 ? state.currentIndex + 1 : 0;
    state.countEl.textContent = `${cur} / ${total}`;
  }

  // ─── 바 열기·닫기 ──────────────────────────
  function openFindBar() {
    if (!state.bar) return;
    state.bar.hidden = false;
    state.bar.classList.add('visible');
    state.isReplaceOpen = false;
    if (state.replaceRow) state.replaceRow.hidden = true;
    if (state.qInput) {
      state.qInput.focus();
      state.qInput.select();
    }
  }

  function openReplaceBar() {
    if (!state.bar) return;
    state.bar.hidden = false;
    state.bar.classList.add('visible');
    state.isReplaceOpen = true;
    if (state.replaceRow) state.replaceRow.hidden = false;
    if (state.qInput) {
      state.qInput.focus();
      state.qInput.select();
    }
  }

  function closeBar() {
    if (!state.bar) return;
    state.bar.hidden = true;
    state.bar.classList.remove('visible');
    clearHighlights();
  }

  // ─── 이벤트 바인딩 ─────────────────────────
  function bindBarEvents() {
    const bar = state.bar;
    if (!bar) return;

    state.qInput        = bar.querySelector('#find-q');
    state.rInput        = bar.querySelector('#find-r');
    state.countEl       = bar.querySelector('#find-count');
    state.caseCheckbox  = bar.querySelector('#find-case');
    state.wordCheckbox  = bar.querySelector('#find-word');
    state.replaceRow    = bar.querySelector('#find-replace-row');

    const btnPrev       = bar.querySelector('#find-prev');
    const btnNext       = bar.querySelector('#find-next');
    const btnToggle     = bar.querySelector('#find-toggle-replace');
    const btnClose      = bar.querySelector('#find-close');
    const btnReplaceOne = bar.querySelector('#find-replace-one');
    const btnReplaceAll = bar.querySelector('#find-replace-all');

    // 검색어 입력 시 자동 검색 (디바운스)
    let debounceTimer = null;
    const triggerSearch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        search(state.qInput.value, {
          caseSensitive: state.caseCheckbox.checked,
          wholeWord: state.wordCheckbox.checked
        });
      }, 120);
    };

    state.qInput.addEventListener('input', triggerSearch);
    state.caseCheckbox.addEventListener('change', triggerSearch);
    state.wordCheckbox.addEventListener('change', triggerSearch);

    state.qInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) goToPrev(); else goToNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeBar();
      }
    });

    if (state.rInput) {
      state.rInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          replaceCurrent(state.rInput.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeBar();
        }
      });
    }

    btnPrev.addEventListener('click', goToPrev);
    btnNext.addEventListener('click', goToNext);
    btnClose.addEventListener('click', closeBar);
    btnToggle.addEventListener('click', () => {
      state.isReplaceOpen = !state.isReplaceOpen;
      state.replaceRow.hidden = !state.isReplaceOpen;
      if (state.isReplaceOpen && state.rInput) state.rInput.focus();
    });
    btnReplaceOne.addEventListener('click', () => replaceCurrent(state.rInput ? state.rInput.value : ''));
    btnReplaceAll.addEventListener('click', () => replaceAll(state.rInput ? state.rInput.value : ''));
  }

  // ─── 셸 단축키 (⌘F/G/⇧G/⇧H) ────────────────
  function bindShellShortcuts() {
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();

      if (key === 'f' && !e.shiftKey) {
        e.preventDefault();
        openFindBar();
      } else if (key === 'g') {
        e.preventDefault();
        if (e.shiftKey) goToPrev();
        else goToNext();
      } else if (key === 'h' && e.shiftKey) {
        e.preventDefault();
        openReplaceBar();
      }
    }, true);  // capture
  }

  // ─── 메뉴 액션 수신 ────────────────────────
  function bindMenuActions() {
    if (!window.htmledit || typeof window.htmledit.onMenuAction !== 'function') return;
    window.htmledit.onMenuAction((action) => {
      if (action === 'find') openFindBar();
      else if (action === 'findNext') goToNext();
      else if (action === 'findPrev') goToPrev();
      else if (action === 'replace') openReplaceBar();
    });
  }

  // ─── 초기화 ────────────────────────────────
  function init(shellEl, getDoc) {
    state.shellEl = shellEl || document.body;
    state.getDoc = getDoc;
    state.bar = mountBar(state.shellEl);
    bindBarEvents();
    bindShellShortcuts();
    bindMenuActions();
  }

  // ─── 글로벌 export ────────────────────────
  window.htmleditFindReplace = {
    init,
    openFindBar,
    openReplaceBar,
    closeBar,
    search: function (query, opts) { return search(query, opts); },
    goToNext,
    goToPrev,
    replaceCurrent,
    replaceAll,
    clearHighlights
  };
})();
