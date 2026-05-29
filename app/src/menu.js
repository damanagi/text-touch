const { Menu } = require('electron');

function buildMenu(getWindow) {
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
          click: () => {
            const w = getWindow();
            if (w) w.webContents.send('menu-action', 'open');
          }
        },
        { type: 'separator' },
        {
          label: '저장',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const w = getWindow();
            if (w) w.webContents.send('menu-action', 'save');
          }
        },
        {
          label: '다른 이름으로 저장...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const w = getWindow();
            if (w) w.webContents.send('menu-action', 'saveAs');
          }
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
        { role: 'selectAll', label: '모두 선택' }
      ]
    },
    {
      label: '보기',
      submenu: [
        {
          label: '편집 모드 토글',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            const w = getWindow();
            if (w) w.webContents.send('menu-action', 'toggleEdit');
          }
        },
        { type: 'separator' },
        { role: 'reload', label: '새로고침' },
        { role: 'toggleDevTools', label: '개발자 도구' },
        { type: 'separator' },
        { role: 'resetZoom', label: '실제 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' }
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
