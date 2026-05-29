const fs = require('fs').promises;
const path = require('path');
const { dialog } = require('electron');

// ───────────────────────────────────────────
// 인코딩 감지
// ───────────────────────────────────────────

async function detectEncoding(filePath) {
  const buf = await fs.readFile(filePath);

  // BOM 우선
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { buf, encoding: 'utf-8', bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return { buf, encoding: 'utf-16le', bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    return { buf, encoding: 'utf-16be', bom: true };
  }

  // meta charset 추출 (앞 4KB만 latin1으로 디코딩해도 ASCII는 OK)
  const head = buf.slice(0, 4096).toString('latin1');
  let declared = null;
  let m = head.match(/<meta\s+charset\s*=\s*["']?([\w-]+)/i);
  if (m) declared = m[1].toLowerCase();
  if (!declared) {
    m = head.match(/<meta[^>]+http-equiv\s*=\s*["']?Content-Type["']?[^>]+charset\s*=\s*([\w-]+)/i);
    if (m) declared = m[1].toLowerCase();
  }

  if (declared) {
    if (declared === 'utf-8' || declared === 'utf8') return { buf, encoding: 'utf-8', bom: false };
    if (declared === 'utf-16' || declared === 'utf-16le') return { buf, encoding: 'utf-16le', bom: false };
    return { buf, encoding: declared, bom: false };
  }
  return { buf, encoding: 'utf-8', bom: false };
}

function decodeBuffer({ buf, encoding, bom }) {
  if (encoding === 'utf-8') {
    return bom ? buf.slice(3).toString('utf-8') : buf.toString('utf-8');
  }
  if (encoding === 'utf-16le') {
    return bom ? buf.slice(2).toString('utf-16le') : buf.toString('utf-16le');
  }
  // 비표준 인코딩 → utf-8로 가정 (글자 깨질 가능성, 사용자 안내)
  return buf.toString('utf-8');
}

function detectLineEnding(text) {
  const sample = text.slice(0, 2048);
  const crlfCount = (sample.match(/\r\n/g) || []).length;
  const lfCount = (sample.match(/(?<!\r)\n/g) || []).length;
  if (crlfCount > 0 && crlfCount >= lfCount) return '\r\n';
  return '\n';
}

function applyLineEnding(text, lineEnding) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (lineEnding === '\r\n') return normalized.replace(/\n/g, '\r\n');
  return normalized;
}

// ───────────────────────────────────────────
// 파일 로드
// ───────────────────────────────────────────

async function loadFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`파일이 아니에요: ${filePath}`);
  }

  const { buf, encoding, bom } = await detectEncoding(filePath);
  const text = decodeBuffer({ buf, encoding, bom });
  const lineEnding = detectLineEnding(text);

  const isStandardEncoding = ['utf-8', 'utf-16le', 'utf-16be'].includes(encoding);

  return {
    path: filePath,
    html: text,
    encoding,
    bom,
    lineEnding,
    legacyEncodingWarn: !isStandardEncoding
  };
}

// ───────────────────────────────────────────
// 백업 회전 (.bak / .bak.1 / .bak.2)
// ───────────────────────────────────────────

async function rotateBackup(filePath) {
  const bak = filePath + '.bak';
  const bak1 = filePath + '.bak.1';
  const bak2 = filePath + '.bak.2';

  try { await fs.rename(bak1, bak2); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { await fs.rename(bak, bak1); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.copyFile(filePath, bak);

  return bak;
}

// ───────────────────────────────────────────
// 원자적 쓰기
// ───────────────────────────────────────────

async function atomicWrite(filePath, content, { encoding, bom }) {
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();

  let buf;
  if (encoding === 'utf-8' || !['utf-16le', 'utf-16be'].includes(encoding)) {
    const bomBytes = (encoding === 'utf-8' && bom) ? Buffer.from([0xEF, 0xBB, 0xBF]) : Buffer.alloc(0);
    buf = Buffer.concat([bomBytes, Buffer.from(content, 'utf-8')]);
  } else if (encoding === 'utf-16le') {
    const bomBytes = bom ? Buffer.from([0xFF, 0xFE]) : Buffer.alloc(0);
    buf = Buffer.concat([bomBytes, Buffer.from(content, 'utf-16le')]);
  } else {
    buf = Buffer.from(content, 'utf-8');
  }

  await fs.writeFile(tmpPath, buf);

  // fsync (실패해도 무시 — 일부 파일시스템 미지원)
  try {
    const fh = await fs.open(tmpPath, 'r+');
    await fh.sync();
    await fh.close();
  } catch (_) { /* noop */ }

  await fs.rename(tmpPath, filePath);
}

// ───────────────────────────────────────────
// 원본 덮어쓰기
// ───────────────────────────────────────────

async function saveOriginal({ filePath, html, encoding, bom, lineEnding }) {
  // 권한 검사
  try {
    await fs.access(filePath, fs.constants.W_OK);
  } catch {
    const e = new Error(`파일에 쓰기 권한이 없어요: ${path.basename(filePath)}`);
    e.code = 'EACCES_USER';
    throw e;
  }

  // 백업
  let backupPath;
  try {
    backupPath = await rotateBackup(filePath);
  } catch (e) {
    const err = new Error(`백업을 만들 수 없어 저장을 중단했어요: ${e.message}`);
    err.code = 'BACKUP_FAIL';
    throw err;
  }

  // 줄바꿈 적용 + 원자적 쓰기
  const finalText = applyLineEnding(html, lineEnding || '\n');
  try {
    await atomicWrite(filePath, finalText, { encoding: encoding || 'utf-8', bom: !!bom });
  } catch (e) {
    const err = new Error(`저장 실패: ${e.message}\n원본은 ${path.basename(backupPath)} 에 안전하게 백업됐어요.`);
    err.code = 'WRITE_FAIL';
    throw err;
  }

  return { success: true, backupPath };
}

// ───────────────────────────────────────────
// 다른 이름으로 저장
// ───────────────────────────────────────────

async function saveAs({ suggestedName, html, encoding, bom, lineEnding }, parentWindow) {
  const result = await dialog.showSaveDialog(parentWindow, {
    defaultPath: suggestedName || 'untitled.html',
    filters: [
      { name: 'HTML', extensions: ['html', 'htm'] }
    ]
  });

  if (result.canceled || !result.filePath) return null;

  const finalText = applyLineEnding(html, lineEnding || '\n');
  try {
    await atomicWrite(result.filePath, finalText, { encoding: encoding || 'utf-8', bom: !!bom });
  } catch (e) {
    const err = new Error(`저장 실패: ${e.message}`);
    err.code = 'WRITE_FAIL';
    throw err;
  }

  return { success: true, newPath: result.filePath };
}

// ───────────────────────────────────────────
// 파일 열기 다이얼로그
// ───────────────────────────────────────────

async function openFileDialog(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'HTML', extensions: ['html', 'htm'] }
    ]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  return loadFile(result.filePaths[0]);
}

module.exports = {
  loadFile,
  saveOriginal,
  saveAs,
  openFileDialog
};
