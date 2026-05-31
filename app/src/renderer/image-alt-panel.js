/**
 * image-alt-panel.js — Text Touch v0.6
 *
 * 이미지 alt·title 일괄 편집 사이드 패널.
 *
 * 동작 원리
 * - 셸의 #alt-panel 컨테이너(editor-engineer가 index.html에 빈 껍데기로 추가) 안에
 *   header / .alt-empty / .alt-list / footer 마크업을 모듈이 동적 생성한다.
 * - open() 호출 시점에 iframe.contentDocument의 모든 <img>를 스캔하여 행을 만든다.
 *   (SCRIPT/STYLE 내부 이미지는 통상 존재하지 않지만 querySelectorAll('img')는 그래도
 *   parent의 nodeName을 확인해 제외한다.)
 * - 입력란 변경 즉시 iframe 안 실제 <img>의 속성을 수정하고 callbacks.onChange()를 호출,
 *   editor.js가 markDirty 처리하도록 위임한다.
 * - iframe 자체의 변경 감지는 모듈이 하지 않는다. 새 파일이 열리면 editor-engineer가
 *   close()를 부르거나, 사용자가 다시 토글로 open()을 호출해 갱신한다.
 *
 * 변경 금지 영역: 다른 모든 파일. (contracts/v0.6-api.md §9)
 */
(function (global) {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────
  // 모듈 상태
  // ───────────────────────────────────────────────────────────────────────
  /** @type {HTMLElement|null} */
  let shellEl = null;
  /** @type {(() => Document|null)|null} */
  let getDoc = null;
  /** @type {{onChange?: () => void}} */
  let userCallbacks = {};

  /** @type {HTMLElement|null} 패널 컨테이너 (#alt-panel) */
  let panelEl = null;
  /** @type {HTMLElement|null} */
  let listEl = null;
  /** @type {HTMLElement|null} */
  let emptyEl = null;
  /** @type {HTMLButtonElement|null} */
  let closeBtn = null;

  /** @type {HTMLImageElement[]} 현재 열린 이미지 라이브 참조 (iframe 내부) */
  let currentImages = [];

  /** @type {boolean} */
  let opened = false;
  /** @type {boolean} */
  let initialized = false;

  // ───────────────────────────────────────────────────────────────────────
  // 유틸
  // ───────────────────────────────────────────────────────────────────────

  /**
   * src 경로에서 파일명만 뽑아낸다. data:, blob:, 빈 src에 대해 안전.
   * @param {string} src
   * @returns {string}
   */
  function extractFileName(src) {
    if (!src) return '(이미지)';
    if (src.startsWith('data:')) return '(인라인 데이터)';
    if (src.startsWith('blob:')) return '(blob)';
    // 쿼리·해시 제거
    let s = src.split('#')[0].split('?')[0];
    // 마지막 슬래시 이후
    const idx = s.lastIndexOf('/');
    if (idx >= 0) s = s.slice(idx + 1);
    try {
      s = decodeURIComponent(s);
    } catch (_) {
      /* ignore */
    }
    return s || '(이미지)';
  }

  /**
   * <img>가 script/style 등 비표시 영역에 있는지 확인.
   * 브라우저는 일반적으로 그런 위치의 img를 렌더하지 않지만, 사용자 HTML이
   * 비정상적으로 마크업된 경우를 방어한다.
   * @param {HTMLImageElement} img
   */
  function isExcluded(img) {
    let p = img.parentNode;
    while (p && p.nodeType === 1) {
      const tag = p.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT') {
        return true;
      }
      p = p.parentNode;
    }
    return false;
  }

  /**
   * 자연 크기 라벨. 이미지가 아직 로드되지 않았으면 0×0이 나올 수 있으니
   * "—"로 대체.
   * @param {HTMLImageElement} img
   */
  function dimensionLabel(img) {
    const w = img.naturalWidth | 0;
    const h = img.naturalHeight | 0;
    if (!w || !h) return '—';
    return w + '×' + h;
  }

  /**
   * 안전한 attribute 값. null/undefined → "".
   * @param {HTMLImageElement} img
   * @param {string} name
   */
  function attr(img, name) {
    const v = img.getAttribute(name);
    return v == null ? '' : v;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 패널 컨테이너 보장
  // ───────────────────────────────────────────────────────────────────────

  /**
   * #alt-panel 컨테이너를 찾거나, 없으면 셸 body 끝에 빈 <aside>를 만든다.
   * editor-engineer가 통합 단계에서 index.html에 마크업과 CSS를 추가하지만,
   * 그 전에 모듈만 로드돼도 죽지 않도록 fallback을 둔다.
   */
  function ensureContainer() {
    if (!shellEl) return null;
    const ownerDoc = shellEl.ownerDocument || document;
    let el = ownerDoc.getElementById('alt-panel');
    if (!el) {
      el = ownerDoc.createElement('aside');
      el.id = 'alt-panel';
      el.hidden = true;
      shellEl.appendChild(el);
    }
    return el;
  }

  /**
   * 컨테이너 내부 골격을 한 번만 그린다. 이미 그려졌으면 빈 listEl만 비워 재사용.
   */
  function ensureSkeleton() {
    if (!panelEl) return;
    const ownerDoc = panelEl.ownerDocument || document;

    // 헤더가 이미 있으면 스킵
    if (panelEl.querySelector('header')) {
      listEl = panelEl.querySelector('.alt-list');
      emptyEl = panelEl.querySelector('.alt-empty');
      closeBtn = panelEl.querySelector('.alt-panel-close');
      return;
    }

    // 깨끗하게
    panelEl.innerHTML = '';

    const header = ownerDoc.createElement('header');
    const h3 = ownerDoc.createElement('h3');
    h3.textContent = '이미지 alt · title';
    closeBtn = ownerDoc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'alt-panel-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.textContent = '✕';
    header.appendChild(h3);
    header.appendChild(closeBtn);

    emptyEl = ownerDoc.createElement('div');
    emptyEl.className = 'alt-empty';
    emptyEl.hidden = true;
    emptyEl.textContent = '편집할 이미지가 없습니다.';

    listEl = ownerDoc.createElement('div');
    listEl.className = 'alt-list';

    const footer = ownerDoc.createElement('footer');
    footer.className = 'alt-help';
    footer.textContent =
      '스크린리더가 읽는 대체 텍스트입니다. 이미지를 설명하는 한 문장이면 충분합니다.';

    panelEl.appendChild(header);
    panelEl.appendChild(emptyEl);
    panelEl.appendChild(listEl);
    panelEl.appendChild(footer);

    closeBtn.addEventListener('click', () => close());
  }

  // ───────────────────────────────────────────────────────────────────────
  // 렌더링
  // ───────────────────────────────────────────────────────────────────────

  /**
   * 한 행(.alt-item) DOM 생성. 입력 이벤트는 위임하지 않고 각 input에 직접 등록.
   * @param {HTMLImageElement} img
   * @param {number} idx
   * @param {Document} ownerDoc 셸 문서 (panel 소유)
   */
  function buildItem(img, idx, ownerDoc) {
    const item = ownerDoc.createElement('div');
    item.className = 'alt-item';
    item.dataset.imgIdx = String(idx);

    // 썸네일 — iframe 안 img.src를 그대로 사용. base 주입(v0.6 #6) 덕분에
    // 상대 경로도 file:// 절대 경로로 해석되어 동작한다.
    const thumb = ownerDoc.createElement('img');
    thumb.className = 'alt-thumb';
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.src = img.src || '';

    const fields = ownerDoc.createElement('div');
    fields.className = 'alt-fields';

    const meta = ownerDoc.createElement('div');
    meta.className = 'alt-meta';
    meta.textContent = extractFileName(img.getAttribute('src') || img.src) +
      ' · ' + dimensionLabel(img);

    // alt
    const altLabel = ownerDoc.createElement('label');
    const altSpan = ownerDoc.createElement('span');
    altSpan.textContent = '대체 텍스트 (alt)';
    const altInput = ownerDoc.createElement('input');
    altInput.type = 'text';
    altInput.dataset.attr = 'alt';
    altInput.value = attr(img, 'alt');
    altInput.placeholder = '이미지 설명';
    altLabel.appendChild(altSpan);
    altLabel.appendChild(altInput);

    // title
    const titleLabel = ownerDoc.createElement('label');
    const titleSpan = ownerDoc.createElement('span');
    titleSpan.textContent = '툴팁 (title)';
    const titleInput = ownerDoc.createElement('input');
    titleInput.type = 'text';
    titleInput.dataset.attr = 'title';
    titleInput.value = attr(img, 'title');
    titleLabel.appendChild(titleSpan);
    titleLabel.appendChild(titleInput);

    fields.appendChild(meta);
    fields.appendChild(altLabel);
    fields.appendChild(titleLabel);

    item.appendChild(thumb);
    item.appendChild(fields);

    // 입력 → 즉시 iframe img 속성 반영
    const onInput = (e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      const value = target.value;
      const a = target.dataset.attr;
      const parentItem = target.closest('.alt-item');
      if (!parentItem) return;
      const i = parseInt(parentItem.getAttribute('data-img-idx') || '-1', 10);
      const liveImg = currentImages[i];
      if (!liveImg) return;
      if (a === 'alt') {
        // alt는 빈 문자열이 의미를 가지므로 항상 setAttribute(장식용 이미지 표식).
        liveImg.setAttribute('alt', value);
      } else if (a === 'title') {
        if (value) liveImg.setAttribute('title', value);
        else liveImg.removeAttribute('title');
      }
      if (userCallbacks && typeof userCallbacks.onChange === 'function') {
        userCallbacks.onChange();
      }
    };
    altInput.addEventListener('input', onInput);
    titleInput.addEventListener('input', onInput);

    return item;
  }

  /**
   * 현재 iframe 문서에서 이미지를 스캔하고 .alt-list를 다시 그린다.
   */
  function render() {
    if (!panelEl || !listEl || !emptyEl) return;
    const ownerDoc = panelEl.ownerDocument || document;

    // 1) iframe 문서 가져오기
    let doc = null;
    try {
      doc = typeof getDoc === 'function' ? getDoc() : null;
    } catch (_) {
      doc = null;
    }

    // 2) 이미지 수집
    currentImages = [];
    if (doc) {
      const imgs = doc.querySelectorAll('img');
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        if (isExcluded(img)) continue;
        currentImages.push(img);
      }
    }

    // 3) 기존 행 비우기 (이벤트 핸들러는 GC에 맡김 — 행이 통째로 사라지므로 leak X)
    listEl.innerHTML = '';

    if (currentImages.length === 0) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    listEl.hidden = false;

    // 4) DocumentFragment로 묶어 1회 reflow
    const frag = ownerDoc.createDocumentFragment();
    for (let i = 0; i < currentImages.length; i++) {
      frag.appendChild(buildItem(currentImages[i], i, ownerDoc));
    }
    listEl.appendChild(frag);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 공개 API
  // ───────────────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} _shellEl 셸 body 또는 그 자식 컨테이너
   * @param {() => (Document|null)} _getDoc iframe.contentDocument를 lazy 반환
   * @param {{onChange?: () => void}} [_callbacks]
   */
  function init(_shellEl, _getDoc, _callbacks) {
    shellEl = _shellEl || (typeof document !== 'undefined' ? document.body : null);
    getDoc = typeof _getDoc === 'function' ? _getDoc : () => null;
    userCallbacks = _callbacks || {};
    panelEl = ensureContainer();
    ensureSkeleton();
    initialized = true;
  }

  function open() {
    if (!initialized) return;
    if (!panelEl) panelEl = ensureContainer();
    ensureSkeleton();
    render();
    panelEl.hidden = false;
    const ownerDoc = panelEl.ownerDocument || document;
    if (ownerDoc.body) ownerDoc.body.classList.add('alt-panel-open');
    opened = true;
  }

  function close() {
    if (!panelEl) return;
    panelEl.hidden = true;
    const ownerDoc = panelEl.ownerDocument || document;
    if (ownerDoc.body) ownerDoc.body.classList.remove('alt-panel-open');
    // 라이브 참조 해제 — iframe이 다음에 갈아끼워질 때 stale 참조로 setAttribute하지 않도록
    currentImages = [];
    if (listEl) listEl.innerHTML = '';
    opened = false;
  }

  function toggle() {
    if (opened) close();
    else open();
  }

  function isOpen() {
    return opened;
  }

  // ───────────────────────────────────────────────────────────────────────
  // export
  // ───────────────────────────────────────────────────────────────────────
  global.htmleditAltPanel = {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
