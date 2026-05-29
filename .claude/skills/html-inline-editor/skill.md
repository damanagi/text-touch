---
name: html-inline-editor
description: 로드된 HTML 문서의 텍스트 노드를 자동 감지해 contentEditable 인라인 편집기로 만들고, 슬라이드형(position:absolute) 요소에서는 마우스 드래그로 텍스트 상자를 이동 가능하게 한다. 디자인·CSS·스크립트를 한 픽셀도 흔들지 않고 텍스트와 위치만 수정해야 할 때 반드시 이 스킬을 사용한다. Undo/Redo 스택, 편집 모드 토글, 변경 사항 시각 표시 포함.
---

# HTML Inline Editor — 디자인 보존 인라인 편집 레시피

## 왜 이 방식인가

`contentEditable=true`는 한 줄로 어떤 요소든 편집 가능하게 만들지만, 무차별로 켜면 두 문제가 생긴다. 첫째 사용자가 의도하지 않은 영역(스크립트 출력 자리, 빈 컨테이너)까지 편집 가능. 둘째 편집 도중 줄바꿈이 `<div>`나 `<br>`로 자유롭게 삽입되어 원본 마크업이 변형된다. 그래서 **TreeWalker로 텍스트 노드만 골라내고**, 그 부모 요소에만 `contentEditable`을 주고, **input 이벤트로 변경을 추적**하는 패턴을 쓴다. 

드래그 이동도 마찬가지다. `position: absolute`인 요소만 안전하게 옮길 수 있다. 일반 flow 요소에 transform translate를 주면 화면상으론 옮겨지지만 다른 요소와 겹쳐 레이아웃이 망가진다. 그래서 **드래그 핸들 부여 자체를 조건부**로 한다.

## HTML 로드 → 파싱 → 마운트

```js
async function loadDocument(filePath, htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  // 파싱 에러 검사
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    throw new Error('HTML 구조에 문제가 있어 편집할 수 없어요. 코드 에디터로 먼저 확인해주세요.');
  }

  // 원본 HTML은 그대로 보관 (저장 시 head 등 전체 재구성용)
  state.originalDoc = doc;
  state.filePath = filePath;

  // 렌더링: 우리 앱의 iframe 또는 컨테이너에 body 내용을 옮긴다
  mountIntoContainer(doc);

  // 편집 모드 OFF 상태로 시작
  setEditMode(false);
}
```

## 텍스트 노드 식별 (TreeWalker)

```js
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'META', 'LINK', 'HEAD']);

function findEditableHosts(root) {
  const hosts = new Set();
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // 공백만 있는 텍스트 노드 제외
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // 제외 태그 내부 제외
        let p = node.parentElement;
        while (p) {
          if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p === root) break;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while ((node = walker.nextNode())) {
    // 가장 가까운 블록 또는 inline 부모를 호스트로 (텍스트가 그 안에 있도록)
    hosts.add(node.parentElement);
  }
  return Array.from(hosts);
}
```

> 텍스트 노드 자체가 아니라 **부모 요소**에 contentEditable을 준다. 텍스트 노드는 contentEditable 속성을 가질 수 없기 때문.

## 편집 모드 토글

```js
function setEditMode(on) {
  state.editMode = on;
  const hosts = findEditableHosts(state.container);

  for (const host of hosts) {
    if (on) {
      host.setAttribute('contenteditable', 'true');
      host.classList.add('htmledit-editable');
      bindEditEvents(host);
    } else {
      host.removeAttribute('contenteditable');
      host.classList.remove('htmledit-editable');
      unbindEditEvents(host);
    }
  }

  document.body.classList.toggle('htmledit-mode-on', on);
}
```

CSS에서 호버 표시:

```css
.htmledit-mode-on .htmledit-editable {
  outline: 1px dashed transparent;
  transition: outline-color 0.15s;
}
.htmledit-mode-on .htmledit-editable:hover {
  outline-color: rgba(0, 122, 255, 0.4);
  cursor: text;
}
.htmledit-mode-on .htmledit-editable:focus {
  outline: 2px solid rgba(0, 122, 255, 0.8);
  outline-offset: 2px;
}
```

## 변경 추적 + Undo/Redo

```js
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 200;

function bindEditEvents(host) {
  let beforeValue = host.innerHTML;

  host.addEventListener('focus', () => {
    beforeValue = host.innerHTML;
  });

  host.addEventListener('blur', () => {
    const afterValue = host.innerHTML;
    if (afterValue !== beforeValue) {
      undoStack.push({
        type: 'text',
        host,
        before: beforeValue,
        after: afterValue,
        timestamp: Date.now()
      });
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0; // 새 편집 시 redo 클리어
      host.classList.add('htmledit-changed');
      state.dirty = true;
      updateTitleBar();
    }
  });

  // Enter는 줄바꿈만 허용, <div> 분할 방지
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // 기본 동작 차단 + br 직접 삽입
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  });

  // 붙여넣기: 서식 제거하고 평문만
  host.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
}

function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  redoStack.push(entry);
  if (entry.type === 'text') {
    entry.host.innerHTML = entry.before;
  } else if (entry.type === 'move') {
    entry.host.style.left = entry.before.left;
    entry.host.style.top = entry.before.top;
  }
  state.dirty = undoStack.length > 0;
  updateTitleBar();
}

function redo() {
  const entry = redoStack.pop();
  if (!entry) return;
  undoStack.push(entry);
  if (entry.type === 'text') {
    entry.host.innerHTML = entry.after;
  } else if (entry.type === 'move') {
    entry.host.style.left = entry.after.left;
    entry.host.style.top = entry.after.top;
  }
  state.dirty = true;
  updateTitleBar();
}

document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (meta && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
});
```

## 슬라이드형 감지 + 드래그 이동

```js
function isSlideStyle(root) {
  // 루트의 자식 중 position:absolute가 압도적이면 슬라이드형
  const children = Array.from(root.querySelectorAll('*'));
  if (children.length === 0) return false;
  const absCount = children.filter(el => {
    const pos = getComputedStyle(el).position;
    return pos === 'absolute' || pos === 'fixed';
  }).length;
  return absCount / children.length > 0.3; // 30% 이상이면 슬라이드형으로 판단
}

function isMovableTextBox(el) {
  const pos = getComputedStyle(el).position;
  if (pos !== 'absolute' && pos !== 'fixed') return false;
  // 텍스트를 직접 포함하는 요소만
  const hasOwnText = Array.from(el.childNodes).some(
    n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim()
  );
  // 또는 인라인 텍스트만 자식으로
  const onlyInline = Array.from(el.children).every(
    c => getComputedStyle(c).display === 'inline' || getComputedStyle(c).display === 'inline-block'
  );
  return hasOwnText || (el.children.length > 0 && onlyInline);
}

function enableDrag(host) {
  if (!isMovableTextBox(host)) return;
  host.classList.add('htmledit-movable');

  // 드래그 핸들 = 요소 가장자리 (텍스트 영역과 충돌 안 함)
  // 간단 구현: Alt(Option) 키 누르면 드래그 모드
  let dragState = null;

  host.addEventListener('mousedown', (e) => {
    if (!e.altKey) return; // Alt 누른 상태에서만 드래그
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    const parentRect = host.offsetParent.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left - parentRect.left,
      origTop: rect.top - parentRect.top,
      before: { left: host.style.left, top: host.style.top }
    };
    document.body.classList.add('htmledit-dragging');
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    host.style.left = (dragState.origLeft + dx) + 'px';
    host.style.top = (dragState.origTop + dy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragState) return;
    const after = { left: host.style.left, top: host.style.top };
    if (after.left !== dragState.before.left || after.top !== dragState.before.top) {
      undoStack.push({
        type: 'move',
        host,
        before: dragState.before,
        after,
        timestamp: Date.now()
      });
      host.classList.add('htmledit-changed');
      state.dirty = true;
      updateTitleBar();
    }
    dragState = null;
    document.body.classList.remove('htmledit-dragging');
  });
}
```

```css
.htmledit-movable {
  cursor: grab;
}
.htmledit-dragging {
  cursor: grabbing !important;
  user-select: none;
}
.htmledit-changed {
  outline: 2px solid rgba(255, 159, 10, 0.5); /* 변경된 영역 표시 (선택) */
}
```

> **드래그 트리거를 Alt 키로 한 이유:** 텍스트 위 클릭은 편집 진입이어야 하므로 같은 마우스 동작이 두 의도를 가지면 충돌. Alt+드래그는 macOS 디자인 도구들의 공통 컨벤션(Figma, Sketch).

## 저장 시 직렬화

```js
function serializeForSave() {
  // state.originalDoc은 원본 파싱 결과. 우리는 body 내용만 컨테이너에 옮겼으므로,
  // 컨테이너 innerHTML을 원본 body에 다시 넣고 전체 doc를 직렬화
  const bodyHtml = state.container.innerHTML;
  state.originalDoc.body.innerHTML = bodyHtml;

  // DOCTYPE + outerHTML 재구성
  const doctype = state.originalDoc.doctype
    ? `<!DOCTYPE ${state.originalDoc.doctype.name}>\n`
    : '<!DOCTYPE html>\n';
  return doctype + state.originalDoc.documentElement.outerHTML;
}
```

## 메뉴/단축키 통합

```js
window.htmledit.onMenuAction((action) => {
  if (action === 'open') triggerOpen();
  else if (action === 'save') triggerSave();
  else if (action === 'saveAs') triggerSaveAs();
});

window.htmledit.onFileFromOS((filePath) => {
  loadFromPath(filePath);
});
```

## 검증 시점

- DOMParser 호출 직후 → 깨진 HTML 입력 시 에러 처리 동작 확인
- TreeWalker 구현 직후 → 테스트 HTML로 SKIP 태그가 진짜 제외되는지
- 편집 모드 토글 직후 → 호버 표시·포커스 표시가 디자인을 깨지 않는지
- Undo/Redo 직후 → 200개 누적 후 메모리·동작 확인
- 슬라이드 드래그 직후 → make-slide 결과물로 실제 이동, 일반 페이지로 안 움직임 확인
- 직렬화 직후 → 저장된 파일을 다시 열어 원본 head/script/style 보존 확인

## 참고

- 큰 HTML(5만+ 노드)은 TreeWalker가 수백 ms 걸릴 수 있다. v1에서는 진행 표시만 띄움.
- iframe에 로드하지 않고 컨테이너에 직접 넣는 이유: iframe이면 contentEditable 외부 통신이 복잡해지고, 원본 CSS 셀렉터가 컨테이너 클래스와 충돌할 위험이 있어 양쪽 모두 검토 필요. v1은 직접 마운트, 충돌이 잦으면 iframe으로 전환 검토.
