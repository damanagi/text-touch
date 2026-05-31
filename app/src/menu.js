const { Menu } = require('electron');

function buildMenu(getWindow) {
  // 헬퍼: menu-action 전송
  const sendAction = (action) => () => {
    const w = getWindow();
    if (w) w.webContents.send('menu-action', action);
  };

  // 헬퍼: 서식 메뉴 항목 (label, accelerator, action)
  const fmt = (label, accelerator, action) => ({
    label,
    accelerator,
    click: sendAction(action)
  });

  const template = [
    {
      label: 'Text Touch',
      submenu: [
        { role: 'about', label: 'Text Touch 정보' },
        { type: 'separator' },
        { role: 'hide', label: 'Text Touch 숨기기' },
        { role: 'hideOthers', label: '다른 항목 숨기기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: 'Text Touch 종료' }
      ]
    },
    {
      label: '파일',
      submenu: [
        {
          label: '열기...',
          accelerator: 'CmdOrCtrl+O',
          click: sendAction('open')
        },
        { type: 'separator' },
        {
          label: '저장',
          accelerator: 'CmdOrCtrl+S',
          click: sendAction('save')
        },
        {
          label: '다른 이름으로 저장...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: sendAction('saveAs')
        },
        { type: 'separator' },
        {
          // macOS NSDocumentController가 자동 관리하는 최근 문서 목록.
          // app.addRecentDocument(path) 호출이 트리거. clearRecentDocuments role로 초기화.
          label: '최근 파일',
          submenu: [
            { role: 'recentDocuments' },
            { type: 'separator' },
            { role: 'clearRecentDocuments', label: '최근 파일 비우기' }
          ]
        },
        { type: 'separator' },
        {
          label: '백업으로 되돌리기...',
          click: sendAction('restoreBackup')
        },
        {
          label: 'Finder에서 보기',
          click: sendAction('revealInFinder')
        },
        { type: 'separator' },
        { role: 'close', label: '윈도우 닫기' }
      ]
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 하기' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
        { type: 'separator' },
        {
          label: '찾기',
          accelerator: 'CmdOrCtrl+F',
          click: sendAction('find')
        },
        {
          label: '바꾸기',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: sendAction('replace')
        },
        {
          label: '다음 찾기',
          accelerator: 'CmdOrCtrl+G',
          click: sendAction('findNext')
        },
        {
          label: '이전 찾기',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: sendAction('findPrev')
        }
      ]
    },
    {
      label: '서식',
      submenu: [
        fmt('굵게', 'CmdOrCtrl+B', 'format:bold'),
        fmt('기울임', 'CmdOrCtrl+I', 'format:italic'),
        fmt('밑줄', 'CmdOrCtrl+U', 'format:underline'),
        fmt('취소선', 'CmdOrCtrl+Shift+X', 'format:strikethrough'),
        { type: 'separator' },
        fmt('위첨자', 'CmdOrCtrl+Shift+=', 'format:superscript'),
        fmt('아래첨자', 'CmdOrCtrl+=', 'format:subscript'),
        { type: 'separator' },
        fmt('왼쪽 정렬', 'CmdOrCtrl+L', 'format:alignLeft'),
        fmt('가운데 정렬', 'CmdOrCtrl+E', 'format:alignCenter'),
        fmt('오른쪽 정렬', 'CmdOrCtrl+R', 'format:alignRight'),
        fmt('양쪽 정렬', 'CmdOrCtrl+J', 'format:alignJustify'),
        { type: 'separator' },
        fmt('글머리 기호', null, 'format:insertUnorderedList'),
        fmt('번호 매기기', null, 'format:insertOrderedList'),
        fmt('들여쓰기', 'CmdOrCtrl+]', 'format:indent'),
        fmt('내어쓰기', 'CmdOrCtrl+[', 'format:outdent'),
        { type: 'separator' },
        fmt('서식 지우기', 'CmdOrCtrl+\\', 'format:removeFormat')
      ]
    },
    {
      label: '보기',
      submenu: [
        {
          label: '편집 모드 켜기/끄기',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: sendAction('toggleEdit')
        },
        { type: 'separator' },
        { role: 'reload', label: '새로고침' },
        { role: 'toggleDevTools', label: '개발자 도구' },
        { type: 'separator' },
        { role: 'resetZoom', label: '실제 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        { type: 'separator' },
        {
          label: '이미지 alt 편집',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: sendAction('toggleAltPanel')
        }
      ]
    },
    {
      label: '윈도우',
      submenu: [
        { role: 'minimize', label: '최소화' },
        { role: 'zoom', label: '확대/축소' },
        { type: 'separator' },
        { role: 'front', label: '앞으로' }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
