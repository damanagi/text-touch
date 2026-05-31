const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { dialog } = require('electron');
const iconv = require('iconv-lite');

// ───────────────────────────────────────────
// 백업 루트 디렉터리 결정
// ───────────────────────────────────────────
// fs-handlers는 메인 프로세스의 app 모듈에 직접 접근하지 않는다.
// electron-architect는 app ready 시 process.env.TEXTTOUCH_USER_DATA_DIR = app.getPath('userData')
// 한 줄을 main.js에 추가해줘야 한다. 환경 변수가 없으면 macOS 기본 경로로 폴백.
function backupRootDir() {
  const envRoot = process.env.TEXTTOUCH_USER_DATA_DIR;
  if (envRoot && envRoot.length > 0) {
    return path.join(envRoot, 'backups');
  }
  // macOS 기본 폴백
  return path.join(os.homedir(), 'Library', 'Application Support', 'Text Touch', 'backups');
}

function backupDirFor(originalPath) {
  const hash = crypto.createHash('sha1').update(originalPath).digest('hex').slice(0, 12);
  return path.join(backupRootDir(), hash);
}

// ───────────────────────────────────────────
// 인코딩 정규화
// ───────────────────────────────────────────

function normalizeEncoding(name) {
  if (!name) return 'utf-8';
  const n = String(name).toLowerCase().trim();
  if (n === 'utf8' || n === 'utf-8') return 'utf-8';
  if (n === 'utf-16' || n === 'utf-16le' || n === 'utf16le') return 'utf-16le';
  if (n === 'utf-16be' || n === 'utf16be') return 'utf-16be';
  // 한국어 레거시
  if (n === 'euc-kr' || n === 'euckr' || n === 'ks_c_5601-1987' || n === 'ksc5601' || n === 'cp949' || n === 'ms949' || n === 'windows-949') return 'euc-kr';
  // 일본어
  if (n === 'shift_jis' || n === 'shift-jis' || n === 'sjis' || n === 'cp932' || n === 'windows-31j') return 'shift_jis';
  // 중국어 간체
  if (n === 'gb2312' || n === 'gbk' || n === 'gb18030' || n === 'cp936') return 'gb2312';
  // 중국어 번체
  if (n === 'big5' || n === 'cp950') return 'big5';
  // 라틴
  if (n === 'iso-8859-1' || n === 'latin1' || n === 'windows-1252' || n === 'cp1252') return n;
  return n;
}

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
  if (m) declared = m[1];
  if (!declared) {
    m = head.match(/<meta[^>]+http-equiv\s*=\s*["']?Content-Type["']?[^>]+charset\s*=\s*([\w-]+)/i);
    if (m) declared = m[1];
  }

  if (declared) {
    return { buf, encoding: normalizeEncoding(declared), bom: false };
  }
  return { buf, encoding: 'utf-8', bom: false };
}

// ───────────────────────────────────────────
// 디코딩 — utf-8/16le는 Node 네이티브, 나머지는 iconv-lite
// ───────────────────────────────────────────

function decodeBuffer({ buf, encoding, bom }) {
  const enc = normalizeEncoding(encoding);

  if (enc === 'utf-8') {
    return bom ? buf.slice(3).toString('utf-8') : buf.toString('utf-8');
  }
  if (enc === 'utf-16le') {
    return bom ? buf.slice(2).toString('utf-16le') : buf.toString('utf-16le');
  }
  if (enc === 'utf-16be') {
    // Node는 utf-16be 직접 미지원 — iconv-lite 사용
    const slice = bom ? buf.slice(2) : buf;
    return iconv.decode(slice, 'utf-16be');
  }

  // 비표준 인코딩 — iconv-lite로 정확히 디코딩
  if (iconv.encodingExists(enc)) {
    return iconv.decode(buf, enc);
  }

  // 알 수 없는 인코딩 → utf-8 폴백
  return buf.toString('utf-8');
}

// ───────────────────────────────────────────
// 줄바꿈 처리
// ───────────────────────────────────────────

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
// 백업 디렉터리 헬퍼
// ───────────────────────────────────────────

const BACKUP_KEEP = 5;

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatTimestamp(date) {
  const y = date.getFullYear();
  const M = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const m = pad2(date.getMinutes());
  return `${y}${M}${d}-${h}${m}`;
}

async function ensureBackupDir(originalPath) {
  const dir = backupDirFor(originalPath);
  await fs.mkdir(dir, { recursive: true });

  // original.txt 기록 (존재하지 않거나 내용이 다르면 덮어쓰기)
  const metaPath = path.join(dir, 'original.txt');
  let needsWrite = true;
  try {
    const existing = await fs.readFile(metaPath, 'utf-8');
    if (existing.trim() === originalPath) needsWrite = false;
  } catch (_) { /* not exists */ }
  if (needsWrite) {
    await fs.writeFile(metaPath, originalPath, 'utf-8');
  }

  return dir;
}

async function listBackupHtmlFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const htmlFiles = entries.filter((name) => /\.html$/i.test(name) && !/\.tmp\.html$/i.test(name));
  const stats = await Promise.all(htmlFiles.map(async (name) => {
    const full = path.join(dir, name);
    try {
      const s = await fs.stat(full);
      return { name, path: full, mtime: s.mtime.getTime(), size: s.size };
    } catch (_) {
      return null;
    }
  }));
  return stats.filter(Boolean);
}

// ───────────────────────────────────────────
// 백업 생성 + 회전 (atomic)
// ───────────────────────────────────────────

async function createBackup(originalPath, sourceFilePath) {
  const dir = await ensureBackupDir(originalPath);

  // 타임스탬프 기반 파일명, 충돌 시 suffix
  const now = new Date();
  const baseTs = formatTimestamp(now);
  let finalName = `${baseTs}.html`;
  let finalPath = path.join(dir, finalName);
  let suffix = 1;
  // 충돌 회피 (같은 분에 여러 저장 시)
  while (true) {
    try {
      await fs.access(finalPath);
      // 존재함 → suffix 증가
      finalName = `${baseTs}-${suffix}.html`;
      finalPath = path.join(dir, finalName);
      suffix += 1;
    } catch (_) {
      break;
    }
  }

  // atomic: 먼저 .tmp.html로 완전히 쓴 뒤 rename
  const tmpName = `${baseTs}-${process.pid}-${Date.now()}.tmp.html`;
  const tmpPath = path.join(dir, tmpName);

  await fs.copyFile(sourceFilePath, tmpPath);

  // fsync (베스트 에포트)
  try {
    const fh = await fs.open(tmpPath, 'r+');
    await fh.sync();
    await fh.close();
  } catch (_) { /* noop */ }

  await fs.rename(tmpPath, finalPath);

  // 회전 — 최근 5개 유지
  const all = await listBackupHtmlFiles(dir);
  all.sort((a, b) => b.mtime - a.mtime); // 최신순
  const toDelete = all.slice(BACKUP_KEEP);
  for (const entry of toDelete) {
    try { await fs.unlink(entry.path); } catch (_) { /* atomic: 실패해도 정상 슬롯 영향 X */ }
  }

  return finalPath;
}

// ───────────────────────────────────────────
// 원자적 쓰기 (인코딩 라운드트립 포함)
// ───────────────────────────────────────────

function encodeText(content, encoding, bom) {
  const enc = normalizeEncoding(encoding);

  if (enc === 'utf-8') {
    const bomBytes = bom ? Buffer.from([0xEF, 0xBB, 0xBF]) : Buffer.alloc(0);
    return Buffer.concat([bomBytes, Buffer.from(content, 'utf-8')]);
  }
  if (enc === 'utf-16le') {
    const bomBytes = bom ? Buffer.from([0xFF, 0xFE]) : Buffer.alloc(0);
    return Buffer.concat([bomBytes, Buffer.from(content, 'utf-16le')]);
  }
  if (enc === 'utf-16be') {
    const bomBytes = bom ? Buffer.from([0xFE, 0xFF]) : Buffer.alloc(0);
    const body = iconv.encode(content, 'utf-16be');
    return Buffer.concat([bomBytes, body]);
  }

  // 비표준 — iconv-lite로 인코딩 시도, 실패 시 ENCODING_INCOMPATIBLE
  if (!iconv.encodingExists(enc)) {
    const err = new Error(`입력하신 텍스트에 ${encoding} 인코딩으로 표현할 수 없는 글자가 있습니다. UTF-8로 저장하거나 글자를 수정해주세요.`);
    err.code = 'ENCODING_INCOMPATIBLE';
    throw err;
  }

  // iconv-lite는 표현 불가 글자를 기본적으로 '?'로 치환하므로 라운드트립 검증으로 손실 감지
  const encoded = iconv.encode(content, enc);
  const decoded = iconv.decode(encoded, enc);
  if (decoded !== content) {
    const err = new Error(`입력하신 텍스트에 ${encoding} 인코딩으로 표현할 수 없는 글자가 있습니다. UTF-8로 저장하거나 글자를 수정해주세요.`);
    err.code = 'ENCODING_INCOMPATIBLE';
    throw err;
  }

  return encoded;
}

async function atomicWrite(filePath, content, { encoding, bom }) {
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();

  const buf = encodeText(content, encoding || 'utf-8', !!bom);

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
// 원본 덮어쓰기 — 백업은 시스템 위치, 사용자 폴더는 깔끔
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

  // 백업 — 시스템 위치로 (사용자 폴더에 .bak 만들지 않음)
  let backupPath;
  try {
    backupPath = await createBackup(filePath, filePath);
  } catch (e) {
    const err = new Error(`백업을 만들 수 없어 저장을 중단했어요: ${e.message}`);
    err.code = 'BACKUP_FAIL';
    throw err;
  }

  // 줄바꿈 적용 + 원자적 쓰기 (원본 인코딩 보존)
  const finalText = applyLineEnding(html, lineEnding || '\n');
  try {
    await atomicWrite(filePath, finalText, { encoding: encoding || 'utf-8', bom: !!bom });
  } catch (e) {
    if (e.code === 'ENCODING_INCOMPATIBLE') {
      // 백업은 이미 만들어졌지만 원본은 그대로 — 사용자가 텍스트 수정 후 재시도하거나 UTF-8 변환 동의 필요
      throw e;
    }
    const err = new Error(`저장 실패: ${e.message}\n원본은 백업 위치(${backupPath})에 안전하게 보관됐어요.`);
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
    if (e.code === 'ENCODING_INCOMPATIBLE') throw e;
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

// ───────────────────────────────────────────
// 백업 목록 / 복원
// ───────────────────────────────────────────

function relativeTimeLabel(mtimeMs, now = Date.now()) {
  const diff = Math.max(0, now - mtimeMs);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);

  if (sec < 60) return '방금 전';
  if (min < 60) return `${min}분 전`;
  if (hour < 24) return `${hour}시간 전`;
  if (day < 7) return `${day}일 전`;

  const d = new Date(mtimeMs);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function listBackups({ originalPath }) {
  if (!originalPath) return [];
  const dir = backupDirFor(originalPath);
  const entries = await listBackupHtmlFiles(dir);
  if (entries.length === 0) return [];

  entries.sort((a, b) => b.mtime - a.mtime); // 최신순

  const now = Date.now();
  return entries.map((e) => ({
    path: e.path,
    mtime: e.mtime,
    size: e.size,
    label: relativeTimeLabel(e.mtime, now)
  }));
}

async function restoreBackup({ backupPath, targetPath }) {
  if (!backupPath || !targetPath) {
    const err = new Error('복원할 백업 또는 대상 경로가 비어 있어요.');
    err.code = 'RESTORE_INVALID';
    throw err;
  }

  // 1) backupPath가 우리 백업 루트 내부인지 검증
  const root = backupRootDir();
  const resolvedBackup = path.resolve(backupPath);
  const resolvedRoot = path.resolve(root);
  if (!resolvedBackup.startsWith(resolvedRoot + path.sep)) {
    const err = new Error('백업 경로가 시스템 백업 디렉터리 안에 있지 않아요. 보안상 거부합니다.');
    err.code = 'RESTORE_OUTSIDE_ROOT';
    throw err;
  }

  // 2) 같은 디렉터리의 original.txt가 targetPath와 일치하는지 검증
  const backupDir = path.dirname(resolvedBackup);
  const metaPath = path.join(backupDir, 'original.txt');
  let recordedOriginal = null;
  try {
    recordedOriginal = (await fs.readFile(metaPath, 'utf-8')).trim();
  } catch (_) {
    const err = new Error('백업 폴더의 원본 경로 메타 정보를 찾을 수 없어요. 복원을 중단합니다.');
    err.code = 'RESTORE_NO_META';
    throw err;
  }
  if (recordedOriginal !== targetPath) {
    const err = new Error(`복원 대상 경로가 원본 백업의 기록(${recordedOriginal})과 일치하지 않아요.`);
    err.code = 'RESTORE_PATH_MISMATCH';
    throw err;
  }

  // 3) targetPath 쓰기 권한 확인 (대상 디렉터리)
  try {
    await fs.access(path.dirname(targetPath), fs.constants.W_OK);
  } catch {
    const err = new Error(`복원 대상 폴더에 쓰기 권한이 없어요: ${path.basename(path.dirname(targetPath))}`);
    err.code = 'EACCES_USER';
    throw err;
  }

  // 4) 백업 → 대상으로 atomic 복사 (백업 회전은 만들지 않음)
  const tmpPath = targetPath + '.tmp.' + process.pid + '.' + Date.now();
  try {
    await fs.copyFile(resolvedBackup, tmpPath);
    try {
      const fh = await fs.open(tmpPath, 'r+');
      await fh.sync();
      await fh.close();
    } catch (_) { /* noop */ }
    await fs.rename(tmpPath, targetPath);
  } catch (e) {
    // 임시 파일 정리
    try { await fs.unlink(tmpPath); } catch (_) { /* noop */ }
    const err = new Error(`복원 실패: ${e.message}`);
    err.code = 'RESTORE_WRITE_FAIL';
    throw err;
  }

  return { success: true, restored: true };
}

module.exports = {
  loadFile,
  saveOriginal,
  saveAs,
  openFileDialog,
  listBackups,
  restoreBackup
};
